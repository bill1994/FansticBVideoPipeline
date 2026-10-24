/**
 * 节奏规则 —— 把走势信号翻译成「配不配 motion、配哪个模板」（P1，2026-10-20）。
 *
 * ─────────────────────────────────────────────────────────────
 * 两条硬规则（决定了这个文件为什么长这样）
 * ─────────────────────────────────────────────────────────────
 * ① **强度规则**：`definition` / `number` / `closing` 单信号即可；
 *    其余信号必须 **≥2 个同时命中** 才出 motion，否则记「信号强度不足」。
 *    目的是避免「满屏都在动」—— 单靠一个「不」字就弹出一行大字，
 *    成片会像卡拉 OK 特效包，而不是讲解视频。
 *
 * ② **模板门控**：选定模板后必须检查 `cue.durationInFrames >= 模板.minVisibleInFrames`。
 *    不满足就**沿选型表向下降级**；全部不满足 → 不做 motion（`skipped: 'no-template-fits'`）。
 *    门槛值来自 `src/templates/builtin.ts`，本文件不另写一份数字。
 *
 * ─────────────────────────────────────────────────────────────
 * 纯函数纪律
 * ─────────────────────────────────────────────────────────────
 * 禁读时钟、禁随机数、禁磁盘。所有选择都由「文本 + 帧数 + 模板声明」决定。
 */

import { ConfigError } from './exit-code.ts';
import { OCCLUSION_BUDGET } from './config.ts';
import {
  carrierDisplayRect,
  CARRIER_RATIO_DEFAULT,
  CARRIER_RATIO_MIN,
  CARRIER_SIDE_DEFAULT,
  type CarrierSide,
} from './carrier-window.ts';
import { listTemplates } from '../templates/registry.ts';
import { isOverlayScope } from '../templates/types.ts';
import type { TemplateDeclaration } from '../templates/types.ts';
import type {
  CarrierRef,
  Cue,
  Footprint,
  MotionBoard,
  MotionBoardItem,
  PerceiveRegion,
  RhythmSignal,
  RhythmTable,
} from './types.ts';

/** 模板查询表 —— 只读 `get`，便于测试注入。 */
export interface TemplateLookup {
  get(motion: string): TemplateDeclaration | undefined;
}

/** 内置模板查询表 —— 生产路径的唯一默认 registry（测试可注入替身）。 */
export function builtinTemplateLookup(): TemplateLookup {
  const map = new Map(listTemplates().map((t) => [t.id, t] as const));
  return {
    get: (motion: string) => map.get(motion),
  };
}

/** `decideMotion` 的输入：只吃 cue 的文本与时长快照。 */
export interface PacingInput {
  cueIndex: number;
  text: string;
  /** cue 区间快照（`toFrame - fromFrame`），禁止二次推导。 */
  durationInFrames: number;
}

/** `decideMotion` 的结论。`params` 为规格之外的**实现期扩展**（见文件末注释）。 */
export interface MotionDecision {
  decide: 'motion' | 'none';
  /** 仅 `decide === 'motion'` 时存在。 */
  motion?: string;
  /** 规则化提取出的模板参数（`decide === 'motion'` 时非空）。 */
  params?: Record<string, unknown>;
  reason: string;
  skipped?: 'too-short' | 'no-template-fits';
}

/** 单信号即可出 motion 的「强信号」。 */
const STRONG_SIGNALS: readonly RhythmSignal[] = ['definition', 'number', 'closing'];

/**
 * M-3 后 `RhythmCue.signal` 可能含语义路径的自由文本（`(RhythmSignal | string)[]`）。
 * 规则路径的消费者（params 预填 / intent 提取）只认词表值 —— 在调用点收窄，
 * 非词表值静默剔除：语义判据本来就不是给机械提取用的。
 */
const isRuleSignal = (x: RhythmSignal | string): x is RhythmSignal =>
  STRONG_SIGNALS.includes(x as RhythmSignal) ||
  ['turn', 'contrast', 'enum', 'question', 'number', 'short-after-long', 'repetition', 'cause-effect'].includes(x as RhythmSignal);

/**
 * 文案长度上限（中文字符数）。
 *
 * 🔴 14 的依据：项目记录的真实溢出阈值是 **13–14 个中文字**
 *    （`stat-card` 的 footprint 更窄，先撞线），且 `fitScaleFor` 有 **0.7 下限**兜底 ——
 *    即最坏情况只缩到 70% 字号，不会无限缩小。
 *    12 太保守：实测「关键节点必须停下来让人确认」= **13 字**，
 *    按 12 会被切掉首字「关」。14 能完整保留这句。
 */
const MAX_EXCERPT_CHARS = 14;

/** 阿拉伯数字串（`stat-card.value` 的唯一来源）。 */
const ARABIC_NUMBER_RE = /\d+(?:\.\d+)?/;
/** 数字后紧跟的单位（可选）。 */
const UNIT_AFTER_NUMBER_RE = /^\s*(万|亿|%|倍|元)/;

