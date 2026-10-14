/**
 * 第二步：把 SRT 的文字与 whisper 的时间**合成**成 `WordTimestamp[]`。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要这个模块（M-1 方案 b）
 * ─────────────────────────────────────────────────────────────
 * M-1 裁决：**文本权威归 SRT，时间戳必须由音频重新推导**。
 * 于是 align 阶段必须把两样东西合起来：
 *   - 文字：来自 SRT（人工校对过，是真值）
 *   - 时间：来自音频（whisper），SRT 的时间戳**不参与任何下游判定**
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么不直接按「窗口内均摊」（这是关键设计取舍）
 * ─────────────────────────────────────────────────────────────
 * 曾经考虑过「SRT cue 窗口内按字数平均切开」——实现最简单。
 * **被否**，因为它会让 M-1c 的门控失效：
 *
 *   M-1c 要求 `alignedRatio` =「SRT 词成功对上 whisper token 的比例」，
 *   且它**同时是门控项**。它的存在理由是原文写明的：
 *     「meanConfidence 衡量的是『whisper 对自己听到的词有多自信』，
 *       它**测不到『SRT 与音频是否对得上』**，
 *       whisper 自信但与 SRT 完全不符的场景会直接通过门控」
 *
 *   纯均摊**没有「匹配」这个动作** ⇒ `alignedRatio` 无从计算 ⇒ 门控形同虚设。
 *   这正是本项目反复踩的「静默假绿」：时间戳看着有、校验也能过，但实拍对不上。
 *
 * 所以本模块**先做匹配，再谈时间**：
 *   ① SRT cue ↔ whisper segment 匹配  → 产出 `alignedRatio`（M-1c 门控）
 *   ② 匹配上的 cue，取其对应 segment 的**真实边界**作为时间锚
 *   ③ 只在 cue **内部**做字级均摊（这一步误差不累积到别的 cue）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么用 segment 层而不是 token 层
 * ─────────────────────────────────────────────────────────────
 * 🔴 2026-10-14 实测：`whisper.cpp -ojf`（逐 token JSON）会把多字节汉字的
 * UTF-8 从中间切断，每个碎片单独写成一个 JSON 字符串（实测 30s 素材上
 * 66 处截断，119 个 token 里 49 个变成 U+FFFD）。
 * ⇒ **token 层的 text 不可用**。
 *
 * 而 **segment 层的 text 是正确的**（同一次运行的 segment 文本与 `-oj` 直出一致），
 * 且 segment 边界与人工断句高度吻合。
 * ⇒ 我们只采信 segment 层：它的时间、它的文本（仅用于匹配，不用于最终输出）。
 *
 * ─────────────────────────────────────────────────────────────
 * 确定性红线（C2-1 的延伸）
 * ─────────────────────────────────────────────────────────────
 * `words[]` 的切分**必须稳定**：`word:N` 是索引而非内容，
 * 同一份 SRT 换一次运行若切出不同的词，已归档 storyboard 的 `word:37`
 * 会指向不同的词，**而报告照样全绿**（这正是 M-1 否掉方案 a 的理由）。
 * ⇒ 本模块的**全部**逻辑必须确定：无随机、无时间依赖、无外部词典。
 *   `Intl.Segmenter` 是 ICU 内置的确定性分词器，不依赖任何模型文件。
 */

/** 词条。**字级**：一个汉字 / 一个英文词 / 一个数字，都是一个 entry。 */
export interface SrtToken {
  /** 在 `words[]` 中的全局序号。`word:N` 锚点指的就是它。 */
  index: number;
  /** 文本（来自 SRT，**逐字切分后**）。 */
  text: string;
  /** 属于哪条 SRT cue（`SrtCue.index`）。 */
  cueIndex: number;
  /** 在该 cue 内的第几个字（0 起）。 */
  indexInCue: number;
  /** 该 cue 内总字数。 */
  cueLength: number;
  startMs: number;
  endMs: number;
  /** 该词的时间置信度 0–1（来自所属 cue 的匹配质量）。 */
  confidence: number;
}

/** whisper segment 层的最小输入（只取我们信的那部分）。 */
export interface WhisperSegment {
  /** 段文本。**只用于匹配**，不进入最终输出（文本权威是 SRT）。 */
  text: string;
  startMs: number;
  endMs: number;
}

