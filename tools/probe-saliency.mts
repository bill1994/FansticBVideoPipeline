/**
 * probe-saliency.mts — 显著性单帧诊断
 *
 * 用途：对指定时间点抽一帧，跑 `saliencyBox` 并打印网格能量分布，用于解释
 *      「为什么这个镜头没有 broll region」（退让原因）。
 * 运行：`npx tsx tools/probe-saliency.mts [秒数] [视频路径]`
 */

import { spawnSync } from 'node:child_process';
import { saliencyBox } from '../src/stages/region-derive.ts';
import { planInputSize } from '../src/stages/yunet.ts';

const t = process.argv[2] ?? '56';
const video = process.argv[3] ?? 'TestResources/kukini.mp4';

const probe = spawnSync(
  'ffprobe',
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
   '-of', 'csv=p=0', video],
  { encoding: 'utf8' },
);
// ⚠️ 该容器上 ffprobe 会输出**两行**相同的 width,height（多出一个 stream），
//    只取第一行；直接 split(',') 会把第二行拼进 height 变成 NaN。
const firstLine = probe.stdout.trim().split(/\r?\n/)[0] ?? '';
const [sw, sh] = firstLine.split(',').map(Number);
const { scaledW, scaledH, padW, padH } = planInputSize(sw!, sh!, 512);

const ff = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-ss', t, '-i', video, '-frames:v', '1',
   '-vf', `scale=${scaledW}:${scaledH}:flags=bilinear,pad=${padW}:${padH}:0:0:black`,
   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: 32 * 1024 * 1024 },
);

const buf = ff.stdout;
console.log(`时间 ${t}s → 画面 ${sw}×${sh} → 输入 ${padW}×${padH}，读回 ${buf.length} 字节（期望 ${padW * padH * 3}）`);

// 像素统计：判断是不是抽到黑帧 / 空帧（这会让所有网格能量为 0，从而被 minEnergy 挡掉）
{
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = buf.length > 0 ? sum / buf.length : 0;
  console.log(`像素统计：min=${min} max=${max} mean=${mean.toFixed(1)} ${buf.length === 0 ? '← 空输出' : ''}`);
}

const res = saliencyBox(buf, padW, padH);
console.log('\n默认参数结果:', res ? JSON.stringify(res, null, 2) : 'null（退让：无明确主体）');

// 逐个参数放宽，定位是哪个门槛挡住的
const variants: Array<[string, Parameters<typeof saliencyBox>[3]]> = [
  ['targetAreaRatio=0.15（更集中）', { targetAreaRatio: 0.15 }],
  ['targetAreaRatio=0.5（更大框）', { targetAreaRatio: 0.5 }],
  ['maxAreaRatio=0.8（更宽容）', { maxAreaRatio: 0.8 }],
  ['minEnergy=0.5（更敏感）', { minEnergy: 0.5 }],
];
for (const [label, opt] of variants) {
  const r = saliencyBox(buf, padW, padH, opt);
  console.log(`  ${label}: ${r ? `box=[${r.box.map((v) => v.toFixed(3)).join(', ')}] score=${r.score.toFixed(1)}` : 'null'}`);
}
