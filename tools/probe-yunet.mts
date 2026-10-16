/**
 * probe-yunet.mts — 阶段 A 探针：YuNet × onnxruntime-node 链路验证（v0.2）
 *
 * 用途：报告 §5.4 阶段 A step 3–4 —— 实现 decodeYunet（对照 OpenCV face_detect.cpp 官方实现），
 *       输出检测框 + 5 点关键点，落盘结果 JSON 与可视化图，供与 OpenCV 参照逐框对齐。
 * 运行：从仓库根执行 `npx tsx tools/probe-yunet.mts`
 * 前置：perceive-models/face_detection_yunet_2026may-official.onnx
 *       （官方 opencv_zoo 版；sha256 = ebafce4e…，229738 bytes）
 *       perceive-models/test-lena.jpg；依赖：onnxruntime-node@1.30.0、jimp
 *
 * 解码参照（逐行为准）: opencv/modules/objdetect/src/face_detect.cpp（4.x）postProcess()
 *   - pad: 右/下 copyMakeBorder，BORDER_CONSTANT 0，到 32 倍数
 *   - blob: BGR planar 0..255（无归一化）；NCHW
 *   - score = sqrt(clamp(cls,0,1) * clamp(obj,0,1))；cls/obj 已是 sigmoid 后值（勿再套 sigmoid）
 *   - cx=(c+bbox[0])*stride, cy=(r+bbox[1])*stride, w=exp(bbox[2])*stride, h=exp(bbox[3])*stride
 *   - kps[n] = (kps[2n]+c)*stride, (kps[2n+1]+r)*stride
 *   - NMS: dnn::NMSBoxes(score_threshold, nms_threshold, eta=1.0, top_k)
 *   ⚠️ 本实现 NMS 用**浮点框**算 IoU（OpenCV 在 NMS 前会把框取整为 Rect2i）——
 *      对齐阶段若出现 1–2 框差异，优先复查此处。
 */
import * as ort from 'onnxruntime-node';
import { Jimp } from 'jimp';
import * as fs from 'node:fs';

const MODEL = 'perceive-models/face_detection_yunet_2026may-official.onnx';
const IMG = 'perceive-models/test-lena.jpg';
const OUT_JSON = 'perceive-models/yunet-lena-result.json';
const OUT_JPG = 'perceive-models/test-lena-detected.jpg';

// 对齐 opencv_zoo demo 默认参数（0.9 / 0.3 / 5000）
const SCORE_THRESHOLD = 0.9;
const NMS_THRESHOLD = 0.3;
const TOP_K = 5000;
const STRIDES = [8, 16, 32] as const;

interface Cand {
  x1: number;
  y1: number;
  w: number;
  h: number;
  score: number;
  kps: number[];
}

// ---- 1. 载入模型 ----
console.log('== 1. 载入模型 ==');
const session = await ort.InferenceSession.create(MODEL, { executionProviders: ['cpu'] });
console.log(`输入: ${session.inputNames.join(',')} | 输出: ${session.outputNames.length} 个张量`);

// ---- 2. 读图 + 预处理（BGR planar 0..255；右/下 pad 0 到 32 倍数） ----
console.log('\n== 2. 读图与预处理 ==');
const img = await Jimp.read(IMG);
const W = img.bitmap.width;
const H = img.bitmap.height;
const padW = Math.ceil(W / 32) * 32;
const padH = Math.ceil(H / 32) * 32;
console.log(`图像 ${W}x${H} → 输入 ${padW}x${padH}`);

const plane = padW * padH;
const data = new Float32Array(3 * plane);
{
  const rgba = img.bitmap.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[0 * plane + y * padW + x] = rgba[i + 2]; // B
      data[1 * plane + y * padW + x] = rgba[i + 1]; // G
      data[2 * plane + y * padW + x] = rgba[i + 0]; // R
    }
  }
}

// ---- 3. 推理 ----
console.log('\n== 3. 推理 ==');
const t0 = performance.now();
const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, padH, padW]) });
console.log(`推理耗时: ${(performance.now() - t0).toFixed(1)} ms`);

