/**
 * 背景链（载体类）的**分段包裹**渲染。
 *
 * ── 为什么载体类需要一套独立机制 ─────────────────────────────
 * 叠加类模板画自己的东西，与视频**并列**即可（现状：一个 `<Sequence>`
 * 包住 items，items 之间空档就是"什么都没渲染"）。
 *
 * 载体类（`subject-transform` / `footage-transform`）不同：它们**改变实拍
 * 视频的呈现**（C6 双栈的语义分界），实现上必须**包裹视频**（children 透传）。
 * 而视频必须**全程可见** —— 若像叠加类那样只在 item 区间渲染 children，
 * 区间外视频会消失。因此把 `[trackStart, trackEnd]` 切成两类段：
 *
 *   · item 段（有 item 活跃）→ `<Sequence>` 包 `MotionItem`（组件包裹 children）
 *   · 间隙段（无 item 活跃）→ `<Sequence>` 直接透传 children（无变换）
 *
 * 任一时刻恰好渲染**一份** children，恰好应用**零或一层**变换。
 *
 * ── 为什么不做成"轨道级组件读时钟" ─────────────────────────────
 * E2 红线：整个渲染树**只有 `MotionItem` 一处**读 `useCurrentFrame()`。
 * 分段切分是**纯数据计算**（只依赖 track 的时间区间，不依赖当前帧），
 * 因此本机制不需要第二个时钟读取点 —— 帧的推进权仍只在 MotionItem 一处。
 *
 * ── 已知边界：同 track 内载体 item 重叠 ───────────────────────
 * 🔴 **重叠语义未在文档中定义**（`track 内 item 允许重叠但必须同 scope`
 * 是通用时间轴规则，未给载体类的重叠语义）。
 * 本实现取 **first-wins（先开始者接管该段）** 的确定性降级，
 * 并在段数据上标 `overlapped: true` 供审计。
 * ⚠️ 若真实素材出现载体重叠需求，**应先立裁决再改此处**。
 * （不选"嵌套串联"：同一 MotionItem 体系下无法为嵌套层各取正确的相对帧，
 * 强行做需要第二个时钟读取点，触 E2 红线。）
 */

import type { FC, ReactNode } from 'react';
import { Sequence } from 'remotion';
import type { StoryboardItem, StoryboardTrack } from '../core/types.ts';
import type { CaptionData } from './caption.ts';
import { MotionItem } from './MotionItem.tsx';

/** 背景链上的一个时间段：item 段或无 item 的间隙段。 */
export interface CarrierSegment {
  /** 轨道内**相对**帧（相对 `min(fromFrame)`，与 `TrackSequence` 的外层一致）。 */
  from: number;
  length: number;
  /** `null` = 间隙（无 item 活跃）。 */
  item: StoryboardItem | null;
  /** item 在原 `track.items` 中的下标（间隙为 `-1`）。 */
  index: number;
  /** 该段有多个 item 同时活跃（未定义语义的降级，见文件头）。 */
  overlapped: boolean;
}

/**
 * 把一条载体 track 切成"item 段 / 间隙段"的完整序列（纯函数，可单测）。
 *
 * 切点 = 所有 item 的起止帧（`trackStart` / `trackEnd` 必然在内）。
 * 每段的归属：活跃 item 为空 → 间隙；否则取**最先开始者**（first-wins）。
 */
export function splitCarrierSegments(track: StoryboardTrack): CarrierSegment[] {
  const items = track.items;
  if (items.length === 0) return [];

  const start = Math.min(...items.map((i) => i.fromFrame));
  const end = Math.max(...items.map((i) => i.fromFrame + i.durationInFrames));

  const bounds = new Set<number>([start, end]);
  for (const it of items) {
    bounds.add(it.fromFrame);
    bounds.add(it.fromFrame + it.durationInFrames);
  }
  const points = [...bounds].filter((p) => p >= start && p <= end).sort((a, b) => a - b);

  const segments: CarrierSegment[] = [];
  for (let k = 0; k < points.length - 1; k += 1) {
    const a = points[k]!;
    const b = points[k + 1]!;
    if (b <= a) continue;

    const active = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => it.fromFrame <= a && a < it.fromFrame + it.durationInFrames);

    if (active.length === 0) {
      segments.push({ from: a - start, length: b - a, item: null, index: -1, overlapped: false });
      continue;
    }
    // first-wins：开始最早的接管该段（并列取声明靠前者）。
    let first = active[0]!;
    for (const cur of active) {
      if (cur.it.fromFrame < first.it.fromFrame) first = cur;
    }
    segments.push({
      from: a - start,
      length: b - a,
      item: first.it,
      index: first.idx,
      overlapped: active.length > 1,
    });
  }
  return segments;
}

/**
 * 一条载体 track 的渲染：外层 `<Sequence>` 把绝对帧转成轨道内相对帧
 * （与叠加侧的 `TrackSequence` 同构），内层按段渲染。
 */
export const CarrierTrack: FC<{
  track: StoryboardTrack;
  caption: CaptionData;
  children: ReactNode;
}> = ({ track, caption, children }) => {
  if (track.items.length === 0) return null;
  const start = Math.min(...track.items.map((i) => i.fromFrame));
  const end = Math.max(...track.items.map((i) => i.fromFrame + i.durationInFrames));
  const segments = splitCarrierSegments(track);

  return (
    <Sequence from={start} durationInFrames={end - start}>
      {segments.map((seg) =>
        seg.item ? (
          <Sequence key={`${seg.from}-${seg.index}`} from={seg.from} durationInFrames={seg.length}>
            <MotionItem
              trackId={track.id}
              itemIndex={seg.index}
              item={seg.item}
              caption={caption}
            >
              {children}
            </MotionItem>
          </Sequence>
        ) : (
          <Sequence key={`${seg.from}-gap`} from={seg.from} durationInFrames={seg.length}>
            {/* 间隙：无变换，原样透传（视频必须全程可见）。 */}
            {children}
          </Sequence>
        ),
      )}
    </Sequence>
  );
};