export interface MatchResult {
  /**
   * SRT cue index → 匹配到的 segment 序号；`-1` = 未匹配上。
   *
   * ⚠️ **允许多对一**：SRT 是人工按语义断句、whisper 是按呼吸断段，
   * 粒度本来就不一致。实测（2026-10-14 真实素材）出现
   * **3 条 SRT cue 对应 1 个 whisper segment** 的情况：
   *   SRT: 「它把…的中底和cookie的」/「外骨骼巧妙的结合在了一起」/「它这个TPU…」
   *   seg: 「他把…的中底和Cookini的外谷格巧妙的结合在了一起」  ← 合成一段
   * 强制 1:1 会让后两条 cue 匹配失败 → 退回 SRT 时间 → 时间倒退 + 重叠。
   */
  cueToSegment: number[];
  /**
   * SRT cue index → 匹配区间的**末段**序号。仅当一条 cue 横跨多个 segment
   * 时与 `cueToSegment` 不同（见「一对多」说明）。`-1` = 未匹配。
   */
  cueToLastSegment: number[];
  /** 成功匹配的 cue 数。 */
  matchedCues: number;
  /** `alignedRatio` = matchedCues / 总 cue 数（M-1c 门控项）。 */
  alignedRatio: number;
}

/** 归一化：去掉空格/标点，只留用于比对的「实义字符」。 */
export function contentChars(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

/** 两个字符串的字符级相似度（0–1），用归一化后的实义字符比。 */
export function similarity(a: string, b: string): number {
  const x = contentChars(a);
  const y = contentChars(b);
  if (x === '' && y === '') return 1;
  if (x === '' || y === '') return 0;
  // LCS 长度 / 较长者长度 —— 对「插入/漏字」比编辑距离更宽容
  const m = x.length;
  const n = y.length;
  let prev = new Array<number>(n + 1).fill(0);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[n]! / Math.max(m, n);
}

/**
 * 相似度阈值：低于它视为「没匹配上」。
 *
 * ─────────────────────────────────────────────────────────────
 * 取值依据（2026-10-14 真实素材实测，非拍脑袋）
 * ─────────────────────────────────────────────────────────────
 * 实测了「正确匹配」与「错位匹配」两组的相似度分布：
 *
 *   | 类别 | 相似度 |
 *   |---|---|
 *   | 正确匹配（5/6） | 0.655 – 1.000 |
 *   | **正确匹配的例外：whisper 只听了一半** | **0.455** |
 *   | 错位匹配（全部） | 0.000 – 0.154 |
 *   | 错位匹配最高 | 0.154 |
 *
 * 两者之间有**巨大空隙**（0.154 → 0.455）。取 **0.35** 落在空隙中央：
 *   - ✅ 能救回「whisper 只听到半句」的情况（0.455 > 0.35）
 *   - ✅ 仍能拒绝全部实测错位匹配（最高 0.154，有 2.3 倍余量）
 *
 * 🔴 为什么必须救回 0.455 那一档：
 *   那不是「对不上」，而是「whisper 漏听了后半句」——
 *   SRT 说这里有话、音频里确实有人在说这句，只是 ASR 没听全。
 *   若判为未匹配，这些 cue 就产不出词条，`alignedRatio` 虚低，
 *   且**真正的对不上反而被稀释**（分母变大）。
 *
 * 🔴 这是**门控的一部分**，不许随手改。要改必须连同
 *    `ALIGN_GATE.alignedRatioMin` 一起重新校准（M-1c 纪律：不得分两次拍）。
 */
export const MATCH_MIN_SIMILARITY = 0.35;

/**
 * 把一段 cue 文本拼起来与 segment 比 —— 用于「多对一」的候选评估。
 */
function joinedFrom(cues: Array<{ text: string }>, from: number, toExclusive: number): string {
  return cues.slice(from, toExclusive).map((c) => c.text).join('');
}

/**
 * 把 SRT cue 序列与 whisper segment 序列做**单调、多对一**的对齐。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么不是简单的 1:1 DP
 * ─────────────────────────────────────────────────────────────
 * 实测（2026-10-14）SRT 与 whisper 的断句粒度不一致：
 *   3 条 SRT cue ←→ 1 个 whisper segment
 * 1:1 DP 会把后两条 cue 判为「未匹配」，退到 SRT 时间，
 * 结果是**时间倒退 + cue 重叠 2580ms**（已实测复现）。
 *
 * 所以这里允许 **k 条 cue 共享 1 个 segment**（多对一）。
 * 反过来（1 条 cue 对多个 segment）不做：SRT 是人工断句，比 whisper 可信，
 * 若 whisper 把一个 cue 切成两段，取哪一段都行，没必要合并。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么要**双向**容忍粒度不匹配
 * ─────────────────────────────────────────────────────────────
 * 实测（2026-10-14 真实素材）两个方向都出现了：
 *
 *   **多对一**（3 条 SRT cue ←→ 1 个 segment）
 *     SRT:「它把…中底和cookie的」/「外骨骼巧妙的结合在了一起」/「它这个TPU…」
 *     seg:「他把…中底和Cookini的外谷格巧妙的结合在了一起」
 *
 *   **一对多**（1 条 SRT cue ←→ 2 个 segment）
 *     SRT:「就是耐克和Stussy联名的Spiridon Kukini Ⅱ」
 *     seg:「就是耐克和斯达西联名的」 + 「Spiritone Cookini II」
 *
 * 只支持一个方向，另一个方向的 cue 就会判「未匹配」，
 * `alignedRatio` 虚低、且这些 cue 无法产出词条。
 * ⇒ DP 必须**两边都能跳**：`k` 条 cue 共享 1 个 segment 之外，
 *   也允许 1 条 cue 横跨多个 segment（用它们的**并集区间**做锚）。
 *
 * ─────────────────────────────────────────────────────────────
 * 算法
 * ─────────────────────────────────────────────────────────────
 * 二维 DP，状态 `(i, j)` = 已消费 i 条 cue、已用到第 j 个 segment。
 * 转移有三类：
 *   ① 跳过 cue i（判为未匹配）
 *   ② 跳过 segment j（判为「音频有、SRT 没写」）
 *   ③ 用 segment j..j+p-1 匹配 cue i..i+k-1（p,k ≥ 1）
 *
 * 得分 = **纯相似度之和**（不乘任何长度补偿）。
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 为什么不能加「长度补偿项」（这里是踩过坑的，务必别改回去）
 * ─────────────────────────────────────────────────────────────
 * 曾用过 `sim × log2(1+k) - log2(1+p)` 与 `sim × 对齐字符数`，**都被实测证伪**：
 *
 *   场景：cue「就是耐克和Stussy联名的Spiridon Kukini Ⅱ」
 *        正确匹配 = seg1+seg2（sim 0.655）
 *        错误匹配 = 只取 seg2（sim 0.545，丢掉前半段 3240ms）
 *   旧公式给 错误 0.545 / 正确 0.070 ⇒ **选了错的**。
 *   换成「×对齐字符数」后走向另一极端：DP 把 4 条 cue 全塞进 seg0（前 20 秒）。
 *
 * 根因：任何「越长越高分」的项都会诱导 DP 吞并。而纯相似度天然抑制吞并
 * （拼入无关文本会让 LCS/max 下跌）：
 *   硬拼 2 条 cue 对 1 个 seg → sim 跌到 0.25（应拒 ✅）
 *   正确跨 2 段           → sim 0.655（应收 ✅）
 *
 * 那怎么区分「正确跨段」与「只匹配后半段」？两者 sim 分别是 0.655 / 0.379
 * 都在阈值之上 —— **单靠相似度分不开**。真正的判据是**有没有留下空洞**：
 *   - 正确：seg1、seg2 都被消费
 *   - 错误：seg1 被跳过 ⇒ 时间轴上有 3240ms 无人认领
 * ⇒ 用 **`SEGMENT_GAP_PENALTY` 惩罚「跳过的 segment」**，
 *   而不是惩罚「吞下的 segment」。跳过才是错，吞下不是。
 *
 * 这样两种错误各自被不同的项拦住：
 *   吞并无关文本 → 相似度暴跌
 *   跳过整段音频 → 空洞惩罚
 */
export function alignCuesToSegments(
  cues: Array<{ index: number; text: string }>,
  segments: WhisperSegment[],
): MatchResult {
  const n = cues.length;
  const m = segments.length;
  const cueToSegment = new Array<number>(n).fill(-1);
  // 一条 cue 可能对应多个 segment，记录它的**末段**序号供回溯
  const cueToLastSegment = new Array<number>(n).fill(-1);
  if (n === 0 || m === 0) {
    return { cueToSegment, cueToLastSegment, matchedCues: 0, alignedRatio: 0 };
  }

  /**
   * 一个 segment 最多吞几条 cue / 一条 cue 最多横跨几个 segment。
   * 4 是实测观察到的上限（30s 素材上出现 3 条 cue 共享 1 个 segment），
   * 留一个余量。放大它只会增加搜索空间。
   */
  const MAX_CUES_PER_SEG = 4;
  const MAX_SEGS_PER_CUE = 4;

  /**
   * 跳过 1 个 segment 的惩罚。
   *
   * 取值依据：跳过一段音频意味着**那段时间没有任何 cue 认领**，
   * 会在成片里留下「动效空白」。惩罚要大到足以让 DP 宁可
   * 用一个相似度略低的跨段匹配去覆盖它。
   *
   * 实测：正确跨段方案比「跳过 seg1」方案多覆盖 1 个 segment，
   * 且相似度差 0.655 − 0.379 = 0.276。取 0.5 让覆盖优先 ——
   * 即「宁可用一个中等相似度的匹配盖住音频，也不要留空洞」。
   */
  const SEGMENT_GAP_PENALTY = 0.5;

  // dp[i][j] = 状态 (i,j) 的最优得分。-Infinity = 不可达。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-Infinity));
  const backI: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-1));
  const backJ: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-1));

  dp[0]![0] = 0;

  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const cur = dp[i]![j]!;
      if (cur === -Infinity) continue;

      // ① 跳过 cue i（该 cue 未匹配）
      if (i < n && dp[i + 1]![j]! < cur) {
        dp[i + 1]![j] = cur;
        backI[i + 1]![j] = i;
        backJ[i + 1]![j] = j;
      }

      // ② 跳过 segment j —— **罚分**，因为这会留下动效空白
      if (j < m && dp[i]![j + 1]! < cur - SEGMENT_GAP_PENALTY) {
        dp[i]![j + 1] = cur - SEGMENT_GAP_PENALTY;
        backI[i]![j + 1] = i;
        backJ[i]![j + 1] = j;
      }

      // ③ 块匹配：cue i..i+k-1 ←→ segment j..j+p-1
      const joinedSegCache: string[] = [];
      let joinedSeg = '';
      for (let p = 1; p <= MAX_SEGS_PER_CUE && j + p <= m; p += 1) {
        joinedSeg += segments[j + p - 1]!.text;
        joinedSegCache[p] = joinedSeg;
        if (i === n) continue;
        let joinedCue = '';
        for (let k = 1; k <= MAX_CUES_PER_SEG && i + k <= n; k += 1) {
          joinedCue += cues[i + k - 1]!.text;
          const sim = similarity(joinedCue, joinedSegCache[p]!);
          if (sim < MATCH_MIN_SIMILARITY) continue;
          // 🔴 得分 = **纯相似度**。不加任何长度补偿项 —— 理由见函数头的
          //    「为什么不能加长度补偿项」。吞并无关文本会被相似度自然拦住。
          const score = cur + sim;
          if (score > dp[i + k]![j + p]!) {
            dp[i + k]![j + p] = score;
            backI[i + k]![j + p] = i;
            backJ[i + k]![j + p] = j;
          }
        }
      }
    }
  }

  // 找最优终态（允许末尾有未消费的 cue / segment）
  let best = -Infinity;
  let bestI = 0;
  let bestJ = 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (dp[i]![j]! > best) {
        best = dp[i]![j]!;
        bestI = i;
        bestJ = j;
      }
    }
  }

  // 回溯
  let bi = bestI;
  let bj = bestJ;
  while (!(bi === 0 && bj === 0)) {
    const pi = backI[bi]![bj]!;
    const pj = backJ[bi]![bj]!;
    if (pi < 0) break;
    const consumedCues = bi > pi;
    const consumedSegs = bj > pj;
    if (consumedCues && consumedSegs) {
      for (let t = pi; t < bi; t += 1) {
        cueToSegment[t] = pj;
        cueToLastSegment[t] = bj - 1;
      }
    }
    bi = pi;
    bj = pj;
  }

  const matchedCues = cueToSegment.filter((x) => x >= 0).length;
  return { cueToSegment, matchedCues, alignedRatio: matchedCues / n, cueToLastSegment };
}

