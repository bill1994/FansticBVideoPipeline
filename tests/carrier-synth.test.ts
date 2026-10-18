/**
 * 影子载体轨（D4-t3）的纯函数测试。
 *
 * 背景：D4-t2 把载体退让的承载字段定成「逐 item 的 `carrier`」，但渲染层是按
 * **track 的 motion scope** 划分载体轨的 ⇒ 叠加 item 上的 `carrier` 无人消费，
 * 「报告说退让生效、画面分毫未动」。本文件守的是那条**转换**：
 * 「叠加 item 上的 carrier 声明」→「能真正包住视频的载体轨」。
 *
 * 三条不变量（对应 D4-t3 的三个裁定点）：
 *   ① 只从**叠加类** item 合成（载体类 item 自己不重复施加）；
 *   ② 同一载体模板归一条轨（`getScopeOf` 要求同轨同 scope）；
 *   ③ 输出顺序稳定（确定性红线：同输入必得同输出）。
 */

import { describe, expect, it } from 'vitest';
import { SHADOW_TRACK_PREFIX, synthesizeCarrierTracks } from '../src/remotion/carrier-synth.ts';
import type { Storyboard, StoryboardItem } from '../src/core/types.ts';

const storyboard = (tracks: Storyboard['tracks']): Storyboard => ({
  meta: { fps: 60, anchorMode: 'word', alignmentConfidence: 0.9 },
  tracks,
  noMotionRanges: [],
});

const overlayItem = (extra: Partial<StoryboardItem> = {}): StoryboardItem => ({
  fromFrame: 100,
  durationInFrames: 150,
  motion: 'typography/center-emphasis@1.0',
  footprint: [0.3, 0.34, 0.45, 0.12],
  ...extra,
});

describe('synthesizeCarrierTracks', () => {
  it('没有 carrier 声明的 storyboard → 零条影子轨（与旧行为完全等价）', () => {
    const s = storyboard([{ id: 'typo', layer: 60, items: [overlayItem()] }]);
    expect(synthesizeCarrierTracks(s)).toEqual([]);
  });

  it('叠加 item 声明 carrier → 合成一条载体轨，区间与 params 照搬', () => {
    const s = storyboard([
      {
        id: 'emphasis',
        layer: 70,
        items: [
          overlayItem({
            carrier: {
              template: 'carrier/split-frame@1.0',
              params: { side: 'right', ratio: 0.5, window: [0.35, 0, 0.3, 1] },
            },
          }),
        ],
      },
    ]);
    const shadows = synthesizeCarrierTracks(s);
    expect(shadows).toHaveLength(1);
    expect(shadows[0]!.id).toBe(`${SHADOW_TRACK_PREFIX}carrier/split-frame@1.0`);
    const it0 = shadows[0]!.items[0]!;
    expect(it0.motion).toBe('carrier/split-frame@1.0');
    expect(it0.fromFrame).toBe(100);
    expect(it0.durationInFrames).toBe(150);
    // `window` 是校验期写入的系统字段，必须原样带到渲染期，否则几何退回居中
    expect((it0.params as Record<string, unknown>).window).toEqual([0.35, 0, 0.3, 1]);
  });

  it('载体类 item 自己也带 carrier → **不**重复合成（避免双重施加）', () => {
    const s = storyboard([
      {
        id: 'bg',
        layer: 1,
        items: [
          {
            fromFrame: 0,
            durationInFrames: 60,
            motion: 'cinematic/punch-in@1.0',
            footprint: [0, 0, 1, 1],
            params: { scale: 1.1 },
            carrier: { template: 'carrier/split-frame@1.0', params: { window: [0.5, 0, 0.5, 1] } },
          },
        ],
      },
    ]);
    expect(synthesizeCarrierTracks(s)).toEqual([]);
  });

  it('多条 item 共用同一载体模板 → 归到同一条轨（同轨必须同 scope）', () => {
    const s = storyboard([
      {
        id: 'a',
        layer: 60,
        items: [
          overlayItem({ fromFrame: 300 }),
          overlayItem({ fromFrame: 100 }),
          overlayItem({ fromFrame: 200 }),
        ],
      },
    ].map((t) => ({
      ...t,
      items: t.items.map((i) => ({
        ...i,
        carrier: { template: 'carrier/split-frame@1.0', params: { side: 'right', window: [0.5, 0, 0.5, 1] } },
      })),
    })));
    const shadows = synthesizeCarrierTracks(s);
    expect(shadows).toHaveLength(1);
    // 轨内按 fromFrame 升序：first-wins 降级依赖「最早开始者接管」，顺序必须确定
    expect(shadows[0]!.items.map((i) => i.fromFrame)).toEqual([100, 200, 300]);
  });

  it('params 是深拷贝：改写影子轨不污染源 item', () => {
    const src = overlayItem({
      carrier: {
        template: 'carrier/split-frame@1.0',
        params: { side: 'right', ratio: 0.5, window: [0.5, 0, 0.5, 1] },
      },
    });
    const s = storyboard([{ id: 'a', layer: 60, items: [src] }]);
    const shadows = synthesizeCarrierTracks(s);
    (shadows[0]!.items[0]!.params as Record<string, unknown>).ratio = 0.7;
    expect((src.carrier!.params as Record<string, unknown>).ratio).toBe(0.5);
  });

  it('输出顺序稳定（同输入两次调用完全一致）', () => {
    const s = storyboard([
      {
        id: 'a',
        layer: 60,
        items: [
          overlayItem({ carrier: { template: 'carrier/split-frame@1.0', params: { window: [0.5, 0, 0.5, 1] } } }),
        ],
      },
    ]);
    expect(JSON.stringify(synthesizeCarrierTracks(s))).toBe(
      JSON.stringify(synthesizeCarrierTracks(s)),
    );
  });
});

describe('synthesizeCarrierTracks · 声明 ≠ 生效', () => {
  it('声明了 carrier 但没有 window（tier1 已解决）→ 不合成，避免无来由的分屏', () => {
    const s: Storyboard = {
      meta: { fps: 60, anchorMode: 'word', alignmentConfidence: 0.9 },
      tracks: [
        {
          id: 'emphasis',
          layer: 70,
          items: [
            {
              fromFrame: 100,
              durationInFrames: 150,
              motion: 'typography/center-emphasis@1.0',
              footprint: [0.3, 0.34, 0.45, 0.12],
              // 人工返修写了模板与参数，但校验期 tier1 平移就消解了 ⇒ 没有 window
              carrier: { template: 'carrier/split-frame@1.0', params: { side: 'right', ratio: 0.5 } },
            },
          ],
        },
      ],
      noMotionRanges: [],
    };
    expect(synthesizeCarrierTracks(s)).toEqual([]);
  });
});
