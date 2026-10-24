/**
 * 数据契约 —— storyboard.json 及其上下游产物。
 *
 * 真源：docs/spec/SPEC-remotion-overlay-workflow.md §1
 * 冲突时以 docs/decisions/OPEN-DECISIONS.md 为准。
 */

// ─────────────────────────────────────────────────────────────
// storyboard.json（顶层 3 字段）
// ─────────────────────────────────────────────────────────────

/** 锚点精度模式。`cue` 是「人工签署的例外通道」，不是降级兜底（C2-4）。 */
export type AnchorMode = 'word' | 'cue';

/** 作者语法层：模型只写锚点，不手算帧（C2）。烘焙后剥离。 */
export interface AuthorAnchor {
  /** 形如 `word:37` —— 指向 01-align 产出的第 37 个词。 */
  anchor: string;
  /** 帧偏移，形如 `-8f`。手写逃生口：`abs` 绝对帧/秒。 */
  offset?: string;
}

/** 归一化矩形 `[x, y, w, h]`，取值 0–1，相对画面。取全动画期最大包围盒。 */
export type Footprint = [x: number, y: number, w: number, h: number];

/** 闸1：产路。 */
export type Routing = 'template' | 'custom';

/** 闸2 输出经产路地板封顶后的最终审核强度。 */
export type ReviewLevel = 'auto' | 'alternatives' | 'must_review';

/** 调度决策字段（§4.4）。 */
export interface ScheduleDecision {
  /** 模板相似度最大值。 */
  sim_max: number;
  /** 模型自评置信度。 */
  confidence: number;
  routing: Routing;
  review: ReviewLevel;
}

/**
 * 载体引用 —— D4 三级退让 ② 号档（「自动切 carrier 模式」）的**逐 item 声明**。
 *
 * 来源：`D4-t2` 裁决（2026-10-17）。三个问题一并定：
 * - **Q1 承载字段**：挂在 `StoryboardItem` 上，而不是塞 `params`（那是模型填的参数表）、
 *   也不是让 validate 插新 item（会污染产物且难以追溯）。
 * - **Q2 键粒度**：**逐 item 显式声明，废除全局 `motion → carrier` 映射表**
 *   —— 全局表「一处配置污染全片」，且载体几何本就逐 item。
 * - **Q3 模板语义**：`carrier/split-frame` 走 cover 裁切分屏 + **主体锚定窗口**，
 *   裁切窗口由校验期算好后写入 `params.window`（归一化），渲染期直接消费。
 *
 * ⚠️ **谁读它**（新增字段必答的问题）：
 *   1. `validate/geometry.ts` 的 `assertStructuralIntegrity` —— 校验引用合法性（结构错误）；
 *   2. `validate/occlusion.ts` 的 `resolveOcclusion` —— 作为 tier2 的**触发依据**
 *      （未声明即「退路不存在」→ `E-D4-01`）。
 *
 * 🔴 **P1 阶段只立契约**：tier2 仍不施加变换，声明了也照出 `W-D4-01` 诚实告警；
 *    真正改写画面在 P3（`resolveOcclusion` 写入）与 P2（`split-frame.tsx`）之后。
 */
export interface CarrierRef {
  /** `family/subtype@version`，必须是**已注册且属载体类 scope**的模板（由结构检查强制）。 */
  template: string;
  /** 载体参数。`window`（归一化裁切窗）由校验期算出，其余键语义见该载体模板声明。 */
  params: Record<string, unknown>;
}

export interface StoryboardItem {
  /** 编辑期可见，烘焙后剥离。 */
  _author?: AuthorAnchor;
  fromFrame: number;
  durationInFrames: number;
  /** `family/subtype@version`，如 `typography/kinetic-line@1.0`。 */
  motion: string;
  footprint: Footprint;
  /** 互斥组名，如 `lower-third`。默认不互斥。 */
  exclusive?: string;
  /** true → 相交检测由 error 降为 warning（C3）。 */
  footprintAnimates?: boolean;
  /** 由模板 paramsSchema 决定；模型只填表不写代码。 */
  params?: Record<string, unknown>;
  /** 载体退让声明（D4-t2）。省略 = 未声明载体档，退让到 tier2 即判「无路可走」。 */
  carrier?: CarrierRef;
  /** 调度决策字段，由 storyboard 阶段写入。 */
  decision?: ScheduleDecision;
}

