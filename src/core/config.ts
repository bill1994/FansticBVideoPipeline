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
  /**
   * 🔴 PLACEHOLDER —— 新增（M1c，2026-10-13）。
   *
   * SRT 词成功对上 whisper token 的比例下限。低于此值 → 门控不过 → 退出码 2。
   *
   * ⚠️ **为什么必须与 `meanConfidenceMin` 一并校准、不得分开拍**：
   * 两者度量的是不同维度 —— 前者是「whisper 对自己听到的词有多自信」，
   * 后者是「SRT 与音频是否对得上」。分开校准容易只调一个而漏掉另一个，
   * 留下一道看着齐全实则测不到对齐质量的门。沿用三处缺口提案 §3.6 的纪律。
   *
   * 取值**待实测**，与 C2-2 一并在真实素材上校准。**不要当结论用。**
   */
  alignedRatioMin: 0.8,
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
 * 感知阶段（02-perceive）参数。
 *
 * ⚠️ `safeAreaTopRatio` 是 **PLACEHOLDER**：SPEC §2.7 只写「安全区 ≠ 主体 bbox，
 *    取 **bbox 上部**（腿部以下可压）」，**没有给精确比例**。
 *    0.6 取自 talkcraft 的生产口径（上 60% / 左右 20%），**待真实素材校准**。
 *    ⚠️ 与 `ALIGN_GATE` 同理：占位值不得当校准结论引用。
 *
 * `scoreThreshold` / `nmsThreshold` 对齐 opencv_zoo demo 的默认值（0.9 / 0.3），
 * 这两项是**上游惯例**而非本项目实测 —— 检测率偏低时可调，但调完须记下依据。
 */
export const PERCEIVE = {
  /** 安全区 = 主体 bbox 的上部比例。🔴 PLACEHOLDER（SPEC 未规定）。 */
  safeAreaTopRatio: 0.6,
  /** 检测输入长边：先等比缩到此值，再向上补到 32 的倍数。 */
  detectMaxSide: 512,
  /** YuNet 分数阈值（对齐 opencv_zoo demo）。 */
  scoreThreshold: 0.9,
  /** NMS IoU 阈值（对齐 opencv_zoo demo）。 */
  nmsThreshold: 0.3,
} as const;

/**
 * D4 三级退让的载体映射：`motion id → carrier 模板 id`。
 *
 * ⚠️ 【实现期拟定，文档未点名】
 *    D4 说「挪不动则**自动切 carrier 模式**」，但**没有定义哪个 motion 该退到哪个载体**。
 *    自动为任意 motion 挑载体是不安全的（例如 fullscreen 类没有可缩进的余地），
 *    因此这里要求**显式登记**。
 *
 * 🔴 **2026-10-13 更正：此前这段注释描述了一个不存在的行为。**
 *    原文写「表中命中 → tier2 可用，退让自动完成」——**这是错的**。
 *    实测证明 tier2 只抑制报错，**不产生任何产物变更**（motion 不被改写、
 *    footprint 不被改动、画面不会被缩进）。详见 `src/validate/occlusion.ts`
 *    的 `resolveOcclusion` 与 `W-D4-01`。
 *
 *    因此本表的真实语义是：
 * *      · 表中未命中 → tier2 无法启动 → 报 `E-D4-01`，由人决定退路
 *      · 表中命中   → 冲突被抑制，但**成片不会被真正退让** → 出 `W-D4-01` 告警
 *
 *    **修复 tier2 须先在登记册立一条承载字段的裁决**（`StoryboardItem` 当前
 *    无处记录「本项已切载体、画面要缩进哪个框」；且本表按 motion 索引，
 *    放不下逐 item 的几何）。在此之前，登记映射**不会**让成片变好。
 */
export const CARRIER_FALLBACK: Record<string, string> = {};

export function setCarrierFallback(motion: string, carrierTemplateId: string): void {
  CARRIER_FALLBACK[motion] = carrierTemplateId;
}

export function carrierFallbackFor(motion: string): string | undefined {
  return CARRIER_FALLBACK[motion];
}
