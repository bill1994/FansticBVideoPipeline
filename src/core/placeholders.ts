/**
 * 占位值注册表 —— 「哪些阈值是待校准的」的**唯一真源**（D6.4）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要这个文件（2026-10-18）
 * ─────────────────────────────────────────────────────────────
 * 「占位值有几个」在本项目里曾同时存在三个互不相等的口径：
 *   · `MEMORY.md` 按分号分组数 → **8**
 *   · `PROGRESS.md §四 3` 表里 **8 行**，但混进了一个「非缺口」的 `DUR`、漏了 `CONFIDENCE_BANDS`
 *   · 代码里 `PLACEHOLDER` 字样只有 3 处注释标记
 * 三个数都能"自圆其说"，因为**没人规定粒度和收录判据**。
 *
 * 后果不是数字难看，而是：**任何"校准占位值"的工作都无法声明范围** ——
 * 你不知道自己校完了没有，也不知道下次数出来为什么又不一样。
 *
 * ─────────────────────────────────────────────────────────────
 * 两条硬约定（改本文件前先读）
 * ─────────────────────────────────────────────────────────────
 * ① **只引用，不复制**。每个 `read()` 都必须返回真源常量的当前值。
 *    抄一份数字进来 = 立刻制造第二个真源，本项目已因同一病栽过三次
 *    （split-frame 坐标系 / `clampScale` 常量 / 校验项顺序耦合）。
 *    因此本文件**禁止出现字面阈值**，只有 `() => X.y` 这种引用。
 *
 * ② **粒度 = 一个需要独立做出的校准决定**。
 *    同进同退的几个数算**一项**（如对齐门控的三个阈值必须一起定，
 *    因为分开调会留下"看着齐全实则测不到"的门）。
 *    于是计数唯一：`PLACEHOLDERS.length`。
 *
 * ─────────────────────────────────────────────────────────────
 * 收录判据（同时也是排除判据）
 * ─────────────────────────────────────────────────────────────
 * 收：**文档（SPEC / 裁决册）未给数值或只给初值**，且**影响判定结论或成片几何**的参数。
 *
 * 不收（连同理由，免得下次又被重新计入）：
 *   · `region-derive.maxAreaRatio`(0.6) / `minEnergy`(2.0) —— 启发式开关，
 *     语义本身即上界（"面积超 60% 就不算主体"），不是待实测的质量阈值
 *   · `PERCEIVE.detectMaxSide`(512) / `scoreThreshold`(0.9) / `nmsThreshold`(0.3)
 *     —— 上游 opencv_zoo demo 惯例，非本项目拟定
 *   · `whisper-adapter.MIN_DURATION_MS`(40) —— 技术兜底（避免零时长），非质量阈值
 *   · `DUR.enter/exit`(0.16/0.22) —— 第二轮已按真渲实测调优（t=0.2 走完 75%），
 *     状态是「已调优、待真实素材复核」，与「未校准」不同类别，见 `tokens.ts`
 *   · `MATCH_MIN_SIMILARITY`(0.35) —— **实测校准过**（正确 0.655–1.000 / 听漏半句 0.455 /
 *     错位 ≤0.154 ⇒ 取空隙中央）。它是 `PARAM-DECISIONS.md` 的正面样板，不是占位值
 *
 * ─────────────────────────────────────────────────────────────
 * 消费者
 * ─────────────────────────────────────────────────────────────
 * · `npm run placeholders` → 渲染 `docs/decisions/PARAM-DECISIONS.md`（文档不手改）
 * · `tests/placeholders.test.ts` → 断言 id 唯一、`read()` 有限、真源位置存在
 * ⚠️ **生产代码不读本文件**：它只服务"资产盘点"，不参与任何判定。
 *    若哪天有判定读了它，它就从盘点表变成了配置源，届时须先走裁决册。
 */

