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
}

/** 空通道 —— `words.json` 缺失时的降级形态。 */
export const EMPTY_CAPTION: CaptionData = { words: [], cues: [] };

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
  const o = raw as { words?: unknown; cues?: unknown };
  const words = Array.isArray(o.words) ? o.words.filter(isWord) : [];
  const cues = Array.isArray(o.cues) ? o.cues.filter(isCue) : [];
  return { words, cues };
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