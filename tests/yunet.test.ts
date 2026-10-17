/**
 * YuNet 编解码模块单测 —— 不依赖 onnxruntime，用合成张量验证公式。
 *
 * 覆盖：输入尺寸规划、RGB/RGBA → BGR planar、解码公式、分数阈值、NMS、缺张量报错。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NMS_THRESHOLD,
  DEFAULT_SCORE_THRESHOLD,
  decodeYunet,
  iou,
  planInputSize,
  rgbToBgrPlanar,
  rgbaToBgrPlanar,
  type YunetOutputs,
} from '../src/stages/yunet.ts';

describe('planInputSize', () => {
  it('1920×1080 长边缩到 512 → 512×288，补边后仍是 32 的倍数', () => {
    const p = planInputSize(1920, 1080, 512);
    expect(p).toEqual({ scaledW: 512, scaledH: 288, padW: 512, padH: 288 });
    expect(p.padW % 32).toBe(0);
    expect(p.padH % 32).toBe(0);
  });

  it('竖屏 1080×1920 → 288×512', () => {
    expect(planInputSize(1080, 1920, 512)).toMatchObject({ scaledW: 288, scaledH: 512 });
  });

  it('正方形 1000×1000 → 512×512', () => {
    expect(planInputSize(1000, 1000, 512)).toMatchObject({ scaledW: 512, scaledH: 512 });
  });

  it('奇数比例向上补到 32 倍数（不留半格）', () => {
    // 1000×333 → 长边 512，短边 170.5→171 → 补到 192
    const p = planInputSize(1000, 333, 512);
    expect(p.padH % 32).toBe(0);
    expect(p.padH).toBeGreaterThanOrEqual(p.scaledH);
  });
});

describe('颜色通道重排', () => {
  it('rgb24 交错 → BGR planar，值域 0..255 不归一化', () => {
    // 2 像素：纯红 (255,0,0)、纯蓝 (0,0,255)
    const rgb = Uint8Array.from([255, 0, 0, 0, 0, 255]);
    const out = rgbToBgrPlanar(rgb, 2, 1);
    // B 平面：红像素的 B=0，蓝像素的 B=255
    expect(Array.from(out.slice(0, 2))).toEqual([0, 255]);
    // G 平面全 0
    expect(Array.from(out.slice(2, 4))).toEqual([0, 0]);
    // R 平面：红=255，蓝=0
    expect(Array.from(out.slice(4, 6))).toEqual([255, 0]);
  });

  it('rgba 交错 → BGR planar（探针路径）', () => {
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]);
    const out = rgbaToBgrPlanar(rgba, 2, 1);
    expect(Array.from(out)).toEqual([0, 255, 0, 0, 255, 0]);
  });

  it('缓冲长度不足时显式报错', () => {
    expect(() => rgbToBgrPlanar(new Uint8Array(3), 2, 2)).toThrow(/长度/);
  });
});

/** 构造只含 stride 8 有内容的输出（16×8 输入 → cols=2 / rows=1）。 */
function makeOutputs(
  cells: { cls: number[]; obj: number[]; bbox: number[]; kps?: number[] },
  inputW = 16,
  inputH = 8,
): YunetOutputs {
  const n = cells.cls.length;
  return {
    cls_8: { data: Float32Array.from(cells.cls) },
    obj_8: { data: Float32Array.from(cells.obj) },
    bbox_8: { data: Float32Array.from(cells.bbox) },
    kps_8: { data: Float32Array.from(cells.kps ?? new Array(n * 10).fill(0)) },
    // stride 16/32 在 16×8 输入下 rows=0，给空张量占位
    cls_16: { data: new Float32Array(0) },
    obj_16: { data: new Float32Array(0) },
    bbox_16: { data: new Float32Array(0) },
    kps_16: { data: new Float32Array(0) },
    cls_32: { data: new Float32Array(0) },
    obj_32: { data: new Float32Array(0) },
    bbox_32: { data: new Float32Array(0) },
    kps_32: { data: new Float32Array(0) },
  };
}

