/**
 * 字幕数据通道 —— `caption/karaoke-word` 的唯一文本来源。
 *
 * ── 为什么需要这一层 ───────────────────────────────────────────
 * `builtin.ts` 里 `caption/karaoke-word` **刻意不声明 `text` 参数**
 * （理由：字幕文本来自 SRT，不是模型自由填写；模型若也能写 text，
 * 就会出现「字幕与语音对不上」，而时序校验只看帧区间、拦不住）。
 *
 * 🔴 **但渲染期原本没有任何地方读 `01-align/words.json`** ——
 *    声明层刻意不给 text，实现层却没有替代来源，`MotionItem.tsx:35`
 *    只能去读 `item.params.text`（一个校验项 #16 会拦掉的键）。
 *    也就是说：**字幕模板此前在数据层面根本无法实现**，不是"没写"。
 *
 * 本模块把 `words.json` 的词级时间戳读进渲染 props，并提供
 * 「给定帧 → 该帧应显示哪些词、哪个词该高亮」的纯函数。
 *
 * ── 为什么是纯函数 ─────────────────────────────────────────────
 * 与校验器同构：字幕选取规则不读时钟、不读随机数，
 * 同一 (words, frame) 必得同一结果 —— 服务端渲染与客户端预览必须一致，
 * 否则 Studio 里看到的和渲出来的不一样。
 *
 * 确定性红线（E2）：本文件禁 `Date.now()` / `Math.random()`。
 */

import type { AlignWords, Cue, WordTimestamp } from '../core/types.ts';

/** 渲染 props 里携带的字幕数据。 */
export interface CaptionData {
  words: WordTimestamp[];
  cues: Cue[];
  /**
   * from 01-align 的 fps。`srtFromSec` 是秒，要换算成帧才能和 item 的
   * 绝对帧区间比较（C2-6 补正后 cue 的显示时序以 SRT 为准）。
   * 缺省 30（与 demo 一致），缺了也不致命 —— 只影响能否按 cue 定位。
   */
  fps: number;
}

/** 空通道 —— `words.json` 缺失时的降级形态。 */
export const EMPTY_CAPTION: CaptionData = { words: [], cues: [], fps: 30 };

/**
 * 归一化 `words.json`。
 *
 * ⚠️ 【实现期拟定，文档未点名】`01-align` 的文件名由 `config.STAGES` 定目录，
 *    但「目录下有哪些数据」文档只说「16kHz wav + 词级时间戳 JSON」，
 *    具体文件名见 `src/stages/align.ts`。此处只认结构不认来源。
 *
 * 容错策略：**结构不符就退化成空通道，不抛错**。
 * 理由：字幕数据缺失应当让 `karaoke-word` 少显示几个字，
 * 而不该让整条渲染管线崩掉 —— 后者把「一个模板的数据问题」
 * 升级成「成片渲不出来」，代价完全不成比例。
 */
export function toCaptionData(raw: unknown): CaptionData {
  if (!raw || typeof raw !== 'object') return EMPTY_CAPTION;
  const o = raw as { words?: unknown; cues?: unknown; fps?: unknown };
  const words = Array.isArray(o.words) ? o.words.filter(isWord) : [];
  const cues = Array.isArray(o.cues) ? o.cues.filter(isCue) : [];
  const fps = typeof o.fps === 'number' && Number.isFinite(o.fps) && o.fps > 0 ? o.fps : 30;
  return { words, cues, fps };
}

function isWord(v: unknown): v is WordTimestamp {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w.word === 'string' &&
    typeof w.startFrame === 'number' &&
    typeof w.endFrame === 'number' &&
    Number.isFinite(w.startFrame) &&
    Number.isFinite(w.endFrame)
  );
}

function isCue(v: unknown): v is Cue {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.text === 'string' &&
    typeof c.fromFrame === 'number' &&
    typeof c.toFrame === 'number' &&
    Number.isFinite(c.fromFrame) &&
    Number.isFinite(c.toFrame)
  );
}