/**
 * 把 cue 文本切成「词条」。
 *
 * 用 `Intl.Segmenter`（ICU 内置，确定性）：
 *   - 中文按词切：「给老婆」「整了」「双鞋圈」「显眼包」
 *   - 英文按词切：「Spiridon」「Kukini」
 *   - 但**数字、标点**的处理要额外注意（见下方过滤）
 *
 * 🔴 确定性：同一输入必须永远切出同一结果。`Intl.Segmenter` 满足，
 *    不要换成需要下载词典的分词库（会引入「换机器结果不同」的风险，
 *    而 `words.json` 是烘焙链第 0 号输入 —— M-1 否掉方案 c 的同款理由）。
 *
 * 过滤规则（**只留会出现在口播里的实义单位**）：
 *   - 纯标点 / 纯空白：丢弃（「、」「，」不该占 word 序号）
 *   - 单个字母的英文残片：丢弃（whisper 的切分噪声，SRT 侧不该有）
 */
export function segmentCueText(text: string): string[] {
  const seg = new Intl.Segmenter('zh', { granularity: 'word' });
  const out: string[] = [];
  for (const s of seg.segment(text)) {
    const t = s.segment;
    // 丢纯标点 / 纯空白 / 纯符号
    if (/^[\s\p{P}\p{S}]+$/u.test(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * 合成最终结果：SRT 的文字 + whisper 的时间。
 *
 * ─────────────────────────────────────────────────────────────
 * 时间分配（**不许用 SRT 时间做兜底**）
 * ─────────────────────────────────────────────────────────────
 * M-1 明文：**SRT 的时间戳不参与任何下游判定**（B2-fix）。
 * 所以「未匹配上就退回 SRT 时间」是**错的** —— 那等于偷偷把
 * 已废掉的数据源又引回来，且实测会导致**时间倒退 + cue 重叠 2580ms**。
 *
 * 正确做法是**两级分配**，两级都只用音频时间：
 *
 *   ① segment 层：把 segment 的 [startMs, endMs] 按各 cue 的字数
 *      比例分给共享它的那几条 cue（多对一的情况）
 *   ② cue 层：在分到的时间窗内，按词条字符数加权均摊到每个词
 *
 * 完全没匹配上的 cue（`-1`）怎么办？
 *   → **不产出词条，并计入 `unmatchedCues` 显式上报**。
 *     宁可少几个词让门控拦住（M-1c 的 `alignedRatio` 会掉下来），
 *     也不许编造时间 —— 编造出来的时间是「静默假绿」的温床。
 *
 * 🔴 已知精度上限：cue 内只能均摊（SRT 无字级时间、token 级数据已损坏）。
 *    实测每字均摊约 200ms，30fps 下约 6 帧。对「整体节奏」够用，
 *    **不足以做单字卡拉OK高亮**。
 */
export function composeWords(
  cues: Array<{ index: number; text: string }>,
  segments: WhisperSegment[],
  opts: { maxEndMs?: number } = {},
): { words: SrtToken[]; match: MatchResult; unmatchedCues: number[] } {
  const match = alignCuesToSegments(cues, segments);
  const words: SrtToken[] = [];
  const unmatchedCues: number[] = [];

  /**
   * 🔴 末段外溢的处理：**压缩**而不是**丢弃**。
   *
   * whisper 的末段结束时间会溢出于音频（实测 30s 音频上末段标到 30960ms）。
   * 曾经的写法是在换算成帧之后统一夹到 composition 上限 —— 但那样会把
   * 末段内的**真实词条整条丢掉**（实测丢掉「骨架 是 软 的」4 个词，
   * 而那 4 个词音频里确实说了）。
   *
   * 正确做法是在**毫秒层**就把超出的段压回可用区间：
   *   末段 [28960, 30960] 音频只到 30000 ⇒ 按比例压缩到 [28960, 30000]，
   *   段内 7 个词按字符数重新分配。词一个不少，只是时间更紧。
   *
   * 压缩**仅在最后一段**发生（中间段的外溢会与下一段重叠，那是另一回事，
   * 由 U+FFFD 无关的 DP 排序处理）。
   */
  const maxEndMs = opts.maxEndMs;
  let clampedSegs = 0;
  let firstClampedSegText = '';
  const effSegments = segments.map((s, i) => {
    if (maxEndMs === undefined) return s;
    if (s.endMs <= maxEndMs) return s;
    if (clampedSegs === 0) firstClampedSegText = s.text;
    clampedSegs += 1;
    // 保证至少留 1ms，避免 start === end 产生零时长
    const endMs = Math.max(s.startMs + 1, maxEndMs);
    return { ...s, startMs: s.startMs, endMs };
  });
  if (clampedSegs > 0) {
    // 只在不改变语义的前提下提示；真正的告警在 builtin-align 里出。
    void firstClampedSegText;
  }

  // ① 把匹配结果切成**连续段**：一段 = 一组连续编号、且匹配到连续 segment 区间的 cue。
  //    这样「多对一」和「一对多」都自然落到同一段里，共享同一段时间锚。
  type Run = { cueStart: number; cueEnd: number; segStart: number; segEnd: number; sim: number };
  const runs: Run[] = [];
  let i = 0;
  while (i < cues.length) {
    const s = match.cueToSegment[i]!;
    if (s < 0) {
      i += 1;
      continue;
    }
    const segEnd = match.cueToLastSegment[i]! >= 0 ? match.cueToLastSegment[i]! : s;
    let j = i;
    // 向后吞并：后续 cue 也匹配到「紧接其后」的 segment 区间时，并入同段。
    //   条件：下一条 cue 匹配到同一个首段，或匹配到 segEnd+1 起的新段。
    while (j + 1 < cues.length) {
      const ns = match.cueToSegment[j + 1]!;
      if (ns < 0) break;
      const nEnd = match.cueToLastSegment[j + 1]! >= 0 ? match.cueToLastSegment[j + 1]! : ns;
      if (ns === s) {
        j += 1;
        continue;
      }
      if (ns > segEnd) break;
      j += 1;
    }
    const joinedCue = cues
      .slice(i, j + 1)
      .map((c) => c.text)
      .join('');
    const joinedSeg = segments
      .slice(s, segEnd + 1)
      .map((x) => x.text)
      .join('');
    runs.push({
      cueStart: i,
      cueEnd: j,
      segStart: s,
      segEnd,
      sim: similarity(joinedCue, joinedSeg),
    });
    i = j + 1;
  }

  // ② 逐段把 [segStart, segEnd] 的时间窗分给段内的各条 cue，再分到词条
  for (const run of runs) {
    const spanStart = effSegments[run.segStart]!.startMs;
    const spanEnd = effSegments[run.segEnd]!.endMs;
    const span = Math.max(0, spanEnd - spanStart);

    const cueIdxs: number[] = [];
    for (let k = run.cueStart; k <= run.cueEnd; k += 1) cueIdxs.push(k);

    const weights = cueIdxs.map((ci) => Math.max(1, contentChars(cues[ci]!.text).length));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const partsPerCue = cueIdxs.map((ci) => segmentCueText(cues[ci]!.text));

    let cursorMs = spanStart;
    cueIdxs.forEach((ci, k) => {
      const w = weights[k]!;
      const isLast = k === cueIdxs.length - 1;
      const cueStart = cursorMs;
      const cueEnd = isLast ? spanEnd : Math.round(cursorMs + (span * w) / totalW);
      cursorMs = cueEnd;

      const parts = partsPerCue[k]!;
      if (parts.length === 0) return;

      const pW = parts.map((p) => Math.max(1, contentChars(p).length || p.length));
      const pTotal = pW.reduce((a, b) => a + b, 0);
      const cueSpan = Math.max(0, cueEnd - cueStart);

      let c = cueStart;
      parts.forEach((p, q) => {
        const isLastPart = q === parts.length - 1;
        const e = isLastPart ? cueEnd : Math.round(c + (cueSpan * pW[q]!) / pTotal);
        words.push({
          index: words.length,
          text: p,
          cueIndex: cues[ci]!.index,
          indexInCue: q,
          cueLength: parts.length,
          startMs: Math.round(c),
          endMs: Math.round(e),
          confidence: run.sim,
        });
        c = e;
      });
    });
  }

  // ③ 未匹配的 cue 显式记录，不编造时间
  match.cueToSegment.forEach((segIdx, ci) => {
    if (segIdx < 0) unmatchedCues.push(cues[ci]!.index);
  });

  // ④ 按时间排序（分摊后可能出现等值，等值不算倒退）
  words.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  // ⑤ 重新编号：`word:N` 锚点依赖连续序号
  words.forEach((w, k) => {
    w.index = k;
  });

  return { words, match, unmatchedCues };
}