// ---- 4. 解码（对照 face_detect.cpp postProcess） ----
console.log('\n== 4. 解码 ==');
const candidates: Cand[] = [];
for (const stride of STRIDES) {
  const cols = (padW / stride) | 0;
  const rows = (padH / stride) | 0;
  const cls = out[`cls_${stride}`].data as Float32Array;
  const obj = out[`obj_${stride}`].data as Float32Array;
  const bbox = out[`bbox_${stride}`].data as Float32Array;
  const kps = out[`kps_${stride}`].data as Float32Array;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const clsScore = Math.min(Math.max(cls[idx], 0), 1);
      const objScore = Math.min(Math.max(obj[idx], 0), 1);
      const score = Math.sqrt(clsScore * objScore);

      const cx = (c + bbox[idx * 4 + 0]) * stride;
      const cy = (r + bbox[idx * 4 + 1]) * stride;
      const w = Math.exp(bbox[idx * 4 + 2]) * stride;
      const h = Math.exp(bbox[idx * 4 + 3]) * stride;

      const kp: number[] = [];
      for (let n = 0; n < 5; n++) {
        kp.push((kps[idx * 10 + 2 * n] + c) * stride, (kps[idx * 10 + 2 * n + 1] + r) * stride);
      }
      candidates.push({ x1: cx - w / 2, y1: cy - h / 2, w, h, score, kps: kp });
    }
  }
}
console.log(`候选总数: ${candidates.length}`);

const sorted = [...candidates].sort((a, b) => b.score - a.score);
console.log(
  'Top-10 分数:',
  sorted
    .slice(0, 10)
    .map((x) => x.score.toFixed(4))
    .join(', ')
);

// ---- 5. 阈值 + NMS（贪婪抑制；对齐 dnn::NMSBoxes, eta=1.0） ----
const above = sorted.filter((x) => x.score >= SCORE_THRESHOLD);
function iou(a: Cand, b: Cand): number {
  const interW = Math.min(a.x1 + a.w, b.x1 + b.w) - Math.max(a.x1, b.x1);
  const interH = Math.min(a.y1 + a.h, b.y1 + b.h) - Math.max(a.y1, b.y1);
  if (interW <= 0 || interH <= 0) return 0;
  const inter = interW * interH;
  return inter / (a.w * a.h + b.w * b.h - inter);
}
const kept: Cand[] = [];
for (const cand of above) {
  if (kept.length >= TOP_K) break;
  if (kept.every((k) => iou(k, cand) <= NMS_THRESHOLD)) kept.push(cand);
}
console.log(`score ≥ ${SCORE_THRESHOLD}: ${above.length} 个；NMS 后: ${kept.length} 个`);
for (const [i, f] of kept.entries()) {
  console.log(
    `  #${i + 1}  box=(x1=${f.x1.toFixed(1)}, y1=${f.y1.toFixed(1)}, w=${f.w.toFixed(1)}, h=${f.h.toFixed(1)})  score=${f.score.toFixed(4)}`
  );
  const k = f.kps.map((v) => v.toFixed(1)).join(',');
  console.log(`       kps=[${k}]`);
}

// ---- 6. 落盘：结果 JSON + 可视化 ----
fs.writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      model: MODEL,
      image: IMG,
      imageSize: [W, H],
      inputSize: [padW, padH],
      scoreThreshold: SCORE_THRESHOLD,
      nmsThreshold: NMS_THRESHOLD,
      candidates: candidates.length,
      aboveThreshold: above.length,
      kept: kept.length,
      faces: kept.map((f) => ({ x1: f.x1, y1: f.y1, w: f.w, h: f.h, score: f.score, kps: f.kps })),
    },
    null,
    2
  )
);
console.log(`\n结果 JSON → ${OUT_JSON}`);

const draw = await Jimp.read(IMG);
const buf = draw.bitmap.data;
function setPx(x: number, y: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = 255;
  buf[i + 1] = 0;
  buf[i + 2] = 0;
  buf[i + 3] = 255;
}
for (const f of kept) {
  const fx1 = Math.round(f.x1);
  const fy1 = Math.round(f.y1);
  const fx2 = Math.round(f.x1 + f.w);
  const fy2 = Math.round(f.y1 + f.h);
  for (let t = 0; t < 2; t++) {
    for (let x = fx1; x <= fx2; x++) {
      setPx(x, fy1 + t);
      setPx(x, fy2 - t);
    }
    for (let y = fy1; y <= fy2; y++) {
      setPx(fx1 + t, y);
      setPx(fx2 - t, y);
    }
  }
  // 关键点（蓝点 3x3）
  for (let n = 0; n < 5; n++) {
    const px = Math.round(f.kps[2 * n]);
    const py = Math.round(f.kps[2 * n + 1]);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (px + dx < 0 || py + dy < 0 || px + dx >= W || py + dy >= H) continue;
        const i = ((py + dy) * W + (px + dx)) * 4;
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 255;
        buf[i + 3] = 255;
      }
    }
  }
}
await draw.write(OUT_JPG as `${string}.${string}`);
console.log(`可视化 → ${OUT_JPG}`);

console.log('\n[DONE] v0.2：解码 + NMS + 落盘完成。下一步：与 OpenCV 参照逐框对齐（step 4）。');
