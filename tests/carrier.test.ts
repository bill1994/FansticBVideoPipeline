/**
 * 背景链「分段包裹」机制的纯函数测试。
 *
 * 为什么不直接渲染 `CarrierTrack` 组件：它内部用 Remotion 的 `<Sequence>`，
 * 纯 vitest 环境没有 Remotion 时间轴上下文（与 `Overlay` 同样的理由 ——
 * Overlay 也没有组件级测试）。把切分逻辑抽成纯函数
 * （`splitCarrierSegments`）正是为了让它可测：机制的核心正确性
 * （间隙覆盖 / 边界相接 / 重叠降级）全部落在这里。
 */

import { describe, expect, it } from 'vitest';
import { splitCarrierSegments } from '../src/remotion/carrier.tsx';
import type { StoryboardItem, StoryboardTrack } from '../src/core/types.ts';

function item(fromFrame: number, durationInFrames: number): StoryboardItem {
  return {
    fromFrame,
    durationInFrames,
    motion: 'cinematic/punch-in@1.0',
    footprint: [0, 0, 1, 1],
    params: {},
  };
}

function track(items: StoryboardItem[]): StoryboardTrack {
  return { id: 'bg', layer: 1, items };
}

describe('背景链 · 分段包裹（splitCarrierSegments）', () => {
  it('空 track → 无段', () => {
    expect(splitCarrierSegments(track([]))).toEqual([]);
  });

  it('单 item → 只有一段，from 归零（轨道内相对帧）', () => {
    const segs = splitCarrierSegments(track([item(156, 120)]));
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ from: 0, length: 120, index: 0, overlapped: false });
    expect(segs[0]!.item).not.toBeNull();
  });

  it('两个 item 之间有缝 → 缝变成间隙段（视频必须全程可见）', () => {
    const segs = splitCarrierSegments(track([item(10, 20), item(50, 20)]));
    expect(segs.map((s) => [s.from, s.length, s.item ? s.index : null, s.overlapped])).toEqual([
      [0, 20, 0, false],
      [20, 20, null, false],
      [40, 20, 1, false],
    ]);
  });

  it('首尾相接 → 不产生间隙段', () => {
    const segs = splitCarrierSegments(track([item(10, 20), item(30, 20)]));
    expect(segs.map((s) => [s.from, s.length, s.index])).toEqual([
      [0, 20, 0],
      [20, 20, 1],
    ]);
  });

  it('重叠 → first-wins 降级 + overlapped 标记（未定义语义的确定性兜底）', () => {
    // i0 = [10,40)、i1 = [30,60)：30–40 同时活跃
    const segs = splitCarrierSegments(track([item(10, 30), item(30, 30)]));
    expect(segs.map((s) => [s.from, s.length, s.item ? s.index : null, s.overlapped])).toEqual([
      [0, 20, 0, false],
      [20, 10, 0, true],
      [30, 20, 1, false],
    ]);
  });

  it('段序列无缝覆盖 [trackStart, trackEnd]（这是"视频全程可见"的结构保证）', () => {
    const segs = splitCarrierSegments(track([item(100, 30), item(160, 40), item(180, 50)]));
    let cursor = 0;
    for (const s of segs) {
      expect(s.from, '段之间不得有未覆盖的空档').toBe(cursor);
      cursor += s.length;
    }
    expect(cursor).toBe(130);
  });
});
