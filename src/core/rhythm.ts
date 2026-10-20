/**
 * 节奏表 —— 判断每条 cue 要不要配 motion、配什么（P1，2026-10-20）。
 *
 * ─────────────────────────────────────────────────────────────
 * 设计意图（先读这段，否则容易把它做成「预算系统」）
 * ─────────────────────────────────────────────────────────────
 * 本项目的模型是：**motion 是「这句话」的伴生图形** ——
 * 这句话多长它就多长，从句首开始。
 *
 * 所以这里**刻意不做**三件事：
 *   · 不找「两句话之间的间隙」—— 没有间隙概念，motion 就贴着 cue 走；
 *   · 不算语速 / 字数配速 —— 不需要，时长直接取 cue 区间；
 *   · 不做全局预算 / 配额 —— 节奏表只回答「这条配不配、配哪个」。
 *
 * 唯一的结构性门槛是 `RHYTHM.minCueFramesForMotion`（PLACEHOLDER）：
 * 太短的 cue 上塞 motion 必然读不完，直接记 `skipped: 'too-short'`。
 *
 * ─────────────────────────────────────────────────────────────
 * 纯函数纪律
 * ─────────────────────────────────────────────────────────────
 * 本文件**禁读时钟、禁随机数、禁磁盘**。同一份 SRT 必须产出逐字节一致的
 * `pacing.json` —— 否则「同一素材重跑出两份不同节奏表」就再也无法对账。
 */

import { RHYTHM } from './config.ts';
import {
  builtinTemplateLookup,
  CAUSE_EFFECT_WORDS,
  CLOSING_WORDS,
  CONTRAST_WORDS,
  decideMotion,
  DEFINITION_WORDS,
  ENUM_WORDS,
  parseCnNumber,
  QUESTION_PATTERNS,
  TURN_WORDS,
  type TemplateLookup,
} from './rhythm-rules.ts';
import type { Cue, RhythmCue, RhythmSignal, RhythmTable } from './types.ts';

/** 节奏表契约版本（`meta.version`）。 */
export const RHYTHM_TABLE_VERSION = '1.0';

// 信号词表定义在 `rhythm-rules.ts`（那里同时供「按信号定位文案」使用）——
// 单一真源，避免判定与提取各有一份词表。

/** 疑问句尾：全角/半角问号，或语气词「吗 / 呢」收尾。 */
const QUESTION_TAIL_RE = /[？?吗呢]\s*$/;
/** 阿拉伯数字串。 */
const ARABIC_NUMBER_RE = /\d+(?:\.\d+)?/;

/** 判据里「字数」的口径：只数汉字 / 字母 / 数字，标点与空白不计。 */
const COUNTED_CHAR_RE = /[\p{Script=Han}A-Za-z0-9]/u;
const HAN_CHAR_RE = /\p{Script=Han}/u;

/**
 * 统计「字数」。
 *
 * 🔴 为什么不用 `text.length`：SRT 文本里标点、空格、英文引号都会让长度虚高，
 *    而 `short-after-long` 判的是「这句话说得比上一句短一半」，
 *    标点抖动不该改变判定。口径固定在这里，其它文件不得另写一份。
 */
export function countChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (COUNTED_CHAR_RE.test(ch)) n += 1;
  }
  return n;
}

/** 是否包含任一给定词。 */
function containsAny(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w));
}

/**
 * 取一句话里的候选「词」—— 用于全片复现统计（`repetition` 信号）。
 *
 * ⚠️ **这是规则化近似，不是分词器**：中文没有空格，项目也不引第三方分词依赖。
 *    这里用「相邻两汉字组成的二字词」作为候选，并在**同一句内去重**。
 *    结论只用于「某词在全片 ≥3 条 cue 里出现」这种粗粒度判断，
 *    误判的代价是偶尔多出一条 tag-float，不会被当成文本真源使用。
 */
export function cueTerms(text: string): string[] {
  const han = [...text].filter((ch) => HAN_CHAR_RE.test(ch));
  const seen = new Set<string>();
  for (let i = 0; i + 1 < han.length; i += 1) {
    seen.add(`${han[i]}${han[i + 1]}`);
  }
  return [...seen].sort();
}

/**
 * 全片词频统计 → 每条 cue 命中的「复现词」。
 *
 * 两遍扫描：先数「某二字词出现在多少条 cue 里」，再回填给每条 cue。
 * 返回数组与 `cues` 一一对应；顺序稳定（按词排序），保证 `signal` 可复现。
 *
 * @param minCues 至少在多少条 cue 中出现才算复现（默认 3，见规格）
 */
export function buildRepeatedTerms(cues: readonly Cue[], minCues = 3): string[][] {
  const docCount = new Map<string, number>();
  const perCue = cues.map((cue) => cueTerms(cue.text));

  for (const terms of perCue) {
    for (const t of terms) {
      docCount.set(t, (docCount.get(t) ?? 0) + 1);
    }
  }

  return perCue.map((terms) => terms.filter((t) => (docCount.get(t) ?? 0) >= minCues));
}

