/**
 * 样式包 / 设计令牌（EAC P1-4，2026-10-27）。
 *
 * 解决的问题：`tokens.ts` 的 `COLOR` 只有一套（深底浅字），视觉风格单一。
 * 但「**禁止模型写颜色**」这条是对的，不能为了换肤就放开 hex。
 *
 * ── 机制怎么跑 ─────────────────────────────────────────────
 * ① `styles/packs/<name>.json` 是**色值的唯一来源**（这里是唯一允许写 hex 的地方）；
 * ② job 在 `00-input/source.json` 里写 `stylePack: '<name>'`（缺省 `dark`）；
 * ③ `render` 组装 props 时解析成 `stylePack` 对象写进 `render-props.json`；
 * ④ 模板从 `props.style.colors.brand` 取语义键 —— **它仍然不知道 hex 是什么**。
 *
 * 🔴 与「模型只填表」的关系（P1-a 澄清后的正确理解）：
 *    模型只说「这个 job 用哪套包」（一个枚举名），**不说具体色值**。
 *    决策权留在 pack 文件里，`paramsSchema` 依旧不收颜色类参数 —— 两条纪律同时成立。
 *
 * ── 为什么 pack 内容自建，不直接导外部 ─────────────────────
 * EAC 原文建议从 OpenDesign 的 152 套里精选 6–10 套（MIT）。核对后**先不这么做**：
 * 那 152 套是否**每一条**都 MIT 未经逐条核实（原文写的是「精选……（MIT 条目）」，
 * 是筛选条件而非全集属性），且外部设计体系的 layout / 主题 token 在 SPEC §5.5 里
 * 已被明确列为「不采纳」的一类。
 * ⇒ 先自建 2 套把**机制**跑通（零许可风险），外部导入留作独立决策。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ConfigError } from './exit-code.ts';

/** 一套配色 —— 与 `tokens.ts` 的 `Tone` 同构（6 个语义键）。 */
export interface PackColors {
  ink: string;
  inkDim: string;
  brand: string;
  accent: string;
  plate: string;
  hairline: string;
}

export interface PackFonts {
  sans: string;
  numeric: string;
}

/** 样式包契约。字段与 `tokens.ts` 的令牌族一一对应。 */
export interface StylePack {
  name: string;
  /**
   * 底色极性 —— 模板据此决定描边/辉光的走向（亮底要深色扩散，暗底要浅色）。
   *
   * 🔴 为什么不「猜 ink 的明暗」：把 `#F0F0F0` 和 `#FFF8EE` 谁算亮底没有客观阈值，
   *    显式声明比启发式可靠。缺省 `dark`（与改造前一致）。
   */
  mode?: 'dark' | 'light';
  /** 人类可读说明（进 gallery / 报告的备注）。 */
  description?: string;
  colors: PackColors;
  fonts: PackFonts;
  /** 圆角标尺（缺省沿用 tokens 的值）。 */
  radius?: { sm: string; md: string; lg: string };
  /** 阴影标尺（缺省沿用 tokens 的值）。 */
  shadow?: { text: string; textOnLight?: string; card: string };
}

/** 缺省包名 —— 与改造前的行为完全等价（`COLOR` 那套深底浅字）。 */
export const DEFAULT_PACK = 'dark';

/** pack 目录（仓库根 `styles/packs`）。 */
export function packDir(): string {
  return path.resolve(import.meta.dirname, '../../styles/packs');
}

/** 列出可用 pack 名（排好序，便于报错时提示）。 */
export function listPackNames(dir: string = packDir()): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * 加载并校验一个样式包。
 *
 * 🔴 未知包名**直接抛 ConfigError**，不静默回退到 dark —— 回退会让「包名打错」
 * 变成「配色莫名不对」，而后者极难排查（同「定义了≠生效」那类教训）。
 */
export function loadStylePack(name: string, dir: string = packDir()): StylePack {
  const available = listPackNames(dir);
  if (!available.includes(name)) {
    throw new ConfigError(
      `未知样式包：${JSON.stringify(name)}。可用：${available.length > 0 ? available.join(' / ') : '（styles/packs 为空）'}\n` +
        `  · 由 00-input/source.json 的 stylePack 指定，缺省 "${DEFAULT_PACK}"`,
    );
  }
  const file = path.join(dir, `${name}.json`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ConfigError(`读取样式包失败（styles/packs/${name}.json）：${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`样式包 JSON 解析失败（${name}.json）：${(e as Error).message}`);
  }
  return assertStylePack(parsed, name);
}

const COLOR_KEYS: readonly (keyof PackColors)[] = [
  'ink',
  'inkDim',
  'brand',
  'accent',
  'plate',
  'hairline',
];

/** 结构校验：六个色键必须齐全且为非空字符串。 */
function assertStylePack(value: unknown, name: string): StylePack {
  if (typeof value !== 'object' || value === null) {
    throw new ConfigError(`样式包 ${name} 必须是对象`);
  }
  const v = value as Record<string, unknown>;
  const colors = v['colors'];
  if (typeof colors !== 'object' || colors === null) {
    throw new ConfigError(`样式包 ${name} 缺少 colors 对象`);
  }
  const c = colors as Record<string, unknown>;
  for (const k of COLOR_KEYS) {
    if (typeof c[k] !== 'string' || c[k] === '') {
      throw new ConfigError(`样式包 ${name} 的 colors.${k} 缺失或不是非空字符串`);
    }
  }
  const fonts = v['fonts'];
  if (typeof fonts !== 'object' || fonts === null) {
    throw new ConfigError(`样式包 ${name} 缺少 fonts 对象`);
  }
  const f = fonts as Record<string, unknown>;
  for (const k of ['sans', 'numeric'] as const) {
    if (typeof f[k] !== 'string' || f[k] === '') {
      throw new ConfigError(`样式包 ${name} 的 fonts.${k} 缺失或不是非空字符串`);
    }
  }
  const mode = v['mode'];
  if (mode !== undefined && mode !== 'dark' && mode !== 'light') {
    throw new ConfigError(`样式包 ${name} 的 mode 只能是 "dark" 或 "light"，收到 ${JSON.stringify(mode)}`);
  }
  return {
    name,
    ...(mode === 'dark' || mode === 'light' ? { mode } : {}),
    ...(typeof v['description'] === 'string' ? { description: v['description'] } : {}),
    colors: Object.fromEntries(COLOR_KEYS.map((k) => [k, c[k] as string])) as unknown as PackColors,
    fonts: { sans: f['sans'] as string, numeric: f['numeric'] as string },
    ...(typeof v['radius'] === 'object' && v['radius'] !== null
      ? { radius: v['radius'] as StylePack['radius'] }
      : {}),
    ...(typeof v['shadow'] === 'object' && v['shadow'] !== null
      ? { shadow: v['shadow'] as StylePack['shadow'] }
      : {}),
  } as StylePack;
}

/**
 * 从 `source.json` 解析包名。
 *
 * 只认 `stylePack` 字段（缺失 / 非字符串 ⇒ 缺省 `dark`）。
 * ⚠️ **不**读 `motionboard.meta.stylePack`：meta 的字段集在 SPEC 里是锁定的 5 个，
 * 加字段要改契约；且「一个 job 一套配色」是当前需要的粒度，per-item 覆盖留待真有需求时再加。
 */
export function resolveStylePackName(source: { stylePack?: unknown } | null | undefined): string {
  const v = source?.['stylePack'];
  return typeof v === 'string' && v !== '' ? v : DEFAULT_PACK;
}
