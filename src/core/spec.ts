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
import { COLOR } from '../remotion/tokens.ts';
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

/** 文本图元。S1a 只支持 text（几何图元留到后续版本）。 */
export interface SpecElement {
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
}

export interface SpecTrack {
  element: number;
  property: SpecProperty;
  keys: SpecKey[];
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
  /** ≤3 个图元。 */
  elements: SpecElement[];
  /** 每轨 2–8 个关键帧。 */
  tracks: SpecTrack[];
  when?: { signals: RhythmSignal[] };
  promptRef?: string;
  /** 仅文档用途的说明（写作用例、单位约定）。不参与派生，禁止塞实现细节。 */
  _note?: string;
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
  // `_note` 是**显式收录**的文档字段（不参与派生，只给人的说明留位置）。
  // 它不是「放开未知字段」：其它任何键仍按规则 11 拒绝。
  '_note',
]);

const ELEMENT_KEYS = new Set([
  'type',
  'slot',
  'content',
  'sizePx',
  'weight',
  'align',
  'lineHeight',
  'trackingEm',
  'paddingPx',
]);

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
const FRAME_T_RE = /^\d+f$/;

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
    if (elements.length > 3) issues.push(`elements 数量 ${elements.length} > 上限 3`);
    elements.forEach((el, i) => {
      if (!isRecord(el)) {
        issues.push(`elements[${i}] 必须是对象`);
        return;
      }
      for (const k of Object.keys(el)) {
        if (!ELEMENT_KEYS.has(k)) issues.push(`elements[${i}] 未知字段：\`${k}\``);
      }
      if (el['type'] !== 'text') issues.push(`elements[${i}].type 必须是 "text"`);
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
      if (!isFiniteNumber(el['sizePx']) || (el['sizePx'] as number) <= 0) {
        issues.push(`elements[${i}].sizePx 必须是正数`);
      }
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
    });
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

        // 规则 7：t 单位与范围
        const t = key['t'];
        if (typeof t === 'number') {
          if (!Number.isFinite(t) || t < 0 || t > 1) {
            issues.push(`${at}.t=${t} 非法（number 必须在 [0,1]）`);
          } else {
            if (unit === 'string') {
              issues.push(`tracks[${ti}] 的 t 单位混用（number 与 "Nf"）—— 同一轨必须统一`);
            }
            unit = 'number';
            if (lastT !== null && t <= lastT) {
              issues.push(`${at}.t=${t} 未严格递增（上一帧 t=${lastT}）`);
            }
            lastT = t;
          }
        } else if (typeof t === 'string' && FRAME_T_RE.test(t)) {
          const frames = Number.parseInt(t.slice(0, -1), 10);
          if (unit === 'number') {
            issues.push(`tracks[${ti}] 的 t 单位混用（number 与 "Nf"）—— 同一轨必须统一`);
          }
          unit = 'string';
          if (lastT !== null && frames <= lastT) {
            issues.push(`${at}.t="${t}" 未严格递增（上一帧 ${lastT}f）`);
          }
          lastT = frames;

          // 绝对帧上界：minVisibleInFrames 是这条 spec 的最短可用时长，
          // 任何更短的 cue 都会被模板门控挡掉 ⇒ 所有绝对帧 ≤ 它，
          // 才能保证「任何被选中的 cue 都能完整播完」，不会停在动画中途。
          const minVisible = spec['minVisibleInFrames'];
          if (isFiniteNumber(minVisible) && frames > minVisible) {
            issues.push(
              `t="${t}" 超出本 spec 声明的 minVisibleInFrames=${minVisible} —— 短句会把它截断在中途`,
            );
          }
        } else {
          issues.push(`${at}.t=${JSON.stringify(t)} 非法（number ∈ [0,1] 或 "Nf"）`);
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

  // `_note` 仅供人读（写作用例、约定），不参与派生；类型仍须是字符串。
  if (spec['_note'] !== undefined && typeof spec['_note'] !== 'string') {
    issues.push('_note 必须是字符串（仅文档用途）');
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
  for (const el of spec.elements) {
    if (el.content === 'excerpt' || el.content === 'number') {
      paramsSchema[el.slot] = 'string';
      if (!requiredParams.includes(el.slot)) requiredParams.push(el.slot);
    }
  }

  const main = spec.elements.find((el) => el.slot === 'main');

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
