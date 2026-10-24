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
  /**
   * `W-C2-5-02` —— 密度校验，**warning 不阻断**（C2-5b，2026-10-24）。
   *
   * 🔴 **历史**：本码原为 error `E-C2-5-02`。`DENSITY.maxItemsPerCue=3` 是占位值
   *   （真源未给数值），却是 11 项占位值里唯一「未校准却直接产 error 阻断」的——
   *   偏严会误伤真实素材，而项目没有 storyboard 编辑 UI，用户只能手改 JSON。
   *   用户裁决降级为 warning（同 `wordRatioWarnMax` 的 M-1d 告警档处理），
   *   实测校准后是否升回 error 另立裁决。
   *   码字符串随级别改为 `W-C2-5-02`，C2-5 决策回溯链不变。
   */
  DENSITY: W('W-C2-5-02', 'density-per-cue', 'C2-5', 2, '每 cue 的 item 数超阈值'),
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
  /**
   * 载体档「无路可走」—— 校验项 #13 的终止态。
   *
   * 🔴 键名曾叫 `CARRIER_FALLBACK`，与已废除的全局表 `config.CARRIER_FALLBACK` 同名。
   *    D4-t2（2026-10-17）废除那张表后，此码的触发条件随之收紧为
   *    **「该 item 未声明 `carrier`」**（原意：载体映射未登记）。
   *    保留旧键名会让下一个人误以为全局表还在 —— 故改名，**错误码字符串 `E-D4-01` 不变**
   *    （登记册已按该码记录，��名会破坏可追溯性）。
   */
  CARRIER_NO_ROUTE: E('E-D4-01', 'carrier-fallback', 'D4', 13, '载体三级退让后仍冲突'),
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
   * `W-D2-02` —— **载体变换后主体被切走太多**（P4 重立，2026-10-17）。
   *
   * 🔴 **历史**：本条于 2026-10-17 上午随「第 18 项」增补、**当日撤回**（D2-2）。
   *   撤回的两条理由在 P4 已**逐条消解**：
   *   ① 「split-frame 只有声明、无渲染实现」⇒ P2 已实现 `split-frame.tsx`，
   *      且 22:50 真渲抽帧抓到并修掉了坐标系 bug（分界曾落在 0.75）；
   *   ② 「用 footprint 判定对分屏误报、对放大漏报」⇒ **判据已换源**：
   *      不再用 `footprint`，改用 `visibleRegion(params)`（认 `window` 裁切与
   *      `scale` 放大两种来源），判据 = `|safeArea ∩ visibleRegion| / |safeArea| ≥ MIN_VISIBLE_RATIO`。
   *
   * ⚠️ 为何仍是 warning 不阻断：判据含 🔴 占位阈值 `MIN_VISIBLE_RATIO = 0.5`，
   *   未在真实素材上校准 ⇒ 贸然阻断会误伤合规成片。校准后可升 error。
   *
   * 🔴 码字符串沿用 `W-D2-02`（与 `W-D4-01` 同款处理）：登记册 D2-2 已引用该码，
   *   改字符串会破坏可追溯性。**语义以本注释与 `validate/geometry.ts` 为准**。
   */
  SUBJECT_CUT_VISIBLE: W(
    'W-D2-02',
    'subject-cut-visible',
    'D2',
    18,
    '载体变换后主体可见比例低于阈值',
  ),

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
   * 三条准入判据（输入可读 / 纯结构化判定 / 渲染前就该拦）全中，故进清单（条目身份 = 第 15 项），
   * 不再计入 `extra`。
   *
   * ⚠️ 引用计数时注意：**「第 15 项」是条目身份，「当前 N 项」是活计数**。活计数见
   * `src/validate/index.ts` 的 `DOCUMENTED_CHECK_ITEMS`，不要在这里写死总数。
   */
  NO_MOTION_RANGE: E('E-E5-01', 'no-motion-range-overlap', 'E5', 15, 'motion 与禁配段相交'),

  // ── 参数契约（第 16 项 · 来源 P1）──────────────────────────────
  /**
   * `item.params` 按 `paramsSchema` 校验 —— 校验项 #16。
   *
   * 来源 P1（2026-10-13）：`paramsSchema` 此前只被定义与注册，**校验器侧零引用**
   * —— 模型填了模板未声明的键、或漏填必填键，构建期一声不吭。
   *
   * 三条码**全部 error，不设 warning 档**。理由：现有 warning 档
   * （`W-C4-01` 几何相交但视觉上可能没问题、`W-F6-01` 等人补）
   * **都有正当的不拦理由**，而参数写错没有 —— 要么崩要么静默错渲。
   *
   * 判定口径见 `validate/params.ts`。
   */
  PARAMS_UNKNOWN_KEY: E('E-P1-01', 'params-unknown-key', 'P1', 16, 'params 含模板未声明的键'),
  PARAMS_MISSING_REQUIRED: E('E-P1-02', 'params-missing-required', 'P1', 16, 'params 缺必填键'),
  PARAMS_TYPE_MISMATCH: E('E-P1-03', 'params-type-mismatch', 'P1', 16, 'params 值类型与声明不符'),

  /**
   * `params.text` 类文本会溢出 `footprint` —— 校验项 **#17**（D-B 裁决 2026-10-15）。
   *
   * 来源：真渲实测 16 中文字 / `123456789` 时 4 个模板全部溢出，
   * `data/stat-card` 甚至溢出画面边界；而此前 16 项校验全是结构判定，
   * **完全看不出来**，报告照样 `ok: true`。
   *
   * 🔴 **本码是 warning 而非 error** —— 理由有两条，缺一不可：
   * 1. 判定基于**字符宽度估算**，不是字体度量。本项目的素材为纯中文口播，
   *    故按 CJK 1.0em / 拉丁 0.5em 估算；真实字宽随字体、字重、平台而变。
   * 2. 因此它是**可能误报合法创作**的判定。把它当 error 用，
   *    估算误差就会直接阻断用户的合法起草 ——
   *    这正是计划书风险登记 R6「审美断言设计过度 ⇒ 误伤」的具体化，
   *    也是 `DENSITY.maxItemsPerCue`（未校准的占位值当 error 用）踩过的坑。
   *
   * ⇒ **实测校准后可升 error。** 当前阶段的作用是「让人看见」，
   * 不是「拦住人」。
   *
   * ⚠️ 字号与内边距读`TemplateDeclaration.textMetrics`（唯一真源），
   *    禁止在校验器内另写字号表 —— 否则改组件字号会让判定静默失准
   *    （同 `DUR.exit` 事故）。
   */
  TEXT_OVERFLOW: W('W-DB-01', 'text-overflow-footprint', 'D-B', 17, '文本估算宽超出 footprint'),

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
