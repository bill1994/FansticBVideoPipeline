/**
 * 词时铺排 —— 「词落在什么时刻」的**唯一实现**（Q4 / M-1f）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么有这个文件
 *
 * 渲染层（`remotion/caption.ts`）原先有一份「按字数权重重铺词」的实现，
 * 用于高亮定位。M-1f 要把同一件事做进**产物层**（`01-align/words.json`），
 * 于是出现了「同一个算法两处实现」的风险 —— 而这已是本项目第四次栽在
 * 同一类问题上（split-frame 坐标系 / `clampScale` 常量 / 校验项顺序耦合 /
 * `highlightWords` 与产物层）。
 *
 * 两处实现一旦分叉，后果不是「代码难看」，而是**报告对成片说谎**：
 * 校验说高亮在第 5 帧，成片却亮在第 800 帧，且没有任何测试会红。
 * ⇒ 本文件是真源，两侧都从这里取（先例：`core/carrier-window.ts`）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么可以重铺（依据）
 *
 * whisper 会把跨静音的文本压进一个长分段，导致词的时间整体偏移
 * （实测 kukini：某 cue 的 9 个词被放进 6.74 秒真静音里，早 7.06 秒）。
 * 调 `-ml` / `-sow` 都改不动 —— 是**模型的时间判断错了**。
 *
 * 但三件事仍然可信：
 *   1. 词的**相对顺序**（实测归属 100% 正确）
 *   2. 词的**归属**（属于哪条cue）
 *   3. 这条 cue **什么时候被说**（SRT 窗口，实测与音频静音差 0.35s）
 *
 * ⇒ 用「顺序 + 字数权重」把词铺回该窗口，得到「当前念到哪个字」的最佳估计。
 */

import type { Cue, WordTimestamp } from './types.ts';

/** 覆盖率阈值：≥ 此值视为词时可信，不重铺（好数据不要被"修"坏）。 */
export const REWEIGH_COVERAGE_MIN = 0.8;

/** 帧比较容差：whisper 的帧与 SRT 换算的帧允许 1–2 帧抖动。 */
const FRAME_TOLERANCE = 2;

/**
 * 取属于某条 cue 的词（按其词落点区间归属，顺序即朗读顺序）。
 *
 * ⚠️ 归属靠**词落点**判定 —— 而词落点正是会漂的那个东西。
 * 实测漂移幅度（-7.06s）远大于 cue 间隔，所以「按落点归属」在漂移案例里
 * 会把词归错cue。这也是为什么 `M-1f` 的重铺必须**先保证归属正确**：
 * 归属对了，才谈得上按窗口铺时间。
 */
export function cueWords(cue: Cue, words: WordTimestamp[]): WordTimestamp[] {
  return words.filter(
    (w) => w.startFrame >= cue.fromFrame - 1 && w.startFrame <= cue.toFrame + 1,
  );
}

/** 秒 → 帧（四舍五入）。空值时退回 cue 的帧区间换算。 */
function windowFrames(cue: Cue, fps: number): { a: number; b: number } {
  const fromSec = typeof cue.srtFromSec === 'number' ? cue.srtFromSec : cue.fromFrame / fps;
  const toSec = typeof cue.srtToSec === 'number' ? cue.srtToSec : cue.toFrame / fps;
  return { a: Math.round(fromSec * fps), b: Math.round(toSec * fps) };
}

/**
 * 词落点落在本 cue 的 SRT 窗口内的比例（0–1）。
 *
 * 🔴 **口径**（引用时必须连函数名一起写）：分母是 `cueWords(cue).length`
 * ——即「**归属于本cue 的词数**」，不是「窗口内的词数」；分子带 ±2 帧容差。
 * kukini 实测 14/48 低于阈值 —— 早期文档记的「8 条」是按另一口径数的。
 */
export function wordCoverage(cue: Cue, words: WordTimestamp[], fps: number): number {
  if (typeof cue.srtFromSec !== 'number' || typeof cue.srtToSec !== 'number') return 1;
  const own = cueWords(cue, words);
  if (own.length === 0) return 0;
  const { a, b } = windowFrames(cue, fps);
  const inside = own.filter(
    (w) => w.startFrame >= a - FRAME_TOLERANCE && w.startFrame <= b + FRAME_TOLERANCE,
  ).length;
  return inside / own.length;
}

