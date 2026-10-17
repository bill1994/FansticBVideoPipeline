/**
 * probe-regions.mts — 把某 shot 的感知区域画到画面上，供人工核对。
 *
 * 用途：每次调 `HANDHELD_EXPANSION` / 显著性参数 / `safeAreaTopRatio` 后，
 *      用它对真实素材抽查几个 shot，确认框位是否合理（数字对了不代表画对了）。
 *
 * 运行：
 *   npx tsx tools/probe-regions.mts --job e2e-0322 --shot s3
 *   npx tsx tools/probe-regions.mts --job e2e-0322 --shot s3 --at 25.5
 *
 * 颜色约定：face=红、handheld=品红、broll=青、safeArea=绿（在 face 之上叠加）
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface Region {
  id: string;
  kind: 'face' | 'handheld' | 'broll';
  fromFrame: number;
  durationInFrames: number;
  box: [number, number, number, number];
}
interface Shot {
  id: string;
  fromFrame: number;
  durationInFrames: number;
  safeArea: [number, number, number, number] | null;
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`缺少参数 --${name}`);
}

const job = arg('job');
const shotId = arg('shot');
const jobDir = path.resolve('jobs', job);

const source = JSON.parse(
  fs.readFileSync(path.join(jobDir, '00-input', 'source.json'), 'utf8'),
) as { video: string; fps: number; durationInFrames: number };
const videoPath = path.join(jobDir, '00-input', source.video);

const shots = JSON.parse(
  fs.readFileSync(path.join(jobDir, '02-perceive', 'shots.json'), 'utf8'),
) as Shot[];
const regions = JSON.parse(
  fs.readFileSync(path.join(jobDir, '02-perceive', 'regions.json'), 'utf8'),
) as Region[];

const shot = shots.find((s) => s.id === shotId);
if (!shot) {
  console.error(`找不到 shot ${shotId}；可用：${shots.map((s) => s.id).join(', ')}`);
  process.exit(2);
}
const mine = regions.filter((r) => r.id.endsWith(`-${shotId}`));

// 抽帧时间：默认取该 shot 中点，可用 --at 覆盖（秒）
const atArg = process.argv.indexOf('--at');
const atSec =
  atArg >= 0
    ? Number(process.argv[atArg + 1])
    : (shot.fromFrame + shot.durationInFrames / 2) / source.fps;

const probe = spawnSync(
  'ffprobe',
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
   '-of', 'json', videoPath],
  { encoding: 'utf8' },
);
const size = (JSON.parse(probe.stdout) as { streams: Array<{ width: number; height: number }> })
  .streams[0]!;
const W = size.width;
const H = size.height;

const COLORS: Record<string, string> = {
  face: 'red',
  handheld: 'magenta',
  broll: 'cyan',
};
const filters: string[] = [];
for (const r of mine) {
  const [x, y, w, h] = r.box;
  filters.push(
    `drawbox=x=${Math.round(x * W)}:y=${Math.round(y * H)}:` +
      `w=${Math.round(w * W)}:h=${Math.round(h * H)}:` +
      `color=${COLORS[r.kind]}@0.95:t=5`,
  );
}
if (shot.safeArea) {
  const [x, y, w, h] = shot.safeArea;
  filters.push(
    `drawbox=x=${Math.round(x * W)}:y=${Math.round(y * H)}:` +
      `w=${Math.round(w * W)}:h=${Math.round(h * H)}:color=lime@0.95:t=4`,
  );
}
filters.push('scale=820:-1');

const out = arg('out', `perceive-models/probe-${job}-${shotId}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });

const ff = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-ss', String(atSec), '-i', videoPath,
   '-vf', filters.join(','), '-frames:v', '1', '-update', '1', '-y', out],
  { encoding: 'utf8' },
);
if (ff.status !== 0) {
  console.error(`ffmpeg 失败：${ff.stderr}`);
  process.exit(2);
}

console.log(`job=${job} shot=${shotId} 时间=${atSec.toFixed(2)}s`);
console.log(`  shot: fromFrame=${shot.fromFrame} duration=${shot.durationInFrames}`);
console.log(`  safeArea: ${shot.safeArea ? shot.safeArea.map((v) => v.toFixed(3)).join(', ') : 'null'}`);
for (const r of mine) {
  console.log(`  ${r.kind.padEnd(8)} box=[${r.box.map((v) => v.toFixed(3)).join(', ')}]`);
}
console.log(`输出 → ${out}`);
