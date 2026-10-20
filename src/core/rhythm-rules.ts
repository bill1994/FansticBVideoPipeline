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
import { listTemplates } from '../templates/registry.ts';
import type { TemplateDeclaration } from '../templates/types.ts';
import type { Cue, Footprint, RhythmSignal, RhythmTable } from './types.ts';

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
 * 安全文案长度上限（中文字符数）。
 *
 * 🔴 12 是**安全线**，不是设计值：模板的 footprint 宽度有限，
 *    超过它就会触发校验项 #17（文本溢出）的告警。P1 是粗糙版提取，
 *    先把「能渲染、不溢出」放在「语义完整」之前；
 *    后续要提升文案质量，应改这里的策略，而不是在校验侧放宽阈值。
 */
const MAX_EXCERPT_CHARS = 12;

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
/** 定义句式词。 */
export const DEFINITION_WORDS = ['叫', '是指', '也就是说', '所谓', '本质是', '意思是'] as const;
/** 因果词。 */
export const CAUSE_EFFECT_WORDS = ['因为', '所以', '因此', '导致', '于是', '结果'] as const;
/** 疑问句式（不含问号收尾，那部分由 `detectSignals` 的尾正则判）。 */
export const QUESTION_PATTERNS = ['是不是', '为什么', '怎么', '什么'] as const;

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
 * 🔴 为什么不能「取前 12 字」（2026-10-20 实测推翻）：
 *    中文口播的**重点通常在句子后半**。「主体位置最后渲染出片整个流程接近全自动但
 *    关键节点必须停下来让人确认」取前 12 字得到「主体位置最后渲染出片整个」——
 *    前半句全是铺垫，重点（关键节点/必须确认）全丢。
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
 * 规则化文案提取 —— **按信号定位**，不是「取前 12 字」。
 *
 * 规则（规格 2026-10-20）：
 *   1. 先按中文标点切短句，再按信号选目标段（见 `locateExcerpt`）
 *   2. 目标段超过 12 个中文字 → **保留尾部 12 字**（中文重心在后）
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
 * 按模板 id 产出参数 —— `decideMotion` 与 `synthDraft` **共用同一实现**。
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

interface CandidateRule {
  /** 该规则介入所需的信号条件。 */
  matches: (signals: ReadonlySet<RhythmSignal>) => boolean;
  motion: string;
  /** 人读的选型说明，写进 `reason`。 */
  label: string;
}

/**
 * 模板选型表（规格 P1 第三节，顺序即优先级）。
 *
 * 只用 9 个已实现模板中的 5 个：`stat-card` / `center-emphasis` /
 * `lower-third` / `kinetic-line` / `tag-float`。其余 4 个
 * （`caption/karaoke-word`、`punch-in`、`noise-grain`、`split-frame`）
 * 不是「这句话的伴生图形」，P1 不选它们。
 */
