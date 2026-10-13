/**
 * 遮挡校验与自动降级：项 #12 / #13 / #14，以及三条起草原生约束。
 *
 * 核心洞察（D2）：**遮挡容忍度不是标量，是向量。**
 * 判别方式不是「有没有相交」，而是「从各级区域各拿了多少遮挡额度，总和超预算才报错」。
 * 优先级：安全区判定（D）**优先于** C4 的 exclusive 组判定 —— 遮挡主体是硬约束。
 *
 * ── 关于两条错误码的分工（本实现的裁决，文档未逐一细化）───────────
 * 文档把「预算超了」(#12) 与「三级退让用尽」(#13) 列为两个校验项、两个码。
 * 为避免同一根因重复报两次，实现按**退让阶段**划分：
 *
 *   E-D4-01  三级退让**无法启动**（tier2 载体档对该 scope 不适用）
 *            —— 根因是「退路不存在」
 *   E-D2-01  载体档已应用，**仍然**超预算（如区域几乎占满画面，没有载体余量）
 *            —— 根因是「退路不够」
 *
 * 两者互斥，合起来覆盖全部失败情形。
 */

import { CODES } from '../core/errors.ts';
import type { ReportItem } from '../core/report.ts';
import { OCCLUSION_BUDGET, carrierFallbackFor } from '../core/config.ts';
import type { Footprint, PerceiveRegion, RegionKind } from '../core/types.ts';
import { isOverlayScope } from '../templates/types.ts';
import type { SceneItem, ValidateContext } from './context.ts';
import { clampRect, framesOverlap, rectArea, rectOverlapArea } from './context.ts';
import { mk } from './item.ts';

/** 区域等级的预算。来源：SPEC §2.6 / D2。 */
function budgetOf(kind: RegionKind): number {
  return OCCLUSION_BUDGET[kind];
}

type ResolveStatus = 'nudged' | 'carrier' | 'carrier-insufficient' | 'no-carrier';

export interface Resolution {
  status: ResolveStatus;
  detail: string;
}

/** 平移候选网格 —— 让「挪一下就好」有确定的尝试范围，且结果可复现。 */
const NUDGE_STEPS = [-0.2, -0.1, 0, 0.1, 0.2];

/**
 * D4 三级退让：
 *   ① 同预算内尝试挪动 footprint（不动时间轴、不改文案）
 *   ② 挪不动则自动切 carrier 模式（画面缩进载体框，motion 在框外播放）
 *   ③ 仍冲突才报错
 *
 * ── 2026-10-13 修复：tier1 曾是「假绿」────────────────────────────────
 * 实测证明：tier1 算出的 candidate 矩形**只被拼进 detail 字符串**，从不回写
 * `item.footprint`；调用方对 `status==='nudged'` 直接 `continue`。于是
 * 「挪得开」的真实含义只是「我不报错了」，而非「我把东西挪走了」——
 * 动效仍压在主体区、成片照样拍出来，而报告写着 `ok: true`。
 *
 * 现在 tier1 **真正回写** `item.footprint`（`SceneItem.item` 持有对象引用非拷贝，
 * 故这是内存内改写）。关于「校验器是纯函数」：
 * 该约束（SPEC §2.1 / context.ts 头注释）指的是**不再读磁盘、不写磁盘**，
 * 落盘仍由 render 阶段负责，并未触碰。改内存中的场景对象不破坏阶段快照不可变性。
 *
 * ⚠️ tier2（carrier）**仍是空操作**：它只抑制报错，不改 motion 也不改 footprint。
 *   这是已知缺口，见 `W-D4-01` 与2026-10-13 裁决材料 §1.5
 *   （修 tier2 须先在登记册立一条承载字段的裁决）。
 */
export function resolveOcclusion(
  item: SceneItem,
  region: PerceiveRegion,
  ratio: number,
  budget: number,
): Resolution {
  const box = region.box;

  // ① 同预算内挪动 footprint
  for (const dy of NUDGE_STEPS) {
    for (const dx of NUDGE_STEPS) {
      if (dx === 0 && dy === 0) continue;
      const [x, y, w, h] = item.item.footprint;
      const candidate = clampRect([x + dx, y + dy, w, h]);
      const r = rectOverlapArea(candidate, box) / rectArea(box);
      if (r <= budget) {
        // 🔴 真正回写 —— 这是「挪得开」的兑现，而非仅消除报错
        item.item.footprint = candidate;
        return {
          status: 'nudged',
          detail: `平移 footprint 至 [${candidate.map((v) => v.toFixed(2)).join(', ')}] 后遮挡率 ${(r * 100).toFixed(1)}% ≤ 预算 ${(budget * 100).toFixed(0)}%`,
        };
      }
    }
  }

  // ② 自动切 carrier 模式
  //    载体映射要求**显式登记**（见 config.CARRIER_FALLBACK）：
  //    为任意 motion 自动挑载体不安全，未登记即视为「退路不存在」。
  const carrierId = carrierFallbackFor(item.item.motion);
  if (!carrierId) {
    return {
      status: 'no-carrier',
      detail: `motion "${item.item.motion}" 未登记载体映射（config.CARRIER_FALLBACK），三级退让无法启动`,
    };
  }
  if (!isOverlayScope(item.tpl.scope)) {
    return {
      status: 'no-carrier',
      detail: `scope "${item.tpl.scope}" 不是叠加类，载体降级不适用`,
    };
  }

  // 载体余量：区域几乎占满画面时，画面没有可缩进的位置
  const regionAreaRatio = rectArea(box);
  if (regionAreaRatio > 0.9) {
    return {
      status: 'carrier-insufficient',
      detail: `区域占画面 ${(regionAreaRatio * 100).toFixed(1)}%，缩进载体框后无可用余量，遮挡率仍为 ${(ratio * 100).toFixed(1)}%`,
    };
  }

  return {
    status: 'carrier',
    detail:
      `已登记载体档 ${carrierId}，但**当前实现不施加载体变换**` +
      `（tier2 尚未实现，见 W-D4-01）；motion 与 footprint 均未被改写`,
  };
}