/** 按字数加权的铺词 —— 真正的重排算法，两侧共用的唯一实现。 */
export function reweighByCharWeight(
  own: WordTimestamp[],
  a: number,
  b: number,
): WordTimestamp[] {
  const span = Math.max(1, b - a);
  const weights = own.map((w) => Math.max(1, w.word.length));
  const total = weights.reduce((x, y) => x + y, 0);
  let cursor = a;
  return own.map((w, i) => {
    const last = i === own.length - 1;
    //🔴 末词的**最后一帧必须正好是 b**。
    //   原实现（`remotion/caption.ts` 内联版）对末词也套 `endFrame = start + len - 1`，
    //   而 `len = b - cursor` ⇒ 末帧落在 `b - 1`，**窗口尾部恒缺 1 帧**。
    //   该偏差从未被断言（项目第 6 次「写断言前先拿真值」的反面：没写断言就没人发现）。
    const endFrame = last ? b : cursor + Math.max(1, Math.round((weights[i]! / total) * span)) - 1;
    const startFrame = cursor;
    cursor = endFrame + 1;
    return { ...w, startFrame, endFrame };
  });
}

/**
 * 取得这条 cue 该用的词序列：覆盖率达标用原词，否则按窗口重铺。
 *
 * @param apply 是否真的返回重铺后的词。`false` = 只判断（用于「要不要修」的自检）。
 *
 * 🔴 **只影响词的落点，不改词的文本与顺序**。降级语义：词对不上原文时，
 * 上层应整句不高亮而非显示错句子（见 `remotion/caption.ts` 的 `highlightSpan`）。
 */
export function wordsForCue(
  cue: Cue | null,
  words: WordTimestamp[],
  fps: number,
  apply = true,
): WordTimestamp[] {
  if (!cue) return words;
  const own = cueWords(cue, words);
  if (own.length === 0) return words;
  if (wordCoverage(cue, words, fps) >= REWEIGH_COVERAGE_MIN) return own;
  if (!apply) return own;
  const { a, b } = windowFrames(cue, fps);
  return reweighByCharWeight(own, a, b);
}

/**
 * 词落在静音段内的时长占比 0–1 —— `M-1d` 的门控判据。
 *
 * 🔴 **为什么这条判据必须用音频、不能用 SRT**：静音来自 `ffmpeg silencedetect`，
 * 是**独立于 SRT 的客观证据**。若改用 SRT 自己当基准，等于让被检查者给自己作证。
 * 正常素材应 ≈0；kukini 修复前 ≈5.9%。
 */
export function silentWordRatio(
  words: WordTimestamp[],
  silences: [number, number][],
  fps: number,
): number {
  if (words.length === 0 || silences.length === 0) return 0;
  let total = 0;
  let inSilence = 0;
  for (const w of words) {
    const s = w.startFrame / fps;
    const e = w.endFrame / fps;
    const d = Math.max(0, e - s);
    total += d;
    if (silences.some(([a, b]) => e > a && s < b)) inSilence += d;
  }
  return total > 0 ? inSilence / total : 0;
}

/**
 * SRT 窗口与音频静音边界的一致性校验 —— `M-1f` 的 Q2。
 *
 * 🔴 **目的已被2026-10-19 更正**：不是「防范 SRT 不可信」
 * （「不信任 SRT 时间戳」那条铁律已撤回，见登记册 B2-fix），而是
 * **捕获用户手编 SRT 时划错**—— 划歪了该报warning，而不是静默产出错高亮。
 *
 * 判据取自**音频**（silencedetect），不是 SRT 自证。
 *
 * @returns 不吻合的描述；吻合返回 null。
 */
export function checkSrtAudioAgreement(
  cues: Cue[],
  silences: [number, number][],
): string | null {
  if (silences.length === 0) return null;
  // 只检查「足够长」的静音 —— 句中换气（实测 0.53s/0.57s）是正常现象，
  // 拿它当错位证据会满屏警告。
  const long = silences.filter(([a, b]) => b - a >= 1.0);
  if (long.length === 0) return null;
  const bad: string[] = [];
  for (const c of cues) {
    if (typeof c.srtFromSec !== 'number' || typeof c.srtToSec !== 'number') continue;
    for (const [a, b] of long) {
      const ov = Math.min(c.srtToSec, b) - Math.max(c.srtFromSec, a);
      if (ov > 0.5) {
        bad.push(
          `cue#${c.index} [${c.srtFromSec}-${c.srtToSec}] 与 ${a.toFixed(2)}-${b.toFixed(2)}s 静音重叠 ${ov.toFixed(2)}s`,
        );
      }
    }
  }
  return bad.length > 0 ? bad.join('；') : null;
}