/**
 * 取与 `[fromFrame, fromFrame+durationInFrames)` 相交的词序列。
 *
 * 交集判定用**闭区间重叠**而非「词完全落在窗口内」——
 * 一个字幕 item 的窗口边界通常切在词中间，若要求完整包含，
 * 边缘的词会被丢掉，字幕出现「缺字」。
 *
 * 🔴 窗口是 item 在 storyboard 中的**绝对帧区间**，而 `words` 也是绝对帧，
 *    两者同坐标系，不做转换。
 */
export function wordsInWindow(data: CaptionData, fromFrame: number, durationInFrames: number): WordTimestamp[] {
  const end = fromFrame + durationInFrames;
  // 🔴 右端用**严格大于**（2026-10-18 第二轮真渲修正）：
  //   对齐产物里相邻 cue 的分界满足 `cues[i].toFrame === cues[i+1].fromFrame`，
  //   而词是连续铺满的 ⇒ 上一句的**末词 endFrame 恰好等于**本句的 fromFrame。
  //   用 `>=` 会把这个末词也算进本句，成片里每条字幕头部都多一个上一句的字
  //   （实测露出「的是 Spiridon Cage 的中底配置」，那个「的是」属于上一句）。
  //   改成 `>` 只排除「恰好在边界上收尾」的词，仍保留「跨越边界的词」（避免缺字）。
  return data.words.filter((w) => w.startFrame < end && w.endFrame > fromFrame);
}

/**
 * 当前帧应高亮的词的序号（相对返回数组的下标），无则 -1。
 *
 * 判定用「词区间含当前帧」。**先到先得**：多个词区间重叠时取第一个，
 * 因为 `text-align.ts` 已保证正常素材下词不重叠，重叠只可能来自
 * 数据异常 —— 此时取第一个比取最后一个更符合「读到哪个字」直觉。
 */
export function activeWordIndex(words: WordTimestamp[], frame: number): number {
  // ⚠️ 必须先取局部变量再取属性：开noUncheckedIndexedAccess 后
  //    `words[i]` 的类型是 `WordTimestamp | undefined`。
  //    这里不用 `continue` 提前跳过的写法（空隙分支要拿最后一个已过词）。
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w && frame >= w.startFrame && frame <= w.endFrame) return i;
  }
  // 落在所有词之间（词间空隙）时：高亮它前面最近的词。
  // 不这么做的后果是每个词之间会闪一下全暗，字幕看起来在抽搐。
  let nearest = -1;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w && w.endFrame < frame) nearest = i;
  }
  return nearest;
}

/**
 * 取与窗口相交且当前帧尚未开始的 cue —— 用于「下一条字幕预告」。
 *
 * 用途：`kinetic-line` 这类强调模板常挂在下一个关键词上，
 * 提前一帧进入能让强调与字幕读点对上。
 */
export function nextCueAt(data: CaptionData, frame: number): Cue | null {
  for (const c of data.cues) {
    if (c.fromFrame > frame) return c;
  }
  return null;
}
/**
 * 取与 `[fromFrame, fromFrame+durationInFrames)` 相交的那条 **cue**（C2-6 补正）。
 *
 * 🔴 为什么需要它：字幕的**文字**必须来自用户编辑过的 SRT 那一行，而不是
 *   「窗口内恰好落进了哪些词」。词落点会漂（实测某条 cue 早 7.06 秒），
 *   若用词拼文字，时间一对齐就必然拼出**别的句子**。
 *   ⇒ 文字以 `cue.text` 为准，词只负责「哪个字在亮」。
 *
 * 时序以 `srtFromSec/srtToSec` 为准（用户编辑过的那份）；缺这两个字段时
 * 回退到词落点推出的 `fromFrame/toFrame`（demo / 外部对齐器兼容）。
 */
export function cueInWindow(
  data: CaptionData,
  fromFrame: number,
  durationInFrames: number,
): Cue | null {
  const end = fromFrame + durationInFrames;
  for (const c of data.cues) {
    const hasSrt = typeof c.srtFromSec === 'number' && typeof c.srtToSec === 'number';
    const a = hasSrt ? Math.round((c.srtFromSec as number) * data.fps) : c.fromFrame;
    const b = hasSrt ? Math.round((c.srtToSec as number) * data.fps) : c.toFrame;
    if (a < end && b > fromFrame) return c;
  }
  return null;
}

