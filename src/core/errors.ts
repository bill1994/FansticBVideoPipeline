/**
 * 项级错误码表。
 *
 * 真源：SPEC §2.5。命名规则 `E-<source>-<nn>` / `W-<source>-<nn>`，
 * `<source>` 取决策编号（C2-5 / C3 / C4 / C5 / C6 / D2 / D4 / E5），
 * 保证每条 error 都能一键回溯到 OPEN-DECISIONS.md 的裁决理由。
 *
 * ⚠️ 与进程级退出码是**两套码，不混用**：
 *    项级 → 04-validate/validate-report.json 的 `code` 字段
 *    进程级 → CLI 的 `$?`（见 src/core/exit-code.ts）
 */

export type Level = 'error' | 'warning';

export interface CodeSpec {
  code: string;
  level: Level;
  /** 稳定的机器可读标识，用于单测与外部工具匹配。 */
  check: string;
  /** 决策编号，可回溯登记册。 */
  source: string;
  /** 校验项序号；无序号者（兜底告警）为 null。 */
  item: number | null;
  title: string;
}

const E = (code: string, check: string, source: string, item: number | null, title: string): CodeSpec =>
  ({ code, level: 'error', check, source, item, title });
const W = (code: string, check: string, source: string, item: number | null, title: string): CodeSpec =>
  ({ code, level: 'warning', check, source, item, title });