import {
  ALIGN_GATE,
  DENSITY,
  HANDHELD_EXPANSION,
  PERCEIVE,
  RHYTHM,
  SALIENCY_TARGET_AREA_RATIO,
} from './config.ts';
import { CONFIDENCE_BANDS } from './schedule.ts';
import { CARRIER_RATIO_DEFAULT, MIN_VISIBLE_RATIO } from './carrier-window.ts';
import { REWEIGH_COVERAGE_MIN } from './word-timeline.ts';
import { SILENCE } from './config.ts';

/** 一个可独立校准的数值（同一项内可能有多个，必须一起定）。 */
export interface PlaceholderMember {
  /** 人读名，进文档表格。 */
  label: string;
  /** **引用**真源，禁止写字面值。 */
  read: () => number;
}

/**
 * 占位值的来源类别。
 * · `invented`    —— 文档完全未给数值，为实现可运行而拟定
 * · `doc-initial` —— 文档给了初值/默认值，但明示"待实测校准"
 *
 * 两者都**不得当结论引用**，区别只在"改它要不要先改文档"。
 */
export type PlaceholderKind = 'invented' | 'doc-initial';

export interface PlaceholderParam {
  /** 稳定标识（kebab-case）。日志/文档/裁决引用它，**不要按序号引用**。 */
  id: string;
  /** 人读标题。 */
  title: string;
  kind: PlaceholderKind;
  /** 真源位置，格式 `文件#符号`。用于人工追溯。 */
  source: string;
  members: PlaceholderMember[];
  /** 当前值从哪来（一句话，可追溯到文档/实测）。 */
  basis: string;
  /** **怎么校准** —— 写成可执行的动作，不是"需实测"三个字。 */
  calibration: string;
  /** 越界后果：偏大 / 偏小各会发生什么**看得见的事**。 */
  impact: string;
  /** 它当前卡着谁（若有）。 */
  blockedBy?: string;
  /** 必须与哪些 id **一起**校准（分开拍会留下假门）。 */
  alignWith?: string[];
}

/**
 * 全部占位值。**顺序无关**，引用一律用 `id`。
 *
 * ⚠️ 新增条目必须同时说明「为什么它符合收录判据」，
 *    否则下一个人会以为这里也能随手加。
 */
