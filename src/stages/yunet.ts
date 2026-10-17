/**
 * YuNet 检测器 —— 预处理 / 解码 / NMS 的**唯一实现**。
 *
 * 为什么单独成模块：`tools/probe-yunet.mts` 里原有一份解码，
 * 内置 perceive 若再写一份，两处会随迭代漂移（本项目踩过「定义了没人用」的坑）。
 * 现在探针与内置后端共用本模块。
 *
 * 解码依据（逐行对照 OpenCV `modules/objdetect/src/face_detect.cpp` postProcess）：
 *   - pad：右/下补 0 到 32 倍数（BORDER_CONSTANT）
 *   - blob：**BGR planar，0..255，不做 mean/std 归一化**
 *   - score = sqrt(clamp(cls) * clamp(obj))；cls/obj **已是 sigmoid 后值，勿再套 sigmoid**
 *   - cx=(col+bbox[0])*stride, cy=(row+bbox[1])*stride, w=exp(bbox[2])*stride, h=exp(bbox[3])*stride
 *   - kps[n] = ((kps[2n]+col)*stride, (kps[2n+1]+row)*stride)
 *
 * ⚠️ 本实现 NMS 用**浮点框**算 IoU（OpenCV 在 NMS 前会把框取整为 Rect2i）。
 *    与 OpenCV 参照对齐时若出现 1–2 框差异，优先复查此处。
 */

/** YuNet 的三级 stride。 */
export const YUNET_STRIDES = [8, 16, 32] as const;

/** 5 个关键点：右眼、左眼、鼻尖、右嘴角、左嘴角。 */
export const YUNET_KP_COUNT = 5;

export interface FaceBox {
  /** 左上角 x（模型输入坐标系，像素）。 */
  x1: number;
  y1: number;
  w: number;
  h: number;
  /** sqrt(cls × obj)，0–1。 */
  score: number;
  /** 5 个关键点 [x0,y0,x1,y1,...]，模型输入坐标系。 */
  kps: number[];
}

/** 只要求 `.data` 的最小张量接口 —— 避免本模块依赖 onnxruntime 类型。 */
export interface TensorLike {
  data: Float32Array | Float64Array | number[];
}

export type YunetOutputs = Record<string, TensorLike | undefined>;

export interface DecodeOptions {
  /** 分数阈值，默认 0.9（对齐 opencv_zoo demo 默认值）。 */
  scoreThreshold?: number;
  /** NMS IoU 阈值，默认 0.3（对齐 opencv_zoo demo 默认值）。 */
  nmsThreshold?: number;
  /** 保留框上限，默认 5000（对齐 OpenCV top_k）。 */
  topK?: number;
}

export const DEFAULT_SCORE_THRESHOLD = 0.9;
export const DEFAULT_NMS_THRESHOLD = 0.3;
export const DEFAULT_TOP_K = 5000;

/** 计算送入模型前的尺寸：长边缩到 maxSide，再向上补到 32 的倍数。 */
export function planInputSize(
  srcW: number,
  srcH: number,
  maxSide = 512,
): { scaledW: number; scaledH: number; padW: number; padH: number } {
  const scale = maxSide / Math.max(srcW, srcH);
  const scaledW = Math.max(1, Math.round(srcW * scale));
  const scaledH = Math.max(1, Math.round(srcH * scale));
  return {
    scaledW,
    scaledH,
    padW: Math.ceil(scaledW / 32) * 32,
    padH: Math.ceil(scaledH / 32) * 32,
  };
}

/**
 * RGB 交错缓冲（ffmpeg `-pix_fmt rgb24` 直出）→ BGR planar Float32（NCHW 的 C 轴）。
 *
 * 返回长度 `3 * w * h`，布局 `[B 平面][G 平面][R 平面]`，值域 0..255 **不归一化**。
 */
