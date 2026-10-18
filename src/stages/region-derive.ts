/**
 * 区域推导 —— 从人脸框推导 `handheld`，用经典显著性推导 `broll`。
 *
 * ── 为什么不给 handheld 引入物体检测模型（2026-10-17 用户裁决方向）──────────
 * 1. **主讲解物品是鞋子，而 COCO 80 类里没有 shoe**（官方 coco.yaml 的 0–79 逐条核对，
 *    只有 backpack / handbag / suitcase / skis / skateboard，无任何鞋类）
 *    ⇒ YOLO 系**通用权重**对鞋子完全检不出，要检必须自建鞋类标注重训。
 * 2. 用户的判断更省：**「只要上半身不被遮挡就够」** —— 鞋子是举在手里的，
 *    保护手部所在的身体区域，就等于保护手持物。这是 SPEC §2.7「安全区≠主体 bbox」的延伸。
 * 3. 与 `occlusionRatio = 交集面积 / region 面积` 的判定口径相容：
 *    region 越大，同样大小的 overlay 占比越小 → 判定更宽松，不会把正常字幕判成遮挡手持物。
 *
 * ── 为什么 broll 用显著性而不是检测器 ──────────────────────────────────────
 * B-roll 是产品特写（实测 s8/s11 是鞋子与脚部特写，画面**没有人脸**）。
 * 它需要的是「画面哪儿是主体」，而不是「这是什么物体」—— 显著性（梯度能量 + 中心先验）
 * 零模型、零依赖，且对产品特写这类"主体清晰、背景简单"的画面效果足够。
 * 框不到就**退让**（不产 region），而不是硬框一个错的区域。
 */

import type { Footprint } from '../core/types.ts';
import {
  HANDHELD_EXPANSION,
  SALIENCY_TARGET_AREA_RATIO,
} from '../core/config.ts';

/**
 * `HANDHELD_EXPANSION` / `SALIENCY_TARGET_AREA_RATIO` 已于 2026-10-18 上提到
 * `core/config.ts`（D6.4：占位值注册表要引用真源，`core` 不能反向依赖 `stages`）。
 * 这里 re-export 保持既有 import 路径不变（`tests/region-derive.test.ts` 等）。
 */
export { HANDHELD_EXPANSION, SALIENCY_TARGET_AREA_RATIO };

/** 裁到 [0,1] 并保证边框不出界。 */
function clampBox(x: number, y: number, w: number, h: number): Footprint {
  const cx = Math.min(1, Math.max(0, x));
  const cy = Math.min(1, Math.max(0, y));
  return [cx, cy, Math.min(w, 1 - cx), Math.min(h, 1 - cy)];
}

/**
 * 由人脸框推导手持物区域：以人脸水平中线为轴左右扩宽，从人脸顶部向下延伸。
 *
 * 语义是「手持物所在的身体区域」，**不是**精确的物品框 —— 这是有意的近似（见文件头）。
 */
export function handheldFromFace(face: Footprint): Footprint {
  const [fx, fy, fw, fh] = face;
  const centerX = fx + fw / 2;
  const newW = fw * HANDHELD_EXPANSION.widthRatio;
  const newH = fh * HANDHELD_EXPANSION.heightRatio;
  return clampBox(centerX - newW / 2, fy, newW, newH);
}

export interface SaliencyOptions {
  /** 网格列数，默认 16。 */
  gridCols?: number;
  /** 网格行数，默认 9（对应 16:9）。 */
  gridRows?: number;
  /**
   * 目标框面积占比：从能量最高的格子开始逐个并入，包围盒达到此面积即停。
   * 默认 0.35 —— **按面积收敛，而不是按「取前 N% 格子」**。
   */
  targetAreaRatio?: number;
  /** 并集面积仍超过此比例时视为「无明显主体」，退让。默认 0.6。 */
  maxAreaRatio?: number;
  /** 全图平均能量低于此值时视为「画面平淡无主体」，默认 2.0（0–255 尺度）。 */
  minEnergy?: number;
}

export interface SaliencyResult {
  /** 归一化 bbox。 */
  box: Footprint;
  /** 入选格子的平均能量（0–255 尺度的梯度均值），供调用方判断置信度。 */
  score: number;
}