export interface StoryboardTrack {
  id: string;
  /** z 序（越大越上）。与 track 正交（C1）。 */
  layer: number;
  /** track 级有向边，声明接力目标。禁止放 item 层（C5）。 */
  handoffTo?: string | null;
  /** 轨内 items 允许重叠 —— 这是硬约束 3 的要求，不是错误。 */
  items: StoryboardItem[];
}

/** 禁配段：模型起草时跳过；任何 motion 与之相交 → error（E5）。 */
export interface NoMotionRange {
  fromFrame: number;
  durationInFrames: number;
  reason: string;
}

export interface StoryboardMeta {
  /** 顶层固化。改 fps 会让已烘焙帧号语义漂移 → 必须重新烘焙。 */
  fps: number;
  anchorMode: AnchorMode;
  /** 强制对齐的整体置信度，来自 01-align。 */
  alignmentConfidence: number;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface Storyboard {
  meta: StoryboardMeta;
  tracks: StoryboardTrack[];
  noMotionRanges: NoMotionRange[];
}

// ─────────────────────────────────────────────────────────────
// 01-align 产物
// ─────────────────────────────────────────────────────────────

export interface WordTimestamp {
  index: number;
  word: string;
  startFrame: number;
  endFrame: number;
  /** 该词的对齐置信度 0–1。 */
  confidence: number;
}

export interface AlignReport {
  fps: number;

  /**
   * 🔴 `M-1g`（2026-10-19）：本 job 走的是哪条对齐路径。
   *
   * `'aligned'`（默认）—— 正常跑了内置对齐器，各项指标是**真实测量值**。
   * `'no-subtitle'`   —— 用户显式声明「本片不做字幕对齐」（`--no-subtitle`）。
   *   此时 `words` / `cues` 为**空数组**，`silentWordRatio` 为 `null`，
   *   只能用 `abs:` 锚点，字幕模板不可用。
   *
   * 🔴 **为什么必须有这个字段**：无字幕模式的产物**文件是存在的**
   *   （`storyboard`/`validate` 结构上硬依赖它们），若不显式标记，
   *   一份空产物与「对齐结果异常」在下游**无法区分**——
   *   那正是「定义了就该能被读出来」的老问题。
   */
  mode?: 'aligned' | 'no-subtitle';
  /** 整体均值置信度。 */
  meanConfidence: number;
  /** 低置信词占比 0–1。 */
  lowConfidenceRatio: number;
  /** 门控是否通过。未通过必须阻断（C2-2 / C2-4）。 */
  gatePassed: boolean;
  /** 低于阈值的词序号，供人工复核。 */
  lowConfidenceWords: number[];

  /**
   * 文本权威来源 —— 来源 M-1c（2026-10-13）。
   *
   * 🔴 **必填**：缺它，一份 `words.json` 无法自证它是 SRT 权威还是 whisper 权威
   * —— 而这正是 M-1 的争点本身。不落盘等于裁决没有被记录。
   *
   * M-1 已裁决取 `'srt'`（SRT 是文本权威；时间戳权威已于 M-1f 归位）。
   * 保留另两个取值是为将来若改判时**有历史可比**，而非鼓励使用。
   *
   * ⚠️ 2026-10-19 端到端审计：本字段**当前无代码消费者** —— 它的定位是**审计记录**
   * （供人工或将来工具核对「这份 `words.json` 是谁的权威」），不是判据。
   * 不为消灭零消费而加假接线：那比零消费更糟。
   */
  textSource: 'srt' | 'whisper-asr';

  /**
   * SRT 词成功对上 whisper token 的比例 0–1 —— 来源 M-1c。
   *
   * 🔴 **为什么 `meanConfidence` 测不到这件事**：
   * `meanConfidence` 衡量的是「whisper 对自己听到的词有多自信」，
   * 而「SRT 与音频是否对得上」是另一个维度。一个 whisper 自信但
   * 与 SRT 完全不符的场景会**直接通过门控** —— 这违反项目 P0
   * 「未配置外部模型时直接报错退出，绝不伪造结果」的精神：
   * 一份对不上的 words.json 比一次显式失败危险得多。
   *
   * 同时作为**门控项**：低于阈值 → 退出码 1（`EXIT.VALIDATION_FAILED`），走 C2-4 已有的
   * 「人工确认后继续」通道。
   */
  alignedRatio: number;

