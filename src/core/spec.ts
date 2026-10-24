/**
 * MotionSpec —— 渲染无关的动效描述契约（S1a 数据层，2026-10-20）。
 *
 * ─────────────────────────────────────────────────────────────
 * 这一层解决什么
 * ─────────────────────────────────────────────────────────────
 * 模板从「一个手写 React 组件」变成「一份 JSON 描述 + 一个渲染器」：
 * 本文件只负责**契约、校验、派生声明**，不渲染任何像素。
 * `SpecRenderer`（消费 spec 出画面）属于 S1b —— 在 S1a 完成时，
 * `custom/*` 的 item 渲染仍是 `Placeholder` 灰框，这是预期行为。
 *
 * ─────────────────────────────────────────────────────────────
 * 三条硬约束
 * ─────────────────────────────────────────────────────────────
 * ① **零依赖手写校验**：不引 JSON Schema 库。所有拒绝规则一次列全，
 *    统一抛 `ConfigError`（退出码 2）。
 * ② **颜色只认令牌**：`color` 轨的值必须是 `tokens.ts` 里 `COLOR` 的六个键之一，
 *    禁止字面色值 —— 与 P1「禁模型写颜色」同源。
 * ③ **本文件不读磁盘**：装载在 `spec-loader.ts`，避免纯校验逻辑被 I/O 污染。
 */

import { ConfigError } from './exit-code.ts';
import { parseTime, parseUnitFrames } from './spec-time.ts';
import { COLOR, RADIUS, SHADOW } from '../remotion/tokens.ts';
import { parseMotionId, type TemplateDeclaration } from '../templates/types.ts';
import type { Footprint, RhythmSignal } from './types.ts';

// ─────────────────────────────────────────────────────────────
// 契约类型
// ─────────────────────────────────────────────────────────────

/** spec 允许驱动的属性。 */
export type SpecProperty =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotate'
  | 'opacity'
  | 'clip'
  | 'blur'
  | 'color';

/** 缓动名。 */
export type SpecEase = 'linear' | 'out' | 'in' | 'inOut' | 'expoOut';

/**
 * 关键帧。
 *
 * `t` 支持两种单位：
 *   · `number` ∈ [0,1] —— 相对 item 时长的比例
 *   · `string` 形如 `"8f"` —— 绝对帧偏移
 *
 * ⚠️ **同一轨内必须统一单位**：混合单位无法比较先后，
 * 单调性检查也就失去意义（见校验规则 6/7）。
 */
export interface SpecKey {
  t: number | string;
  v: number | string;
  ease?: SpecEase;
}

/** 图元类型（S2 起 5 类：1 文本 + 4 装饰）。 */
export type SpecElementType = 'text' | 'panel' | 'bar' | 'rule' | 'triangle';

/** 文本图元。 */
export interface SpecTextElement {
  type: 'text';
  slot: 'main' | 'sub';
  /** `'excerpt'` / `'number'` 由运行时从 params 取；`literal:` 是写死文案。 */
  content: 'excerpt' | 'number' | `literal:${string}`;
  sizePx: number;
  weight: 400 | 600 | 700 | 900;
  align: 'left' | 'center' | 'right';
  lineHeight?: number;
  trackingEm?: number;
  paddingPx: number;
  /**
   * 逐字**累计**揭示：第 i 个码点从 `i × perUnit` 起出现，出现后保持。
   * ⚠️ 刻意只有这一种语义（没有 reveal 字段）：逐字独立淡入淡出会出现
   *    「的/了单独闪一下」的乱码感。
   */
  split?: 'chars';
  /** 每字起始间隔，`"Nf"` 绝对帧；省略 = `"2f"`（30fps ≈ 15 字/秒）。 */
  perUnit?: string;
  /** 最后一个字之后保留多少帧（用于把总时长压进 item 内）；省略 = 6。 */
  holdFrames?: number;
  /**
   * `split:'chars'` 时**必填**：作者声明这条 spec 最多吃多少字。
   *
   * 🔴 为什么必须声明：`perUnit` 是绝对帧，但总长度取决于字符数，
   *    天然绕过「绝对帧 ≤ minVisibleInFrames」那条铁律 —— 长句会把最后几个字
   *    拖到 item 结束后静默截断。装载期用 `(maxUnits-1)×perUnit+holdFrames
   *    ≤ minVisibleInFrames` 校验上界；实际字符数超了由选型期换 spec，
   *    渲染期 `perUnit_eff` 再兜底。三层职责互不替代。
   */
  maxUnits?: number;
}

/** 卡底：铺满 footprint 的纯色/圆角/阴影块。 */
export interface SpecPanelElement {
  type: 'panel';
  /** `COLOR` 的键（如 `plate`）。 */
  fill?: string;
  /** `COLOR` 的键；1px 描边。 */
  border?: string;
  /** `RADIUS` 的键（sm/md/lg）。 */
  radius?: string;
  /** `SHADOW` 的键（text/card）。 */
  shadow?: string;
}

