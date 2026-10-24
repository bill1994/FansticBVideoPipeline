/**
 * `transition/whip-pan@1.0` —— 全屏甩镜头转场。
 *
 * ── 它是 fullscreen 叠加层，不是载体类 ───────────────────────────
 * `scope: fullscreen` 只表示「必然覆盖全画面」；本组件**不改视频本身**，
 * 也不接收 children —— 与 `cinematic/punch-in` 的载体语义严格分开（C6 双栈）。
 * 转场期间 `layer: 100` 高于字幕（90），字幕会让位，这正是首批清单的要求。
 *
 * ── 视觉：方向性速度线 + 轻微压暗，不做「整屏模糊」──────────────
 * 甩镜头在实拍里表现为**方向性拖影**，而不是均匀模糊。此处用一组
 * 固定参数的亮色速度线沿 `direction` 扫过，配一层很轻的暗底：
 * · 线宽 / 长度 / 相位是**常量表**，不读随机数（E2 红线）；
 * · 每帧位置只由 `frame / duration` 决定，同一帧重复渲染必然一致；
 * · 两端强度归零（`sin(π·u)`），进出场不出现「突然出现一条线」。
 *
 * ── 为什么不用 `enterExitProgress` ──────────────────────────────
 * 它是「快进 → 停 → 快出」的叠加物节奏；转场是一次性扫过，
 * 全程都在运动，用三角波才能让首尾都平滑落到 0。
 *
 * 参数：`direction`（`left` / `right` / `up` / `down`，缺省 `left`）。
 * ⚠️ 未知值静默回退 `left`，与 `kinetic-line` 的 `enter` 同约定：
 *    校验项 #16 只验类型，渲染期不能因一个拼错的枚举值毁掉整条渲染。
 *
 * ⚠️ 本模板会触发 D3-a：`occludesSubject: true` ⇒ render 启动闸要求
 *    `06-review/confirmed.json` 里的 `acknowledgedFullscreen` 覆盖它。
 *    本组件不参与该判定，那件事在 `stages/render.ts#renderGate`。
 */

import { COLOR, clamp01 } from '../tokens.ts';
import { str, type TemplateComponent } from './contract.tsx';

const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
type Direction = (typeof DIRECTIONS)[number];

/**
 * 速度线常量表。
 *
 * `lane` 是垂直于运动方向的位置（0–1）；`len` 是长度（画面百分比）；
 * `phase` / `speed` 只用来错开相位，避免所有线同时穿过同一点。
 */
const STREAKS = [
  { lane: 0.12, len: 38, thickness: 4, phase: 0.05, speed: 0.9, alpha: 0.42 },
  { lane: 0.24, len: 22, thickness: 2, phase: 0.38, speed: 1.3, alpha: 0.3 },
  { lane: 0.37, len: 55, thickness: 6, phase: 0.72, speed: 0.7, alpha: 0.2 },
  { lane: 0.48, len: 30, thickness: 4, phase: 0.18, speed: 1.1, alpha: 0.5 },
  { lane: 0.61, len: 46, thickness: 2, phase: 0.55, speed: 1.5, alpha: 0.34 },
  { lane: 0.74, len: 26, thickness: 4, phase: 0.85, speed: 0.8, alpha: 0.4 },
  { lane: 0.86, len: 60, thickness: 6, phase: 0.28, speed: 1.2, alpha: 0.18 },
] as const;

/** 归一化进度 0–1（最后一帧恰为 1；单帧时退化为 0）。 */
export function whipPanProgress(frame: number, durationInFrames: number): number {
  const d = Math.max(1, durationInFrames);
  return d === 1 ? 0 : clamp01(frame / (d - 1));
}

/** 强度包络：两端为 0，中段为 1（三角波）。 */
export function whipPanIntensity(frame: number, durationInFrames: number): number {
  return Math.sin(Math.PI * whipPanProgress(frame, durationInFrames));
}

/** 解析方向；未知值回退 `left`（见文件头）。 */
export function resolveDirection(v: string): Direction {
  return (DIRECTIONS as readonly string[]).includes(v) ? (v as Direction) : 'left';
}

export const WhipPan: TemplateComponent = ({ frame, durationInFrames, item }) => {
  const direction = resolveDirection(str(item.params, 'direction'));
  const progress = whipPanProgress(frame, durationInFrames);
  const intensity = whipPanIntensity(frame, durationInFrames);

  const horizontal = direction === 'left' || direction === 'right';
  // right / down 是「正向」；left / up 把相位反过来，线朝反方向扫。
  const forward = direction === 'right' || direction === 'down';

  return (
    <div
      data-template="whip-pan"
      data-direction={direction}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        opacity: intensity,
        pointerEvents: 'none',
        // 轻微模糊让线条读成「拖影」而不是「贴纸」；不做动画，开销恒定。
        filter: 'blur(0.8px)',
      }}
    >
      {/* 很轻的暗底：只压一层，不遮住主体（fullscreen 但 occludesSubject 的语义是画面被转场覆盖） */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: COLOR.plate,
          opacity: 0.18,
        }}
      />

      {STREAKS.map((s, i) => {
        // 位置随进度从画面外扫到画面外；相位错开，避免同时穿过同一位置。
        const tRaw = (progress * s.speed + s.phase) % 1;
        const t = forward ? tRaw : 1 - tRaw;
        const travel = 100 + s.len * 2;
        const pos = -s.len + t * travel;
        const common = {
          position: 'absolute' as const,
          background: COLOR.ink,
          opacity: s.alpha,
          borderRadius: 999,
        };
        return horizontal ? (
          <span
            key={i}
            data-streak={i}
            style={{
              ...common,
              top: `${s.lane * 100}%`,
              left: `${pos}%`,
              width: `${s.len}%`,
              height: s.thickness,
            }}
          />
        ) : (
          <span
            key={i}
            data-streak={i}
            style={{
              ...common,
              left: `${s.lane * 100}%`,
              top: `${pos}%`,
              height: `${s.len}%`,
              width: s.thickness,
            }}
          />
        );
      })}
    </div>
  );
};
