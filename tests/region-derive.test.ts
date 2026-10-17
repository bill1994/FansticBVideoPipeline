/**
 * 区域推导单测 —— handheld 外扩几何 + broll 显著性。
 *
 * 显著性用合成图验证行为：纯色应退让、中心高对比块应被框到、满屏细节应退让。
 */

import { describe, expect, it } from 'vitest';
import {
  HANDHELD_EXPANSION,
  handheldFromFace,
  saliencyBox,
} from '../src/stages/region-derive.ts';
import type { Footprint } from '../src/core/types.ts';

/** 构造纯色 RGB 图。 */
function solid(w: number, h: number, v = 128): Uint8Array {
  const buf = new Uint8Array(w * h * 3);
  buf.fill(v);
  return buf;
}

/** 在 buf 上画一块黑白棋盘（高梯度区域）。 */
function checker(
  buf: Uint8Array,
  w: number,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
  cell = 2,
): void {
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 255 : 0;
      const p = (y * w + x) * 3;
      buf[p] = v;
      buf[p + 1] = v;
      buf[p + 2] = v;
    }
  }
}

describe('handheldFromFace', () => {
  it('实测 s0 的人脸框 → 外扩到上半身（宽 3 倍、高 2 倍）', () => {
    const face: Footprint = [0.398, 0.098, 0.133, 0.333];
    const [x, y, w, h] = handheldFromFace(face);

    expect(w).toBeCloseTo(0.133 * HANDHELD_EXPANSION.widthRatio, 6); // 0.399
    expect(h).toBeCloseTo(0.333 * HANDHELD_EXPANSION.heightRatio, 6); // 0.666
    expect(y).toBeCloseTo(0.098, 6); // 顶边与人脸齐平
    // 水平居中于人脸中线
    expect(x + w / 2).toBeCloseTo(0.398 + 0.133 / 2, 6);
  });

  it('靠右边缘时不越界，宽度被裁到画面内', () => {
    const [x, , w] = handheldFromFace([0.9, 0.05, 0.15, 0.2]);
    expect(x + w).toBeLessThanOrEqual(1 + 1e-9);
    expect(x).toBeGreaterThanOrEqual(0);
  });

  it('靠下边缘时高度被裁到画面内', () => {
    const [, y, , h] = handheldFromFace([0.4, 0.8, 0.1, 0.15]);
    expect(y + h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('区域必须包含原人脸框（外扩只能变大，不能跑掉）', () => {
    const face: Footprint = [0.3, 0.2, 0.12, 0.3];
    const [hx, hy, hw, hh] = handheldFromFace(face);
    expect(hx).toBeLessThanOrEqual(face[0] + 1e-9);
    expect(hy).toBeLessThanOrEqual(face[1] + 1e-9);
    expect(hx + hw).toBeGreaterThanOrEqual(face[0] + face[2] - 1e-9);
    expect(hy + hh).toBeGreaterThanOrEqual(face[1] + face[3] - 1e-9);
  });
});

describe('saliencyBox', () => {
  it('纯色画面无主体 → 退让返回 null', () => {
    expect(saliencyBox(solid(160, 90), 160, 90)).toBeNull();
  });

  it('中心高对比块被框到，且不铺满全屏', () => {
    const w = 160;
    const h = 90;
    const buf = solid(w, h, 60);
    checker(buf, w, 60, 30, 40, 30); // 中心一块 40×30 的棋盘
    const res = saliencyBox(buf, w, h);
    expect(res).not.toBeNull();
    const [x, y, bw, bh] = res!.box;
    // 覆盖中心（0.5, 0.5）附近
    expect(x).toBeLessThan(0.55);
    expect(y).toBeLessThan(0.55);
    expect(x + bw).toBeGreaterThan(0.45);
    expect(y + bh).toBeGreaterThan(0.45);
    expect(bw * bh).toBeLessThan(0.6);
  });

  it('满屏都是高频细节时，靠中心先验收敛而非铺满全屏', () => {
    const w = 160;
    const h = 90;
    const buf = solid(w, h, 60);
    checker(buf, w, 0, 0, w, h, 2); // 铺满整个画面
    const res = saliencyBox(buf, w, h);
    // 中心先验让中心格子权重更高 ⇒ 选出的是中心区域，不会退化成全屏框
    if (res) {
      expect(res.box[2] * res.box[3]).toBeLessThan(0.6);
    }
  });

  it('targetAreaRatio 收到超过 maxAreaRatio 时退让返回 null', () => {
    const w = 160;
    const h = 90;
    const buf = solid(w, h, 60);
    checker(buf, w, 0, 0, w, h, 2);
    // 一直并到 95% 面积 ⇒ 超过默认上限 60% ⇒ 判定「无明显主体」
    expect(saliencyBox(buf, w, h, { targetAreaRatio: 0.95 })).toBeNull();
  });

  it('按面积收敛：同一画面 targetAreaRatio 越小，框越小', () => {
    const w = 160;
    const h = 90;
    const buf = solid(w, h, 60);
    checker(buf, w, 0, 0, w, h, 2);
    const small = saliencyBox(buf, w, h, { targetAreaRatio: 0.1 });
    const big = saliencyBox(buf, w, h, { targetAreaRatio: 0.4 });
    expect(small).not.toBeNull();
    expect(big).not.toBeNull();
    const areaOf = (r: { box: number[] }) => r.box[2]! * r.box[3]!;
    expect(areaOf(small!)).toBeLessThan(areaOf(big!));
  });

  it('图太小（小于网格）返回 null 而不崩', () => {
    expect(saliencyBox(solid(8, 4), 8, 4)).toBeNull();
  });

  it('返回的 box 是归一化且在 [0,1] 内', () => {
    const w = 160;
    const h = 90;
    const buf = solid(w, h, 60);
    checker(buf, w, 20, 10, 50, 40);
    const res = saliencyBox(buf, w, h)!;
    for (const v of res.box) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('score 反映被选格子的能量，可供调用方判置信', () => {
    const w = 160;
    const h = 90;
    const strong = solid(w, h, 60);
    checker(strong, w, 60, 30, 40, 30, 1); // 棋盘更细 → 梯度更强
    const weak = solid(w, h, 60);
    checker(weak, w, 60, 30, 40, 30, 8); // 棋盘更粗 → 梯度更弱

    const s1 = saliencyBox(strong, w, h);
    const s2 = saliencyBox(weak, w, h);
    expect(s1).not.toBeNull();
    if (s2) expect(s1!.score).toBeGreaterThan(s2.score);
  });
});
