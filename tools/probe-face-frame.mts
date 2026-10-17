/**
 * probe-face-frame.mts — 单帧人脸检测诊断
 *
 * 用途：对指定视频的某一时刻跑 YuNet，打印**所有**候选框及其分数（含低于生产阈值的），
 *      用于排查「误检成人脸」与「阈值该定多少」。
 *
 * 运行：`npx tsx tools/probe-face-frame.mts [视频] [秒数] [阈值]`
 * 例：  `npx tsx tools/probe-face-frame.mts "jobs/e2e-0322/00-input/3月22日.mp4" 3.79 0.3`
 */

import { spawnSync } from 'node:child_process';
import * as ort from 'onnxruntime-node';
import { PERCEIVE } from '../src/core/config.ts';
import { decodeYunet, planInputSize } from '../src/stages/yunet.ts';

const video = process.argv[2] ?? 'TestResources/kukini.mp4';
const atSec = Number(process.argv[3] ?? '0');
const threshold = Number(process.argv[4] ?? '0.3');

const MODEL = 'perceive-models/face_detection_yunet_2026may-official.onnx';

const probe = spawnSync(
  'ffprobe',
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
   '-of', 'json', video],
  { encoding: 'utf8' },
);
const stream = (JSON.parse(probe.stdout) as { streams: Array<{ width: number; height: number }> })
  .streams[0]!;
const { scaledW, scaledH, padW, padH } = planInputSize(stream.width, stream.height, PERCEIVE.detectMaxSide);

const ff = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-ss', String(atSec), '-i', video, '-frames:v', '1',
   '-vf', `scale=${scaledW}:${scaledH}:flags=bilinear,pad=${padW}:${padH}:0:0:black`,
   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: 32 * 1024 * 1024 },
);
const raw = ff.stdout;
if (raw.length !== padW * padH * 3) {
  console.error(`抽帧失败：读回 ${raw.length} 字节，期望 ${padW * padH * 3}`);
  process.exit(2);
}

// BGR planar
const plane = padW * padH;
const data = new Float32Array(3 * plane);
for (let i = 0, p = 0; i < plane; i++, p += 3) {
  data[i] = raw[p + 2]!;
  data[plane + i] = raw[p + 1]!;
  data[2 * plane + i] = raw[p]!;
}

const session = await ort.InferenceSession.create(MODEL, { executionProviders: ['cpu'] });
const out = await session.run({
  [session.inputNames[0]!]: new ort.Tensor('float32', data, [1, 3, padH, padW]),
});
const faces = decodeYunet(
  out as unknown as Record<string, { data: Float32Array }>,
  padW,
  padH,
  { scoreThreshold: threshold, nmsThreshold: PERCEIVE.nmsThreshold },
);

console.log(`${video} @ ${atSec}s  →  输入 ${padW}×${padH}，阈值 ${threshold}`);
console.log(`候选（NMS 后）：${faces.length} 个`);
for (const f of faces) {
  const nw = f.w / scaledW;
  const nh = f.h / scaledH;
  console.log(
    `  score=${f.score.toFixed(4)}  ` +
      `框(归一化)=[${(f.x1 / scaledW).toFixed(3)}, ${(f.y1 / scaledH).toFixed(3)}, ` +
      `${nw.toFixed(3)}, ${nh.toFixed(3)}]  ` +
      `宽高比=${(nw / nh).toFixed(2)}  ` +
      `像素=${Math.round(f.w)}×${Math.round(f.h)}`,
  );
}
if (faces.length === 0) console.log('  （无候选）');
console.log(`\n生产阈值 ${PERCEIVE.scoreThreshold} 下命中：${faces.filter((f) => f.score >= PERCEIVE.scoreThreshold).length} 个`);