/**
 * 经典显著性：梯度能量 × 中心先验 → **按面积收敛**取包围盒。
 *
 * 输入为 `rgb24` 交错缓冲（通常来自 ffmpeg 抽帧流，尺寸 = 检测输入尺寸）。
 * 返回 `null` 表示「画面没有明确主体」——调用方应**退让**（不产 region），而非硬框。
 *
 * ── 为什么要「按面积收敛」而不是「取能量前 25% 的格子」（2026-10-17 实测踩坑）──
 * 曾用「取前 N% 格子再求并集」。在脚部特写镜头（`s11`，56s）上失败：
 * 地面砖缝同样是高频，能量分散在四周，取前 15% 时并集一撑就超过 60% 上限 ⇒ 直接退让；
 * 只有收到前 5% 才框得住鞋子。可见「格子比例」与「框大小」不是线性关系。
 * 现在改为：从最高能量格子起逐个并入，**包围盒面积达到 targetAreaRatio 就停**
 * ⇒ 框大小有确定上界，不会被分散能量拖成满屏。
 */
export function saliencyBox(
  rgb: Uint8Array | Buffer,
  w: number,
  h: number,
  opts: SaliencyOptions = {},
): SaliencyResult | null {
  const cols = opts.gridCols ?? 16;
  const rows = opts.gridRows ?? 9;
  const targetAreaRatio = opts.targetAreaRatio ?? SALIENCY_TARGET_AREA_RATIO;
  const maxAreaRatio = opts.maxAreaRatio ?? 0.6;
  const minEnergy = opts.minEnergy ?? 2.0;

  if (w < cols || h < rows) return null;

  const cellW = w / cols;
  const cellH = h / rows;
  const energies = new Float64Array(cols * rows);

  // 每个单元格内：相邻像素亮度差的均值（水平 + 垂直），代表「这格有多"有内容"」
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * cellW);
      const y0 = Math.floor(r * cellH);
      const x1 = Math.min(w - 1, Math.floor((c + 1) * cellW));
      const y1 = Math.min(h - 1, Math.floor((r + 1) * cellH));

      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * w + x) * 3;
          const pRight = (y * w + Math.min(w - 1, x + 1)) * 3;
          const pDown = (Math.min(h - 1, y + 1) * w + x) * 3;
          const lum = (rgb[p]! * 299 + rgb[p + 1]! * 587 + rgb[p + 2]! * 114) / 1000;
          const lumR = (rgb[pRight]! * 299 + rgb[pRight + 1]! * 587 + rgb[pRight + 2]! * 114) / 1000;
          const lumD = (rgb[pDown]! * 299 + rgb[pDown + 1]! * 587 + rgb[pDown + 2]! * 114) / 1000;
          sum += Math.abs(lum - lumR) + Math.abs(lum - lumD);
          n++;
        }
      }
      if (n === 0) continue;

      // 中心先验：越靠画面中心权重越高（权重 0.5–1.0，避免边缘被完全排除）
      const cx = (c + 0.5) / cols - 0.5;
      const cy = (r + 0.5) / rows - 0.5;
      const dist = Math.sqrt(cx * cx + cy * cy) / Math.sqrt(0.5);
      const centerWeight = 1 - 0.5 * Math.min(1, dist);

      energies[r * cols + c] = (sum / n) * centerWeight;
    }
  }

  const flat = Array.from(energies);
  const globalMean = flat.reduce((a, v) => a + v, 0) / flat.length;
  if (!Number.isFinite(globalMean) || globalMean < minEnergy) return null;

  const cells: Array<{ r: number; c: number; e: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = energies[r * cols + c]!;
      if (e > 0) cells.push({ r, c, e });
    }
  }
  if (cells.length === 0) return null;
  cells.sort((a, b) => b.e - a.e);

  let minC = cols;
  let maxC = -1;
  let minR = rows;
  let maxR = -1;
  let sum = 0;
  let count = 0;
  let area = 0;

  for (const cell of cells) {
    minC = Math.min(minC, cell.c);
    maxC = Math.max(maxC, cell.c);
    minR = Math.min(minR, cell.r);
    maxR = Math.max(maxR, cell.r);
    sum += cell.e;
    count++;
    area = ((maxC + 1 - minC) / cols) * ((maxR + 1 - minR) / rows);
    if (area >= targetAreaRatio) break;
  }

  if (count === 0 || maxC < minC || maxR < minR) return null;
  // 并集仍铺满大半个画面 ⇒ 「到处都是细节」而非「有一个明确主体」，退让
  if (area > maxAreaRatio) return null;

  const boxX = minC / cols;
  const boxY = minR / rows;
  const boxW = (maxC + 1 - minC) / cols;
  const boxH = (maxR + 1 - minR) / rows;

  return {
    box: clampBox(boxX, boxY, boxW, boxH),
    score: sum / count,
  };
}