export function rgbToBgrPlanar(rgb: Uint8Array | Buffer, w: number, h: number): Float32Array {
  const plane = w * h;
  if (rgb.length < plane * 3) {
    throw new Error(`rgbToBgrPlanar：缓冲长度 ${rgb.length} 不足 ${plane * 3}`);
  }
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i++, p += 3) {
    const r = rgb[p]!;
    const g = rgb[p + 1]!;
    const b = rgb[p + 2]!;
    out[i] = b;
    out[plane + i] = g;
    out[2 * plane + i] = r;
  }
  return out;
}

/** RGBA 交错缓冲（jimp `bitmap.data`）→ BGR planar Float32。探针用。 */
export function rgbaToBgrPlanar(rgba: Uint8Array, w: number, h: number): Float32Array {
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    out[i] = rgba[p + 2]!;
    out[plane + i] = rgba[p + 1]!;
    out[2 * plane + i] = rgba[p]!;
  }
  return out;
}

/**
 * 把模型原始输出解码成人脸框。
 *
 * @param outputs `session.run()` 的返回值，需含 cls_8/obj_8/bbox_8/kps_8 等 12 个张量
 * @param inputW 模型输入宽（须为 32 的倍数）
 * @param inputH 模型输入高
 */
export function decodeYunet(
  outputs: YunetOutputs,
  inputW: number,
  inputH: number,
  opts: DecodeOptions = {},
): FaceBox[] {
  const scoreThreshold = opts.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const nmsThreshold = opts.nmsThreshold ?? DEFAULT_NMS_THRESHOLD;
  const topK = opts.topK ?? DEFAULT_TOP_K;

  const candidates: FaceBox[] = [];

  for (const stride of YUNET_STRIDES) {
    const cls = outputs[`cls_${stride}`]?.data;
    const obj = outputs[`obj_${stride}`]?.data;
    const bbox = outputs[`bbox_${stride}`]?.data;
    const kps = outputs[`kps_${stride}`]?.data;
    if (!cls || !obj || !bbox || !kps) {
      throw new Error(
        `decodeYunet：缺少 stride ${stride} 的输出张量（cls/obj/bbox/kps），` +
          `实际可用键：${Object.keys(outputs).join(', ')}`,
      );
    }

    const cols = Math.floor(inputW / stride);
    const rows = Math.floor(inputH / stride);
    const cells = cols * rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= cells) continue;

        const clsScore = Math.min(Math.max(cls[idx]!, 0), 1);
        const objScore = Math.min(Math.max(obj[idx]!, 0), 1);
        const score = Math.sqrt(clsScore * objScore);
        if (score < scoreThreshold) continue;

        const cx = (c + bbox[idx * 4]!) * stride;
        const cy = (r + bbox[idx * 4 + 1]!) * stride;
        const w = Math.exp(bbox[idx * 4 + 2]!) * stride;
        const h = Math.exp(bbox[idx * 4 + 3]!) * stride;

        const kp: number[] = [];
        for (let n = 0; n < YUNET_KP_COUNT; n++) {
          kp.push(
            (kps[idx * 2 * YUNET_KP_COUNT + 2 * n]! + c) * stride,
            (kps[idx * 2 * YUNET_KP_COUNT + 2 * n + 1]! + r) * stride,
          );
        }

        candidates.push({ x1: cx - w / 2, y1: cy - h / 2, w, h, score, kps: kp });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const kept: FaceBox[] = [];
  for (const cand of candidates) {
    if (kept.length >= topK) break;
    if (kept.every((k) => iou(k, cand) <= nmsThreshold)) kept.push(cand);
  }
  return kept;
}

/** IoU（浮点框）。 */
export function iou(a: FaceBox, b: FaceBox): number {
  const interW = Math.min(a.x1 + a.w, b.x1 + b.w) - Math.max(a.x1, b.x1);
  const interH = Math.min(a.y1 + a.h, b.y1 + b.h) - Math.max(a.y1, b.y1);
  if (interW <= 0 || interH <= 0) return 0;
  const inter = interW * interH;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}