const CANDIDATES: readonly CandidateRule[] = [
  {
    matches: (s) => s.has('number'),
    motion: 'data/stat-card@1.0',
    label: '数字 → 数据卡',
  },
  {
    matches: (s) => s.has('definition'),
    motion: 'typography/center-emphasis@1.0',
    label: '下定义 → 居中强调',
  },
  {
    matches: (s) => s.has('closing'),
    motion: 'typography/center-emphasis@1.0',
    label: '收束 → 居中强调',
  },
  {
    matches: (s) => s.has('enum'),
    motion: 'typography/lower-third@1.0',
    label: '列举 → 下三分之一条',
  },
  {
    matches: (s) => s.has('turn') || s.has('contrast'),
    motion: 'typography/kinetic-line@1.0',
    label: '转折 / 对比 → 动势单行',
  },
  {
    matches: (s) => s.has('question'),
    motion: 'typography/kinetic-line@1.0',
    label: '提问 → 动势单行',
  },
  {
    matches: (s) => s.has('repetition') || s.has('short-after-long'),
    motion: 'typography/tag-float@1.0',
    label: '复现 / 短句承接 → 浮签',
  },
];

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
 *   3. 按选型表顺序尝试：参数提取成功 **且** 时长满足模板 `minVisibleInFrames` → 选中
 *   4. 信号候选全部不满足 → 降级到 `kinetic-line`（文字类兜底）
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

  for (const rule of CANDIDATES) {
    if (!rule.matches(hit)) continue;

    const tpl = registry.get(rule.motion);
    if (!tpl) {
      // 模板查不到属配置错误（与 registry.getTemplate 的口径一致），不静默跳过。
      throw new ConfigError(
        `节奏规则引用了未注册的模板：${rule.motion} —— 检查 templates/builtin.ts 是否改名/降版本`,
      );
    }

    const params = paramsForMotion(rule.motion, cue.text, signals);
    if (!params) continue; // 文案提取不出 → 降级到下一候选

    if (cue.durationInFrames < tpl.minVisibleInFrames) continue; // 模板门控 → 降级

    return {
      decide: 'motion',
      motion: rule.motion,
      params,
      reason:
        `信号 ${describeSignals(signals)} → ${rule.label}（${rule.motion}）；` +
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
// 节奏表 → 起草稿
// ─────────────────────────────────────────────────────────────

/** 起草稿 item 的结构化形状（与 `stages/storyboard.ts` 的 `DraftItem` 兼容）。 */
export interface SynthDraftItem {
  _author: { anchor: string };
  motion: string;
  footprint: Footprint;
  params?: Record<string, unknown>;
  sim_max: number;
  confidence: number;
}

export interface SynthDraftTrack {
  id: string;
  layer: number;
  items: SynthDraftItem[];
}

export interface SynthDraft {
  meta: {
    fps: number;
    anchorMode: 'word' | 'cue';
    alignmentConfidence: number;
  };
  tracks: SynthDraftTrack[];
  noMotionRanges: [];
}

/** `synthDraft` 需要的上游事实。 */
export interface SynthSource {
  fps: number;
  alignmentConfidence: number;
}

/** 字幕轨 / MG 轨的固定划分（规格 P1 第三节：不按模板各开一轨）。 */
const CAPTION_TRACK = { id: 'caption', layer: 90 } as const;
const MOTION_TRACK = { id: 'motion', layer: 60 } as const;
const CAPTION_MOTION = 'caption/karaoke-word@1.0';

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
const RULE_SIM_MAX = 0.85;
const RULE_CONFIDENCE = 1.0;

/** 取模板声明的默认 footprint；缺失即配置错误，不自己发明坐标。 */
function footprintOf(registry: TemplateLookup, motion: string): Footprint {
  const tpl = registry.get(motion);
  if (!tpl) {
    throw new ConfigError(`synthDraft 引用了未注册的模板：${motion}`);
  }
  return [...tpl.footprint] as Footprint;
}

/**
 * 由节奏表合成起草稿（`draft.json` 的内存形态）。
 *
 * 产出规则（规格 P1 第三节）：
 *   · **每条 cue 恒有一条 caption item**（含 `<门槛` 的短 cue）——
 *     字幕层独立于 motion 门槛，它按 SRT 区间铺，不受「要不要配动效」影响。
 *   · `decide === 'motion'` 的 cue 额外产出一条 MG item。
 *   · track 只有两条：`caption`（layer 90）/ `motion`（layer 60）。
 *   · 全部用 `cue:N` 锚点，**不写 `fromFrame` / `durationInFrames`**：
 *     帧由烘焙器按 cue 区间算，避免「模型手算帧」（C2 铁律 2），
 *     同时保证 motion 时长与该句话严格一致（不做任何时长推导）。
 *     ⚠️ 字幕例外：`bake()` 对隐式时长取 `max(minVisibleInFrames, cue 区间)`，
 *     所以短于 12 帧的 cue，其 caption 会被抬高到 12 帧 —— 这是模板下限
 *     （模板声明、非模型选择），不是「时长推导」。
 *
 * @param table `buildRhythmTable` 的产出
 * @param cues 与 `table` 同源的 cue 列表（用于 caption 锚点与文案提取）
 * @param source fps 与对齐置信度（写进 draft.meta）
 * @param registry 模板查询表；默认内置模板库
 */
export function synthDraft(
  table: RhythmTable,
  cues: readonly Cue[],
  source: SynthSource,
  registry: TemplateLookup = builtinTemplateLookup(),
): SynthDraft {
  if (table.cues.length !== cues.length) {
    throw new ConfigError(
      `synthDraft：节奏表有 ${table.cues.length} 行，但 cue 有 ${cues.length} 条 —— ` +
        `必须用同一份 01-align 产物生成，否则锚点会指向不存在的 cue`,
    );
  }

  const captionItems: SynthDraftItem[] = [];
  const motionItems: SynthDraftItem[] = [];

  cues.forEach((cue, i) => {
    const anchor = `cue:${cue.index}`;

    // 字幕层：恒存在，不受 motion 门槛约束。
    captionItems.push({
      _author: { anchor },
      motion: CAPTION_MOTION,
      footprint: footprintOf(registry, CAPTION_MOTION),
      sim_max: CAPTION_SIM_MAX,
      confidence: RULE_CONFIDENCE,
    });

    const row = table.cues[i];
    if (!row || row.decide !== 'motion' || row.motion === undefined) return;

    const params = paramsForMotion(row.motion, cue.text ?? '', row.signal);
    if (!params) {
      throw new ConfigError(
        `synthDraft：节奏表判定 cue#${cue.index} 配 ${row.motion}，但文案提取失败 —— ` +
          `节奏表与 cue 文本可能不同源（节奏表应在同一次构建中生成）`,
      );
    }

    motionItems.push({
      _author: { anchor },
      motion: row.motion,
      footprint: footprintOf(registry, row.motion),
      params,
      sim_max: RULE_SIM_MAX,
      confidence: RULE_CONFIDENCE,
    });
  });

  return {
    meta: {
      fps: source.fps,
      anchorMode: 'word',
      alignmentConfidence: source.alignmentConfidence,
    },
    tracks: [
      { id: CAPTION_TRACK.id, layer: CAPTION_TRACK.layer, items: captionItems },
      { id: MOTION_TRACK.id, layer: MOTION_TRACK.layer, items: motionItems },
    ],
    noMotionRanges: [],
  };
}