/** 贴边竖条 / 横条。 */
export interface SpecBarElement {
  type: 'bar';
  edge: 'left' | 'right' | 'top' | 'bottom';
  thicknessPx: number;
  /** 从所在边向内缩进的像素（默认 0）。 */
  insetPx?: number;
  /** `COLOR` 的键。 */
  fill?: string;
}

/** 分隔线 / 下划线。 */
export interface SpecRuleElement {
  type: 'rule';
  /** `h` = 水平线（主轴 x），`v` = 垂直线。 */
  axis: 'h' | 'v';
  /** 交叉轴位置 0–100（从起边算）；线绘制在该位置**内侧**。 */
  at: number;
  thicknessPx: number;
  /** 主轴两端内缩像素（默认 0）。 */
  insetPx?: number;
  /** `COLOR` 的键。 */
  fill?: string;
}

/** 三角指示器（border 技巧绘制）。 */
export interface SpecTriangleElement {
  type: 'triangle';
  dir: 'up' | 'down';
  /** 三角高度；底宽 = 1.15 × heightPx（对齐 tag-float 的小尖角）。 */
  heightPx: number;
  /** 在 footprint 内的锚点；默认 `{ x:'center', y:'bottom' }`。 */
  at?: { x: 'left' | 'center' | 'right'; y: 'top' | 'middle' | 'bottom' };
  /** `COLOR` 的键。 */
  fill?: string;
}

export type SpecElement =
  | SpecTextElement
  | SpecPanelElement
  | SpecBarElement
  | SpecRuleElement
  | SpecTriangleElement;

export interface SpecTrack {
  element: number;
  property: SpecProperty;
  keys: SpecKey[];
}

/**
 * motion:accept 验收签章块（P1-b）—— spec 文件顶层 `acceptance` 键的形状契约。
 *
 * 形状归本文件（顶层白名单收录 + 校验，见 validateMotionSpec 规则）；签发与
 * 验签语义归 `motion-accept.ts`（其 `MotionAcceptance` 以更窄的类型 extends
 * 本形状：toolVersion 字面量 1、gates 为门名元组）。刻意不让 spec.ts 反向
 * import motion-accept —— 后者引了 react-dom/server，只许在 Node 侧活，
 * 契约文件与它必须保持单向依赖。
 */
export interface MotionSpecAcceptance {
  toolVersion: number;
  specHash: string;
  gates: readonly string[];
}

export interface MotionSpec {
  specVersion: 1;
  /** 必须 `custom/<subtype>@<x.y>`。 */
  id: string;
  layer: number;
  footprint: [number, number, number, number];
  minVisibleInFrames: number;
  /** 必填 —— 禁止默认 false（默认值会让人忘记声明遮挡意图）。 */
  occludesSubject: boolean;
  /** ≤4 个图元。 */
  elements: SpecElement[];
  /** 每轨 2–8 个关键帧。 */
  tracks: SpecTrack[];
  when?: { signals: RhythmSignal[] };
  promptRef?: string;
  /**
   * 图元级错峰（S2）。
   *
   * 第 j 个图元的动画时钟整体后移 `j × perElement`；`reverse` 时反序
   * （`(count-1-j) × perElement`）。与 `text.split:'chars'` 的字符偏移**叠加**。
   */
  stagger?: { perElement: string; order: 'index' | 'reverse' };
  /** 仅文档用途的说明（写作用例、单位约定）。不参与派生，禁止塞实现细节。 */
  _note?: string;
  /**
   * motion:accept 六道验收全过后盖上的签章块（P1-b）。可选：现有 8 份基线
   * spec 没有它照常装载；`custom-*` 入库文件由 spec-loader 强制验签（AC-7）。
   */
  acceptance?: MotionSpecAcceptance;
}

// ─────────────────────────────────────────────────────────────
// 枚举与常量
// ─────────────────────────────────────────────────────────────

export const SPEC_VERSION = 1;

/** spec 文件体积上限（16KB）。 */
export const MAX_SPEC_BYTES = 16 * 1024;

export const SPEC_PROPERTIES: readonly SpecProperty[] = [
  'x',
  'y',
  'scale',
  'rotate',
  'opacity',
  'clip',
  'blur',
  'color',
];

export const SPEC_EASES: readonly SpecEase[] = ['linear', 'out', 'in', 'inOut', 'expoOut'];

/** 合法的走势信号名（与 `RhythmSignal` 联合类型同源，用于 `when.signals` 校验）。 */
export const RHYTHM_SIGNALS: readonly RhythmSignal[] = [
  'turn',
  'contrast',
  'enum',
  'question',
  'number',
  'short-after-long',
  'closing',
  'definition',
  'cause-effect',
  'repetition',
];