describe('decodeYunet', () => {
  it('解码公式：cx=(col+dx)*stride、w=exp(dw)*stride、score=sqrt(cls*obj)', () => {
    const out = decodeYunet(
      makeOutputs({
        cls: [1, 0],
        obj: [1, 0],
        bbox: [0, 0, 0, 0, 0, 0, 0, 0],
      }),
      16,
      8,
    );
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.score).toBeCloseTo(1, 6);
    // anchor (col=0,row=0)，dx=dy=0 ⇒ 中心 (0,0)，边长 exp(0)*8 = 8
    expect(f.w).toBeCloseTo(8, 6);
    expect(f.h).toBeCloseTo(8, 6);
    expect(f.x1).toBeCloseTo(-4, 6);
    expect(f.y1).toBeCloseTo(-4, 6);
    expect(f.kps).toHaveLength(10);
  });

  it('关键点按 (kps+col/row)*stride 换算', () => {
    const kps = new Array(10).fill(0);
    kps[0] = 0.5; // 第 1 个关键点 x 偏移
    kps[1] = 0.25; // y 偏移
    const out = decodeYunet(
      makeOutputs({ cls: [1, 0], obj: [1, 0], bbox: [0, 0, 0, 0, 0, 0, 0, 0], kps }),
      16,
      8,
    );
    expect(out[0]!.kps[0]).toBeCloseTo(4, 6); // (0.5+0)*8
    expect(out[0]!.kps[1]).toBeCloseTo(2, 6); // (0.25+0)*8
  });

  it('低于分数阈值的 anchor 被丢弃', () => {
    const out = decodeYunet(
      makeOutputs({ cls: [0.5, 0], obj: [0.5, 0], bbox: new Array(8).fill(0) }),
      16,
      8,
      { scoreThreshold: 0.9 },
    );
    expect(out).toHaveLength(0); // sqrt(0.5*0.5)=0.5 < 0.9
  });

  it('NMS 抑制重叠框，保留高分者', () => {
    // anchor0: cx=0 → [-4,4]；anchor1: dx=-0.5 → cx=4 → [0,8]，重叠 4px，IoU≈0.33
    const out = decodeYunet(
      makeOutputs({
        cls: [1, 0.95],
        obj: [1, 0.95],
        bbox: [0, 0, 0, 0, -0.5, 0, 0, 0],
      }),
      16,
      8,
      { nmsThreshold: 0.3 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBeCloseTo(1, 6);
  });

  it('NMS 阈值放大后两个框都保留', () => {
    const out = decodeYunet(
      makeOutputs({
        cls: [1, 0.95],
        obj: [1, 0.95],
        bbox: [0, 0, 0, 0, -0.5, 0, 0, 0],
      }),
      16,
      8,
      { nmsThreshold: 0.9 },
    );
    expect(out).toHaveLength(2);
  });

  it('缺输出张量时显式报错并列出可用键', () => {
    const broken: YunetOutputs = { cls_8: { data: new Float32Array(2) } };
    expect(() => decodeYunet(broken, 16, 8)).toThrow(/缺少 stride 8/);
  });

  it('默认阈值与 opencv_zoo demo 一致（0.9 / 0.3）', () => {
    expect(DEFAULT_SCORE_THRESHOLD).toBe(0.9);
    expect(DEFAULT_NMS_THRESHOLD).toBe(0.3);
  });
});

describe('iou', () => {
  const box = (x1: number, y1: number, w: number, h: number) => ({ x1, y1, w, h, score: 1, kps: [] });

  it('完全重合 = 1', () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBeCloseTo(1, 6);
  });

  it('不相交 = 0', () => {
    expect(iou(box(0, 0, 10, 10), box(20, 20, 10, 10))).toBe(0);
  });

  it('半重叠 = 1/3', () => {
    // 交 10x10=100，并 100+100-100=200 … 用错位 5 得到 50/150
    expect(iou(box(0, 0, 10, 10), box(5, 0, 10, 10))).toBeCloseTo(50 / 150, 6);
  });
});
