/**
 * 调度逻辑 —— 两道闸串联 + 产路地板 + 动态阈值 T。
 *
 * 真源：SPEC §4（来源 N-3 + B5）；登记册「N-3 章节」。
 *
 *  闸1 路由：sim_max ≥ T → template 产路 / custom 产路（决定走哪条产路）
 *  闸2 审核强度：按 confidence 只调制人工介入强度，**不回头改产路**
 *
 * 目的是避免同一模糊点被**双重惩罚**。闸2 不许回头改产路。
 */

import type { ReviewLevel, Routing, ScheduleDecision } from './types.ts';
import {
  SAFETY_VALVE_MEDIAN,
  T_BOUNDS,
  T_SMALL_SAMPLE,
  TEMPLATE_QUOTA,
} from './config.ts';
import { ConfigError } from './exit-code.ts';

/** 审核强度偏序：auto < alternatives < must_review。产路地板靠它取 max。 */
const LEVEL_ORDER: Record<ReviewLevel, number> = {
  auto: 0,
  alternatives: 1,
  must_review: 2,
};

const ORDER_LEVEL: ReviewLevel[] = ['auto', 'alternatives', 'must_review'];

export function maxReview(a: ReviewLevel, b: ReviewLevel): ReviewLevel {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

/**
 * 🔴 PLACEHOLDER —— 闸2 的 confidence 分档边界。
 *
 * 真源只给了组合矩阵（低/中/高 → must_review/alternatives/auto），
 * **未给 低/中/高 的分界数值**。此处为占位值，须与 C2-2 一并实测校准。
 */
export const CONFIDENCE_BANDS = {
  /** confidence ≥ high → auto */
  high: 0.8,
  /** confidence ≥ mid → alternatives；低于 mid → must_review */
  mid: 0.5,
  placeholder: true as const,
} as const;

/** 闸2：只吃 confidence，对产路一无所知。 */
export function gate2(confidence: number): ReviewLevel {
  if (confidence >= CONFIDENCE_BANDS.high) return 'auto';
  if (confidence >= CONFIDENCE_BANDS.mid) return 'alternatives';
  return 'must_review';
}

/**
 * 产路地板：把 B4 的「custom 必审」从**强制改写**降格为**取值域收紧**。
 *
 * | routing  | review 地板    | 闸2 调节能力       |
 * |----------|---------------|-------------------|
 * | template | auto          | 完全保留           |
 * | custom   | must_review   | 失效（被地板锁死） |
 */
export function routingFloor(routing: Routing): ReviewLevel {
  return routing === 'custom' ? 'must_review' : 'auto';
}

/** 最终 review = max(闸2输出, 产路地板)。 */
export function finalReview(routing: Routing, confidence: number): ReviewLevel {
  return maxReview(gate2(confidence), routingFloor(routing));
}

/** 闸1：按动态阈值判定产路。 */
export function route(simMax: number, threshold: number): Routing {
  return simMax >= threshold ? 'template' : 'custom';
}

export interface ThresholdResult {
  /** 判定用阈值。安全阀触发时无意义（应整批转 custom）。 */
  T: number;
  /** 安全阀：整批 sim_max 中位数 < 0.4 → 库不适配，整批转 custom + 人审。 */
  safetyValve: boolean;
  reason: string;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) throw new ConfigError('median: 空数组');
  const mid = n >> 1;
  if (n % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** 线性插值分位数（R-7 / Excel PERCENTILE.INC）。`p` ∈ [0,1]。 */
export function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) throw new ConfigError('quantile: 空数组');
  if (n === 1) return sorted[0] as number;
  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * frac;
}

/**
 * 动态阈值 T = clamp( 间隙锚 , 约束于 配额锚分位 )。
 *
 *  - 配额锚：期望走库比例 70%–90% ⇒ T 应落在 sim_max 分布的
 *            10%–30% 分位之间（≥ T 的比例即走库比例）。
 *  - 间隙锚：分数排序后的最大间隙（elbow）取中点。
 *  - 硬边界：再夹到 [0.50, 0.80] —— 是**边界**，不是取值。
 *  - 样本少：N < 8 → 退化固定 T = 0.65。
 */
export function computeThreshold(simScores: number[]): ThresholdResult {
  if (simScores.length === 0) {
    throw new ConfigError('computeThreshold: 至少需要一个 sim_max 分数');
  }
  const sorted = [...simScores].sort((a, b) => a - b);

  // 安全阀优先于一切 —— 库不适配时禁止降阈值硬套库。
  if (median(sorted) < SAFETY_VALVE_MEDIAN) {
    return {
      T: T_BOUNDS.min,
      safetyValve: true,
      reason: `整批 sim_max 中位数 ${median(sorted).toFixed(3)} < ${SAFETY_VALVE_MEDIAN} → 库不适配，整批转 custom + 人审`,
    };
  }

  if (sorted.length < T_SMALL_SAMPLE.minSamples) {
    return {
      T: T_SMALL_SAMPLE.threshold,
      safetyValve: false,
      reason: `N=${sorted.length} < ${T_SMALL_SAMPLE.minSamples} → 退化固定 T=${T_SMALL_SAMPLE.threshold}`,
    };
  }

  // 间隙锚：最大间隙的中点
  let elbow = sorted[0] as number;
  let bestGap = -1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = (sorted[i] as number) - (sorted[i - 1] as number);
    if (gap > bestGap) {
      bestGap = gap;
      elbow = ((sorted[i] as number) + (sorted[i - 1] as number)) / 2;
    }
  }

  // 配额锚：走库比例 70%–90% ⇒ 分位区间 [1-0.90, 1-0.70] = [0.10, 0.30]
  const qLow = quantile(sorted, 1 - TEMPLATE_QUOTA.max);
  const qHigh = quantile(sorted, 1 - TEMPLATE_QUOTA.min);
  let T = Math.min(Math.max(elbow, qLow), qHigh);
  // 硬边界
  T = Math.min(Math.max(T, T_BOUNDS.min), T_BOUNDS.max);

  return {
    T,
    safetyValve: false,
    reason: `elbow=${elbow.toFixed(3)}，配额锚区间 [${qLow.toFixed(3)}, ${qHigh.toFixed(3)}]，硬边界 [${T_BOUNDS.min}, ${T_BOUNDS.max}] → T=${T.toFixed(3)}`,
  };
}

/** 完整决策：给定 sim_max 与 confidence，产出唯一确定的 ScheduleDecision。 */
export function decide(simMax: number, confidence: number, T: number): ScheduleDecision {
  const routing = route(simMax, T);
  return {
    sim_max: simMax,
    confidence,
    routing,
    review: finalReview(routing, confidence),
  };
}