/** 颜色令牌白名单 —— 直接取 `COLOR` 的键，**不另抄一份色值/键名**。 */
export const COLOR_TOKENS: readonly string[] = Object.keys(COLOR);
/** 圆角 / 阴影令牌白名单 —— 同上，只引用不抄写。 */
export const RADIUS_TOKENS: readonly string[] = Object.keys(RADIUS);
export const SHADOW_TOKENS: readonly string[] = Object.keys(SHADOW);

/** 图元类型枚举。 */
export const ELEMENT_TYPES: readonly SpecElementType[] = [
  'text',
  'panel',
  'bar',
  'rule',
  'triangle',
];
/** bar 的贴边方向。 */
export const BAR_EDGES = ['left', 'right', 'top', 'bottom'] as const;
/** rule 的主轴。 */
export const RULE_AXES = ['h', 'v'] as const;
/** triangle 的指向（只支持上下；左右没有语义场景）。 */
export const TRIANGLE_DIRS = ['up', 'down'] as const;
/** triangle 锚点枚举。 */
export const TRIANGLE_AT_X = ['left', 'center', 'right'] as const;
export const TRIANGLE_AT_Y = ['top', 'middle', 'bottom'] as const;

const TOP_LEVEL_KEYS = new Set([
  'specVersion',
  'id',
  'layer',
  'footprint',
  'minVisibleInFrames',
  'occludesSubject',
  'elements',
  'tracks',
  'when',
  'promptRef',
  'stagger',
  // `_note` 是**显式收录**的文档字段（不参与派生，只给人的说明留位置）。
  // 它不是「放开未知字段」：其它任何键仍按规则 11 拒绝。
  '_note',
  // `acceptance` 是 motion:accept 六道验收全过后盖在文件顶层的**签章块**
  // （P1-b，2026-10-24 裁决收录）。不收录它，带签章的 spec 会在装载期被
  // 规则 11 拒掉 —— 验收产物落回 templates/specs/ 的全链路就断了。
  // 这里只验**形状**（见下方校验）；hash 是否与文件内容吻合由 spec-loader
  // 对 `custom-*` 入库文件强制对拍（AC-7，P1-b Task 3），基线 spec 不要求。
  'acceptance',
]);

/**
 * 图元白名单 —— **按 type 分组**（S2）。
 *
 * 🔴 为什么分组而不是一个大 Set：S1 踩过「自家白名单拒掉自家新字段」的坑；
 *    分组后新增某类图元字段只改对应一行，且「shape 带 slot/content」这类
 *    跨类型污染会被自然拒掉。
 */
const COMMON_ELEMENT_KEYS = new Set(['type']);
const ELEMENT_KEYS_BY_TYPE: Record<SpecElementType, ReadonlySet<string>> = {
  text: new Set([
    ...COMMON_ELEMENT_KEYS,
    'slot',
    'content',
    'sizePx',
    'weight',
    'align',
    'lineHeight',
    'trackingEm',
    'paddingPx',
    'split',
    'perUnit',
    'holdFrames',
    'maxUnits',
  ]),
  panel: new Set([...COMMON_ELEMENT_KEYS, 'fill', 'border', 'radius', 'shadow']),
  bar: new Set([...COMMON_ELEMENT_KEYS, 'edge', 'thicknessPx', 'insetPx', 'fill']),
  rule: new Set([...COMMON_ELEMENT_KEYS, 'axis', 'at', 'thicknessPx', 'insetPx', 'fill']),
  triangle: new Set([...COMMON_ELEMENT_KEYS, 'dir', 'heightPx', 'at', 'fill']),
};

const TRACK_KEYS = new Set(['element', 'property', 'keys']);
const KEY_KEYS = new Set(['t', 'v', 'ease']);

/** 数值型属性的取值范围。未列出的（x/y）只要求是有限数。 */
const VALUE_BOUNDS: Partial<Record<SpecProperty, readonly [number, number]>> = {
  scale: [0.2, 3],
  rotate: [-15, 15],
  opacity: [0, 1],
  blur: [0, 20],
};

const ID_RE = /^custom\/[a-z0-9]+(?:-[a-z0-9]+)*@\d+\.\d+$/;

// 时间语法在 `spec-time.ts`（校验与渲染共用）；此处 re-export 保持既有调用路径。
export { parseTime, timeToFrame, type ParsedTime } from './spec-time.ts';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 解析 `clip` 的四边值：接受 `"a,b,c,d"` / `"a b c d"` 或单个 number（四边同值）。 */
function parseClipSides(v: unknown): number[] | null {
  if (isFiniteNumber(v)) return [v, v, v, v];
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/[\s,]+/).filter((p) => p !== '');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}

// ─────────────────────────────────────────────────────────────
// 校验
// ─────────────────────────────────────────────────────────────

export interface ValidateSpecOptions {
  /** 文件字节数（由 loader 传入，用于体积上限校验）。 */
  byteSize?: number;
  /** 来源标注（文件名），只用于错误信息。 */
  source?: string;
}