/** `detectSignals` 的附加上下文（不传时退化为「非末条、无复现词」）。 */
export interface SignalContext {
  /** 是否为全片最后一条 cue —— `closing` 的判据之一。 */
  isLast?: boolean;
  /** 本条 cue 命中的全片复现词（由 `buildRepeatedTerms` 产出）。 */
  repeatedTerms?: readonly string[];
}

/**
 * 检测一条 cue 的走势信号。
 *
 * 判据**全部**是词表 / 正则 / 字数比较（规格 P1 第三节），不调模型。
 * 返回顺序固定（与规格表格同序），便于测试与人工对账。
 *
 * @param cue 当前 cue
 * @param prevCue 上一条 cue（首条传 `null`）；只用于 `short-after-long`
 * @param ctx 附加上下文（末条标记、全片复现词）
 */
export function detectSignals(
  cue: Cue,
  prevCue: Cue | null,
  ctx: SignalContext = {},
): RhythmSignal[] {
  const text = cue.text ?? '';
  const signals: RhythmSignal[] = [];

  if (containsAny(text, TURN_WORDS)) signals.push('turn');
  if (containsAny(text, CONTRAST_WORDS)) signals.push('contrast');
  if (containsAny(text, ENUM_WORDS)) signals.push('enum');
  if (QUESTION_TAIL_RE.test(text) || containsAny(text, QUESTION_PATTERNS)) {
    signals.push('question');
  }
  // number：阿拉伯数字，或可解析的中文数量词（三倍 / 百分之三十 / 两万）。
  // 中文侧复用 `parseCnNumber`，避免「信号命中却填不出 value」的口径分裂。
  if (ARABIC_NUMBER_RE.test(text) || parseCnNumber(text) !== null) signals.push('number');

  if (prevCue !== null) {
    const prevCount = countChars(prevCue.text ?? '');
    const curCount = countChars(text);
    if (prevCount >= 12 && curCount <= prevCount * 0.5) signals.push('short-after-long');
  }

  if (ctx.isLast === true || containsAny(text, CLOSING_WORDS)) signals.push('closing');
  if (containsAny(text, DEFINITION_WORDS)) signals.push('definition');
  if (containsAny(text, CAUSE_EFFECT_WORDS)) signals.push('cause-effect');
  if ((ctx.repeatedTerms ?? []).length > 0) signals.push('repetition');

  return signals;
}

/** 内置模板查询表 —— `buildRhythmTable` 的默认 registry。 */
export { builtinTemplateLookup };

/**
 * 构建节奏表。
 *
 * 一条 cue 一个判断：
 *   1. `durationInFrames < RHYTHM.minCueFramesForMotion` → `skipped: 'too-short'`
 *   2. 否则检测信号 → `decideMotion()` 决定模板与参数
 *      （模板不满足自身 `minVisibleInFrames` 时由 `decideMotion` 降级 / 记 `no-template-fits`）
 *
 * 🔴 `fromFrame` / `durationInFrames` 只是 **cue 区间快照**，禁止二次推导 ——
 *    真源是 `01-align/words.json` 的 `cues[]`。
 *
 * @param cues 01-align 产出的 cue 列表
 * @param fps 帧率（写入 meta）
 * @param mode 对齐模式（无字幕模式没有 cue，本函数只会产出空表）
 * @param registry 模板查询表；默认内置模板库
 */
export function buildRhythmTable(
  cues: readonly Cue[],
  fps: number,
  mode: RhythmTable['meta']['mode'],
  registry: TemplateLookup = builtinTemplateLookup(),
): RhythmTable {
  const repeated = buildRepeatedTerms(cues);
  const minFrames = RHYTHM.minCueFramesForMotion;

  const rows: RhythmCue[] = cues.map((cue, i) => {
    const durationInFrames = cue.toFrame - cue.fromFrame;
    const base = {
      cueIndex: cue.index,
      fromFrame: cue.fromFrame,
      durationInFrames,
    };

    if (durationInFrames < minFrames) {
      return {
        ...base,
        decide: 'none',
        reason: `cue 时长 ${durationInFrames} 帧 < 门槛 ${minFrames} 帧，不做 motion`,
        signal: [],
        skipped: 'too-short',
      };
    }

    const signals = detectSignals(cue, i > 0 ? (cues[i - 1] as Cue) : null, {
      isLast: i === cues.length - 1,
      repeatedTerms: repeated[i] ?? [],
    });
    const decision = decideMotion(
      { cueIndex: cue.index, text: cue.text ?? '', durationInFrames },
      signals,
      registry,
    );

    const row: RhythmCue = {
      ...base,
      decide: decision.decide,
      reason: decision.reason,
      signal: signals,
    };
    if (decision.motion !== undefined) row.motion = decision.motion;
    if (decision.skipped !== undefined) row.skipped = decision.skipped;
    return row;
  });

  return {
    meta: { fps, mode, version: RHYTHM_TABLE_VERSION },
    cues: rows,
  };
}