export const PLACEHOLDERS: readonly PlaceholderParam[] = [
  {
    id: 'align-gate',
    title: '强制对齐门控',
    kind: 'doc-initial',
    source: 'src/core/config.ts#ALIGN_GATE',
    members: [
      { label: 'meanConfidenceMin', read: () => ALIGN_GATE.meanConfidenceMin },
      { label: 'lowConfidenceRatioMax', read: () => ALIGN_GATE.lowConfidenceRatioMax },
      { label: 'alignedRatioMin', read: () => ALIGN_GATE.alignedRatioMin },
    ],
    basis:
      '前两项是 C2-2 的文档初值「均值<0.60 或低置信词>30% → 阻断」；' +
      '`alignedRatioMin=0.8` 是实现期拟定（M-1c，2026-10-13）。',
    calibration:
      '在 2–3 条真实素材上跑 align，取 `alignedRatio` 与 `meanConfidence` 的实测分布下沿；' +
      '三项**必须一次定完**。已知反例：kukini 三项全过（0.9113 / 3.19% / 1.000），' +
      '但词时仍漂 7.06s ⇒ 光调这三个数**修不了** `M-1d`，别指望它。',
    impact:
      '偏严 → 好素材被误拦（退出码 1，用户无路可走）；' +
      '偏松 → 错位对齐静默通过，错误直到成片才看得见。',
    alignWith: ['confidence-bands'],
  },
  {
    id: 'confidence-bands',
    title: '闸2 置信度分档',
    kind: 'invented',
    source: 'src/core/schedule.ts#CONFIDENCE_BANDS',
    members: [
      { label: 'high（≥ → auto）', read: () => CONFIDENCE_BANDS.high },
      { label: 'mid（≥ → alternatives）', read: () => CONFIDENCE_BANDS.mid },
    ],
    basis:
      '真源只给了组合矩阵（低/中/高 → must_review/alternatives/auto），**未给分界数值**。',
    calibration:
      '与 `align-gate` 同批跑：把实测 confidence 排序后看三档的实际切点，' +
      '要求「auto 档不出现明显错位项」。',
    impact:
      '偏严 → 大量条目掉进 must_review，而项目没有审核 UI，人审成本直接压给用户；' +
      '偏松 → 低质条目自动通过，闸2 退化成装饰。',
    alignWith: ['align-gate'],
  },
  {
    id: 'density',
    title: '每 cue 最大 item 数',
    kind: 'invented',
    source: 'src/core/config.ts#DENSITY',
    members: [{ label: 'maxItemsPerCue', read: () => DENSITY.maxItemsPerCue }],
    basis: '真源全文只写「每 cue 的 item 数超阈值 → error」，**未给数值**。',
    calibration:
      '统计真实 storyboard 的「每 cue 实际 item 数」分布，取 P90 作为阈值；' +
      '至少 2 条素材、覆盖口播/特写两类镜头。',
    impact:
      '🔴 **这是唯一一个「占位值却直接产 error」**：偏严会**阻断真实素材**，' +
      '而项目没有 storyboard 编辑 UI，用户只能手改 JSON。' +
      '这是「过度严格」最现实的伤害点。',
  },
  {
    id: 'rhythm-min-cue-frames',
    title: '节奏表的 motion 时长门槛',
    kind: 'invented',
    source: 'src/core/config.ts#RHYTHM',
    members: [
      { label: 'minCueFramesForMotion', read: () => RHYTHM.minCueFramesForMotion },
    ],
    basis:
      '文档与裁决册均未给数值；**用户于 2026-10-20 指定初值 10 帧**（P1 节奏表落地时口头给定），' +
      '明确标注「待实测」。语义是「一条 cue 短于 10 帧就不值得配伴生动效」，' +
      '与语速 / 间隙 / 预算无关。',
    calibration:
      '在 2–3 条真实口播素材上跑内置生成器，统计 `pacing.json` 里 `too-short` 的占比：' +
      '① 「短到读不完」的 cue 应被挡掉（对着成片看，被配了动效却来不及读的算漏挡）；' +
      '② 正常的一句话不应被误挡（被挡后整段没有伴生图形）。' +
      '⚠️ 它只影响 motion，字幕层恒有一条，不受此值影响。',
    impact:
      '偏大 → 正常短句不配动效，成片显得「有的句子有图形、有的没有」，节奏断裂；' +
      '偏小 → 极短 cue 上也弹动效，观众读不完，反而干扰理解。',
  },
  {
    id: 'safe-area-top',
    title: '安全区顶部比例',
    kind: 'invented',
    source: 'src/core/config.ts#PERCEIVE.safeAreaTopRatio',
    members: [{ label: 'safeAreaTopRatio', read: () => PERCEIVE.safeAreaTopRatio }],
    basis:
      'SPEC §2.7 只写「安全区 ≠ 主体 bbox，取 bbox 上部（腿部以下可压）」，无精确比例；' +
      '0.6 取自 talkcraft 的生产口径（上 60% / 左右 20%）。',
    calibration:
      '真实素材抽帧，量「头 + 手（+ 手持物）下沿」占 bbox 的比例，取覆盖所需值。' +
      '`tools/probe-regions.mts` 可批量出图。',
    impact:
      '偏大 → 安全区变窄，正常字幕被判遮挡，`W-D2-01` 满屏；' +
      '偏小 → 主体下半被 overlay 压住却不报警。',
  },
  {
    id: 'handheld-expansion',
    title: 'handheld 人脸框外扩',
    kind: 'invented',
    source: 'src/core/config.ts#HANDHELD_EXPANSION',
    members: [
      { label: 'widthRatio（宽）', read: () => HANDHELD_EXPANSION.widthRatio },
      { label: 'heightRatio（高）', read: () => HANDHELD_EXPANSION.heightRatio },
    ],
    basis:
      'SPEC 只说 handheld 是「手持讲解物品」，**未规定如何从人脸推导**。' +
      '当前值有部分实测依据（3月22日 s2：手与鞋落在 y≈0.75–0.85，反推高度需 2.3，取 2.5 留余量），' +
      '但只对那一种构图成立。',
    calibration:
      '在 3 条素材上取「人物中景 / 特写 / 半身」各一帧，量手与手持物下沿，' +
      '要求外扩框底部 ≥ 该下沿且不超 `OCCLUSION_BUDGET.handheld`(0.2) 的合理占比。',
    impact:
      '偏小 → 手和手持物落在框外，遮挡**完全漏报**；' +
      '偏大 → 框吃满 20% 预算，同样大小的 overlay 占比变小，保护形同虚设。',
  },
  {
    id: 'saliency-target',
    title: '显著性目标框面积',
    kind: 'invented',
    source: 'src/core/config.ts#SALIENCY_TARGET_AREA_RATIO',
    members: [
      { label: 'targetAreaRatio', read: () => SALIENCY_TARGET_AREA_RATIO },
    ],
    basis: '无文档依据；三素材目视可接受，**未做量化**。',
    calibration:
      '对每个 broll shot 跑 `tools/probe-saliency.mts`（已有 0.15 / 0.35 / 0.5 三档），' +
      '由人判定「框是否刚好框住主体」，统计最常被选中的档位；至少 10 个 shot。',
    impact:
      '偏小 → 框太窄，overlay 压到主体却按小框算占比，遮挡漏报；' +
      '偏大 → 框覆盖大半屏，`broll` 的 30% 预算一进来就超，判定退化为常态报警。',
  },
  {
    id: 'carrier-ratio',
    title: '载体缺省占比',
    kind: 'invented',
    source: 'src/core/carrier-window.ts#CARRIER_RATIO_DEFAULT',
    members: [{ label: 'CARRIER_RATIO_DEFAULT', read: () => CARRIER_RATIO_DEFAULT }],
    basis:
      'D4-t2 裁决只给了钳制区间 [0.3, 0.7]，**未给默认值**；' +
      '取区间中值 0.5（"不需要判断时应当安全"）。',
    calibration:
      '真实素材上试 0.3 / 0.5 / 0.7 三档分屏，看「展示条能否放下 9 个模板的最长文本」' +
      '且「主体不被切走」（配合 `MIN_VISIBLE_RATIO` 判据）。',
    impact:
      '偏小 → 主体被切走，`W-D2-02` 报警；偏大 → 展示条窄到放不下内容，' +
      '与 `text-metrics` 的字数上限打架。',
    alignWith: ['min-visible'],
  },
  {
    id: 'min-visible',
    title: '主体最低可见比',
    kind: 'doc-initial',
    source: 'src/core/carrier-window.ts#MIN_VISIBLE_RATIO',
    members: [{ label: 'MIN_VISIBLE_RATIO', read: () => MIN_VISIBLE_RATIO }],
    basis: 'D4-t2 裁决原文给的默认值 0.5，明示"待真实素材校准"。',
    calibration:
      '真实素材上跑分屏，量 `|safeArea ∩ visibleRegion| / |safeArea|` 的实际分布，' +
      '取「观感上主体未被切走」的最低值；需与 `carrier-ratio` 一起定。',
    impact:
      '偏严 → 正常分屏被判「主体被切走」，`W-D2-02` 满屏；' +
      '偏松 → 主体被切掉一半仍报通过。',
    blockedBy: '`W-D2-02` 从 warning 升 error',
    alignWith: ['carrier-ratio'],
  },
  {
    id: 'silence-thresholds',
    title: '静音检测与 SRT 一致性校验阈值',
    kind: 'invented',
    source: 'src/core/config.ts#SILENCE',
    members: [
      { label: 'noiseDb', read: () => SILENCE.noiseDb },
      { label: 'minDurationSec', read: () => SILENCE.minDurationSec },
      { label: 'longSilenceSec', read: () => SILENCE.longSilenceSec },
      { label: 'overlapToleranceSec', read: () => SILENCE.overlapToleranceSec },
    ],
    basis:
      '文档与裁决册均未给数值（`M-1d` / `M-1f` 为 OPEN）。kukini 单条素材实测：' +
      '`noise=-40dB / d=0.5` 下全片仅 3 段静音（6.736s 大空洞 + 0.53s / 0.57s 句中换气）；' +
      'SRT 留白 7.083s vs 实测 6.736s，差 0.35s ⇒「长静音」取 1.0s 以排除换气。',
    calibration:
      '补齐 3月22日 / 5月28日 的 SRT 后，三条素材各跑一次 align，' +
      '对比 `silentWordRatio` 与「SRT↔静音不吻合」的告警条数：' +
      '① 不吻合告警应**只在真错位时**出现（句中换气绝不能被当错位）；' +
      '② `longSilenceSec` 需保证各素材的正常换气都不超过它；' +
      '③ `noiseDb` 若素材底噪偏高需上调。',
    impact:
      '`noiseDb` 偏大（阈值过高）→ 正常语音尾音被判静音 → 词时误重铺、误告警；' +
      '偏小 → 真静音漏检 → `M-1d` 失守。' +
      '`longSilenceSec` 偏小 → 句中换气被当错位 → 满屏警告（用户会学会忽略警告）；' +
      '偏大 → 大错位漏检。' +
      '`overlapToleranceSec` 偏小 → 边界轻微不齐就报警；偏大 → 真错位放过。',
    blockedBy: '`M-1d` 判据升 error；`M-1f` Q2 的告警可用性',
    alignWith: ['align-gate'],
  },
  {
    id: 'reweigh-coverage-min',
    title: '词时重铺的覆盖率阈值',
    kind: 'invented',
    source: 'src/core/word-timeline.ts#REWEIGH_COVERAGE_MIN',
    members: [{ label: 'REWEIGH_COVERAGE_MIN', read: () => REWEIGH_COVERAGE_MIN }],
    basis:
      '**继承自 `highlightWords` 的原值 0.8，不是本项目验证过的结论** —— ' +
      '它随显示层实现被搬进产物层，来源已不可考。' +
      'kukini 修复后实测分布：最小 0.714 / 25%位 0.857 / 中位 0.900 / 最大 1.000。' +
      '阈值 0.8 恰好把 7 条「首词比 SRT 窗口早约 10 帧」的边缘 cue 判为需重铺，' +
      '而它们的词时**本是对的**（人说话起止略宽于字幕标注，非错位）。',
    calibration:
      '🔴 **原写的校准路径走不通（2026-10-20 复核推翻）**：原文要求「补齐 3月22日 / ' +
      '5月28日后三条素材各跑一次取覆盖率分布」，但这两条走的是 **M-1g 无字幕模式**' +
      '（`mode:no-subtitle`，`cues` 与 `words` 均为空数组，`silentWordRatio: null`）' +
      '⇒ **它们永远不会有覆盖率分布**。换言之，本项目当前**只有 1 条样本**' +
      '（`e2e-perceive` / kukini，48 cue），不足以定线。' +
      '正确路径：① 补一条**走完整对齐**（非 M-1g）的素材，取其分布；' +
      '② 阈值应落在「真漂移」与「边缘抖动」之间的**空隙**（kukini 上看是 0.714 之下）；' +
      '③ 交叉验证：低于阈值的 cue 是否真落进了静音（用 `silentWordRatio` 佐证），' +
      '只有「既低覆盖、又落静音」才是真漂移。' +
      '⚠️ **实测敏感性（2026-10-20）**：kukini 的分布在 0.70–0.95 区间**连续无断层**' +
      '（29 条 cue 密集落在此区间），阈值每动 0.05 就会改变 3–12 条的重铺判定' +
      '⇒ 0.8 附近**没有天然安全区**，单样本下改值即改行为，不可凭手感调。',
    impact:
      '偏高 → 真漂移漏修（本次已修的那条 cov=0.182 会漏掉）；' +
      '偏低 → **把对的词时改坏**（本次 0.8 会误伤 7 条本正确的 cue）。' +
      '⚠️ 第二个方向更隐蔽：重铺后画面看不出异常，只是高亮时机被人为改过。',
    blockedBy: '`M-1f` 的「好数据不被修坏」保证',
    alignWith: ['align-gate'],
  },
];