/**
 * 校验一份 MotionSpec（未知输入）。
 *
 * 所有问题**一次列全**后抛一个 `ConfigError` —— 与 `assertDraftItemKeys`
 * 同思路：逐个报错会让人改一轮跑一轮。
 */
export function validateMotionSpec(
  input: unknown,
  opts: ValidateSpecOptions = {},
): MotionSpec {
  const where = opts.source === undefined ? '' : `（${opts.source}）`;
  const issues: string[] = [];

  if (opts.byteSize !== undefined && opts.byteSize > MAX_SPEC_BYTES) {
    issues.push(
      `文件体积 ${opts.byteSize}B > 上限 ${MAX_SPEC_BYTES}B（16KB）—— spec 是声明，不是数据包`,
    );
  }

  if (!isRecord(input)) {
    throw new ConfigError(`MotionSpec 校验失败${where}：顶层必须是对象`);
  }
  const spec = input;

  // 规则 11：未知顶层字段（白名单）
  for (const k of Object.keys(spec)) {
    if (!TOP_LEVEL_KEYS.has(k)) issues.push(`未知顶层字段：\`${k}\``);
  }

  // 规则 1：id
  if (typeof spec['id'] !== 'string' || !ID_RE.test(spec['id'])) {
    issues.push(
      `id 非法：${JSON.stringify(spec['id'])} —— 必须是 custom/<subtype>@<x.y>（subtype 为 kebab-case）`,
    );
  }

  if (spec['specVersion'] !== SPEC_VERSION) {
    issues.push(`specVersion 必须是 ${SPEC_VERSION}（当前 ${JSON.stringify(spec['specVersion'])}）`);
  }

  // 规则 2：必填字段
  if (!isFiniteNumber(spec['layer'])) issues.push('缺少必填字段 layer（数字）');
  if (!isFiniteNumber(spec['minVisibleInFrames']) || (spec['minVisibleInFrames'] as number) <= 0) {
    issues.push('缺少必填字段 minVisibleInFrames（正数）');
  }
  if (typeof spec['occludesSubject'] !== 'boolean') {
    issues.push('缺少必填字段 occludesSubject（布尔，禁止省略/默认 false）');
  }

  // 规则 3：footprint
  const footprint = spec['footprint'];
  if (!Array.isArray(footprint) || footprint.length !== 4) {
    issues.push('缺少必填字段 footprint（四元组 [x,y,w,h]）');
  } else {
    const [x, y, w, h] = footprint as unknown[];
    const nums = [x, y, w, h];
    if (!nums.every(isFiniteNumber)) {
      issues.push('footprint 四个值必须都是数字');
    } else {
      for (const [label, n] of [
        ['x', x as number],
        ['y', y as number],
        ['w', w as number],
        ['h', h as number],
      ] as const) {
        if (n < 0 || n > 1) issues.push(`footprint.${label}=${n} 不在 0–1`);
      }
      if ((w as number) <= 0 || (h as number) <= 0) {
        issues.push(`footprint 的 w/h 必须 > 0（当前 w=${w}, h=${h}）`);
      }
    }
  }

  // 元素
  const elements = spec['elements'];
  if (!Array.isArray(elements)) {
    issues.push('缺少必填字段 elements（数组）');
  } else {
    if (elements.length > 4) issues.push(`elements 数量 ${elements.length} > 上限 4`);

    const token = (value: unknown, tokens: readonly string[], label: string): void => {
      if (value === undefined) return;
      if (typeof value !== 'string' || !tokens.includes(value)) {
        issues.push(`${label} 必须是令牌之一（${tokens.join('/')}），当前 ${JSON.stringify(value)}`);
      }
    };
    const positive = (value: unknown, label: string, max: number): void => {
      if (!isFiniteNumber(value) || value <= 0 || value > max) {
        issues.push(`${label} 必须是 (0, ${max}] 的数字`);
      }
    };

    elements.forEach((el, i) => {
      if (!isRecord(el)) {
        issues.push(`elements[${i}] 必须是对象`);
        return;
      }
      const type = el['type'];
      if (!ELEMENT_TYPES.includes(type as SpecElementType)) {
        issues.push(
          `elements[${i}].type 非法：${JSON.stringify(type)}（允许 ${ELEMENT_TYPES.join('/')}）`,
        );
        return;
      }
      const kind = type as SpecElementType;
      for (const k of Object.keys(el)) {
        if (!ELEMENT_KEYS_BY_TYPE[kind].has(k)) {
          issues.push(`elements[${i}]（${kind}）未知字段：\`${k}\``);
        }
      }

      if (kind === 'text') {
        if (el['slot'] !== 'main' && el['slot'] !== 'sub') {
          issues.push(`elements[${i}].slot 必须是 "main" 或 "sub"`);
        }
        const content = el['content'];
        const contentOk =
          content === 'excerpt' ||
          content === 'number' ||
          (typeof content === 'string' &&
            content.startsWith('literal:') &&
            content.length > 'literal:'.length);
        if (!contentOk) {
          issues.push(
            `elements[${i}].content 必须是 "excerpt" / "number" / "literal:<非空文本>"`,
          );
        }
        if (typeof content === 'string' && content.startsWith('literal:')) {
          // 逐字按码点切分；emoji 会被拆成两半 ⇒ 早失败优于渲出乱码。
          if (/\p{Extended_Pictographic}/u.test(content)) {
            issues.push(
              `elements[${i}].content 含 emoji —— 逐字按码点切会把它拆成两半，请在 spec 里换成文字描述`,
            );
          }
        }
        positive(el['sizePx'], `elements[${i}].sizePx`, 400);
        if (![400, 600, 700, 900].includes(el['weight'] as number)) {
          issues.push(`elements[${i}].weight 必须是 400/600/700/900`);
        }
        if (!['left', 'center', 'right'].includes(el['align'] as string)) {
          issues.push(`elements[${i}].align 必须是 left/center/right`);
        }
        if (!isFiniteNumber(el['paddingPx']) || (el['paddingPx'] as number) < 0) {
          issues.push(`elements[${i}].paddingPx 必须是 ≥0 的数字`);
        }
        if (el['lineHeight'] !== undefined && !isFiniteNumber(el['lineHeight'])) {
          issues.push(`elements[${i}].lineHeight 必须是数字`);
        }
        if (el['trackingEm'] !== undefined && !isFiniteNumber(el['trackingEm'])) {
          issues.push(`elements[${i}].trackingEm 必须是数字`);
        }
        if (el['split'] !== undefined && el['split'] !== 'chars') {
          issues.push(`elements[${i}].split 只支持 "chars"（累计揭示，无第二种语义）`);
        }
        const splitChars = el['split'] === 'chars';
        let perUnitFrames: number | null = null;
        if (el['perUnit'] !== undefined) {
          const frames = parseUnitFrames(el['perUnit']);
          if (!Number.isFinite(frames) || frames < 1 || frames > 6) {
            issues.push(
              `elements[${i}].perUnit 必须是 "Nf" 且 N ∈ [1,6]（当前 ${JSON.stringify(el['perUnit'])}）`,
            );
          } else {
            perUnitFrames = frames;
          }
        } else {
          perUnitFrames = 2; // 默认 "2f"
        }
        let hold = 6; // 默认 6
        if (el['holdFrames'] !== undefined) {
          const h = el['holdFrames'];
          if (!Number.isInteger(h) || (h as number) < 0 || (h as number) > 24) {
            issues.push(`elements[${i}].holdFrames 必须是 0–24 的整数`);
          } else {
            hold = h as number;
          }
        }
        if (splitChars) {
          const maxUnits = el['maxUnits'];
          if (maxUnits === undefined) {
            issues.push(
              `elements[${i}] 使用 split:'chars' 时必须声明 maxUnits（最多吃多少字）—— ` +
                `perUnit 是绝对帧但总长取决于字数，没有上界就会被长句静默截断`,
            );
          } else if (!Number.isInteger(maxUnits) || (maxUnits as number) < 2 || (maxUnits as number) > 40) {
            issues.push(`elements[${i}].maxUnits 必须是 2–40 的整数`);
          } else if (perUnitFrames !== null) {
            // 装载期上界：保证「按声明上限铺满」仍能塞进 minVisibleInFrames。
            const need = ((maxUnits as number) - 1) * perUnitFrames + hold;
            const minVisible = spec['minVisibleInFrames'];
            if (isFiniteNumber(minVisible) && need > minVisible) {
              issues.push(
                `elements[${i}] 逐字总长 ${need} 帧 > minVisibleInFrames=${minVisible} ` +
                  `（(${maxUnits}-1)×${perUnitFrames}+${hold}）—— 长句会把最后几个字截断在中途`,
              );
            }
          }
        } else if (el['maxUnits'] !== undefined) {
          issues.push(`elements[${i}].maxUnits 只在 split:'chars' 时有效`);
        }
        return;
      }

      if (kind === 'panel') {
        token(el['fill'], COLOR_TOKENS, `elements[${i}].fill`);
        token(el['border'], COLOR_TOKENS, `elements[${i}].border`);
        token(el['radius'], RADIUS_TOKENS, `elements[${i}].radius`);
        token(el['shadow'], SHADOW_TOKENS, `elements[${i}].shadow`);
        return;
      }

      if (kind === 'bar') {
        if (!BAR_EDGES.includes(el['edge'] as (typeof BAR_EDGES)[number])) {
          issues.push(`elements[${i}].edge 必须是 ${BAR_EDGES.join('/')}`);
        }
        positive(el['thicknessPx'], `elements[${i}].thicknessPx`, 200);
        if (el['insetPx'] !== undefined) {
          if (!isFiniteNumber(el['insetPx']) || (el['insetPx'] as number) < 0 || (el['insetPx'] as number) > 500) {
            issues.push(`elements[${i}].insetPx 必须是 0–500 的数字`);
          }
        }
        token(el['fill'], COLOR_TOKENS, `elements[${i}].fill`);
        return;
      }

      if (kind === 'rule') {
        if (!RULE_AXES.includes(el['axis'] as (typeof RULE_AXES)[number])) {
          issues.push(`elements[${i}].axis 必须是 ${RULE_AXES.join('/')}`);
        }
        if (!isFiniteNumber(el['at']) || (el['at'] as number) < 0 || (el['at'] as number) > 100) {
          issues.push(`elements[${i}].at 必须是 0–100 的数字`);
        }
        positive(el['thicknessPx'], `elements[${i}].thicknessPx`, 200);
        if (el['insetPx'] !== undefined) {
          if (!isFiniteNumber(el['insetPx']) || (el['insetPx'] as number) < 0 || (el['insetPx'] as number) > 500) {
            issues.push(`elements[${i}].insetPx 必须是 0–500 的数字`);
          }
        }
        token(el['fill'], COLOR_TOKENS, `elements[${i}].fill`);
        return;
      }

      // triangle
      if (!TRIANGLE_DIRS.includes(el['dir'] as (typeof TRIANGLE_DIRS)[number])) {
        issues.push(`elements[${i}].dir 必须是 ${TRIANGLE_DIRS.join('/')}`);
      }
      const h = el['heightPx'];
      if (!Number.isInteger(h) || (h as number) < 4 || (h as number) > 40) {
        issues.push(`elements[${i}].heightPx 必须是 4–40 的整数`);
      }
      if (el['at'] !== undefined) {
        const at = el['at'];
        if (!isRecord(at)) {
          issues.push(`elements[${i}].at 必须是 { x, y }`);
        } else {
          for (const k of Object.keys(at)) {
            if (k !== 'x' && k !== 'y') issues.push(`elements[${i}].at 含未知字段：\`${k}\``);
          }
          if (at['x'] !== undefined && !TRIANGLE_AT_X.includes(at['x'] as (typeof TRIANGLE_AT_X)[number])) {
            issues.push(`elements[${i}].at.x 必须是 ${TRIANGLE_AT_X.join('/')}`);
          }
          if (at['y'] !== undefined && !TRIANGLE_AT_Y.includes(at['y'] as (typeof TRIANGLE_AT_Y)[number])) {
            issues.push(`elements[${i}].at.y 必须是 ${TRIANGLE_AT_Y.join('/')}`);
          }
        }
      }
      token(el['fill'], COLOR_TOKENS, `elements[${i}].fill`);
    });

    // 层序：panel 必须排在所有 text 之前（DOM 后置会盖住文字）。
    const firstText = elements.findIndex((el) => isRecord(el) && el['type'] === 'text');
    if (firstText >= 0) {
      elements.forEach((el, i) => {
        if (isRecord(el) && el['type'] === 'panel' && i > firstText) {
          issues.push(
            `elements[${i}] 是 panel 却排在 text（下标 ${firstText}）之后 —— ` +
              `卡底后置会盖住文字，请把 panel 放在 elements 前面`,
          );
        }
      });
    }
  }

  const elementCount = Array.isArray(elements) ? elements.length : 0;

  // 轨道
  const tracks = spec['tracks'];
  if (!Array.isArray(tracks)) {
    issues.push('缺少必填字段 tracks（数组）');
  } else {
    tracks.forEach((track, ti) => {
      if (!isRecord(track)) {
        issues.push(`tracks[${ti}] 必须是对象`);
        return;
      }
      for (const k of Object.keys(track)) {
        if (!TRACK_KEYS.has(k)) issues.push(`tracks[${ti}] 未知字段：\`${k}\``);
      }

      // 规则 10：element 索引
      const el = track['element'];
      if (!Number.isInteger(el) || (el as number) < 0 || (el as number) >= elementCount) {
        issues.push(
          `tracks[${ti}].element=${JSON.stringify(el)} 越界（elements 共 ${elementCount} 个）`,
        );
      }

      // 规则 5：未知属性
      const property = track['property'];
      const propOk = SPEC_PROPERTIES.includes(property as SpecProperty);
      if (!propOk) {
        issues.push(
          `tracks[${ti}].property 未知：${JSON.stringify(property)}（允许 ${SPEC_PROPERTIES.join('/')}）`,
        );
      }

      const keys = track['keys'];
      if (!Array.isArray(keys)) {
        issues.push(`tracks[${ti}].keys 必须是数组`);
        return;
      }
      // 规则 4：keyframe 数量
      if (keys.length < 2 || keys.length > 8) {
        issues.push(`tracks[${ti}] 的 keys 数量 ${keys.length} 不在 2–8`);
      }

      let lastT: number | null = null;
      let unit: 'number' | 'string' | null = null;

      keys.forEach((key, ki) => {
        const at = `tracks[${ti}].keys[${ki}]`;
        if (!isRecord(key)) {
          issues.push(`${at} 必须是对象`);
          return;
        }
        for (const k of Object.keys(key)) {
          if (!KEY_KEYS.has(k)) issues.push(`${at} 未知字段：\`${k}\``);
        }

        // 规则 7：t 单位与范围 —— 与 perUnit / stagger 共用 parseTime
        const t = key['t'];
        const parsed = parseTime(t);
        if (parsed === null) {
          issues.push(`${at}.t=${JSON.stringify(t)} 非法（number ∈ [0,1] 或 "Nf"）`);
        } else {
          const kind: 'number' | 'string' = parsed.kind === 'ratio' ? 'number' : 'string';
          if (unit !== null && unit !== kind) {
            issues.push(`tracks[${ti}] 的 t 单位混用（number 与 "Nf"）—— 同一轨必须统一`);
          }
          unit = kind;
          if (lastT !== null && parsed.value <= lastT) {
            issues.push(`${at}.t=${JSON.stringify(t)} 未严格递增（上一帧 ${lastT}）`);
          }
          lastT = parsed.value;

          // 绝对帧上界：minVisibleInFrames 是这条 spec 的最短可用时长，
          // 任何更短的 cue 都会被模板门控挡掉 ⇒ 所有绝对帧 ≤ 它，
          // 才能保证「任何被选中的 cue 都能完整播完」，不会停在动画中途。
          const minVisible = spec['minVisibleInFrames'];
          if (parsed.kind === 'frames' && isFiniteNumber(minVisible) && parsed.value > minVisible) {
            issues.push(
              `t="${t}" 超出本 spec 声明的 minVisibleInFrames=${minVisible} —— 短句会把它截断在中途`,
            );
          }
        }

        // 规则 5：ease
        if (key['ease'] !== undefined && !SPEC_EASES.includes(key['ease'] as SpecEase)) {
          issues.push(
            `${at}.ease 未知：${JSON.stringify(key['ease'])}（允许 ${SPEC_EASES.join('/')}）`,
          );
        }

        // 规则 8/9：值的范围与颜色令牌
        const v = key['v'];
        if (property === 'color') {
          if (typeof v !== 'string' || !COLOR_TOKENS.includes(v)) {
            issues.push(
              `${at}.v 必须是颜色令牌之一（${COLOR_TOKENS.join('/')}），当前 ${JSON.stringify(v)}`,
            );
          }
          // 颜色是阶跃，缓动无意义
          if (Object.prototype.hasOwnProperty.call(key, 'ease')) {
            issues.push(`${at}：color 轨禁止出现 ease（颜色是阶跃，没有中间值）`);
          }
          return;
        }

        if (property === 'clip') {
          const sides = parseClipSides(v);
          if (sides === null) {
            issues.push(`${at}.v 必须是四边数字（"a,b,c,d" 或单个 number），当前 ${JSON.stringify(v)}`);
          } else if (sides.some((n) => n < 0 || n > 100)) {
            issues.push(`${at}.v 的四边必须在 0–100（当前 ${sides.join(',')}）`);
          }
          return;
        }

        if (!isFiniteNumber(v)) {
          issues.push(`${at}.v 必须是数字（属性 ${String(property)}）`);
          return;
        }
        const bound = VALUE_BOUNDS[property as SpecProperty];
        if (bound !== undefined && (v < bound[0] || v > bound[1])) {
          issues.push(`${at}.v=${v} 越界（${String(property)} ∈ [${bound[0]}, ${bound[1]}]）`);
        }
      });
    });
  }

  // when.signals（契约的一部分，未知信号会让节奏表的判据无法对应）
  const when = spec['when'];
  if (when !== undefined) {
    if (!isRecord(when) || !Array.isArray(when['signals'])) {
      issues.push('when 必须是 { signals: RhythmSignal[] }');
    } else {
      for (const s of when['signals'] as unknown[]) {
        if (!RHYTHM_SIGNALS.includes(s as RhythmSignal)) {
          issues.push(`when.signals 含未知信号：${JSON.stringify(s)}`);
        }
      }
      // 只允许 signals 一个键
      for (const k of Object.keys(when)) {
        if (k !== 'signals') issues.push(`when 含未知字段：\`${k}\``);
      }
    }
  }

  if (spec['promptRef'] !== undefined && typeof spec['promptRef'] !== 'string') {
    issues.push('promptRef 必须是字符串');
  }

  // stagger（S2）：图元级错峰
  const stagger = spec['stagger'];
  if (stagger !== undefined) {
    if (!isRecord(stagger)) {
      issues.push('stagger 必须是 { perElement: "Nf", order: "index" | "reverse" }');
    } else {
      for (const k of Object.keys(stagger)) {
        if (k !== 'perElement' && k !== 'order') {
          issues.push(`stagger 含未知字段：\`${k}\``);
        }
      }
      const parsed = parseTime(stagger['perElement']);
      if (parsed === null || parsed.kind !== 'frames' || parsed.value < 1) {
        issues.push(
          `stagger.perElement 必须是 "Nf" 且 N ≥ 1（当前 ${JSON.stringify(stagger['perElement'])}）`,
        );
      }
      if (stagger['order'] !== 'index' && stagger['order'] !== 'reverse') {
        issues.push('stagger.order 必须是 "index" 或 "reverse"');
      }
    }
  }

  // `_note` 仅供人读（写作用例、约定），不参与派生；类型仍须是字符串。
  if (spec['_note'] !== undefined && typeof spec['_note'] !== 'string') {
    issues.push('_note 必须是字符串（仅文档用途）');
  }

  // acceptance 签章块（motion:accept 产物）：只验形状，不重算 hash。
  // ⚠️ 与 `_note` 同款纪律：显式收录 ≠ 放开未知字段 —— 块内键同样走白名单。
  const acceptance = spec['acceptance'];
  if (acceptance !== undefined) {
    if (!isRecord(acceptance)) {
      issues.push('acceptance 必须是对象（{ toolVersion, specHash, gates }）');
    } else {
      for (const k of Object.keys(acceptance)) {
        if (k !== 'toolVersion' && k !== 'specHash' && k !== 'gates') {
          issues.push(`acceptance 含未知字段：\`${k}\``);
        }
      }
      if (!isFiniteNumber(acceptance['toolVersion'])) {
        issues.push('acceptance.toolVersion 必须是数字');
      }
      if (
        typeof acceptance['specHash'] !== 'string' ||
        !/^[0-9a-f]{64}$/.test(acceptance['specHash'])
      ) {
        issues.push(
          `acceptance.specHash 必须是 64 位十六进制字符串（sha256），当前 ${JSON.stringify(acceptance['specHash'])}`,
        );
      }
      const gates = acceptance['gates'];
      if (!Array.isArray(gates) || !gates.every((g) => typeof g === 'string')) {
        issues.push('acceptance.gates 必须是字符串数组');
      }
    }
  }

  if (issues.length > 0) {
    throw new ConfigError(
      `MotionSpec 校验失败${where}（共 ${issues.length} 处）：\n` +
        issues.map((s) => `  · ${s}`).join('\n'),
    );
  }

  return input as unknown as MotionSpec;
}

