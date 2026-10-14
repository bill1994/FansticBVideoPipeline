/**
 * 真实素材实测探针（M-1 第一步验证 + C2-2 阈值校准用）。
 *
 * 只调 transcribeWhisper，不写任何产物到job 目录 ——
 * 目的是「看清中文分词的实际形态」，这是写第二步 DP 对齐的前提。
 *
 * 输出：token 逐条 + 分布统计（供人工判断阈值）
 */
import { transcribeWhisper, WHISPER_MODEL, WHISPER_LANGUAGE } from '../src/stages/whisper-adapter.ts';
import fs from 'node:fs';

const wav = process.argv[2] ?? 'jobs/real30/01-align/audio.wav';
const model = (process.argv[3] ?? WHISPER_MODEL) as never;
const outJson = process.argv[4];

console.log(`模型 ${model} · 语言 ${WHISPER_LANGUAGE} · 音频 ${wav}\n`);

const res = await transcribeWhisper(wav, { model });

console.log(`原始 token ${res.rawTokenCount} → 有效 ${res.words.length} · 丢弃无时间 ${res.droppedNoTime}`);
console.log(`检测语言 ${res.language}\n`);

// ── 分布统计：这才是校准阈值的依据 ──
const probs = res.words.map((w) => w.probability);
const starts = res.words.map((w) => w.startMs);
const mean = probs.reduce((s, p) => s + p, 0) / probs.length;
const lowCount = probs.filter((p) => p < 0.5).length;

console.log('── 解码概率 p 分布 ──');
console.log(`均值${mean.toFixed(4)}  min ${Math.min(...probs).toFixed(4)}  max ${Math.max(...probs).toFixed(4)}`);
console.log(`p < 0.5 的 token：${lowCount} 个（占 ${((lowCount / probs.length) * 100).toFixed(1)}%）`);

// 🔴 昨天纯音调实测的病灶：所有 token startMs 相同（DTW 退化成单点）
const uniqueStarts = new Set(starts).size;
console.log('\n── 时间戳分布（检验 DTW 是否退化）──');
console.log(`唯一 startMs 数：${uniqueStarts} / ${starts.length} 个 token`);
if (uniqueStarts <= starts.length * 0.2) {
  console.log('⚠️  **DTW 可能退化**：绝大多数 token 共享同一 startMs');
} else {
  console.log('✅ startMs 有足够分散度，DTW 未退化为单点');
}

// 逐步长分布
const durs = res.words.map((w) => w.endMs - w.startMs);
const zeroDur = durs.filter((d) => d <= 0).length;
console.log(`时长 <= 0 的 token：${zeroDur} 个`);
console.log(`首 token startMs ${starts[0]}ms，末 token endMs ${res.words[res.words.length - 1]?.endMs}ms`);

console.log('\n── 逐 token 明细 ──');
console.log('#\tstartMs\tendMs\tdur\tp\ttext');
res.words.forEach((w, i) => {
  console.log(
    `${String(i).padStart(3)}\t${String(w.startMs).padStart(6)}\t${String(w.endMs).padStart(6)}\t` +
      `${String(w.endMs - w.startMs).padStart(5)}\t${w.probability.toFixed(4)}\t${w.word}`,
  );
});

if (outJson) {
  fs.writeFileSync(outJson, JSON.stringify(res, null, 2), 'utf8');
  console.log(`\n已落盘：${outJson}`);
}
