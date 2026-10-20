import { parseSrt } from './src/core/srt.ts';
import fs from 'node:fs';
const f = 'jobs/rerun-kukini-1020/00-input/kukini.srt';
const t0 = Date.now();
const cues = parseSrt(f, 59.94005994005994);
console.log(`解析成功：${cues.length} cue，耗时 ${Date.now()-t0}ms`);
console.log(`首条: #${cues[0].index} [${cues[0].fromFrame},${cues[0].toFrame}] "${cues[0].text}"`);
console.log(`  srtFrom/To = ${cues[0].srtFromSec}s / ${cues[0].srtToSec}s`);
console.log(`末条: #${cues[cues.length-1].index} [${cues.at(-1)!.fromFrame},${cues.at(-1)!.toFrame}] "${cues.at(-1)!.text}"`);
// CRLF 是否泄漏进 text
const withCR = cues.filter(c => c.text.includes('\r'));
console.log(`\n🔴 text 含残留 \\r 的 cue: ${withCR.length} 条 ${withCR.length?'←泄漏!':''}`);
// 单调性
let bad=0; for(let i=1;i<cues.length;i++) if(cues[i].fromFrame<=cues[i-1].fromFrame) bad++;
console.log(`非单调 cue: ${bad}`);
// 空文本
console.log(`空文本 cue: ${cues.filter(c=>c.text.trim()==='').length}`);
// 与原SRT 的 cue 数对比
const raw=(fs.readFileSync(f,'utf8').match(/-->/g)||[]).length;
console.log(`原文件 cue 数: ${raw} → 解析后 ${cues.length} ${raw===cues.length?'✓ 一致':'（有被丢弃的非台词 cue）'}`);
// 帧区间越界检查
const last=cues.at(-1)!;
console.log(`\n末 cue 结束帧 ${last.toFrame} / 视频总帧 6667 → ${last.toFrame<=6667?'✓ 在范围内':'🔴 越界'}`);
