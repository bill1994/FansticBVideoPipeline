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
   * M-1 已裁决取 `'srt'`（B2-fix：只取 SRT 文本，时间戳从音频重新推导）。
   * 保留另两个取值是为将来若改判时**有历史可比**，而非鼓励使用。
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
   * 同时作为**门控项**：低于阈值 → 退出码 2，走 C2-4 已有的
   * 「人工确认后继续」通道。
   */
  alignedRatio: number;

  /** 实际使用的阈值，便于事后追溯。 */
  thresholds: {
    meanConfidenceMin: number;
    lowConfidenceRatioMax: number;
    /** 🔴 PLACEHOLDER（新增）：alignedRatio 的下限。须与 meanConfidenceMin 一并校准。 */
    alignedRatioMin: number;
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
}

export interface AlignWords {
  fps: number;
  words: WordTimestamp[];
  cues: Cue[];
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
  /** 锚点解析到的词序号。 */
  wordIndex: number;
  /** 该词的区间，来自 01-align。 */
  wordStartFrame: number;
  wordEndFrame: number;
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
}