export const CODES = {
  // ── 时间轴类（9 项，其中第 5 项主从冲突无码）────────────────
  TIMING: E('E-C2-5-01', 'timing-in-word-range', 'C2-5', 1, '帧未落在目标词区间'),
  DENSITY: E('E-C2-5-02', 'density-per-cue', 'C2-5', 2, '每 cue 的 item 数超阈值'),
  OVERLAP_SAME_GROUP: E('E-C4-01', 'footprint-overlap-same-group', 'C4', 3, '同 exclusive 组 footprint 相交'),
  OVERLAP_CROSS_GROUP: W('W-C4-01', 'footprint-overlap-cross-group', 'C4', 4, '异组 footprint 相交'),
  MIN_VISIBLE: E('E-C3-01', 'min-visible-frames', 'C3', 6, '最小可见时长不足'),
  WORD_BOUNDARY: W('W-C3-01', 'word-boundary-alignment', 'C3', 7, '起点恰好落在词级边界'),
  SUBJECT_CUT: E('E-C3-02', 'subject-transform-cut-boundary', 'C3', 8, '跨越 subject-transform 裁切边界'),
  HANDOFF_GAP: W('W-C5-01', 'handoff-gap', 'C5', 9, '接力 gap > 1.5s'),

  // ── 工程与遮挡类（5 项）──────────────────────────────────────
  TAIL_TRUNCATION: E('E-C6-01', 'composition-tail-truncation', 'C6', 10, 'composition 尾部截断'),
  FOOTPRINT_ANIMATES_ERR: E('E-C3-03', 'footprint-animates', 'C3', 11, 'footprintAnimates 降级（相交）'),
  FOOTPRINT_ANIMATES_WARN: W('W-C3-02', 'footprint-animates', 'C3', 11, 'footprintAnimates 降级（相交）'),
  OCCLUSION_BUDGET: E('E-D2-01', 'occlusion-budget', 'D2', 12, '遮挡分级预算超预算'),
  CARRIER_FALLBACK: E('E-D4-01', 'carrier-fallback', 'D4', 13, '载体三级退让后仍冲突'),
  BROLL_OCCLUSION: E('E-D2-02', 'broll-occlusion', 'D2', 14, 'B-roll 主体遮挡 > 30%'),

  /**
   * 载体档已抑制但**未实际施加**载体 —— 校验项 #13 的兜底告警。
   *
   * 来源：D4 三级退让的 ② 号档「自动切 carrier 模式」在当前实现中
   * **只抑制报错，不产生任何产物变更**（见 occlusion.ts 的 `status: 'carrier'` 分支）。
   * 本码存在的意义就是把这种「静默假绿」变成**响亮但诚实**的告警：
   * 冲突照报，但不再谎称已退让。
   *
   * 🔴 它是 warning 而非 error —— 因为 D4② 号档尚未实现（tier2 实现须先走登记册
   * 开一条字段承载的裁决，见 2026-10-13裁决材料 §1.5）。本码是该缺口的**可见标记**，
   * 待tier2 实现后本码应随之移除。
   */
  CARRIER_NOT_APPLIED: W('W-D4-01', 'carrier-not-applied', 'D4', 13, '载体档已登记但未实际施加'),

  /**
   * 遮挡冲突已被 tier1 平移消解 —— 但平移结果**只改了内存对象**。
   *
   * 不阻断：平移是确定性退让，且遮挡率已重算至预算内。
   * 出此告警是为了让「校验报告说通过」与「产物确实变了」这两件事可被对账。
   */
  OCCLUSION_NUDGED: W('W-D2-01', 'occlusion-nudged', 'D2', 12, '遮挡冲突已由平移消解'),

  /**
   * fullscreen 需人工确认。
   *
   * 来源：D3「`fullscreen` 类 motion 必然覆盖全画面，一律走人工确认，**不设自动放行规则**」。
   * **刻意不进构建期清单**（D3-a 定其落点）：确认记录产在 `06-review/confirmed.json`，
   * 而构建期只读 `03`/`01`/`02` —— 「输入在本阶段可读」这条判据不满足。
   * 故 `validate` 只出 warning 预告，**硬停在 render 阶段的启动闸**（见 stages/render.ts `renderGate`）。
   */
  FULLSCREEN_CONFIRM: W('W-D3-01', 'fullscreen-needs-confirmation', 'D3', null, 'fullscreen 需人工确认'),

  // ── 起草原生约束 ─────────────────────────────────────────────
  /**
   * 禁配段相交 —— 校验项 #15。
   *
   * 来源：SPEC §1.4（E5 裁决）「校验期：任何 motion 与禁配段相交 → error」。
   * 2026-10-13 由 D3-a / E5 的补录正式纳入构建期清单（原 §7 清单成型早于 E5，编表时漏收）。
   * 三条准入判据（输入可读 / 纯结构化判定 / 渲染前就该拦）全中，故进 15 项，不再计入 `extra`。
   */
  NO_MOTION_RANGE: E('E-E5-01', 'no-motion-range-overlap', 'E5', 15, 'motion 与禁配段相交'),

  // ── 兜底告警 ─────────────────────────────────────────────────
  /**
   * shot 主体未确。来源 SPEC §5.5 / F6：感知标了 `lowConfidence` 时出此告警，
   * **不阻断**（这是唯一「不阻断」的语义）。
   */
  SUBJECT_UNKNOWN: W('W-F6-01', 'subject-unknown', 'F6', null, 'shot 主体未确'),

  // ── 渲染期兜底（stage: render）───────────────────────────────
  RT_FONT: E('E-RT-01', 'render-font-not-loaded', 'F2', null, '字体未加载'),
  RT_CANVAS: E('E-RT-02', 'render-canvas-not-mounted', 'F2', null, 'Canvas 未挂载（delayRender 超时）'),
  RT_GPU: E('E-RT-03', 'render-gpu-context', 'F2', null, 'GPU 上下文创建失败'),
} as const satisfies Record<string, CodeSpec>;

export type CodeKey = keyof typeof CODES;

/** 全部 error 码，用于断言「有 error ⇒ 退出码 1」。 */
export const ALL_CODES: CodeSpec[] = Object.values(CODES);

export function isErrorCode(code: string): boolean {
  const spec = ALL_CODES.find((c) => c.code === code);
  return spec?.level === 'error';
}

/**
 * 校验项序号 → 该序号的可用错误码（含 error / warning）。
 * 第 5 项（主从冲突）**故意无码** —— 它不校验、直接放行，不产 report 条目。
 */
export function codesForItem(item: number): CodeSpec[] {
  return ALL_CODES.filter((c) => c.item === item);
}