/**
 * **明确排除**的拟定值 —— 让「为什么是 8 不是 12」有据可查。
 *
 * 这些值同样是「实现期拟定」或「文档未规定」，但**不进占位值清单**。
 * 若哪天想收进来，先说明它为什么符合收录判据（见文件头），别只加一行。
 */
export interface ExcludedParam {
  name: string;
  where: string;
  reason: string;
}

export const EXCLUDED_PARAMS: readonly ExcludedParam[] = [
  {
    name: 'maxAreaRatio / minEnergy',
    where: 'src/stages/region-derive.ts',
    reason: '启发式开关，语义本身即上界（「面积超 60% 就不算主体」），不是待实测的质量阈值',
  },
  {
    name: 'detectMaxSide / scoreThreshold / nmsThreshold',
    where: 'src/core/config.ts#PERCEIVE',
    reason: '对齐上游 opencv_zoo demo 的默认值，属上游惯例而非本项目拟定',
  },
  {
    name: 'MIN_DURATION_MS',
    where: 'src/stages/whisper-adapter.ts',
    reason: '技术兜底（避免零时长 token），非质量阈值，调它不影响判定口径',
  },
  {
    name: 'DUR.enter / DUR.exit',
    where: 'src/remotion/tokens.ts#DUR',
    reason: '第二轮已按真渲实测调优（expo-out 在 t=0.2 走完 75%），属「已调优、待真实素材复核」，与「未校准」不同类别',
  },
  {
    name: 'MATCH_MIN_SIMILARITY',
    where: 'src/stages/text-align.ts',
    reason: '**已实测校准**（正确匹配 0.655–1.000 / 听漏半句 0.455 / 错位 ≤0.154 ⇒ 取 0.35 落在空隙中央），是 PARAM-DECISIONS 的正面样板，不是占位值',
  },
];