/** 中文数字字符 → 数值。`两` 与 `二` 同值；`〇` 是口语写法。 */
const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
/** 中文小单位。 */
const CN_SMALL_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
/** 中文数字连写串。 */
const CN_RUN_RE = /[零〇一二三四五六七八九十百千万亿两]+/g;
/** 「百分之三十」形式。 */
const CN_PERCENT_RE = /百分之([零〇一二三四五六七八九十百千万亿两]+)/;
/**
 * 量词 / 单位标记 —— 数字后面跟着它们才算「数量」，否则视为普通用字。
 *
 * 🔴 为什么需要它：中文里「一」出现在「一些 / 一起 / 一定 / 一样」中，
 *    不加判别就会把「一些」解析成 1，进而让 `number` 信号误命中、
 *    `stat-card` 弹出一张莫名其妙的「1」。这里用**后接标记**做最小判别，
 *    不引分词库（项目纪律：不引第三方依赖）。
 *
 * ⚠️ 「步」刻意**不在**标记里：「这一步 / 第一步」是**指代**而不是数量，
 *    实测它会把「但这一步别再拖了」误判成「1」并弹出数据卡。
 * ⚠️ 「个」虽在标记里，但**单字「一」+「个」是例外**（见 `parseCnNumber` 内联判）：
 *    「一个」是冠词不是数量（「一个呢就是…」「还是一个运动裤」曾弹假 "1" 卡）。
 */
const CN_QUANTITY_MARKERS = new Set([
  '倍', '成', '%', '元', '个', '次', '人', '天', '年', '条', '份', '岁', '位', '家', '种',
]);
/** 其中能直接作为 `stat-card.unit` 展示的。 */
const CN_UNIT_OUTPUT = new Set(['倍', '成', '%', '元']);

/**
 * 中文数字串 → 整数（`三万五千` → 35000）。
 *
 * 支持 零/〇/一~九/两 + 十/百/千/万/亿 的组合；
 * 不支持的写法（小数点、分数、序数前缀）返回 `null`，由调用方降级。
 */
function cnRunToInt(run: string): number | null {
  let total = 0;
  let section = 0;
  let pending = 0;
  let hasAny = false;

  for (const ch of run) {
    if (ch in CN_DIGITS) {
      pending = CN_DIGITS[ch] as number;
      hasAny = true;
      continue;
    }
    if (ch in CN_SMALL_UNITS) {
      const unit = CN_SMALL_UNITS[ch] as number;
      // 「十二」的十前面没有数字 ⇒ 按 1 处理。
      section += (pending === 0 ? 1 : pending) * unit;
      pending = 0;
      hasAny = true;
      continue;
    }
    if (ch === '万' || ch === '亿') {
      section += pending;
      pending = 0;
      if (section === 0) section = 1;
      total += section * (ch === '万' ? 10_000 : 100_000_000);
      section = 0;
      hasAny = true;
      continue;
    }
    return null;
  }

  if (!hasAny) return null;
  return total + section + pending;
}

/**
 * 解析中文数量词 —— **最小实现**（无第三方依赖）。
 *
 * 覆盖中文口播里最常见的写法：
 *   · `三倍`     → `{ value: '3', unit: '倍' }`
 *   · `五成`     → `{ value: '5', unit: '成' }`
 *   · `百分之三十` → `{ value: '30', unit: '%' }`
 *   · `两万`     → `{ value: '20000' }`
 *   · `三万五千` → `{ value: '35000' }`
 *   · `一`       → `{ value: '1' }`
 *
 * 解析失败返回 `null`（如「一些」—— 数字后不是量词，不当作数量）。
 * 调用方按现有逻辑降级，不抛错。
 */
export function parseCnNumber(text: string): { value: string; unit?: string } | null {
  const src = text ?? '';

  const percent = CN_PERCENT_RE.exec(src);
  if (percent) {
    const n = cnRunToInt(percent[1] as string);
    if (n !== null) return { value: String(n), unit: '%' };
  }

  CN_RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null = CN_RUN_RE.exec(src);
  while (m !== null) {
    const run = m[0];
    const n = cnRunToInt(run);
    const next = src[m.index + run.length] ?? '';
    if (n !== null) {
      // 「一个」是不定冠词不是数量（2026-10-22 Reservation ① 语料校准）：
      // 「一个呢就是…」「还是一个运动裤」曾各弹出一张写着 "1" 的假数据卡。
      // 多字 run（「三万五千个」）与阿拉伯数字（「3个」）不受影响。
      if (run === '一' && next === '个') {
        m = CN_RUN_RE.exec(src);
        continue;
      }
      // 句尾的数字（如「一共一」）与多字数字（一百 / 十二 / 三万五千）都算数量。
      if (next === '' || [...run].length >= 2) {
        return { value: String(n) };
      }
      if (CN_QUANTITY_MARKERS.has(next)) {
        return CN_UNIT_OUTPUT.has(next)
          ? { value: String(n), unit: next }
          : { value: String(n) };
      }
      // 单字数字后接普通用字（一些 / 一起 / 一定）⇒ 不是数量，继续找下一个
    }
    m = CN_RUN_RE.exec(src);
  }
  return null;
}

/**
 * 从文本里取第一个数量。
 *
 * 顺序：阿拉伯数字串优先（3.5万 / 30%），取不到再尝试中文数量词。
 *
 * @returns `{ value, unit? }`；两者都取不到返回 `null`（该条降级到文字类模板）
 */
