/**
 * 渲染层静态体检脚本（不入库，供本地排查用）。
 *
 * 用途：在**真正调用 Remotion 渲染之前**（那需要下载 Chrome，耗时数分钟），
 * 先确认渲染层不会在运行期炸掉。本脚本只做两件事：
 *   1. 把 5 个模板在若干帧上渲染成 HTML，统计结构特征
 *   2. 打印一张对照表，人工确认「肉眼可辨不同」
 *
 * 🔴 为什么需要它：Remotion 真渲要拉起 headless Chrome，
 *    首次还要下载 120MB 的 Chrome Headless Shell。
 *    在拿到那个东西之前，「模板是否真的画出了不同东西」只能靠 SSR 断言，
 *    而 SSR 断言（tests/template-render.test.tsx）验不到**浏览器布局相关**的问题
 *    （例如 CSS 属性在真实渲染引擎里是否生效、层叠是否被遮挡）。
 *
 * 用法：npx tsx tools/render-probe.mts
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, mkdirSync } from 'node:fs';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.ts';
import type { StoryboardItem, WordTimestamp } from '../src/core/types.ts';
import { getTemplateComponent, isImplemented } from '../src/remotion/templates/index.tsx';

const WORDS: WordTimestamp[] = Array.from({ length: 12 }, (_, i) => ({
  index: i,
  word: `词${i + 1}`,
  startFrame: 100 + i * 20,
  endFrame: 100 + i * 20 + 19,
  confidence: 0.9,
}));

const PARAMS: Record<string, Record<string, unknown>> = {
  'caption/karaoke-word@1.0': { boxed: true },
  'typography/kinetic-line@1.0': { text: '惊喜', enter: 'from-left' },
  'typography/lower-third@1.0': { title: '张小澄', subtitle: '动效设计师' },
  'typography/tag-float@1.0': { text: '透气' },
  'data/stat-card@1.0': { value: '42.5', unit: '码' },
};

function itemOf(id: string): StoryboardItem {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === id)!;
  return {
    fromFrame: 100,
    durationInFrames: 60,
    motion: id,
    footprint: tpl.footprint,
    params: PARAMS[id] ?? {},
  };
}

const rows: Array<{ id: string; bytes: number; tags: number; active: string }> = [];
mkdirSync('out/probe', { recursive: true });

for (const tpl of BUILTIN_TEMPLATES) {
  if (!isImplemented(tpl.id)) continue;
  const Comp = getTemplateComponent(tpl.id);
  const item = itemOf(tpl.id);

  // 取三帧：入场 / 保持 / 保持后段
  const frames = [0, 30, 55];
  const propsFor = (frame: number) => ({
    frame,
    durationInFrames: item.durationInFrames,
    item,
    caption: { words: WORDS, cues: [] },
  });
  // 直接当函数调用（FC 本质是函数）⇒ 绕过 React 元素创建，SSR 更快
  const htmls = frames.map((frame) => renderToStaticMarkup(Comp(propsFor(frame))));

  const html = htmls[1];
  const file = `out/probe/${tpl.id.replace(/[@/]/g, '_')}.html`;
  writeFileSync(file, html, 'utf8');

  // 结构特征：标签数、class/style 指纹、帧间差异量
  const tags = (html.match(/</g) ?? []).length;
  const diff01 = diffLength(htmls[0], htmls[1]);
  const diff12 = diffLength(htmls[1], htmls[2]);

  rows.push({
    id: tpl.id,
    bytes: html.length,
    tags,
    active: `f0→f30:${diff01} f30→f55:${diff12}`,
  });
}

/** 两段 HTML 的粗略差异长度（够用来判断"有没有在动"）。 */
function diffLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) d += 1;
  return d;
}

console.log('\n模板渲染探针（SSR，不需Chrome）\n' + '='.repeat(78));
for (const r of rows) {
  console.log(`${r.id.padEnd(32)} ${String(r.bytes).padStart(6)}B  标签${String(r.tags).padStart(4)}  帧差 ${r.active}`);
}
console.log('='.repeat(78));
console.log(`\n共${rows.length} 个已实现模板。`);
const distinct = new Set(rows.map((r) => r.bytes)).size;
console.log(`字节长度去重后：${distinct} 种（应等于 ${rows.length}，否则有模板输出雷同）`);
console.log('\n单帧 HTML 已写入 out/probe/，可用浏览器打开肉眼比对。');

/** 🔴 帧差为 0 意味着该模板静止不动 —— 动效失效。 */
const staticTemplates = rows.filter((r) => {
  const m = r.active.match(/f0→f30:(\d+) f30→f55:(\d+)/);
  return m && Number(m[1]) === 0 && Number(m[2]) === 0;
});
if (staticTemplates.length > 0) {
  console.log(`\n🔴 静止模板（帧差全0）：${staticTemplates.map((t) => t.id).join(', ')}`);
  process.exitCode = 1;
}