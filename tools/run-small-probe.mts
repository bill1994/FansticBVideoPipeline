/**
 * 一次性探针：用 small 模型跑 30s 真实素材，经 whisper-adapter 的完整清洗路径
 * （含 DTW 单位换算 / 负时长夹取 / 繁简归一），把 words[] 落盘供对比。
 *
 * 存在意义：`main.exe -oj` 的 JSON **不含 token 级数据**（只有 segment），
 * token 级只能走 `@remotion/install-whisper-cpp` 的 `transcribe({tokenLevelTimestamps:true})`。
 * 也就是说，想验 token 级行为，必须过 adapter —— 不能绕开。
 */
import fs from 'node:fs';
import { transcribeWhisper } from '../src/stages/whisper-adapter.ts';

const wav = 'G:/VideoPipeline/jobs/real30/01-align/audio.wav';

const r = await transcribeWhisper(wav, { model: 'small', language: 'Chinese' });

console.log('\n=== adapter 清洗后 tokens ===');
console.log('数量:', r.words.length);
console.log(r.words.map((w) => `${w.word}@${w.startMs}`).join(' '));

const out = 'G:/VideoPipeline/jobs/real30/01-align/small-words.json';
fs.writeFileSync(out, JSON.stringify(r.words, null, 2));
console.log('\n已写出:', out);