export function extractNumber(text: string): { value: string; unit?: string } | null {
  const m = ARABIC_NUMBER_RE.exec(text ?? '');
  if (m) {
    const value = m[0];
    const rest = (text ?? '').slice(m.index + value.length);
    const u = UNIT_AFTER_NUMBER_RE.exec(rest);
    return u ? { value, unit: u[0].trim() } : { value };
  }
  return parseCnNumber(text ?? '');
}

// ── 信号词表 ─────────────────────────────────────────────────
// 单一真源：`rhythm.ts` 的 `detectSignals` 与本文的**按信号定位文案**共用同一份词表。
// 放在 rhythm-rules 是因为依赖方向是 rhythm → rhythm-rules（反向会成环）。

/** 转折词。 */
export const TURN_WORDS = ['但', '可是', '不过', '然而', '反而', '其实'] as const;
/** 否定 / 对比词。 */
export const CONTRAST_WORDS = ['不', '没', '别', '而非', '比起', '而不是'] as const;
/** 列举词。 */
export const ENUM_WORDS = [
  '第一', '第二', '第三', '首先', '然后', '其次', '最后', '接下来',
] as const;
/** 收束词。 */
export const CLOSING_WORDS = ['总之', '总结', '最后', '记住'] as const;
/**
 * 定义句式词。
 *
 * 「就是」为 2026-10-22 Reservation ① 回填：kukini 真实语料中原六词零命中
 * （基线报告 §3），而「就是」型定义句有 3 处——「就是耐克和Stussy联名…」/
 * 「一个呢就是这个鞋面…」/「核心优势就是它的百搭」。
 * ⚠️ 须搭配 `rhythm.ts` 定义信号判据的 minChars=4：口语里「就是」后 2 字
 *     多为指代残尾（「后掌就是这个」），不足 4 字不当定义。
 */
export const DEFINITION_WORDS = ['叫', '是指', '也就是说', '所谓', '本质是', '意思是', '就是'] as const;
/** 因果词。 */
export const CAUSE_EFFECT_WORDS = ['因为', '所以', '因此', '导致', '于是', '结果'] as const;
/** 疑问句式（不含问号收尾，那部分由 `detectSignals` 的尾正则判）。 */
export const QUESTION_PATTERNS = ['是不是', '为什么', '怎么', '什么'] as const;
/**
 * 「怎么」的信号级反向护栏：`(?<!不)怎么` —— 「并不怎么样」「也不怎么好」
 * 是陈述不是提问（kukini cue20/30/32 曾误判，2026-10-22 校准）。
 * 只用于 `detectSignals` 的信号判定；`QUESTION_PATTERNS` 仍供文案定位使用。
 */
export const QUESTION_ZENME_RE = /(?<!不)怎么/;

/** 中文短句分隔符（规格指定：，。！？；、）。 */
const CLAUSE_SPLIT_RE = /[，。！？；、]/;

/** 只保留汉字 / 字母 / 数字 —— 去标点、去空白。 */
const EXCERPT_CHAR_RE = /[\p{Script=Han}A-Za-z0-9]/u;

