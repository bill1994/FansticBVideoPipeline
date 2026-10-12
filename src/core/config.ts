/**
 * 阈值与路径配置。
 *
 * ⚠️ 这里每一个数字都必须能说清来源。凡是**文档未给数值**的，
 *    一律标 `PLACEHOLDER` 并在 README 的「待实测」清单里列出 —— 不得当成结论用。
 */

/** 阶段目录名。真源：SPEC §5.1（F1）。顺序即不可变烘焙链的方向。 */
export const STAGES = {
  input: '00-input',
  align: '01-align',
  perceive: '02-perceive',
  storyboard: '03-storyboard',
  validate: '04-validate',
  render: '05-render',
  review: '06-review',
} as const;

export const STAGE_ORDER = [
  STAGES.input,
  STAGES.align,
  STAGES.perceive,
  STAGES.storyboard,
  STAGES.validate,
  STAGES.render,
  STAGES.review,
] as const;

/** 默认 job 根目录。 */
export const DEFAULT_JOBS_DIR = 'jobs';

/**
 * C2-2 强制对齐置信度门控阈值。
 *
 * 来源：登记册 C2-2「均值 < 0.60 或低置信词占比 > 30% → 阻断」。
 * 状态：**文档明示的初值，待实测校准**（§10.5 剩余待办第二件）。
 */
export const ALIGN_GATE = {
  meanConfidenceMin: 0.6,
  lowConfidenceRatioMax: 0.3,
} as const;

/**
 * 校验项 #2「密度校验」的阈值。
 *
 * 🔴 PLACEHOLDER —— 真源全文只写「每 cue 的 item 数超阈值 error」，
 *    **未给数值**。此处是为让校验器可运行的占位值，**不是文档结论**，
 *    须与 C2-2 一并在实拍素材上校准。
 */
export const DENSITY = {
  maxItemsPerCue: 3,
  placeholder: true as const,
} as const;

/**
 * 门控阻断时的退出码一律走 EXIT.VALIDATION_FAILED。

 * 动态阈值 T 的硬边界。来源：B5「T_min = 0.50 / T_max = 0.80（是边界，不是取值）」。
 */
export const T_BOUNDS = {
  min: 0.5,
  max: 0.8,
} as const;

/** 期望走库比例区间（配额锚）。来源：B5「建议 70%–90%」。 */
export const TEMPLATE_QUOTA = {
  min: 0.7,
  max: 0.9,
} as const;

/** 样本少时的退化阈值。来源：B5「N < 8 → 退化固定 T = 0.65」。 */
export const T_SMALL_SAMPLE = {
  threshold: 0.65,
  minSamples: 8,
} as const;

/** 安全阀：整批 sim_max 中位数低于此值 → 整批转 custom + 人审。来源：B5。 */
export const SAFETY_VALVE_MEDIAN = 0.4;

/** 接力 gap 上限（帧）。来源：C5「gap > 1.5s 报 warning」。 */
export const HANDOFF_GAP_SECONDS = 1.5;

/**
 * D2 区域分级遮挡预算（面积占比）。
 * 来源：SPEC §2.6 / 登记册 D2。**这些是文档明示值，不是占位。**
 */
export const OCCLUSION_BUDGET = {
  face: 0,
  handheld: 0.2,
  broll: 0.3,
} as const;

/** 渲染版本锚定。来源：E3「锁 4.0.534，禁 ^」。 */
export const REMOTION_VERSION = '4.0.534';

/** 抽帧默认密度（秒）。来源：E4「1.5s 是默认值，可提问改密/疏」。 */
export const DEFAULT_FRAME_INTERVAL_SEC = 1.5;

/**
 * D4 三级退让的载体映射：`motion id → carrier 模板 id`。
 *
 * ⚠️ 【实现期拟定，文档未点名】
 *    D4 说「挪不动则**自动切 carrier 模式**」，但**没有定义哪个 motion 该退到哪个载体**。
 *    自动为任意 motion 挑载体是不安全的（例如 fullscreen 类没有可缩进的余地），
 *    因此这里要求**显式登记**：
 *      · 表中命中 → tier2 可用，退让自动完成
 *      · 表中未命中 → tier2 无法启动 → 报 `E-D4-01`，由人决定退路
 *    默认留空 = 默认报错，**不猜**。
 */
export const CARRIER_FALLBACK: Record<string, string> = {};

export function setCarrierFallback(motion: string, carrierTemplateId: string): void {
  CARRIER_FALLBACK[motion] = carrierTemplateId;
}

export function carrierFallbackFor(motion: string): string | undefined {
  return CARRIER_FALLBACK[motion];
}
