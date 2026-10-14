/**
 * 一次性脚本：用项目自带的 SRT 解析器切出前 N 秒字幕。
 * 刻意复用 src/core/srt.ts（已有 22 项单测）而非另写 awk，
 * 顺带在真实素材上验证解析器的实际表现。
 *
 * 用法：node --experimental-strip-types tools/slice-srt.mts <src.srt> <dst.srt> <fps> <seconds>
 */
import { parseSrt } from '../src/core/srt.ts';
import fs from 'node:fs';

const [src, dst, fpsStr, secStr] = process.argv.slice(2);
if (!src || !dst || !fpsStr || !secStr) {
  console.error('用法：slice-srt.mts <src.srt> <dst.srt> <fps> <seconds>');
  process.exit(1);
}
const fps = Number(fpsStr);
const seconds = Number(secStr);
const maxStartSec = seconds;

const cues = parseSrt(src, fps);
const kept = cues.filter((c) => {
  const startSec = c.fromFrame / fps;
  return startSec < maxStartSec;
});

const toTs = (frame: number): string => {
  const ms = Math.round((frame / fps) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(rest).padStart(3, '0')}`;
};

const body = kept
  .map(
    (c, i) =>
      `${i + 1}\n${toTs(c.fromFrame)} --> ${toTs(c.toFrame)}\n${c.text}\n`,
  )
  .join('\n');

fs.writeFileSync(dst, body + '\n', 'utf8');

console.log(`原始 ${cues.length} 条 → 保留 ${kept.length} 条（start < ${maxStartSec}s）`);
console.log(`末条：${kept.length > 0 ? kept[kept.length - 1]!.text : '（无）'}`);