/** 按中文标点切成短句，丢弃空段。 */
function splitClauses(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 清掉标点与空白，只留可渲染字符。 */
function cleanChars(text: string): string {
  let out = '';
  for (const ch of text) {
    if (EXCERPT_CHAR_RE.test(ch)) out += ch;
  }
  return out;
}

/**
 * 信号词**之后**是否还有至少 `minChars` 个可数中文字。
 *
 * 🔴 为什么信号判据需要它（2026-10-20 demo 实测）：
 *    cue 文本可能在信号词处被切断 —— `…接近全自动但` / `…记住这一点很`。
 *    此时转折/收束词属于**下一句**，本句并不该因此命中：
 *    motion 是「这句话」的伴生图形，文案也必须来自这句；
 *    跨 cue 拿下一句的文字会让「画面在说 A、motion 写 B」。
 *
 * 只用于**依赖其后内容**的信号（turn / closing / definition / cause-effect）。
 * `contrast` / `enum` / `number` / `question` 不依赖后文，不受影响。
 *
 * @param text 原始 cue 文本
 * @param words 信号词表
 * @param minChars 其后至少需要的可数字符数（默认 2）
 */
export function hasContentAfterWord(
  text: string,
  words: readonly string[],
  minChars = 2,
): boolean {
  const src = text ?? '';
  for (const w of words) {
    let i = src.indexOf(w);
    while (i >= 0) {
      const after = src.slice(i + w.length);
      if ([...cleanChars(after)].length >= minChars) return true;
      i = src.indexOf(w, i + w.length);
    }
  }
  return false;
}

/** 该 cue 的最后一个短句 —— 无信号时的兜底位置。 */
function lastClause(text: string): string {
  const clauses = splitClauses(text);
  return clauses.at(-1) ?? '';
}

/** 第一个包含任一给定词的短句。 */
function clauseContainingAny(text: string, words: readonly string[]): string | null {
  const clauses = splitClauses(text);
  for (const w of words) {
    const hit = clauses.find((c) => c.includes(w));
    if (hit !== undefined) return hit;
  }
  return null;
}

/** 第一个命中词**之后**的整段文本。 */
function segmentAfterWord(text: string, words: readonly string[]): string | null {
  let best = -1;
  let bestWord = '';
  for (const w of words) {
    const i = text.indexOf(w);
    if (i >= 0 && (best < 0 || i < best)) {
      best = i;
      bestWord = w;
    }
  }
  return best < 0 ? null : text.slice(best + bestWord.length);
}

/** 第一个命中词**之后、到下一个标点之前**的片段（列举词用）。 */
function segmentFromWordToDelimiter(text: string, words: readonly string[]): string | null {
  let best = -1;
  for (const w of words) {
    const i = text.indexOf(w);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  if (best < 0) return null;
  return text.slice(best).split(CLAUSE_SPLIT_RE)[0] ?? '';
}

/** 含疑问词的短句；有问号时取问号前的最后一句（问号被切分符吃掉了）。 */
function questionClause(text: string): string {
  const mark = text.search(/[？?]/);
  if (mark >= 0) {
    const before = lastClause(text.slice(0, mark));
    if ([...cleanChars(before)].length > 0) return before;
  }
  return clauseContainingAny(text, QUESTION_PATTERNS) ?? lastClause(text);
}

/**
 * 按**命中的信号**定位要展示的片段。
 *
 * 🔴 为什么不能「固定取前 N 字」（2026-10-20 实测推翻）：
 *    中文口播的**重点通常在句子后半**。「主体位置最后渲染出片整个流程接近全自动但
 *    关键节点必须停下来让人确认」固定取头部只会拿到前半句铺垫，重点（关键节点/必须确认）全丢。
 *    只有按信号定位（转折词之后、定义词之后、否定词所在短句…）才抓得住重心。
 *
 * 优先级与规格表同序：turn → closing → definition → contrast → enum → question
 * → short-after-long / repetition → 兜底（最后短句）。
 */
function locateExcerpt(text: string, signals: readonly RhythmSignal[]): string | null {
  const has = new Set(signals);

  const turn = has.has('turn') ? segmentAfterWord(text, TURN_WORDS) : null;
  if (turn !== null) return turn;

  if (has.has('closing')) {
    // `closing` 可能只由「末条」触发（没有收束词），此时取最后一个短句。
    return segmentAfterWord(text, CLOSING_WORDS) ?? lastClause(text);
  }

  const definition = has.has('definition') ? segmentAfterWord(text, DEFINITION_WORDS) : null;
  if (definition !== null) return definition;

  if (has.has('contrast')) {
    const clause = clauseContainingAny(text, CONTRAST_WORDS);
    if (clause !== null) return clause;
  }

  if (has.has('enum')) {
    const segment = segmentFromWordToDelimiter(text, ENUM_WORDS);
    if (segment !== null) return segment;
  }

  if (has.has('question')) return questionClause(text);

  if (has.has('short-after-long') || has.has('repetition')) return lastClause(text);

  return null;
}

/**
 * 规则化文案提取 —— **按信号定位**，不是「固定取前 N 字」。
 *
 * 规则（规格 2026-10-20）：
 *   1. 先按中文标点切短句，再按信号选目标段（见 `locateExcerpt`）
 *   2. 目标段超过 14 个中文字 → **保留尾部 14 字**（中文重心在后）
 *   3. 目标段不足 2 个中文字 → 回退「最后一个短句」；仍不足 → `null`（该条降级）
 *
 * 仍然是**规则化提取**：它保证「非空、不溢出、可复现」，不保证语义通顺；
 * 不调模型、不引分词库 —— 内置生成器必须保持确定性。
 *
 * @param text 原始 cue 文本（含标点）
 * @param signals `detectSignals` 的产出；空数组 = 兜底取最后短句
 * @param maxChars 安全长度上限（默认 12）
 */
export function extractExcerpt(
  text: string,
  signals: readonly RhythmSignal[] = [],
  maxChars = MAX_EXCERPT_CHARS,
): string | null {
  const src = text ?? '';
  let cleaned = cleanChars(locateExcerpt(src, signals) ?? '');
  if ([...cleaned].length < 2) cleaned = cleanChars(lastClause(src));
  if ([...cleaned].length < 2) return null;
  if ([...cleaned].length > maxChars) {
    cleaned = [...cleaned].slice(-maxChars).join('');
  }
  return cleaned;
}

/**
 * 按模板 id 产出参数 —— `decideMotion`（判定）与绑定器 `bindMotionboard`
 * （候选降档重提取）**共用同一实现**。
 *
 * 🔴 为什么必须共用：节奏表契约（`RhythmCue`）刻意**不存 params** ——
 *    参数是「文本的函数」，存一份就会在 SRT 修订后与文本不一致。
 *    两个函数各自提取一次但走同一段代码，才不会出现「判断时用 A 文案、
 *    落盘时用 B 文案」的分裂。
 *
 * ⚠️ `signals` 必须与判断时**同一份**：文案位置由命中的信号决定，
 *    传空数组会退回「最后短句」，与 `decideMotion` 的提取结果不一致。
 */
export function paramsForMotion(
  motion: string,
  text: string,
  signals: readonly RhythmSignal[] = [],
): Record<string, unknown> | null {
  switch (motion) {
    case 'data/stat-card@1.0': {
      const n = extractNumber(text);
      if (!n) return null;
      return n.unit === undefined ? { value: n.value } : { value: n.value, unit: n.unit };
    }
    case 'typography/lower-third@1.0': {
      const title = extractExcerpt(text, signals);
      return title === null ? null : { title };
    }
    case 'typography/kinetic-line@1.0':
    case 'typography/center-emphasis@1.0':
    case 'typography/tag-float@1.0': {
      const excerpt = extractExcerpt(text, signals);
      return excerpt === null ? null : { text: excerpt };
    }
    default:
      return null;
  }
}

/**
 * intent 词表 —— **唯一真源**（规格 P1 第三节选型表 + Wave 5 整合）。
 *
 * 候选按优先级排序，两处消费同一份：
 *  · `decideMotion`（节奏表选型）：`intentFromSignals` 定 intent → 按候选序尝试；
 *  · 绑定器 `bindMotionboard`（core/motionboard.ts）：intent → 候选逐个过时长门控。
 * 单一真源保证「节奏表选的」与「绑定器绑的」永不漂移（评审 P1，2026-10-21）。
 *
 * 只用 9 个已实现模板中的 5 个：`stat-card` / `center-emphasis` /
 * `lower-third` / `kinetic-line` / `tag-float`。其余 4 个
 * （`caption/karaoke-word`、`punch-in`、`noise-grain`、`split-frame`）
 * 不是「这句话的伴生图形」，不进词表。
 */
export const MOTIONBOARD_INTENTS: Readonly<
  Record<string, { readonly candidates: readonly string[]; readonly description: string }>
> = {
  'number-emphasis': {
    candidates: ['data/stat-card@1.0', 'typography/kinetic-line@1.0'],
    description: '数字 / 数据点强调',
  },
  'contrast-turn': {
    candidates: ['typography/kinetic-line@1.0'],
    description: '转折 / 对比',
  },
  question: {
    candidates: ['typography/kinetic-line@1.0'],
    description: '提问 / 悬念',
  },
  enum: {
    candidates: ['typography/lower-third@1.0', 'typography/kinetic-line@1.0'],
    description: '列举 / 并列要点',
  },
  'repetition-term': {
    candidates: ['typography/tag-float@1.0'],
    description: '全片复现关键词浮签',
  },
  'closing-verdict': {
    candidates: ['typography/center-emphasis@1.0', 'typography/kinetic-line@1.0'],
    description: '收束 / 总评',
  },
  definition: {
    candidates: ['typography/center-emphasis@1.0', 'typography/kinetic-line@1.0'],
    description: '定义句式',
  },
  keypoint: {
    candidates: ['typography/kinetic-line@1.0', 'typography/tag-float@1.0'],
    description: '要点泛称（材质 / 推荐 / 无更强语义时的归口）',
  },
};

/** 降级兜底模板：文字类里最通用的一个（`minVisibleInFrames = 30`）。 */
const FALLBACK_MOTION = 'typography/kinetic-line@1.0';

/** 信号列表 → 人读文本，用于 `reason`。 */
function describeSignals(signals: readonly RhythmSignal[]): string {
  return signals.length === 0 ? '无' : signals.join('+');
}

/**
 * 判断一条 cue 要不要配 motion、配哪个。
 *
 * 步骤（顺序不可换）：
 *   1. 无信号 → 不做（`reason: '无走势信号'`）
 *   2. 强度门槛 → 只有弱信号且仅 1 个 → 不做（`reason: '信号强度不足'`）
 *   3. `intentFromSignals` 定 intent（单一真源）→ 按词表候选序尝试：
 *      参数提取成功 **且** 时长满足模板 `minVisibleInFrames` → 选中
 *   4. 词表候选全部不满足 → 降级到 `kinetic-line`（文字类兜底）
 *   5. 仍不满足 → 不做（`skipped: 'no-template-fits'`）
 *
 * ⚠️ 第 4 步的兜底是规格「按上表向下尝试次优先模板」的落地：
 *    `number` 命中但 `stat-card` 要 45 帧、本条只有 40 帧时，
 *    数字本身仍是可渲染的文本 ⇒ 退到 `kinetic-line`（30 帧）而不是直接放弃。
 *
 * @param cue 当前 cue 的文本与时长快照
 * @param signals `detectSignals` 的产出
 * @param registry 模板查询表（只读）
 */
export function decideMotion(
  cue: PacingInput,
  signals: readonly RhythmSignal[],
  registry: TemplateLookup,
): MotionDecision {
  const hit = new Set(signals);

  if (hit.size === 0) {
    return { decide: 'none', reason: '无走势信号' };
  }

  const hasStrong = signals.some((s) => STRONG_SIGNALS.includes(s));
  if (!hasStrong && hit.size < 2) {
    return {
      decide: 'none',
      reason: `信号强度不足（仅 ${describeSignals(signals)}；weak 信号需 ≥2 个同时命中）`,
    };
  }

  // intent 单一真源：先定 intent，再按词表候选序尝试（与绑定器同源同序，
  // 保证 pacing.json 的选型与 bind-report 的绑定永不漂移）。
  const intent = intentFromSignals(signals);
  const intentDef = MOTIONBOARD_INTENTS[intent]!;
  for (let order = 0; order < intentDef.candidates.length; order += 1) {
    const motion = intentDef.candidates[order]!;

    const tpl = registry.get(motion);
    if (!tpl) {
      // 模板查不到属配置错误（与 registry.getTemplate 的口径一致），不静默跳过。
      throw new ConfigError(
        `节奏规则引用了未注册的模板：${motion} —— 检查 templates/builtin.ts 是否改名/降版本`,
      );
    }

    const params = paramsForMotion(motion, cue.text, signals);
    if (!params) continue; // 文案提取不出 → 降级到下一候选

    if (cue.durationInFrames < tpl.minVisibleInFrames) continue; // 模板门控 → 降级

    return {
      decide: 'motion',
      motion,
      params,
      reason:
        `信号 ${describeSignals(signals)} → ${intentDef.description}（${motion}` +
        `${order > 0 ? `，降级候选 ${order + 1}` : ''}）；` +
        `${cue.durationInFrames} 帧 ≥ minVisible ${tpl.minVisibleInFrames}`,
    };
  }

  // ── 降级兜底：文字类 kinetic-line ──────────────────────────
  const fallback = registry.get(FALLBACK_MOTION);
  if (fallback) {
    const params = paramsForMotion(FALLBACK_MOTION, cue.text, signals);
    if (params && cue.durationInFrames >= fallback.minVisibleInFrames) {
      return {
        decide: 'motion',
        motion: FALLBACK_MOTION,
        params,
        reason:
          `信号 ${describeSignals(signals)} 的首选模板不满足时长门控 → 降级到 ` +
          `${FALLBACK_MOTION}（${cue.durationInFrames} 帧 ≥ minVisible ${fallback.minVisibleInFrames}）`,
      };
    }
  }

  const textOk = extractExcerpt(cue.text, signals) !== null;
  return {
    decide: 'none',
    reason: textOk
      ? `无候选模板满足 minVisibleInFrames（cue 仅 ${cue.durationInFrames} 帧）`
      : '文案提取失败（去标点后不足 2 字），无可渲染文本',
    skipped: 'no-template-fits',
  };
}

// ─────────────────────────────────────────────────────────────
// 规则底稿 → 意图层：轨道常量与共享件（绑定器复用，见 core/motionboard.ts）
// ─────────────────────────────────────────────────────────────

/** 字幕轨 / MG 轨的固定划分（规格 P1 第三节：不按模板各开一轨）。CAPTION_* 导出供绑定器复用。 */
export const CAPTION_TRACK = { id: 'caption', layer: 90 } as const;
const MOTION_TRACK = { id: 'motion', layer: 60 } as const;
export const CAPTION_MOTION = 'caption/karaoke-word@1.0';

// ─────────────────────────────────────────────────────────────
// 区域感知的载体退路（E-D4-01 修复，2026-10-21）
// ─────────────────────────────────────────────────────────────
// 基线实测（docs/reviews/2026-10-21-节奏表基线报告.md §4）：当时的规则合成路径只读
// cues、不读 02-perceive/regions.json，footprint 全取模板默认值 →
// center-emphasis 压住 handheld 区域 27.6% > 预算 20%，且 item 未声明
// carrier ⇒ 三级退让无法启动 → E-D4-01，validate 阻断。
//
// 修法（最小且诚实）：合成时按 validate 的**同一几何口径**预测预算超支，
// 超了才声明 carrier 退路 —— tier1 平移仍优先（`resolveOcclusion` 先试
// nudge，已在预算内则幂等跳过），tier2 只是「退路存在」。声明前先验证
// 展示条真的清得掉预算（否则只是把 E-D4-01 换成 E-D2-01）；挑不出能清掉
// 的 side/ratio 时声明**最接近达标**的候选，让 tier2 按事实报 E-D2-01
// （退路不够），而不是 E-D4-01（退路不存在）—— 两者语义本就互斥。
//
// 🔴 几何真源：展示条矩形一律取自 `core/carrier-window.ts`（唯一真源），
//   不得在此重算；AABB 相交面积因 core 不得反向依赖 validate/context.ts
//   而在此独立实现（口径与 `rectOverlapArea` 逐位一致）。若两边分叉，
//   validate 仍是权威 —— 后果是声明了用不上的路由（响）或 validate 报错（更响），
//   不会静默。

/** 退路声明用的载体模板 —— 当前唯一可被 tier2 消费的载体类模板。 */
const CARRIER_ROUTE_TEMPLATE = 'carrier/split-frame@1.0';

/** 归一化矩形相交面积（与 validate/context.ts 的 `rectOverlapArea` 同口径）。 */
function overlapArea(a: Footprint, b: Footprint): number {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  const right = Math.min(a[0] + a[2], b[0] + b[2]);
  const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

/** item 覆盖面占区域面积的比例（occlusion.ts `occlusionRatio` 同口径）。 */
function occlusionRatioOf(item: Footprint, box: Footprint): number {
  const area = Math.max(0, box[2]) * Math.max(0, box[3]);
  if (area <= 0) return 0;
  return overlapArea(item, box) / area;
}

/**
 * 预测超预算的区域集合（validate `collectHits` 的同款准入：
 * 帧区间相交 + 遮挡率超该区域等级预算）。
 */
function predictedConflicts(
  footprint: Footprint,
  startFrame: number,
  endFrame: number,
  regions: readonly PerceiveRegion[],
): PerceiveRegion[] {
  return regions.filter((r) => {
    const regionEnd = r.fromFrame + r.durationInFrames;
    if (startFrame >= regionEnd || r.fromFrame >= endFrame) return false;
    return occlusionRatioOf(footprint, r.box) > OCCLUSION_BUDGET[r.kind];
  });
}

/**
 * 挑一条真的能过 tier2 终判的载体路由（side × ratio 固定枚举顺序，可复现）。
 *
 * 终判口径与 `resolveOcclusion` 第②步一致：展示条（`carrierDisplayRect`）
 * 对**每个**冲突区域的遮挡率 ≤ 该区域预算。全部候选不达标时取
 * 「超出量最小」的 —— 退路仍声明，失败形态交给 tier2 如实报 E-D2-01。
 */
function chooseCarrierRoute(conflicts: readonly PerceiveRegion[]): CarrierRef {
  const sides: CarrierSide[] = [
    CARRIER_SIDE_DEFAULT,
    CARRIER_SIDE_DEFAULT === 'right' ? 'left' : 'right',
  ];
  const ratios = [CARRIER_RATIO_DEFAULT, CARRIER_RATIO_MIN];
  let best: { side: CarrierSide; ratio: number; worstExcess: number } | null = null;
  for (const side of sides) {
    for (const ratio of ratios) {
      const display = carrierDisplayRect(side, ratio);
      let worstExcess = -Infinity;
      let ok = true;
      for (const r of conflicts) {
        const excess = occlusionRatioOf(display, r.box) - OCCLUSION_BUDGET[r.kind];
        if (excess > worstExcess) worstExcess = excess;
        if (excess > 0) ok = false;
      }
      if (ok) {
        return { template: CARRIER_ROUTE_TEMPLATE, params: { side, ratio } };
      }
      if (!best || worstExcess < best.worstExcess) best = { side, ratio, worstExcess };
    }
  }
  return { template: CARRIER_ROUTE_TEMPLATE, params: { side: best!.side, ratio: best!.ratio } };
}

/**
 * 需要时声明载体退路；不需要就返回 undefined（不多不少）。
 *
 * 准入与 validate `collectHits` 完全一致：只看 `occludesSubject: true` 的
 * **叠加类**模板（fullscreen 归 D3 人工确认，不进遮挡预算，也不声明退路）。
 * 预测帧区间与 bake 的隐式时长同口径：`max(minVisibleInFrames, toFrame-fromFrame+1)`。
 */
export function carrierRouteIfNeeded(
  registry: TemplateLookup,
  motion: string,
  cue: Cue,
  regions: readonly PerceiveRegion[],
): CarrierRef | undefined {
  const tpl = registry.get(motion);
  if (!tpl || !tpl.occludesSubject) return undefined;
  if (!isOverlayScope(tpl.scope) || tpl.scope === 'fullscreen') return undefined;
  const byCue = cue.toFrame - cue.fromFrame + 1;
  return carrierRouteForSpan(
    registry,
    motion,
    cue.fromFrame,
    cue.fromFrame + Math.max(tpl.minVisibleInFrames, byCue),
    regions,
  );
}

/**
 * 载体退路声明（区间版）—— 供绑定器按锚点解析出的任意区间调用
 * （intent 条目可能是 word:/cue:/abs: 锚点，不天然对应一条 cue）。
 * 准入与 `carrierRouteIfNeeded` 相同；abs/无区间场景由调用方跳过。
 */
export function carrierRouteForSpan(
  registry: TemplateLookup,
  motion: string,
  startFrame: number,
  endFrame: number,
  regions: readonly PerceiveRegion[],
): CarrierRef | undefined {
  const tpl = registry.get(motion);
  if (!tpl || !tpl.occludesSubject) return undefined;
  if (!isOverlayScope(tpl.scope) || tpl.scope === 'fullscreen') return undefined;
  const conflicts = predictedConflicts(tpl.footprint, startFrame, endFrame, regions);
  if (conflicts.length === 0) return undefined;
  if (!registry.get(CARRIER_ROUTE_TEMPLATE)) {
    throw new ConfigError(
      `需要声明载体退路，但模板未注册：${CARRIER_ROUTE_TEMPLATE} —— 检查 templates/builtin.ts 是否改名/降版本`,
    );
  }
  return chooseCarrierRoute(conflicts);
}

/**
 * 调度强度固定值 —— **规则置信度，不是模型自评**。
 *
 * 🔴 与旧语义的区别（务必知道再用）：`decision.confidence` 原本的设计是
 *    「模型对自己这一笔有多确定」，用来调人工介入强度。内置生成器没有模型，
 *    这里的 1.0 表示「规则 100% 命中了它自己的判据」，**不代表成片一定好看**。
 *    `sim_max` 同理：caption 恒 1.0（它就是字幕，不需要挑模板）；
 *    规则命中恒 0.85（高于 T 上限 0.80 ⇒ 走 template 产路，不误触安全阀）。
 */
const CAPTION_SIM_MAX = 1.0;
const RULE_CONFIDENCE = 1.0;

// ─────────────────────────────────────────────────────────────
// 规则底稿生成（Wave 5 整合）：节奏表 → motionboard.json（intent 形态）
// ─────────────────────────────────────────────────────────────

/**
 * 信号 → intent 的映射（优先级序：先命中先得）。
 *
 * 分组顺序与规格 P1 第三节选型表一致（number → definition/closing → enum →
 * 文字类 → repetition），保证多信号时选中的模板与选型表逐案一致；
 * `question` 与 `contrast-turn` 同选 kinetic-line，组内顺序沿旧词表序
 * （question 在前）以稳定 intent 标签。
 *
 * 🔴 单一真源约束：本表只做「信号 → 意图」的翻译；模板候选序一律取
 *   `MOTIONBOARD_INTENTS`，不另维护「信号 → 模板」的第二份映射。
 */
const SIGNAL_INTENT_PRIORITY: readonly {
  readonly signals: readonly RhythmSignal[];
  readonly intent: string;
}[] = [
  { signals: ['number'], intent: 'number-emphasis' },
  { signals: ['definition'], intent: 'definition' },
  { signals: ['closing'], intent: 'closing-verdict' },
  { signals: ['enum'], intent: 'enum' },
  { signals: ['question'], intent: 'question' },
  { signals: ['turn', 'contrast'], intent: 'contrast-turn' },
  { signals: ['repetition', 'short-after-long'], intent: 'repetition-term' },
];

/** 信号集 → intent；无命中归口 `keypoint`（词表中的泛称意图）。 */
export function intentFromSignals(signals: readonly RhythmSignal[]): string {
  const has = new Set(signals);
  for (const rule of SIGNAL_INTENT_PRIORITY) {
    if (rule.signals.some((s) => has.has(s))) return rule.intent;
  }
  return 'keypoint';
}

/**
 * 由节奏表生成 motionboard 底稿（intent 形态，可编辑）。
 *
 * 产出规则（规格 P1 第三节 + Wave 5 整合）：
 *   · **每条 cue 恒有一条 caption item**（钉死形态，含 `<门槛` 的短 cue）——
 *     字幕层独立于 motion 门槛，它按 SRT 区间铺，不受「要不要配动效」影响。
 *   · `decide === 'motion'` 的 cue 额外产出一条 **intent 条目**（不写 motion id、
 *     不写坐标/帧数）—— 模板选择交给绑定器按 `MOTIONBOARD_INTENTS` 解析。
 *   · `params` 预填 `decideMotion` 判定时的机械提取结果（同信号同口径），
 *     人工/模型可直接在文件里看到并修改文案；候选降档时绑定器会按新模板重提取。
 *   · track 只有两条：`caption`（layer 90）/ `motion`（layer 60）。
 *   · 全部用 `cue:N` 锚点，**不写 `fromFrame` / `durationInFrames`**（C2 铁律 2）。
 *
 * @param table `buildRhythmTable` 的产出
 * @param cues 与 `table` 同源的 cue 列表
 * @param source fps 与对齐置信度（写进 meta）
 * @param registry 模板查询表；默认内置模板库
 */
export function generateMotionboard(
  table: RhythmTable,
  cues: readonly Cue[],
  source: { fps: number; alignmentConfidence: number },
  registry: TemplateLookup = builtinTemplateLookup(),
): MotionBoard {
  if (table.cues.length !== cues.length) {
    throw new ConfigError(
      `generateMotionboard：节奏表有 ${table.cues.length} 行，但 cue 有 ${cues.length} 条 —— ` +
        `必须用同一份 01-align 产物生成，否则锚点会指向不存在的 cue`,
    );
  }

  const captionItems: MotionBoardItem[] = [];
  const motionItems: MotionBoardItem[] = [];

  cues.forEach((cue, i) => {
    const anchor = `cue:${cue.index}`;

    // 字幕层：恒存在，不受 motion 门槛约束（钉死条目）。
    captionItems.push({
      _author: { anchor },
      motion: CAPTION_MOTION,
      confidence: RULE_CONFIDENCE,
      sim_max: CAPTION_SIM_MAX,
    });

    const row = table.cues[i];
    if (!row || row.decide !== 'motion' || row.motion === undefined) return;

    // params 预填判定时的机械提取（同信号同口径）；提取失败不拦 ——
    // 绑定器会按候选再提取 / 记 no-fits，不在这里二次报错。
    const params = paramsForMotion(row.motion, cue.text ?? '', row.signal.filter(isRuleSignal));
    const item: MotionBoardItem = {
      _author: { anchor },
      intent: intentFromSignals(row.signal.filter(isRuleSignal)),
      confidence: RULE_CONFIDENCE,
      note: row.reason,
    };
    if (params) item.params = params;
    motionItems.push(item);
  });

  return {
    meta: {
      fps: source.fps,
      alignmentConfidence: source.alignmentConfidence,
    },
    tracks: [
      { id: CAPTION_TRACK.id, layer: CAPTION_TRACK.layer, items: captionItems },
      { id: MOTION_TRACK.id, layer: MOTION_TRACK.layer, items: motionItems },
    ],
    noMotionRanges: [],
  };
}
