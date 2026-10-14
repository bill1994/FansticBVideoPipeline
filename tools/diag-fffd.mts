/**
 * 诊断：small 模型 token 级输出里的 U+FFFD 从哪来。
 *
 * 两种可能，修法完全不同：
 *   A. 编码转换错误 —— Node 侧按字节/代理对切分，中文被截断 ⇒ 我们自己的 bug，可修
 *   B. whisper 真没识别出 —— 模型输出就是这些 ⇒ 只能换模型/改参数，不是 bug
 *
 * 判据：看**原始**（未经 adapter 清洗）的 token text，以及它的字节表示。
 */
import fs from 'node:fs';
import { transcribe } from '@remotion/install-whisper-cpp';

const res: any = await transcribe({
  inputPath: 'G:/VideoPipeline/jobs/real30/01-align/audio.wav',
  whisperPath: 'G:/VideoPipeline/whisper.cpp',
  whisperCppVersion: '1.5.5',
  model: 'small',
  tokenLevelTimestamps: true,
  language: 'Chinese',
  printOutput: false,
});

fs.writeFileSync(
  'G:/VideoPipeline/jobs/real30/01-align/small-raw-tokens.json',
  JSON.stringify(res, null, 2),
);

const segs = res.transcription ?? [];
console.log('segment 数:', segs.length);
for (const seg of segs) {
  console.log('\n--- segment ---');
  console.log('  text:', JSON.stringify(seg.text));
  const toks = seg.tokens ?? [];
  console.log('  token 数:', toks.length);
  for (const t of toks.slice(0, 25)) {
    const txt = t.text ?? '';
    const hasFffd = txt.includes('\uFFFD');
    console.log(
      `    ${JSON.stringify(txt).padEnd(18)} ` +
        `bytes=[${[...Buffer.from(txt, 'utf8')].join(',')}] ` +
        `t_dtw=${t.t_dtw} ${hasFffd ? '  <== U+FFFD' : ''}`,
    );
  }
}
