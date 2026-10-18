import fs from 'node:fs';

const w = JSON.parse(fs.readFileSync('jobs/e2e-perceive/01-align/words.json', 'utf8'));
const words = w.words;
const fps = w.fps;
const norm = (s) => s.replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, '').toLowerCase();

const raw = fs.readFileSync('jobs/e2e-perceive/00-input/kukini.srt', 'utf8').replace(/\r/g, '');
const blocks = raw.split(/\n\n+/);
const cues = [];
for (const b of blocks) {
  const lines = b.split('\n').filter((l) => l.trim() !== '');
  const timeLine = lines.find((l) => l.includes('-->'));
  if (!timeLine) continue;
  const [from] = timeLine.split('-->');
  const [hh, mm, rest] = from.trim().split(':');
  const [ss, ms] = rest.split(',');
  const t = +hh * 3600 + +mm * 60 + +ss + +ms / 1000;
  const text = lines.filter((l) => !l.includes('-->') && !/^\d+$/.test(l.trim())).join('');
  cues.push({ t, text: norm(text) });
}

const joined = words.map((x) => norm(x.word)).join('');
const wordStart = [];
let acc = 0;
for (const x of words) {
  wordStart.push(acc);
  acc += norm(x.word).length;
}

let cursor = 0;
const bad = [];
for (const c of cues) {
  const idx = joined.indexOf(c.text, cursor);
  if (idx < 0) {
    bad.push({ cue: c.t, note: '未匹配', text: c.text.slice(0, 12) });
    continue;
  }
  cursor = idx + c.text.length;
  let wi = 0;
  for (let i = 0; i < words.length; i++) {
    if (wordStart[i] + norm(words[i].word).length > idx) {
      wi = i;
      break;
    }
  }
  const got = words[wi].startFrame / fps;
  const d = got - c.t;
  if (Math.abs(d) > 1.0) bad.push({ cue: c.t, got: +got.toFixed(2), d: +d.toFixed(2), text: c.text.slice(0, 14) });
}

console.log('cue 总数', cues.length, '｜偏离 >1s 的 cue 数', bad.length);
for (const b of bad) console.log(`  cue@${b.cue.toFixed(2)}s → 词落 ${b.got ?? '-'}s  偏差 ${b.d ?? '-'}s  "${b.text ?? ''}"`);
