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
   * SRT 词成功对上 whisper token 的比例下限。低于此值 → 门控不过 → 退出码 1
   * （`EXIT.VALIDATION_FAILED`；历史多处文档写的「退出码 2」是笔误，2026-10-23 已一并更正）。
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
 * 节奏表（pacing）的 motion 门槛。
 *
 * 🔴 **PLACEHOLDER（用户指定初值 2026-10-20，待实测）**。
 *
 * 一条 cue 的时长（`toFrame - fromFrame`）低于此值 → 不做 motion，
 * 在 `pacing.json` 里记 `skipped: 'too-short'`。
 *
 * ── 为什么是「帧数门槛」而不是「语速 / 间隙 / 预算」────────────
 * 本项目的模型是：**motion 是「这句话」的伴生图形** —— 这句话多长它就多长，
 * 从句首开始。因此不需要找间隙、不需要算语速、也不需要预算系统；
 * 唯一需要防的是「短到根本读不完的一句话上还想塞动效」。
 *
 * ⚠️ 字幕层（`caption/karaoke-word`）**不受此门槛约束**：
 *    每条 cue 恒有一条字幕 item（字幕时长由 SRT 区间决定，不是模型选择）。
 */
export const RHYTHM = {
  minCueFramesForMotion: 10,
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
 * ~~D4 三级退让的载体映射：`motion id → carrier 模板 id`~~ —— **已废除（D4-t2 裁决，2026-10-17）**。
 *
 * 废除理由（裁决 Q2）：全局表按 **motion** 索引，而载体几何是**逐 item** 的
 * （同一条 motion 在不同 shot 里要缩进不同的窗口）⇒ 表里放不下几何，
 * 且「一处配置污染全片」。现改为 `StoryboardItem.carrier?: CarrierRef` 逐 item 显式声明
 * （见 `core/types.ts`）。
 *
 * 历史教训（保留备查，勿再引入同类表）：本表长期为空对象，而文档写「表中命中 → 退让自动完成」
 * —— 实测证明 tier2 **只抑制报错、不产生任何产物变更**，「登记即退让」是文档层面的假绿。
 * 2026-10-13 更正注释、2026-10-17 由 D4-t2 定案。
 *
 * 现行语义：`item.carrier` 未声明 → `E-D4-01`（退路不存在）；
 * 已声明 → 仍出 `W-D4-01`（P1 只立契约，施加变换在 P3）。
 */

/**
 * 人脸框 → 手持物/上半身区域的外扩参数。
 *
 * ⚠️ 【实现期拟定，文档未规定】SPEC / 登记册只说 handheld 是「手持讲解物品」，
 *    未规定如何从人脸推导。这两个系数是**占位值**，须用真实素材继续校准。
 *
 * 取值依据（2026-10-17 实测 `3月22日.mp4` s2：人物中景、双手扶着鞋）：
 *    人脸框 [0.427, 0.062, 0.135, 0.298]，手与鞋落在 y≈0.75–0.85。
 *    · 高度系数 **2.0 时框底到 0.658** ⇒ **手和鞋的下半部分露在框外**（抽帧目视确认）。
 *    · 按「头顶 0.062 → 上半身底 0.75」反推，需 (0.75-0.062)/0.298 ≈ **2.3**，
 *      故取 **2.5** 留余量。
 *    · ⚠️ 不宜再大：handheld 的预算只有 20%，框越大同样大小的 overlay 占比越小，
 *      保护会形同虚设（见 `region-derive.ts` 文件头「与 occlusionRatio 口径相容」一节）。
 *    宽度系数 3.0 实测已能覆盖双手。
 *
 * ── 为什么定义在 config 而不是 region-derive（2026-10-18 上提）─────────────
 * 占位值注册表（`core/placeholders.ts`）要**引用**而不是**复制**这些数。
 * 若它定义在 `stages/` 而注册表在 `core/`，就会出现 `core → stages` 的反向依赖。
 * 常量放这里、`region-derive.ts` 再 re-export，既有单一真源，也不破坏既有 import。
 */
export const HANDHELD_EXPANSION = {
  /** 新宽度 = 人脸宽 × 此系数（居中扩展）。 */
  widthRatio: 3,
  /** 新高度 = 人脸高 × 此系数（从人脸顶部向下延伸）。 */
  heightRatio: 2.5,
} as const;

/**
 * 显著性（`broll` 通道）目标框面积占比 —— 从能量最高格子起逐个并入，达到此面积即停。
 *
 * 🔴 PLACEHOLDER（0.35）：三素材目视可接受，**未做量化**（同属占位值族）。
 *
 * ── 为什么按面积收敛，而不是「取能量前 N% 的格子」────────────────────────
 * 2026-10-17 实测：脚部特写（`s11`，56s）上，地面砖缝同样是高频，能量分散四周，
 * 取前 15% 时并集一撑就超过 `maxAreaRatio` 上限 ⇒ 直接退让；只有收到前 5% 才框得住鞋。
 * 「格子比例」与「框大小」不是线性关系 ⇒ 改为按**包围盒面积**收敛。
 *
 * ── 为什么上提为导出常量（2026-10-18，D6.4）────────────────────────────
 * 原先是 `opts.targetAreaRatio ?? 0.35` 里的**字面默认值**，文件外无法引用 ⇒
 * 占位值注册表只能抄一份数字，而**抄一份就会漂移**（本项目已三次栽在「同一概念两处实现」）。
 */
export const SALIENCY_TARGET_AREA_RATIO = 0.35;

/**
 * 静音检测、SRT↔音频一致性校验与静音词占比（`M-1d` / `M-1f`）。
 *
 * 🔴 前四个探测参数是**一组**，必须同批校准（同 `ALIGN_GATE` 的教训：
 *    分开调会留下一道「看着齐全、实则测不到」的门）。
 *
 * ── 收录理由（D6.4 判据）────────────────────────────────────────
 * 文档与裁决册**未给数值**，且直接影响：① 词时是否重铺 ② 成片字幕时机。
 *
 * ── 实测依据（kukini，2026-10-19）────────────────────────────────
 * · `noiseDb=-40` / `minDur=0.5` 下全片仅 3 段静音：
 *   6.736s 大空洞 + 两段 0.53s / 0.57s 句中换气
 * · SRT 留白 7.083s vs 实测静音 6.736s ⇒ **差 0.35s**
 * · 那两段短静音与 SRT cue 重叠 0.53s / 0.27s，经查是**句中换气**（正常）
 * ⇒ 故「长静音阈值」取 1.0s：把换气排除在「错位证据」之外，否则满屏警告。
 *
 * ⚠️ 仅 kukini 单条素材，**须2–3 条素材复核**（`M-1f` Q2 的验收条件之一）。
 */
export const SILENCE = {
  /** silencedetect 的噪声门限（dB）。素材人声压过BGM，取 -40。 */
  noiseDb: -40,
  /** 判定为静音段的最短持续时长（秒）。0.5 可捕捉换气但不误报单帧空隙。 */
  minDurationSec: 0.5,
  /** 超过此时长的静音才算「时间空洞」，才用于SRT 一致性校验（排除句中换气）。 */
  longSilenceSec: 1.0,
  /** SRT cue 与长静音重叠超过此时长即判为不吻合。 */
  overlapToleranceSec: 0.5,
  /**
   * 🔴 PLACEHOLDER（`M-1d`，2026-10-24）：`silentWordRatio` 的**告警线**（只告警、不阻断）。
   *
   * 判据：词落在静音段内的时长 / 全部词总时长。健康素材应 ≈0。
   *
   * ── 定线依据（kukini 单条完整对齐素材）────────────────────────
   * · 修复后健康值 **0.879%**（`M-1f` 铺词后，-40dB / 0.5s）
   * · 修复前病理值 **5.9%**（9 个词被塞进 6.74s 真静音）
   * · 二者对数中点 ≈ **2.28%** ⇒ 向下取 **2%**（偏向多报，少漏报）
   *
   * 🔴 **阻断线未设**：只有 1 条完整对齐素材，登记册 `M-1d` 要求 2–3 条才定 error 线。
   *
   * 🔴 **本值与上面四个探测参数绑定**：实测 `minDurationSec` 0.5→0.3 会让同一健康素材
   *    的占比从 0.88% 升到 **2.97%**（误告警）⇒ 改任何探测参数都必须重算此线。
   */
  wordRatioWarnMax: 0.02,
  placeholder: true as const,
} as const;
