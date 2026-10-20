/**
 * 时间语法 —— **校验期与渲染期共用的唯一实现**（S2）。
 *
 * 为什么单独成模块：`spec.ts` 是校验器（依赖 `ConfigError` 等 Node 侧东西），
 * `spec-style.ts` 是渲染器；让渲染器 import 校验器是**错向依赖**。
 * 把 `"Nf"` / 0–1 比例的解析抽到这里（纯函数、零依赖），两边各自 import：
 * 一处真源、零循环、也不会出现两套时间语法。
 *
 * 支持的形式：
 *   · `number ∈ [0,1]` —— item 时长比例（只有 `key.t` 允许）
 *   · `"Nf"`          —— item 内绝对帧（`key.t` / `perUnit` / `stagger.perElement`）
 */

/** 绝对帧字面量：`"8f"` / `"0f"`。 */
export const FRAME_T_RE = /^\d+f$/;

/** 解析后的时间单位。 */
export interface ParsedTime {
  /** `ratio` = 0–1 比例；`frames` = 绝对帧。 */
  kind: 'ratio' | 'frames';
  value: number;
}

/** 时间 → item 内绝对帧。解析失败回退 0（调用方应先校验）。 */
export function timeToFrame(t: number | string, durationInFrames: number): number {
  const parsed = parseTime(t);
  if (parsed === null) return 0;
  return parsed.kind === 'ratio'
    ? parsed.value * Math.max(0, durationInFrames)
    : parsed.value;
}

/** 是否是合法时间字面量。 */
export function isValidTime(t: unknown): boolean {
  return parseTime(t) !== null;
}

/**
 * 解析 `"Nf"` → 帧数；非帧字面量返回 `NaN`（供 `perUnit` 这类**只接受绝对帧**的字段）。
 */
export function parseUnitFrames(t: unknown): number {
  if (typeof t !== 'string' || !FRAME_T_RE.test(t)) return Number.NaN;
  return Number.parseInt(t.slice(0, -1), 10);
}

/**
 * 时间语法的唯一解析入口。
 *
 * @returns 解析失败返回 `null`（调用方决定报错或降级）
 */
export function parseTime(t: unknown): ParsedTime | null {
  if (typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 1) {
    return { kind: 'ratio', value: t };
  }
  if (typeof t === 'string' && FRAME_T_RE.test(t)) {
    return { kind: 'frames', value: Number.parseInt(t.slice(0, -1), 10) };
  }
  return null;
}
