/**
 * MotionSpec 的时间轴求值与 CSS 合成（纯函数，S1b）。
 *
 * 从 `SpecRenderer.tsx` 抽出：渲染器只负责「组装 DOM」，求值逻辑单独可测 ——
 * 也让渲染器本体保持在可读长度内（≤190 行）。
 */

import type { CSSProperties } from 'react';
import type { MotionSpec, SpecTrack } from '../../core/spec.ts';
import { SPEC_EASE } from '../tokens.ts';

/** key 的 `t` → item 内绝对帧。number 按比例，`"Nf"` 直接取 N。 */
export function keyFrameOf(t: number | string, durationInFrames: number): number {
  if (typeof t === 'number') return t * Math.max(0, durationInFrames);
  const n = Number.parseInt(t.slice(0, -1), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 单轨求值。
 *
 * · 数值轨：相邻 key 线性插值；缓动取**后一个** key 的 `ease`（「到达该帧」的段）
 * · `color` 轨：**阶跃**，取最后一个 `t ≤ frame` 的值（颜色没有中间值）
 * · 早于首帧取首值、晚于末帧取末值
 */
export function resolveTrack(
  track: SpecTrack,
  frame: number,
  durationInFrames: number,
): number | string {
  const keys = track.keys.map((k) => ({
    f: keyFrameOf(k.t, durationInFrames),
    v: k.v,
    ease: k.ease,
  }));
  if (keys.length === 0) return 0;

  const first = keys[0] as (typeof keys)[number];
  const last = keys[keys.length - 1] as (typeof keys)[number];

  if (track.property === 'color') {
    let value = first.v;
    for (const k of keys) {
      if (k.f <= frame) value = k.v;
    }
    return value;
  }

  if (frame <= first.f) return first.v;
  if (frame >= last.f) return last.v;

  for (let i = 0; i + 1 < keys.length; i += 1) {
    const a = keys[i] as (typeof keys)[number];
    const b = keys[i + 1] as (typeof keys)[number];
    if (frame < a.f || frame > b.f) continue;

    const span = b.f - a.f;
    const p = span <= 0 ? 1 : (frame - a.f) / span;
    const easeName = b.ease ?? 'out';
    const eased = SPEC_EASE[easeName](Math.min(1, Math.max(0, p)));

    // `clip` 是**四边分别插值**，不能走数值插值（`Number("0,0,100,0")` = NaN
    // ⇒ clipInset 解析不出 4 边 ⇒ 兜底 inset(0%) ⇒ 静默无裁切）。
    // 也不能做阶跃：阶跃会让揭幕瞬间跳变，没有动画。
    if (track.property === 'clip') {
      const s0 = parseClipSides(a.v);
      const s1 = parseClipSides(b.v);
      if (s0 === null || s1 === null) return a.v; // 校验期已拦；防御性阶跃
      const out = s0.map((n, idx) => {
        const target = s1[idx] as number;
        return n + (target - n) * eased;
      });
      return out.join(',');
    }

    const v0 = typeof a.v === 'number' ? a.v : Number(a.v);
    const v1 = typeof b.v === 'number' ? b.v : Number(b.v);
    return v0 + (v1 - v0) * eased;
  }
  return last.v;
}

/**
 * 解析 `clip` 的四边值：`"t,r,b,l"`（逗号/空格分隔）或单个 number（四边同值）。
 *
 * 与 `clipInset()` 共用 —— 求值期（插值）与渲染期（CSS 字符串）必须是同一套解析，
 * 否则会出现「插值出 4 个数、渲染时又解析成 1 个」的分裂。
 */
export function parseClipSides(value: number | string): [number, number, number, number] | null {
  const parts =
    typeof value === 'number'
      ? [value, value, value, value]
      : String(value)
          .trim()
          .split(/[\s,]+/)
          .map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts as [number, number, number, number];
}

/** `clip` 值 → CSS `inset(...)`。字符串 `"10,0,10,0"`（或空格分隔）或单个 number。 */
export function clipInset(value: number | string): string {
  const sides = parseClipSides(value);
  if (sides === null) return 'inset(0% 0% 0% 0%)';
  const [top, right, bottom, left] = sides;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

/**
 * 把某个图元的轨道合成成 CSS。
 *
 * 🔴 **按 `track.element` 过滤**：spec 允许 ≤3 个图元，每条轨只作用于自己的图元。
 *    若把所有轨合成到容器上，`element` 字段就成了「校验了却没人读」的字段
 *    —— 那正是本项目记录过多次的病灶（声明了 / 定义了，但没人用）。
 */
export function specStyleOf(
  spec: MotionSpec,
  elementIndex: number,
  frame: number,
  durationInFrames: number,
): CSSProperties {
  const values = new Map<string, number | string>();
  for (const track of spec.tracks) {
    if (track.element !== elementIndex) continue;
    values.set(track.property, resolveTrack(track, frame, durationInFrames));
  }

  const style: CSSProperties = {};
  const num = (key: string): number | null => {
    const v = values.get(key);
    return typeof v === 'number' ? v : null;
  };

  const x = num('x');
  const y = num('y');
  const parts: string[] = [];
  if (x !== null || y !== null) parts.push(`translate(${x ?? 0}%, ${y ?? 0}%)`);
  const scale = num('scale');
  if (scale !== null) parts.push(`scale(${scale})`);
  const rotate = num('rotate');
  if (rotate !== null) parts.push(`rotate(${rotate}deg)`);
  if (parts.length > 0) style.transform = parts.join(' ');

  const opacity = num('opacity');
  if (opacity !== null) style.opacity = Math.min(1, Math.max(0, opacity));

  const blur = num('blur');
  if (blur !== null) style.filter = `blur(${blur}px)`;

  const clip = values.get('clip');
  if (clip !== undefined) style.clipPath = clipInset(clip);

  return style;
}
