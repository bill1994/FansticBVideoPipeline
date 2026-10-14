/**
 * 端到端验内置对齐器：真实素材 30s，SRT 文字 + whisper 时间。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runBuiltinAlign } from '../src/stages/builtin-align.ts';

const alignDir = 'G:/VideoPipeline/jobs/real30/01-align';
fs.mkdirSync(alignDir, { recursive: true });

const r = runBuiltinAlign(
  path.join(alignDir, 'audio.wav'),
  'G:/VideoPipeline/jobs/real30/00-input/raw.srt',
  alignDir,
  30,
  { model: 'small', language: 'zh', durationInFrames: 900 },
);

console.log('\n=== alignedRatio（M-1c 门控项）===', r.alignedRatio);
console.log('未匹配 cue:', r.unmatchedCues.length ? r.unmatchedCues.join(',') : '(无)');
console.log('词条数:', r.words.length, ' cue 数:', r.cues.length);

console.log('\n=== 词条（帧号）===');
console.log(r.words.map((w) => `${w.word}@${w.startFrame}`).join(' '));

console.log('\n=== 时间质量 ===');
let viol = 0;
for (let i = 1; i < r.words.length; i += 1) {
  if (r.words[i]!.startFrame < r.words[i - 1]!.startFrame) viol += 1;
}
console.log('帧序倒退:', viol);
const neg = r.words.filter((w) => w.endFrame < w.startFrame).length;
console.log('负时长:', neg);
const zero = r.words.filter((w) => w.endFrame === w.startFrame).length;
console.log('零时长:', zero);
console.log('首词帧:', r.words[0]!.startFrame, ' 末词帧:', r.words[r.words.length - 1]!.endFrame, ' (30s @30fps = 900)');

fs.writeFileSync(
  path.join(alignDir, 'builtin-align-result.json'),
  JSON.stringify(r, null, 2),
);
console.log('\n已写出 builtin-align-result.json');
