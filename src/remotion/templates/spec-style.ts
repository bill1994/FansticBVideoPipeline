/**
 * MotionSpec 的时间轴求值与 CSS 合成（纯函数，S1b）。
 *
 * 从 `SpecRenderer.tsx` 抽出：渲染器只负责「组装 DOM」，求值逻辑单独可测 ——
 * 也让渲染器本体保持在可读长度内（≤190 行）。
 */

import type { CSSProperties } from 'react';
import type { MotionSpec, SpecTextElement, SpecTrack } from '../../core/spec.ts';
import { timeToFrame } from '../../core/spec-time.ts';
import { SPEC_EASE } from '../tokens.ts';

/**
 * key 的 `t` → item 内绝对帧。
 *
 * ⚠️ 与校验期共用 `core/spec-time.ts` 的 `timeToFrame` —— 禁止第二套时间语法；
 *    这里**不 import 校验器** `spec.ts`（那会让渲染器依赖 Node 侧校验代码）。
 */
export function keyFrameOf(t: number | string, durationInFrames: number): number {
  return timeToFrame(t, durationInFrames);
}

/**
 * 图元级错峰偏移（帧）。
 *
 * `order: 'reverse'` 时反序：最后一个图元先动。
 */
export function elementOffsetOf(
  spec: MotionSpec,
  elementIndex: number,
  durationInFrames: number,
): number {
  const stagger = spec.stagger;
  if (!stagger) return 0;
  const per = timeToFrame(stagger.perElement, durationInFrames);
  const j =
    stagger.order === 'reverse' ? spec.elements.length - 1 - elementIndex : elementIndex;
  return j * per;
}

/**
 * 渲染期自适应的每字间隔（帧）。
 *
 * `perUnit_eff = min(perUnit, max(1, (duration - holdFrames) / (n - 1)))`
 * —— 保证最后几个字能在 item 结束前显示完，而不是被截掉。
 */
export function effectivePerUnit(
  element: Pick<SpecTextElement, 'perUnit' | 'holdFrames'>,
  charCount: number,
  durationInFrames: number,
): number {
  const base = timeToFrame(element.perUnit ?? '2f', durationInFrames);
  const hold = element.holdFrames ?? 6;
  if (charCount <= 1) return base;
  return Math.min(base, Math.max(1, (durationInFrames - hold) / (charCount - 1)));
}

/**
 * 把文本切成**不可再分的显示单元**。
 *
 * 普通字符按码点切；emoji（含 ZWJ 组合序列）整体算一个单元 ——
 * `params` 的文本来自 SRT（文本权威），不能因为一个 emoji 就让整条 job 失败，
 * 所以运行时**不拒绝、只分组**，避免把 emoji 拆成两个半截码点。
 */
const UNIT_RE = /(\p{Extended_Pictographic}(?:\u200D\p{Extended_Pictographic})*)|./gsu;

export function splitUnits(text: string): string[] {
  return text.match(UNIT_RE) ?? [];
}

/**
 * 累计揭示下当前可见的字符数。
 *
 * 第 i 个字在 `elementOffset + i × perUnit_eff` 帧出现，**出现后保持**
 * （不是逐字独立淡入淡出 —— 后者会让「的/了」单独闪一下）。
 * 返回 0..n。
 */
export function visibleCharCount(
  element: Pick<SpecTextElement, 'perUnit' | 'holdFrames' | 'split'>,
  text: string,
  frame: number,
  elementOffset: number,
  durationInFrames: number,
): number {
  const chars = splitUnits(text);
  if (element.split !== 'chars' || chars.length === 0) return chars.length;
  const unit = effectivePerUnit(element, chars.length, durationInFrames);
  let count = 0;
  for (let i = 0; i < chars.length; i += 1) {
    if (elementOffset + i * unit <= frame) count += 1;
    else break;
  }
  return count;
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

/** 图元本地帧（减去 stagger 偏移，钳到 ≥0）。 */
export function elementLocalFrame(
  spec: MotionSpec,
  elementIndex: number,
  frame: number,
  durationInFrames: number,
): number {
  return Math.max(0, frame - elementOffsetOf(spec, elementIndex, durationInFrames));
}

/**
 * 把某个图元的轨道合成成 CSS。
 *
 * 🔴 **按 `track.element` 过滤**：spec 允许 ≤3 个图元，每条轨只作用于自己的图元。
 *    若把所有轨合成到容器上，`element` 字段就成了「校验了却没人读」的字段
 *    —— 那正是本项目记录过多次的病灶（声明了 / 定义了，但没人用）。
 * 🔴 轨道求值用**图元本地帧**（已减去 `stagger` 偏移）。
 */
export function specStyleOf(
  spec: MotionSpec,
  elementIndex: number,
  frame: number,
  durationInFrames: number,
): CSSProperties {
  const local = elementLocalFrame(spec, elementIndex, frame, durationInFrames);
  const values = new Map<string, number | string>();
  for (const track of spec.tracks) {
    if (track.element !== elementIndex) continue;
    values.set(track.property, resolveTrack(track, local, durationInFrames));
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
