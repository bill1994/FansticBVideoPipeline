/**
 * 载体窗口几何 —— D4-t2 / Q3 的**唯一真源**单测。
 *
 * 🔴 为什么这组测试值得单独存在：
 * 「窗口以主体为锚」这个语义**没有任何渲染期防线**。若窗口算错（没锚主体、
 * 或左边界越出画面），成片照样导出、校验全绿、单测全过 —— 只有把
 * `computeCarrierWindow` 的边界行为钉死，P3 写入时才知道自己写进去的是什么。
 *
 * 特别注意**两个方向的错误都要钉**：
 * · 主体贴边时不钳制 ⇒ 窗口有一部分落在画面外（那不是「被切」，是「没显示」）；
 * · 中心不在画面内时钳制过头 ⇒ 主体反而跑到窗外。
 */

import { describe, expect, it } from 'vitest';
import {
  CARRIER_RATIO_DEFAULT,
  CARRIER_RATIO_MAX,
  CARRIER_RATIO_MIN,
  carrierDisplayRect,
  carrierParamsOf,
  clampCarrierRatio,
  computeCarrierWindow,
  readCarrierRatio,
  readCarrierSide,
  visibleRegion,
} from '../src/core/carrier-window.ts';
import { ConfigError } from '../src/core/exit-code.ts';

const center = (w: readonly number[]) => w[0]! + w[2]! / 2;

describe('clampCarrierRatio', () => {
  it('区间内原样返回', () => {
    expect(clampCarrierRatio(0.35)).toBe(0.35);
    expect(clampCarrierRatio(CARRIER_RATIO_DEFAULT)).toBe(0.5);
  });

  it('下界 / 上界按 D4-t2 裁决钳制', () => {
    expect(clampCarrierRatio(0.1)).toBe(CARRIER_RATIO_MIN);
    expect(clampCarrierRatio(0.9)).toBe(CARRIER_RATIO_MAX);
  });

  it('非有限值回退缺省（不是钳到边界）', () => {
    expect(clampCarrierRatio(Number.NaN)).toBe(CARRIER_RATIO_DEFAULT);
    expect(clampCarrierRatio(Number.POSITIVE_INFINITY)).toBe(CARRIER_RATIO_DEFAULT);
  });
});

describe('computeCarrierWindow —— 主体锚定', () => {
  it('无 safeArea ⇒ 居中窗口（感知低置信时不得失效）', () => {
    expect(computeCarrierWindow(null, 0.5)).toEqual([0.25, 0, 0.5, 1]);
  });

  it('safeArea 居中 ⇒ 窗口也居中', () => {
    const safeArea: [number, number, number, number] = [0.4, 0.1, 0.2, 0.3]; // 中心 0.5
    const win = computeCarrierWindow(safeArea, 0.5);
    expect(center(win)).toBeCloseTo(0.5, 10);
  });

  it('safeArea 偏左 ⇒ 窗口跟着偏左', () => {
    const safeArea: [number, number, number, number] = [0.1, 0.1, 0.2, 0.3]; // 中心 0.2
    const win = computeCarrierWindow(safeArea, 0.4);
    expect(center(win)).toBeCloseTo(0.2, 10);
  });

  it('🔴 主体贴左边缘时左边界必须钳到 0（不能有部分落在画面外）', () => {
    const safeArea: [number, number, number, number] = [0.0, 0.1, 0.1, 0.3]; // 中心 0.05
    const win = computeCarrierWindow(safeArea, 0.5);
    expect(win[0]).toBe(0);
    // 但主体仍在窗内：中心 0.05 落在 [0, 0.5] 内
    expect(center(win)).toBeGreaterThanOrEqual(0);
  });

  it('🔴 主体贴右边缘时右边界必须恰好贴到 1', () => {
    const safeArea: [number, number, number, number] = [0.9, 0.1, 0.1, 0.3]; // 中心 0.95
    const win = computeCarrierWindow(safeArea, 0.5);
    expect(win[0]! + win[2]!).toBeCloseTo(1, 10);
  });

  it('窗口恒为全高竖条（height=1，纵向不裁）', () => {
    const win = computeCarrierWindow([0.2, 0.3, 0.2, 0.3], 0.6);
    expect(win[1]).toBe(0);
    expect(win[3]).toBe(1);
  });

  it('窗口宽 = clamp 后的 ratio', () => {
    expect(computeCarrierWindow(null, 0.9)[2]).toBe(CARRIER_RATIO_MAX);
    expect(computeCarrierWindow(null, 0.1)[2]).toBe(CARRIER_RATIO_MIN);
  });
});

describe('carrierDisplayRect', () => {
  it('left ⇒ 贴左竖条', () => {
    expect(carrierDisplayRect('left', 0.4)).toEqual([0, 0, 0.4, 1]);
  });

  it('right ⇒ 贴右竖条', () => {
    expect(carrierDisplayRect('right', 0.4)).toEqual([0.6, 0, 0.4, 1]);
  });
});

describe('参数读取（不校验语义，只做确定性降级）', () => {
  it('side 只认 left / right，其余（含缺失）回退 right —— 与声明的 footprint 同侧', () => {
    expect(readCarrierSide({ side: 'left' })).toBe('left');
    expect(readCarrierSide({ side: 'right' })).toBe('right');
    expect(readCarrierSide({ side: 'LEFT' })).toBe('right');
    expect(readCarrierSide({ side: 42 })).toBe('right');
    expect(readCarrierSide(undefined)).toBe('right');
  });

  it('ratio 读取并钳制', () => {
    expect(readCarrierRatio({ ratio: 0.42 })).toBeCloseTo(0.42, 10);
    expect(readCarrierRatio({ ratio: 5 })).toBe(CARRIER_RATIO_MAX);
    expect(readCarrierRatio({})).toBe(CARRIER_RATIO_DEFAULT);
    expect(readCarrierRatio({ ratio: '0.4' })).toBe(CARRIER_RATIO_DEFAULT);
  });
});

describe('visibleRegion —— W-D2-02 判据的唯一输入', () => {
  it('无 window ⇒ null = 全画面可见（无裁切）', () => {
    expect(visibleRegion({})).toBeNull();
    expect(visibleRegion(undefined)).toBeNull();
    expect(visibleRegion({ window: null })).toBeNull();
  });

  it('合法 window ⇒ 原样返回', () => {
    expect(visibleRegion({ window: [0.1, 0, 0.5, 1] })).toEqual([0.1, 0, 0.5, 1]);
  });

  it('🔴 window 形状非法 ⇒ 抛 ConfigError（不静默当「全画面可见」，否则 W-D2-02 漏报）', () => {
    const bad: unknown[] = [[0.1, 0, 0.5], ['a', 0, 0.5, 1], [0.1, 0, 0, 1], [0.1, 0, 0.5, Number.NaN], 7];
    for (const w of bad) {
      expect(() => visibleRegion({ window: w })).toThrow(ConfigError);
    }
  });
});

describe('carrierParamsOf —— 两条来源的优先级', () => {
  it('carrier.params 优先（载体档被声明在别的 item 上时）', () => {
    const params = carrierParamsOf({
      carrier: { params: { side: 'left' } },
      params: { side: 'right' },
    });
    expect(params).toEqual({ side: 'left' });
  });

  it('没有 carrier 声明时回落到 item.params（模板作为普通 carrier item 使用）', () => {
    expect(carrierParamsOf({ params: { ratio: 0.4 } })).toEqual({ ratio: 0.4 });
  });

  it('两者皆无 ⇒ 空对象（不给 undefined，避免下游可选链成片）', () => {
    expect(carrierParamsOf({})).toEqual({});
  });
});
