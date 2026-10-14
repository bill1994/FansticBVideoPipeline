/**
 * 用真实素材验 text-align：SRT 文字 + whisper segment 时间。
 *
 * 目的：先看到**实际输出**（每个词的时间、alignedRatio），再决定要不要接进管线。
 * 不先看数字就接线 = 又一次「静默假绿」。
 */
import fs from 'node:fs';
import { parseSrt } from '../src/core/srt.ts';
import { composeWords, type WhisperSegment } from '../src/stages/text-align.ts';

// ① SRT（前 30 秒）
const parsed = parseSrt('G:/VideoPipeline/jobs/real30/00-input/raw.srt', 30);
console.log('SRT cue 数:', parsed.length);

const cues = parsed.map((c) => ({
  index: c.index,
  text: c.text,
}));

// ② whisper segment 层（从 -ojf 文件里取，只取 text + offsets）
const raw = fs.readFileSync('G:/VideoPipeline/jobs/real30/01-align/probe-ojf.json', 'utf8');
const j = JSON.parse(raw) as any;
const segments: WhisperSegment[] = [];
for (const s of j.transcription ?? []) {
  const t = (s.text ?? '').trim();
  if (t === '' || t.startsWith('[_')) continue;
  // -ojf 会给每个 token 一个 segment，用 offsets 合并相邻的（同属一个原 segment 的）
  segments.push({ text: t, startMs: s.offsets.from, endMs: s.offsets.to });
}
console.log('whisper segment 数:', segments.length);
console.log('前 5 个 segment:');
for (const s of segments.slice(0, 5)) {
  console.log(`  ${s.startMs}-${s.endMs}ms  ${JSON.stringify(s.text).slice(0, 50)}`);
}

// ③ 合成
const { words, match, unmatchedCues } = composeWords(cues, segments);

console.log('\n=== alignedRatio（M-1c 门控项）===', match.alignedRatio.toFixed(3));
console.log('匹配成功 cue 数:', match.matchedCues, '/', cues.length);
console.log('cue → segment 映射:', match.cueToSegment.join(','));
console.log('未匹配 cue:', unmatchedCues.length ? unmatchedCues.join(',') : '(无)');

console.log('\n=== 输出词条（前 40）===');
console.log(
  words
    .slice(0, 40)
    .map((w) => `${w.text}@${w.startMs}`)
    .join(' '),
);

console.log('\n=== 逐 cue 明细 ===');
for (const c of cues) {
  const ws = words.filter((w) => w.cueIndex === c.index);
  if (ws.length === 0) {
    console.log(`cue ${c.index}: (空)  ${JSON.stringify(c.text)}`);
    continue;
  }
  const segIdx = match.cueToSegment[cues.indexOf(c)]!;
  console.log(
    `cue ${c.index} [seg=${segIdx}] ${ws[0]!.startMs}-${ws[ws.length - 1]!.endMs}ms ` +
      `conf=${ws[0]!.confidence.toFixed(2)}  ${ws.map((w) => w.text).join('|')}`,
  );
}

fs.writeFileSync(
  'G:/VideoPipeline/jobs/real30/01-align/textalign-words.json',
  JSON.stringify({ words, match }, null, 2),
);
console.log('\n已写出 textalign-words.json');