/** 占位值**项数**（= 需要独立做出的校准决定个数）。 */
export function placeholderCount(): number {
  return PLACEHOLDERS.length;
}

/** 占位值**数值个数**（一项可能含多个数，如对齐门控有 3 个）。 */
export function placeholderValueCount(): number {
  return PLACEHOLDERS.reduce((n, p) => n + p.members.length, 0);
}

/**
 * 渲染成 Markdown 表格 —— `docs/decisions/PARAM-DECISIONS.md` 的正文由它生成。
 *
 * 为什么由代码生成而不是手写：手写就又是一份"抄来的数字"，
 * 改了常量忘了改文档，就会重现 `DUR.exit` 那类事故（定义了没人用 / 写法与实现不符）。
 */
export function renderPlaceholderTable(): string {
  const head =
    '| id | 参数 | 类别 | 当前值 | 真源 | 卡着谁 |\n' +
    '|---|---|---|---|---|---|\n';
  const rows = PLACEHOLDERS.map((p) => {
    const values = p.members
      .map((m) => `\`${m.label}\` = **${m.read()}**`)
      .join('<br>');
    const kind = p.kind === 'invented' ? '实现期拟定' : '文档初值';
    const [file, sym] = p.source.split('#');
    const src = `\`${(file ?? p.source).replace(/^src\//, '')}\` · \`${sym ?? '?'}\``;
    return `| \`${p.id}\` | ${p.title} | ${kind} | ${values} | ${src} | ${p.blockedBy ?? '—'} |`;
  });
  return head + rows.join('\n');
}