// ─────────────────────────────────────────────────────────────
// 派生模板声明
// ─────────────────────────────────────────────────────────────

/**
 * 由 spec 派生 `TemplateDeclaration` —— 让注册表/校验器/调度无需理解 spec 内部结构。
 *
 * | 声明字段 | 来源 |
 * |---|---|
 * | id / family / subtype / version | 解析 spec.id（family 恒 `custom`） |
 * | scope | 固定 `overlay-safe` |
 * | status | 固定 `custom` |
 * | layer / footprint / minVisibleInFrames / occludesSubject | 直接取 spec |
 * | paramsSchema | 含 `excerpt` / `number` 的图元 ⇒ `{ [slot]: 'string' }` |
 * | requiredParams | 同上（这些槽必须由 params 提供文本） |
 * | textMetrics | `slot==='main'` 的 `{ fontSizePx, paddingPx }`；无 main 则省略 |
 *
 * ⚠️ 刻意**不**自动置 `footprintAnimates`：那是渲染/校验联动（S1b）的事，
 *    且使用 `rotate` 的模板作者应显式声明，避免「自动推断」再次变成无人读的字段。
 */
export function deriveDeclaration(spec: MotionSpec): TemplateDeclaration {
  const { subtype, version } = parseMotionId(spec.id);

  const paramsSchema: Record<string, string> = {};
  const requiredParams: string[] = [];
  const texts = spec.elements.filter((el): el is SpecTextElement => el.type === 'text');
  for (const el of texts) {
    if (el.content === 'excerpt' || el.content === 'number') {
      paramsSchema[el.slot] = 'string';
      if (!requiredParams.includes(el.slot)) requiredParams.push(el.slot);
    }
  }

  // 🔴 textMetrics 只由 **text** 图元贡献：装饰图元的 sizePx/thicknessPx
  //    不是字号，喂给校验项 #17 会得到完全错误的溢出判定。
  const main = texts.find((el) => el.slot === 'main');

  return {
    id: spec.id,
    family: 'custom',
    subtype,
    version,
    scope: 'overlay-safe',
    status: 'custom',
    layer: spec.layer,
    footprint: [...spec.footprint] as Footprint,
    minVisibleInFrames: spec.minVisibleInFrames,
    occludesSubject: spec.occludesSubject,
    paramsSchema,
    ...(requiredParams.length > 0 ? { requiredParams } : {}),
    ...(main === undefined
      ? {}
      : { textMetrics: { fontSizePx: main.sizePx, paddingPx: main.paddingPx } }),
    spec,
  };
}