/**
 * 在 cue 原文里定位「当前高亮词」的字符区间 `[start, end)`。
 *
 * 逐词在原文里**顺序**查找（不是全文 indexOf），因此同样的字重复出现也不会错位；
 * 找不到（词与原文对不上，通常是对齐漂移）⇒ 返回 `null`，调用方退化为「整句不高亮」。
 * 宁可不高亮，也不能把高亮打在别的字上 —— 那会让观众以为念错了。
 */
export function highlightSpan(
  cueText: string,
  words: WordTimestamp[],
  activeIndex: number,
): { start: number; end: number } | null {
  if (activeIndex < 0 || activeIndex >= words.length) return null;
  let cursor = 0;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    const at = cueText.indexOf(w.word, cursor);
    if (at < 0) return null;
    if (i === activeIndex) return { start: at, end: at + w.word.length };
    cursor = at + w.word.length;
  }
  return null;
}

/**
 * 取属于某条 cue 的词（按其**词落点区间**归属，顺序即朗读顺序）。
 *
 * 词落点会漂，但**相对顺序与归属是可信的** —— 这是下面重分配的前提。
 */
export function cueWords(cue: Cue, words: WordTimestamp[]): WordTimestamp[] {
  return words.filter((w) => w.startFrame >= cue.fromFrame - 1 && w.startFrame <= cue.toFrame + 1);
}

/** 词在 SRT 窗口内的覆盖率（0–1）。用于判断这 cue 的词是否可信。 */
export function wordCoverage(cue: Cue, words: WordTimestamp[], fps: number): number {
  if (typeof cue.srtFromSec !== 'number' || typeof cue.srtToSec !== 'number') return 1;
  const own = cueWords(cue, words);
  if (own.length === 0) return 0;
  const a = Math.round(cue.srtFromSec * fps);
  const b = Math.round(cue.srtToSec * fps);
  const inside = own.filter((w) => w.startFrame >= a - 2 && w.startFrame <= b + 2).length;
  return inside / own.length;
}

/**
 * 高亮用的词序列：**词落点与 SRT 窗口严重不符时，按字数权重把词重新铺在这条 cue 的窗口里**。
 *
 * 🔴 为什么可以这么做（以及为什么只在显示层做）：
 *   whisper 会把跨静音的文本压进一个长分段，导致词的时间整体偏移（实测某 cue 早 7.06 秒，
 *   9 个词被放进 6.74 秒的真静音里）。调 `-ml`/`-sow` 都改不动 —— 是模型的时间判断错了。
 *   但词的**顺序**是对的、**归属**是对的，而这条 cue「什么时候被说」（SRT 窗口）也是对的。
 *   ⇒ 用「顺序 + 字数权重」重铺时间，得到的是**当前念到哪个字**的最佳估计。
 *
 *   ⚠️ 只改**渲染时的高亮定位**，绝不回写 `01-align`（产物仍是原始测量值）。
 *   覆盖率 ≥ 0.8 时**不动**（好数据不要被"修"坏）。
 */
export function highlightWords(
  cue: Cue | null,
  words: WordTimestamp[],
  fps: number,
): WordTimestamp[] {
  if (!cue) return words;
  const own = cueWords(cue, words);
  if (own.length === 0) return words;
  if (wordCoverage(cue, words, fps) >= 0.8) return own;

  const a = Math.round((cue.srtFromSec ?? cue.fromFrame / fps) * fps);
  const b = Math.round((cue.srtToSec ?? cue.toFrame / fps) * fps);
  const span = Math.max(1, b - a);
  const weights = own.map((w) => Math.max(1, w.word.length));
  const total = weights.reduce((x, y) => x + y, 0);
  let cursor = a;
  return own.map((w, i) => {
    const len = i === own.length - 1 ? b - cursor : Math.max(1, Math.round((weights[i]! / total) * span));
    const startFrame = cursor;
    cursor += len;
    return { ...w, startFrame, endFrame: startFrame + len - 1 };
  });
}
