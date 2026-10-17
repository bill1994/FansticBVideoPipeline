/**
 * probe-shots.mts — 镜头切分端到端探针
 *
 * 用途：对真实素材跑 `detectShotSpans`，打印 shot 列表并落盘，供目视核对。
 * 运行：`npx tsx tools/probe-shots.mts [视频路径] [--threshold N] [--out 输出json]`
 * 默认视频：TestResources/kukini.mp4
 *
 * 已实测基线（2026-10-17，kukini.mp4 1080p 59.94fps 6667 帧）：
 *   threshold=10 → 15 切点 / 16 shot，抽帧核验全为真；threshold=5 会过检 2 个。
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectShotSpans, DEFAULT_SCDET_THRESHOLD } from '../src/stages/shot-detect.ts';

const args = process.argv.slice(2);
const video = args.find((a) => !a.startsWith('--')) ?? 'TestResources/kukini.mp4';
const thresholdArg = args.indexOf('--threshold');
const threshold = thresholdArg >= 0 ? Number(args[thresholdArg + 1]) : DEFAULT_SCDET_THRESHOLD;
const outArg = args.indexOf('--out');
const outPath = outArg >= 0 ? args[outArg + 1]! : 'perceive-models/shots-preview.json';

if (!fs.existsSync(video)) {
  console.error(`视频不存在：${video}`);
  process.exit(2);
}

// ---- 用 ffprobe 读 fps 与总帧数（对齐 SourceManifest 的两个字段）----
const probe = spawnSync(
  'ffprobe',
  [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate,nb_frames',
    '-of', 'default=noprint_wrappers=1:nokey=0',
    video,
  ],
  { encoding: 'utf8' },
);
if (probe.error || probe.status !== 0) {
  console.error(`ffprobe 失败：${probe.error?.message ?? probe.stderr}`);
  process.exit(2);
}
const kv = Object.fromEntries(
  probe.stdout
    .trim()
    .split('\n')
    .map((line) => line.split('=') as [string, string]),
);
const [num, den] = (kv.r_frame_rate ?? '0/1').split('/').map(Number);
const fps = num! / (den || 1);
const totalFrames = Number(kv.nb_frames);

console.log(`== 素材 ==`);
console.log(`  ${video}`);
console.log(`  fps=${fps.toFixed(4)}  nb_frames=${totalFrames}  时长≈${(totalFrames / fps).toFixed(2)}s`);
console.log(`  阈值=${threshold}`);

const { cuts, spans } = detectShotSpans(video, fps, totalFrames, { threshold });

console.log(`\n== 切点（${cuts.length} 个）==`);
for (const c of cuts) {
  console.log(`  ${c.timeSec.toFixed(3)}s  frame=${c.frame}  score=${c.score.toFixed(3)}`);
}

console.log(`\n== Shot（${spans.length} 个）==`);
for (const s of spans) {
  const sec = s.durationInFrames / fps;
  console.log(
    `  ${s.id}  fromFrame=${String(s.fromFrame).padStart(5)}  ` +
      `duration=${String(s.durationInFrames).padStart(5)}  (${sec.toFixed(2)}s)`,
  );
}

const sum = spans.reduce((a, s) => a + s.durationInFrames, 0);
console.log(`\n总帧数守恒：${sum} / ${totalFrames}  ${sum === totalFrames ? 'OK' : '✗ 不一致'}`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify({ video, fps, totalFrames, threshold, cuts, spans }, null, 2) + '\n',
);
console.log(`\n落盘 → ${outPath}`);