/** 一个 item 对某个区域的遮挡率（该 item 覆盖面占区域面积的比例）。 */
function occlusionRatio(item: Footprint, box: Footprint): number {
  const area = rectArea(box);
  if (area <= 0) return 0;
  return rectOverlapArea(item, box) / area;
}

interface Hit {
  scene: SceneItem;
  region: PerceiveRegion;
  ratio: number;
}

function collectHits(ctx: ValidateContext): Hit[] {
  const hits: Hit[] = [];
  for (const region of ctx.perceive.regions) {
    for (const s of ctx.scene) {
      // 只有叠加类才遮挡画面；载体类改变的是视频本身的呈现（D 分支的解法，不是遮挡）
      if (!isOverlayScope(s.tpl.scope)) continue;
      if (s.tpl.scope === 'fullscreen') continue; // 归 D3 人工确认，不进预算
      if (!framesOverlap(s.start, s.end, region.fromFrame, region.fromFrame + region.durationInFrames)) {
        continue;
      }
      const ratio = occlusionRatio(s.item.footprint, region.box);
      if (ratio <= budgetOf(region.kind)) continue;
      hits.push({ scene: s, region, ratio });
    }
  }
  return hits;
}

/** #12 遮挡分级预算（人脸 / 手持物）+ #13 载体三级退让。 */
export function checkOcclusionBudget(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const hit of collectHits(ctx)) {
    if (hit.region.kind === 'broll') continue; // 归 #14
    const budget = budgetOf(hit.region.kind);
    const res = resolveOcclusion(hit.scene, hit.region, hit.ratio, budget);
    const frames = [Math.max(hit.scene.start, hit.region.fromFrame), Math.min(hit.scene.end, hit.region.fromFrame + hit.region.durationInFrames)];
    const head =
      `区域 ${hit.region.id}（${hit.region.kind}）被遮挡 ${(hit.ratio * 100).toFixed(1)}%，` +
      `超预算 ${(budget * 100).toFixed(0)}%`;

    // 🔴 2026-10-13：退让成功不再静默continue，而是**留下可对账的告警**。
    //   修复前这两个分支直接跳过，导致「校验通过」与「产物真的变了」无法对账。
    if (res.status === 'nudged') {
      out.push(
        mk(
          CODES.OCCLUSION_NUDGED,
          'build',
          [hit.scene.ref, hit.region.id],
          frames,
          `${head}；已平移消解 —— ${res.detail}`,
          'footprint 已就地改写并重算遮挡率至预算内。改的是内存场景对象，落盘由 render 阶段负责。',
        ),
      );
      continue;
    }
    if (res.status === 'carrier') {
      out.push(
        mk(
          CODES.CARRIER_NOT_APPLIED,
          'build',
          [hit.scene.ref, hit.region.id],
          frames,
          `${head}；${res.detail}`,
          '⚠️ 这条是已知缺口：D4 的 ② 号载体档尚未实现，冲突被抑制但画面未被真正退让。' +
            '在 tier2 实现前，载体映射登记**不会**改变成片。',
        ),
      );
      continue;
    }

    if (res.status === 'no-carrier') {
      out.push(
        mk(
          CODES.CARRIER_FALLBACK,
          'build',
          [hit.scene.ref, hit.region.id],
          frames,
          `${head}；三级退让用尽 —— ${res.detail}`,
          '同一预算内挪不动，且该 scope 没有载体档可退。换模板、改锚点让动效落在安全区，或调低 footprint 尺寸。',
        ),
      );
      continue;
    }

    out.push(
      mk(
        CODES.OCCLUSION_BUDGET,
        'build',
        [hit.scene.ref, hit.region.id],
        frames,
        `${head}；载体档已应用但仍不足 —— ${res.detail}`,
        '缩小 footprint，或把该 motion 移到主体不在场的 shot。',
      ),
    );
  }
  return out;
}