  /**
   * 🔴 `M-1d`（2026-10-19）：词落在静音段内的**时长占比** 0–1。
   *
   * **为什么必须有它**：`alignedRatio` 衡量**文本匹配**，结构上看不见**时间错位**
   * —— 实测反例：门控全过（`alignedRatio=1.000`、置信 0.9113），
   * 但某 cue 的 9 个词被放进 6.74 秒真静音里，早 7.06 秒。
   * 这是一条「门控看着齐全、实则测不到时间」的判据。
   *
   * 🔴 **`null` ≠ `0`**：`null` 表示**没测**（ffmpeg 不可用 / 未内置后端），
   *    `0` 表示测了且完全正常。写 0 会让「没测过」看起来像「测过且完美」。
   *
   * ⚠️ 2026-10-24 `M-1d` 落地**告警档**：超过 `SILENCE.wordRatioWarnMax`（2%）只告警，
   *    **不阻断**。阻断线需 2–3 条完整对齐素材后再校准。
   */
  silentWordRatio?: number | null;

  /** `M-1f`：按 SRT 窗口重铺过词时的 cue 数（0 = 未启用或无需修）。 */
  reweighedCues?: number;

  /** 实际使用的阈值，便于事后追溯。 */
  thresholds: {
    meanConfidenceMin: number;
    lowConfidenceRatioMax: number;
    /** 🔴 PLACEHOLDER（新增）：alignedRatio 的下限。须与 meanConfidenceMin 一并校准。 */
    alignedRatioMin: number;
    /** `M-1d` 告警档：`silentWordRatio` 超过此值只告警（不阻断）。 */
    silentWordRatioWarnMax: number;
  };
}

/**
 * 字幕 cue。由 SRT 文本 + 强制对齐的词级时间共同确定边界。
 *
 * ⚠️ 【实现期拟定，文档未点名】
 *    校验项 #2「密度校验：每 cue 的 item 数超阈值」需要 cue 边界，
 *    而进度文档只规定了 01-align 的内容是「16kHz wav + 词级时间戳 JSON」，
 *    未定义 cue 的表达。此处把它并入 `words.json`（同一份时间数据），
 *    好处是**不新增阶段产物文件**。
 */
export interface Cue {
  index: number;
  /** 该 cue 的首词 startFrame。 */
  fromFrame: number;
  /** 该 cue 的末词 endFrame，含端点。 */
  toFrame: number;
  text: string;
  /**
   * SRT 原始时间（秒）—— **字幕显示时序的权威来源**（C2-6 补正，2026-10-18）。
   *
   * 🔴 为什么把它写进产物：`fromFrame`/`toFrame` 是**词落点**推出来的，
   *    而词落点会漂（实测 cue 早 7.06 秒，词被 whisper 的合并分段带进了静音区）。
   *    字幕「何时出现」应由**用户编辑过的 SRT** 决定，词只决定「哪个字在亮」。
   *    ⚠️ 它**不参与校验项的判定**（校验是纯结构化判定，读帧不读秒）；
   *    只决定字幕的显示区间与词时铺排（M-1f）。
   */
  srtFromSec?: number;
  srtToSec?: number;
}

/**
 * SRT 解析出的单条 cue —— M-1（方案 b）的输入。
 *
 * 🔴 **时间戳的地位（2026-10-19 更正）**：此前本注释写「SRT 时间戳不参与任何下游判定
 * （B2-fix：素材已粗剪拼接，SRT 时间轴可能偏移）」—— **该表述已撤回**，
 * B2-fix 原文无此要求（见 `srt.ts` 顶部与登记册 B2-fix 更正）。
 * 现状：**文本与句子时间都以 SRT 为权威**，词级时间按 cue 窗口铺（M-1f）。
 *
 * 真正进入流水线的是 `text`（文本权威，M-1）与 `srtFromSec`/`srtToSec`（时间权威，C2-6 + M-1f）。
 *
 * 来源：`src/core/srt.ts`（实现期拟定，文档只规定「输入含 SRT」未点名格式）。
 */
export interface SrtCue {
  /** 剥离非台词内容后的序号（**连续重编号**，不沿用 SRT 原序号）。 */
  index: number;
  fromFrame: number;
  toFrame: number;
  /** 已剥离说话人标签 / 音效标注等非台词内容。 */
  text: string;
  /** 原始秒数，仅供人工对账。 */
  srtFromSec: number;
  srtToSec: number;
}

export interface AlignWords {
  fps: number;
  words: WordTimestamp[];
  cues: Cue[];
}

// ─────────────────────────────────────────────────────────────
// 节奏表（pacing.json）—— P1，2026-10-20
// ─────────────────────────────────────────────────────────────

/**
 * 走势信号 —— 判断「这句话要不要配 motion」的机械依据。
 *
 * 🔴 **全部判据都是词表 / 正则 / 字数比较**（见 `core/rhythm.ts`），
 *    不调用语言模型，也不读时钟或随机数。
 * ⚠️ 「同一份 SRT 必须产出同一份节奏表」的复现性表述**只对规则兜底路径成立**
 *    （M-3，2026-10-23）：语义路径（`meta.source='semantic'`）由 LLM 创作期判读，
 *    同一素材允许产出不同判读 —— 随机性关在创作期，渲染期确定性不受影响。
 */
export type RhythmSignal =
  | 'turn'
  | 'contrast'
  | 'enum'
  | 'question'
  | 'number'
  | 'short-after-long'
  | 'closing'
  | 'definition'
  | 'cause-effect'
  | 'repetition';

/**
 * 一条 cue 的节奏判断 —— pacing.json 的一行。
 *
 * 🔴 **`fromFrame` / `durationInFrames` 是 cue 区间快照，禁止二次推导**。
 *    它们只是把「当时那条 cue 的区间」抄下来供人核对进度，
 *    唯一真源仍然是 `01-align/words.json` 的 `cues[]`。
 *    下游（storyboard 烘焙）不得用这里的帧数反推 cue 边界 ——
 *    否则一次 SRT 修订就会出现「节奏表说 30 帧、实际 cue 只剩 12 帧」的静默漂移。
 */
export interface RhythmCue {
  /** cue 序号，对应 `Cue.index`。 */
  cueIndex: number;
  /** cue 起点快照 —— 非独立真源，禁止二次推导。 */
  fromFrame: number;
  /** cue 时长快照（`cue.toFrame - cue.fromFrame`）—— 非独立真源，禁止二次推导。 */
  durationInFrames: number;
  /** 这条 cue 要不要配 motion。 */
  decide: 'motion' | 'none';
  /** 仅 `decide === 'motion'` 时存在：`family/subtype@version`。 */
  motion?: string;
  /** 人可读的判断依据（为什么做 / 为什么不做）。 */
  reason: string;
  /**
   * 命中的信号，可空。
   *
   * 规则兜底路径：只允许 `RhythmSignal` 词表内的值。
   * 语义路径（M-3，`meta.source='semantic'`）：允许自由文本 ——
   * 语义判据（「铺垫」「反讽」「口头禅」…）天然不在结构词表里，
   * LLM 自述依据本就是裁决的一部分。
   */
  signal: (RhythmSignal | string)[];
  /** 不做 motion 的结构化原因。 */
  skipped?: 'too-short' | 'no-template-fits';
}

/**
 * 节奏表（`03-storyboard/pacing.json`）。
 *
 * 职责**只有一个**：判断每条 cue 要不要配 motion、配什么。
 * 不做时长推导 —— motion 是「这句话」的伴生图形，这句话多长它就多长，
 * 从句首开始（见 `RhythmCue` 的快照说明）。
 */
export interface RhythmTable {
  meta: {
    fps: number;
    /** `aligned` = 有字幕 cue；`no-subtitle` = 无 cue（本阶段无法生成节奏表）。 */
    mode: 'aligned' | 'no-subtitle';
    version: string;
    /**
     * 表的来源（M-3，2026-10-23）。缺省 = `'rules'`（向后兼容已落盘产物）。
     * `semantic` = LLM 创作期语义判定，与 motionboard 同批落盘，
     * reason 即模型自述依据，供人工核对「pacing 决定 motionboard 分布」的因果。
     */
    source?: 'rules' | 'semantic';
  };
  cues: RhythmCue[];
}

// ─────────────────────────────────────────────────────────────
// 02-perceive 产物
// ─────────────────────────────────────────────────────────────

/**
 * 区域等级。预算彼此独立，且**不是**判「有没有相交」，
 * 而是算「从各级区域各拿了多少遮挡额度」（D2）。
 */
export type RegionKind = 'face' | 'handheld' | 'broll';

export interface PerceiveRegion {
  id: string;
  kind: RegionKind;
  shotId: string;
  fromFrame: number;
  durationInFrames: number;
  /** 该区域自身的包围盒（人脸/头肩、手持物、B-roll 主体）。 */
  box: Footprint;
  /** 主体归属低置信：不阻断，仅出 W-F6-01 告警（F6）。 */
  lowConfidence?: boolean;
}

export interface Shot {
  id: string;
  fromFrame: number;
  durationInFrames: number;
  /**
   * 安全区 = 主体 bbox 上部，**按 shot 取并集**、不逐帧跟随。
   * `null` = 主体不在场，全画面可行域（D2 三原则之三）。
   */
  safeArea: Footprint | null;
  subjectBox?: Footprint;
  lowConfidence?: boolean;
}

export interface PerceiveResult {
  fps: number;
  shots: Shot[];
  regions: PerceiveRegion[];
}

// ─────────────────────────────────────────────────────────────
// 03-storyboard 的锚点解析记录
// ─────────────────────────────────────────────────────────────

/**
 * 【实现期拟定，文档未点名】
 *
 * 烘焙后 `_author` 被剥离，`fromFrame` 已无「目标词」信息；
 * 而校验项 #1「时序校验：帧须落在目标词区间」需要这条映射。
 * 故在 03-storyboard 内保留一份解析记录，供 validate 只读消费。
 */
export interface BakeRecord {
  trackId: string;
  itemIndex: number;
  anchor: string;
  offset: string;
  /** 锚点解析到的词序号。`cue:` / `abs:` 锚点为 -1。 */
  wordIndex: number;
  /** 该词的区间，来自 01-align。非 `word:` 锚点为 -1。 */
  wordStartFrame: number;
  wordEndFrame: number;
  /** 锚点解析到的 cue 序号（C2-6）。`word:` / `abs:` 锚点为 -1。 */
  cueIndex: number;
  fromFrame: number;
}

export interface BakeReport {
  fps: number;
  records: BakeRecord[];
}

// ─────────────────────────────────────────────────────────────
// 00-input 清单
// ─────────────────────────────────────────────────────────────

/**
 * 素材清单。
 *
 * ⚠️ 【实现期拟定，文档未点名】
 *    校验项 #10「composition 尾部截断」需要知道成片总时长，而
 *    `storyboard.meta` 的字段集被文档锁死为 5 个（不含 durationInFrames），
 *    故把总时长放在素材清单里 —— 它本来就是素材的属性，不是 storyboard 的属性。
 */
export interface SourceManifest {
  /** 已粗剪拼接、无文字无特效的视频文件名。 */
  video: string;
  /** 对应 SRT 文件名。 */
  srt: string;
  fps: number;
  /** 成片总帧数 —— 即 `<Composition>` 的 durationInFrames。 */
  durationInFrames: number;
  /**
   * 画面尺寸（`P4` 裁决，2026-10-19）。
   *
   * **可选**。省略时 `render` 用 `ffprobe` 读视频真实分辨率，读不到才兜底 1920×1080
   * （见 `core/video-size.ts` 的 `resolveRenderSize`）。
   *
   * 🔴 为什么要进契约：此前 `<Composition>` 宽高**硬编码 1920×1080**，
   *    素材分辨率根本不参与渲染 —— 640×360 素材会被放大成 1080p，竖屏素材无路可走。
   *
   * ⚠️ 两个字段**必须同时填或同时省略**（只填一个视为配置错误，退出码 2）。
   * @see RenderSize
   */
  width?: number;
  height?: number;
}

// ─────────────────────────────────────────────────────────────
// motionboard.json —— 统一可编辑意图层（Wave 5 整合，2026-10-21）
// ─────────────────────────────────────────────────────────────
//
// 一份文件承载「生成 → 人改 → 绑定」全生命周期：
//   · 规则生成器首跑产出（intent 形态底稿）；
//   · 模型读 skill 精修；人工增删改（可把 intent 换成钉死 motion）。
// 管线除首跑生成外**只读**本文件；绑定器（调度前解析步）把 intent 解析成
// 模板绑定，intent 随 `_author` 在 bake 时「用完即弃」→ storyboard.json。

export interface MotionBoardItem {
  /** 作者语法层：锚点 + 偏移（复用 C2，烘焙后剥离）。 */
  _author: AuthorAnchor;
  /**
   * 动效意图（受控词表，见 `core/rhythm-rules.ts` 的 `MOTIONBOARD_INTENTS`）。
   * 与 `motion` **二选一** —— 由 `assertMotionboardKeys` 强制。
   */
  intent?: string;
  /** 钉死条目：直接指定模板 id（人工兜底 / 已知确切模板时）。 */
  motion?: string;
  /** 模型提炼的文案（修「文字提取生硬」）；缺省时绑定器机械提取。 */
  featuredText?: string;
  /** 人读备注（为什么这么配）；绑定器零消费，不进任何判定。 */
  note?: string;
  /**
   * 创作期生成 prompt（P1-b，提案 §4.5）——Task 4 skill 契约引用此字段名。
   * 仅创作期生成器与人审读；binder/validate/render 零消费（守 P0）；禁坐标/帧/颜色/CSS。
   */
  genPrompt?: string;
  /** 模型自评置信度（闸2 输入）。必填。 */
  confidence: number;
  /** 钉死条目的模板参数（直通，#16 兜底）；intent 条目一般不写（绑定器填）。 */
  params?: Record<string, unknown>;
  /** 覆盖模板默认占位矩形。 */
  footprint?: Footprint;
  /** 互斥组名。 */
  exclusive?: string;
  /** 相交检测降级为 warning（C3）。 */
  footprintAnimates?: boolean;
  /** 显式载体退路（人工返修可手填；绑定器也会按区域预算自动声明）。 */
  carrier?: CarrierRef;
  /** 显式帧（逃生口；正常路径由锚点烘焙）。 */
  fromFrame?: number;
  durationInFrames?: number;
  /** 调度分（人工可保留旧值；缺省由绑定器按钉死/候选档位赋值）。 */
  sim_max?: number;
}

export interface MotionBoardTrack {
  id: string;
  layer: number;
  handoffTo?: string | null;
  items: MotionBoardItem[];
}

export interface MotionBoard {
  meta: {
    fps: number;
    /** 省略 = 'word'。无字幕模式手写文件无此约束（只用 abs: 锚点）。 */
    anchorMode?: AnchorMode;
    alignmentConfidence: number;
    version?: string;
    author?: string;
    confirmedBy?: string;
    confirmedAt?: string;
  };
  tracks: MotionBoardTrack[];
  noMotionRanges: NoMotionRange[];
}

/** 绑定溯源单条记录（`bind-report.json`）。 */
export interface BindRecord {
  /** `trackId/000` 形式的条目引用。 */
  ref: string;
  source: 'intent' | 'pinned';
  intent?: string;
  /** 解析结果（intent 命中的模板 / 钉死值）。 */
  motion: string;
  /** 命中候选序（0 起）；钉死条目无此字段。 */
  candidateOrder?: number;
  /** intent 实际尝试过的候选（按序）。 */
  candidatesTried?: string[];
  pinned?: boolean;
  featuredText?: string;
  status: 'bound' | 'no-fits';
  reason: string;
}

export interface BindReport {
  fps: number;
  records: BindRecord[];
  /** no-fits 条数（显式计数，绝不静默）。 */
  noFits: number;
}

// ─────────────────────────────────────────────────────────────
// 绑定产物（烘焙输入）—— 原定义于 stages/storyboard.ts，
// Wave 5 整合时上提至 core（绑定器在 core，不得反向依赖 stages）。
// ─────────────────────────────────────────────────────────────

/**
 * 绑定后的起草稿 item（烘焙输入）。
 *
 * 与最终契约的差别（都来自「模型只填表不写代码」这条铁律）：
 *  · `fromFrame` / `durationInFrames` **可省略** —— 前者由锚点烘焙得出，
 *    后者由 `max(模板 minVisibleInFrames, 锚定词区间长度)` 推导。
 *  · 额外允许携带 `sim_max` 与 `confidence`，它们是闸1 / 闸2 的输入。
 */
export type DraftItem = Omit<StoryboardItem, 'fromFrame' | 'durationInFrames'> & {
  fromFrame?: number;
  durationInFrames?: number;
  sim_max?: number;
  confidence?: number;
};

export interface DraftTrack {
  id: string;
  layer: number;
  handoffTo?: string | null;
  items: DraftItem[];
}

export interface DraftStoryboard {
  meta: StoryboardMeta;
  tracks: DraftTrack[];
  noMotionRanges: Storyboard['noMotionRanges'];
}
