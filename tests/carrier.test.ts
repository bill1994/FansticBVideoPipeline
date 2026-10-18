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
import {
  carrierRenderSegments,
  composeCarrierTimeline,
  carrierWindowLayout,
  splitCarrierSegments,
} from '../src/remotion/carrier.tsx';
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

// ─────────────────────────────────────────────────────────────
// 载体轨的窗口前后透传（2026-10-18 真素材首跑回归）
//
// 事故：原实现只渲染 `[trackStart, trackEnd)`，窗口外 children（视频）
// **整段不挂载** ⇒ 成片纯黑。像素实测 0,0,0；时长 6517 帧。
// 这里断言「三段拼起来无缝覆盖整条时间轴」—— 画面是否正确仍要靠抽帧，
// 但至少「窗口外有没有渲染东西」这件事从此可被单测拦住。
// ─────────────────────────────────────────────────────────────
describe('carrierWindowLayout（窗口前/中/后三段必须覆盖整条时间轴）', () => {
  it('载体窗在中间 → 前后各补一段，总长等于 composition', () => {
    const track = { id: 'bg', layer: 1, items: [item(2800, 150)] };
    const L = carrierWindowLayout(track, 6667);
    expect(L).toEqual({ start: 2800, end: 2950, head: 2800, tail: 6667 - 2950, total: 6667 });
    // 三段之和 = 整条时间轴（这是「视频全程可见」的可断言形式）
    expect(L.head + (L.end - L.start) + L.tail).toBe(6667);
  });

  it('载体窗正好从头开始 → head=0，不许出现负长度', () => {
    const L = carrierWindowLayout({ id: 'bg', layer: 1, items: [item(0, 120)] }, 900);
    expect(L.head).toBe(0);
    expect(L.tail).toBe(780);
  });

  it('载体窗延伸到片尾 → tail=0', () => {
    const L = carrierWindowLayout({ id: 'bg', layer: 1, items: [item(800, 100)] }, 900);
    expect(L.tail).toBe(0);
  });

  it('缺省 durationInFrames → 退化为旧行为（tail=0，不凭空多渲染）', () => {
    const L = carrierWindowLayout({ id: 'bg', layer: 1, items: [item(2800, 150)] });
    expect(L.total).toBe(2950);
    expect(L.tail).toBe(0);
  });

  it('composition 比载体窗还短 → 三段总和不超出 composition', () => {
    const L = carrierWindowLayout({ id: 'bg', layer: 1, items: [item(800, 500)] }, 900);
    expect(L.head + Math.max(0, Math.min(L.end, L.total) - L.start) + L.tail).toBe(900);
  });
});

// ─────────────────────────────────────────────────────────────
// 载体轨嵌套：段必须用**绝对帧**（2026-10-18 第二次真渲回归）
//
// 事故：影子载体轨单独存在时正常分屏，一旦外层还有 `punch-in` 载体轨就完全失效。
// 根因：每层 `<Sequence from={start}>` 都偏移时间，嵌套后内层看到的是父层的
// **局部帧**，而 `item.fromFrame` 是绝对帧 ⇒ 起点被叠成 `2744 + 6488`，早已出界。
// 修法：每层用 `<Sequence from={0} durationInFrames={total}>` 兜底，段内写绝对帧。
// ─────────────────────────────────────────────────────────────
describe('carrierRenderSegments（嵌套时不得叠加时间偏移）', () => {
  const track = { id: 'bg', layer: 1, items: [item(6488, 150)] };

  it('段起点是绝对帧，不是轨道内相对帧', () => {
    const segs = carrierRenderSegments(track, 6667);
    const withItem = segs.find((s) => s.item !== null)!;
    expect(withItem.from).toBe(6488); // 若错写成相对帧会是 0
    expect(withItem.length).toBe(150);
  });

  it('三段无缝覆盖 [0, total)：前透传 / item / 后透传', () => {
    const segs = carrierRenderSegments(track, 6667);
    expect(segs[0]).toMatchObject({ from: 0, length: 6488, item: null });
    expect(segs.at(-1)).toMatchObject({ from: 6638, length: 29, item: null });
    // 逐段相接，不重叠不留缝
    for (let i = 1; i < segs.length; i += 1) {
      expect(segs[i]!.from).toBe(segs[i - 1]!.from + segs[i - 1]!.length);
    }
    const last = segs.at(-1)!;
    expect(last.from + last.length).toBe(6667);
  });

  it('轨道内间隙也换算成绝对帧', () => {
    // 两个 item 中间留 100 帧空档 → 应产出「透传」段
    const t = { id: 'bg', layer: 1, items: [item(100, 50), item(250, 50)] };
    const segs = carrierRenderSegments(t, 500);
    expect(segs.map((s) => [s.from, s.length, s.item !== null])).toEqual([
      [0, 100, false],
      [100, 50, true],
      [150, 100, false],
      [250, 50, true],
      [300, 200, false],
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// 多载体轨合并成单张绝对时间表（2026-10-18 第二次真渲回归）
//
// 事故：punch-in(2594–2744) 与影子 split-frame(6488–6638) 两条载体轨嵌套时，
// 内层起点被算成 2744+6488，早已出界 ⇒ 加与不加影子轨的成片 SSIM = 1.0。
// 修法：拍平成原子窗口，任一时刻只挂一个变换，视频只渲染一次。
// ─────────────────────────────────────────────────────────────
describe('composeCarrierTimeline', () => {
  const bg = { id: 'bg-punch', layer: 1, items: [item(2594, 150)] };
  const shadow = { id: 'shadow', layer: 5, items: [item(6488, 150)] };

  it('两条互不重叠的载体轨 → 各自窗口独立，互不影响', () => {
    const w = composeCarrierTimeline([shadow, bg], 6667);
    const withItem = w.filter((x) => x.item !== null);
    expect(withItem.map((x) => [x.trackId, x.from, x.length])).toEqual([
      ['bg-punch', 2594, 150],
      ['shadow', 6488, 150],
    ]);
    // 无变换的窗口必须填满剩下的时间轴
    const filled = w.reduce((a, x) => a + x.length, 0);
    expect(filled).toBe(6667);
  });

  it('窗口逐段相接、无缝无叠（这是「视频只渲染一次」的前提）', () => {
    const w = composeCarrierTimeline([shadow, bg], 6667);
    expect(w[0]!.from).toBe(0);
    for (let i = 1; i < w.length; i += 1) {
      expect(w[i]!.from).toBe(w[i - 1]!.from + w[i - 1]!.length);
    }
    const last = w.at(-1)!;
    expect(last.from + last.length).toBe(6667);
  });

  it('无载体轨 → 单个满长透传窗口（等价于不做任何变换）', () => {
    expect(composeCarrierTimeline([], 900)).toEqual([
      { from: 0, length: 900, item: null, trackId: null },
    ]);
  });

  it('两轨时间真重叠 → 数组靠前者（更内层）优先，不叠乘', () => {
    const a = { id: 'inner', layer: 5, items: [item(100, 200)] };
    const b = { id: 'outer', layer: 1, items: [item(100, 200)] };
    const w = composeCarrierTimeline([a, b], 400);
    const mid = w.find((x) => x.from === 100)!;
    expect(mid.trackId).toBe('inner');
    // 只挂一个变换：外层那条在该窗口被丢弃，而不是两条都施加
    expect(w.filter((x) => x.item !== null)).toHaveLength(1);
  });
});
