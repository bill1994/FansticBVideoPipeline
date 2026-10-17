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
  DEFAULT_SCALE,
  SCALE_MAX,
  SCALE_MIN,
  carrierDisplayRect,
  carrierParamsOf,
  clampCarrierRatio,
  clampScale,
  computeCarrierWindow,
  readCarrierRatio,
  readCarrierSide,
  visibleRegion,
} from '../src/core/carrier-window.ts';
import { punchInScale } from '../src/remotion/templates/punch-in.tsx';
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

/**
 * 🔴 P4 复核增补（2026-10-17）：这两组测试对应**两个已修的真缺陷**，
 *   都不是「补覆盖率」，是防止它们再回来。
 */
describe('visibleRegion · scale 分支（放大裁边）', () => {
  it('scale > 1 ⇒ 可见区 = 中央 1/s', () => {
    const vr = visibleRegion({ scale: 1.4 })!;
    expect(vr).not.toBeNull();
    const inv = 1 / 1.4;
    expect(vr[0]).toBeCloseTo((1 - inv) / 2, 10);
    expect(vr[1]).toBeCloseTo((1 - inv) / 2, 10);
    expect(vr[2]).toBeCloseTo(inv, 10);
    expect(vr[3]).toBeCloseTo(inv, 10);
  });

  it('scale ≤ 1（不裁切）⇒ null', () => {
    expect(visibleRegion({ scale: 1 })).toBeNull();
    expect(visibleRegion({ scale: 0.5 })).toBeNull();
  });

  it('🔴 scale 必须过钳制：scale=3.0 的判据结果须与渲染期的 SCALE_MAX 相同', () => {
    // 修此缺陷前：判据按 3.0 算 [0.333,0.333,0.333,0.333]，而渲染实际用 1.6
    // ⇒ 判据比渲染更狠 ⇒ 误报。修法：两边共用 `clampScale`。
    const vr = visibleRegion({ scale: 3.0 })!;
    const inv = 1 / SCALE_MAX; // 1/1.6
    expect(vr[2]).toBeCloseTo(inv, 10);
    // 明确断言「不是按 3.0 算的」
    expect(vr[2]).not.toBeCloseTo(1 / 3.0, 10);
  });

  it('🔴 非法 scale 静默降级为「不裁切」（刻意不抛错，见函数注释取舍）', () => {
    // 判据不应比渲染更严：渲染期 num() 本就确定性降级
    expect(visibleRegion({ scale: '1.4' })).toBeNull();
    expect(visibleRegion({ scale: Number.NaN })).toBeNull();
    expect(visibleRegion({ scale: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('clampScale 与渲染期同源：边界值原样返回、超界钳住', () => {
    expect(clampScale(1.0)).toBe(SCALE_MIN);
    expect(clampScale(1.6)).toBe(SCALE_MAX);
    expect(clampScale(0.2)).toBe(SCALE_MIN);
    expect(clampScale(99)).toBe(SCALE_MAX);
    expect(clampScale(1.2)).toBe(1.2);
  });

  it('🔴 进出场偏差的方向必须钉住：判据可见区**不得大于**渲染任一帧', () => {
    // `punch-in` 的 scale 随帧变化（1 → target → 1），而 `visibleRegion` 只读 params、
    // 取的是**目标值**（最坏帧）。这条测试锁住方向：判据不因进出场而变宽松。
    //
    // 若哪天有人改成「取中段帧」或「取首帧」，本测试会红 —— 那是**漏报方向**的改动。
    const D = 60;
    const target = SCALE_MAX; // 1.6
    const judgeWidth = visibleRegion({ scale: target })![2];

    let widestActual = 0;
    for (let f = 0; f < D; f += 1) {
      const s = punchInScale(f, D, clampScale(target));
      widestActual = Math.max(widestActual, 1 / s);
    }
    // 判据（0.625）必须 ≤ 任一帧的实际可见宽（这里最大是首末帧的 1.0）
    expect(judgeWidth).toBeLessThanOrEqual(widestActual + 1e-12);
    // 且确实比「最宽松帧」更严 —— 说明偏差存在、方向正确
    expect(judgeWidth).toBeLessThan(widestActual);
  });
});

describe('visibleRegion · window 与 scale 并存取交集', () => {
  it('两者都生效 ⇒ 交集（不是 window 优先）', () => {
    // window = [0.5, 0, 0.5, 1]      ⇒ x ∈ [0.5, 1.0],   y ∈ [0, 1]
    // scale = 1.5（**未超 SCALE_MAX 1.6**）⇒ 可见区 = [0.1667, 0.1667, 0.6667, 0.6667]
    //                              ⇒ x ∈ [0.1667, 0.8333], y ∈ [0.1667, 0.8333]
    // 交集：x ∈ [0.5, 0.8333]（宽 1/3）、y ∈ [0.1667, 0.8333]（高 2/3）
    const inv = 1 / 1.5;
    const scaleX0 = (1 - inv) / 2; // 0.16667
    const vr = visibleRegion({ window: [0.5, 0, 0.5, 1], scale: 1.5 })!;
    expect(vr[0]).toBeCloseTo(0.5, 10); // x 交左 = max(0.5, 0.1667)
    expect(vr[1]).toBeCloseTo(scaleX0, 10); // y 交上 = max(0, 0.1667)
    expect(vr[2]).toBeCloseTo(scaleX0 + inv - 0.5, 10); // x 交右 = 0.8333 ⇒ 宽 1/3
    expect(vr[3]).toBeCloseTo(inv, 10); // y 交下 = 0.8333 ⇒ 高 2/3
  });

  it('🔴 取交集前 scale 仍须过钳制（scale=2 实按 1.6 算）', () => {
    // 这条钉住「钳制发生在取交集之前」，不是之后。
    const vr = visibleRegion({ window: [0.5, 0, 0.5, 1], scale: 2 })!;
    const inv = 1 / SCALE_MAX; // 1/1.6 = 0.625
    expect(vr[1]).toBeCloseTo((1 - inv) / 2, 10); // 0.1875
    expect(vr[3]).toBeCloseTo(inv, 10); // 0.625
    // 若忘了钳制，这里会是按 1/2 算的 0.25
    expect(vr[1]).not.toBeCloseTo((1 - 0.5) / 2, 10);
  });

  it('交集为空 ⇒ null（全被裁掉，主体必然不可见）', () => {
    expect(visibleRegion({ window: [0, 0, 0.1, 1], scale: 3 })).toBeNull();
  });

  it('🔴 交集不得大于任一来源（否则等于放水）', () => {
    const winOnly = visibleRegion({ window: [0.2, 0.1, 0.6, 0.8] })!;
    const scaleOnly = visibleRegion({ scale: 1.5 })!;
    const both = visibleRegion({ window: [0.2, 0.1, 0.6, 0.8], scale: 1.5 })!;
    for (const r of [winOnly, scaleOnly]) {
      expect(both[2] <= r[2] + 1e-12).toBe(true);
      expect(both[3] <= r[3] + 1e-12).toBe(true);
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