/** #14 B-roll 主体遮挡 ≤ 30% 预算。 */
export function checkBrollOcclusion(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  const budget = budgetOf('broll');
  for (const hit of collectHits(ctx)) {
    if (hit.region.kind !== 'broll') continue;
    const res = resolveOcclusion(hit.scene, hit.region, hit.ratio, budget);
    const frames = [Math.max(hit.scene.start, hit.region.fromFrame), Math.min(hit.scene.end, hit.region.fromFrame + hit.region.durationInFrames)];
    // 同上：退让成功同样要留下可对账的告警，而不是静默跳过
    if (res.status === 'nudged' || res.status === 'carrier') {
      out.push(
        mk(
          res.status === 'nudged' ? CODES.OCCLUSION_NUDGED : CODES.CARRIER_NOT_APPLIED,
          'build',
          [hit.scene.ref, hit.region.id],
          frames,
          `B-roll 主体 ${hit.region.id} 被遮挡 ${(hit.ratio * 100).toFixed(1)}% > 预算 ${(budget * 100).toFixed(0)}%；${res.detail}`,
          res.status === 'nudged'
            ? 'footprint 已就地改写并重算遮挡率至预算内。'
            : '⚠️ D4 的 ② 号载体档尚未实现，冲突被抑制但画面未被真正退让。',
        ),
      );
      continue;
    }
    out.push(
      mk(
        CODES.BROLL_OCCLUSION,
        'build',
        [hit.scene.ref, hit.region.id],
        frames,
        `B-roll 主体 ${hit.region.id} 被遮挡 ${(hit.ratio * 100).toFixed(1)}% > 预算 ${(budget * 100).toFixed(0)}%（${res.detail}）`,
        'B-roll 用来展示产品特点，被遮挡就失去意义。把动效挪出峰值区，或缩短其在该 shot 内的时长。',
      ),
    );
  }
  return out;
}

/**
 * D3 fullscreen 需人工确认。
 *
 * 校验期只提示；**硬停**在 render 的启动闸（见 stages/render.ts）。
 * 原因：SPEC §2.1 限定构建期只读 03/01/02，而人工确认落在 06-review。
 */
export function checkFullscreenConfirmation(ctx: ValidateContext): ReportItem[] {
  return ctx.scene
    .filter((s) => s.tpl.scope === 'fullscreen')
    .map((s) =>
      mk(
        CODES.FULLSCREEN_CONFIRM,
        'build',
        [s.ref],
        [s.start, s.end],
        `fullscreen 类 motion（${s.tpl.id}）必然覆盖全画面`,
        'D3 规定一律人工确认、不设自动放行规则。渲染前须在 06-review/confirmed.json 留下放行记录。',
      ),
    );
}

/** F6 判不出主体区 → warning，**不阻断**（这是唯一语义为「不阻断」的码）。 */
export function checkSubjectUnknown(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const shot of ctx.perceive.shots) {
    if (!shot.lowConfidence) continue;
    out.push(
      mk(
        CODES.SUBJECT_UNKNOWN,
        'build',
        [shot.id],
        [shot.fromFrame, shot.fromFrame + shot.durationInFrames],
        `shot ${shot.id} 的主体归属为低置信，安全区未确`,
        '不阻断。人工在 06-review/confirmed.json 里补 subjectBox 覆盖后才算确定。',
      ),
    );
  }
  const lowRegions = ctx.perceive.regions.filter((r) => r.lowConfidence);
  for (const r of lowRegions) {
    out.push(
      mk(
        CODES.SUBJECT_UNKNOWN,
        'build',
        [r.id],
        [r.fromFrame, r.fromFrame + r.durationInFrames],
        `区域 ${r.id}（${r.kind}）为低置信检测结果`,
        '不阻断。人工核验后补 subjectBox 覆盖。',
      ),
    );
  }
  return out;
}

/**
 * 禁配段：任何 motion 与 `noMotionRanges` 相交 → error —— 校验项 #15。
 *
 * 来源：SPEC §1.4（E5 裁决）。
 * 2026-10-13 正式纳入构建期清单：它的三条准入判据（输入可读 / 纯结构化判定 /
 * 渲染前就该拦）全中，原清单成型早于 E5，编表时**纯漏收**，非设计分歧。
 */
export function checkNoMotionRanges(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const range of ctx.storyboard.noMotionRanges) {
    const end = range.fromFrame + range.durationInFrames;
    for (const s of ctx.scene) {
      if (!framesOverlap(s.start, s.end, range.fromFrame, end)) continue;
      out.push(
        mk(
          CODES.NO_MOTION_RANGE,
          'build',
          [s.ref],
          [Math.max(s.start, range.fromFrame), Math.min(s.end, end)],
          `motion 与禁配段 [${range.fromFrame}, ${end}]（${range.reason}）相交`,
          '模型起草时应跳过这些区间。把 item 移出禁配段，或调整 noMotionRanges。',
        ),
      );
    }
  }
  return out;
}
