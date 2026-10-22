/**
 * 模板预览画廊 —— 目录 + 预览夹具 + 离线 HTML。
 *
 * 真源：`listTemplates()`（注册表） + `isImplemented()`（渲染映射表）。
 * 本模块**不读磁盘、不读时钟、不渲染**，只做纯数据变换：
 * · `buildTemplateCatalog()`：模板声明 → 可查询目录（含实现状态）
 * · `buildGalleryItem()`：目录条目 → 单 item 预览故事板
 * · `renderGalleryHtml()`：目录 → 离线 gallery.html
 *
 * 图片由 `tools/build-template-gallery.mts` 用 Remotion renderStill 产出，
 * 文件名为 `<slug>-f<frame>.png`，与本文件生成的 `<img src>` 一一对应。
 */

import type { Cue, Footprint, StoryboardItem, WordTimestamp } from '../core/types.ts';
import type { CaptionData } from '../remotion/caption.ts';
import { isImplemented } from '../remotion/templates/index.tsx';
import { listTemplates } from './registry.ts';

/** 每个已实现模板统一预览 3 秒（90 帧 @30fps）。 */
const PREVIEW_DURATION = 90;
/**
 * 入场 / 中段 / 收尾三个采样点。
 *
 * 入场取 6 而不是 12：大多数模板的入场时长约 14 帧（DUR.enter 0.16），
 * f12 时已经落定，三张图会长得一模一样；f6 才能看到"正在进来"。
 * 收尾取 72：DUR.exit 0.22 ⇒ 约 f70 开始退场，f72 能看出出场方向。
 */
const PREVIEW_FRAMES = [6, 45, 72] as const;

const CAPTION_TEXT = '说到哪个字哪个字变亮';

/**
 * 字幕预览夹具。
 *
 * 词与 cue 必须同坐标系（都是绝对帧），否则 `highlightSpan` 找不到词，
 * 预览会退化成「整句不高亮」—— 那会把数据缺口误报成模板缺陷。
 */
function makeCaption(): CaptionData {
  const chars = Array.from(CAPTION_TEXT);
  const words: WordTimestamp[] = chars.map((word, index) => ({
    index,
    word,
    startFrame: Math.floor((index * PREVIEW_DURATION) / chars.length),
    endFrame: Math.floor(((index + 1) * PREVIEW_DURATION) / chars.length),
    confidence: 0.99,
  }));
  const cue: Cue = {
    index: 0,
    fromFrame: 0,
    toFrame: PREVIEW_DURATION,
    text: CAPTION_TEXT,
    srtFromSec: 0,
    srtToSec: PREVIEW_DURATION / 30,
  };
  return { fps: 30, words, cues: [cue] };
}

interface GalleryMeta {
  name: string;
  description: string;
  tags: string[];
  /** 预览参数；必须覆盖该模板的 requiredParams。 */
  params?: Record<string, unknown>;
  /** 仅字幕模板需要。 */
  caption?: CaptionData;
}

const CAPTION_FIXTURE = makeCaption();

const META: Record<string, GalleryMeta> = {
  // ── 内置：手写组件 ─────────────────────────────────────────
  'caption/karaoke-word@1.0': {
    name: '逐词高亮字幕',
    description: '底部字幕带，说到哪个字哪个字变亮；文本来自 SRT，不由 params 填写。',
    tags: ['字幕', '逐词', 'karaoke'],
    params: { boxed: true },
    caption: CAPTION_FIXTURE,
  },
  'typography/kinetic-line@1.0': {
    name: '动感文字行',
    description: '中部偏左的强调大字，逐字切出、短暂停留；带左侧强调竖条。',
    tags: ['文字', '强调', '入场'],
    params: { text: '真正被看见的一句话', enter: 'from-left' },
  },
  'typography/lower-third@1.0': {
    name: '左下身份条',
    description: '贴左滑入的姓名 / 职务双行条，方角深色底板。',
    tags: ['文字', '身份', '左下'],
    params: { title: '林知远', subtitle: '产品设计负责人' },
  },
  'typography/tag-float@1.0': {
    name: '右上关键词气泡',
    description: '右上角圆角胶囊 + 小尖角，上浮入场、下沉出场。',
    tags: ['文字', '关键词', '气泡'],
    params: { text: '关键结论' },
  },
  'typography/center-emphasis@1.0': {
    name: '居中大字强调',
    description: '压在主体身上的居中大字；模板库唯一会触发遮挡预算的叠加模板。',
    tags: ['文字', '强调', '遮挡'],
    params: { text: '记住这一点' },
  },
  'data/stat-card@1.0': {
    name: '数字卡片',
    description: '大号数字 + 小号单位的卡片，缩放落定；刻意不做 digit roll。',
    tags: ['数据', '数字', '卡片'],
    params: { value: '3.2x', unit: '效率提升' },
  },
  'carrier/split-frame@1.0': {
    name: '裁切分屏',
    description: '把视频裁成一条竖屏窗口并锚定主体，另一侧留给 overlay。',
    tags: ['背景链', '分屏', '主体'],
    params: { side: 'right', ratio: 0.5 },
  },
  'cinematic/punch-in@1.0': {
    name: '画面推近',
    description: '对视频做缓慢推近 / 回退；作用于背景链，不覆盖画面。',
    tags: ['背景链', '推近', '镜头'],
    params: { scale: 1.12 },
  },
  'ambience/noise-grain@1.0': {
    name: '胶片颗粒',
    description: '全屏 feTurbulence 颗粒层，每帧重排但完全由 frame 决定。',
    tags: ['氛围', '颗粒', '全屏'],
    params: { opacity: 0.08 },
  },

  // ── 内置：声明了但未实现 ───────────────────────────────────
  'annotation/pointer-callout@1.0': {
    name: '指向标注',
    description: '指向主体 / 物体的标注；组件尚未实现。',
    tags: ['标注', '指向', '未实现'],
  },
  'transition/whip-pan@1.0': {
    name: '甩镜头转场',
    description: '全屏甩镜头转场；组件尚未实现。',
    tags: ['转场', '全屏', '未实现'],
  },

  // ── MotionSpec：custom/* ───────────────────────────────────
  'custom/fade-up@1.0': {
    name: '淡入上移',
    description: '淡入 + 上移 + 微缩放的绝对帧入场，之后保持到句尾。',
    tags: ['文字', '入场', '淡入'],
    params: { main: '动效预览文本' },
  },
  'custom/typewriter-cn@1.0': {
    name: '中文打字机',
    description: '中文逐字显现，像被逐键敲出来。',
    tags: ['文字', '逐字', '揭示'],
    params: { main: '动效预览文本' },
  },
  'custom/bar-accent@1.0': {
    name: '强调色条',
    description: '在文字旁生成一条强调色条，先出条后出字。',
    tags: ['装饰', '色条', '强调'],
    params: { main: '动效预览文本' },
  },
  'custom/rule-underline@1.0': {
    name: '下划线描画',
    description: '文字下方一条横线从左向右描出。',
    tags: ['装饰', '下划线', '描画'],
    params: { main: '动效预览文本' },
  },
  'custom/focus-in@1.0': {
    name: '聚焦入场',
    description: '从轻微失焦 + 放大状态收束到清晰落位。',
    tags: ['文字', '聚焦', '入场'],
    params: { main: '动效预览文本' },
  },
  'custom/card-stack@1.0': {
    name: '卡片堆叠',
    description: '多层卡片依次落下堆叠，最后露出主文本。',
    tags: ['卡片', '堆叠', '面板'],
    params: { main: '动效预览文本' },
  },
  'custom/clip-reveal-h@1.0': {
    name: '横向裁切揭示',
    description: '用横向裁切窗把文字从左到右揭示出来。',
    tags: ['文字', '裁切', '揭示'],
    params: { main: '动效预览文本' },
  },
  'custom/wipe-reveal@1.0': {
    name: '擦除揭示',
    description: '一条擦除边界扫过画面，带出完整文字。',
    tags: ['文字', '擦除', '揭示'],
    params: { main: '动效预览文本' },
  },
};

export interface GalleryPreview {
  durationInFrames: number;
  frames: number[];
  params: Record<string, unknown>;
  caption?: CaptionData;
}

export interface TemplateCatalogEntry {
  id: string;
  family: string;
  subtype: string;
  version: string;
  scope: string;
  layer: number;
  occludesSubject: boolean;
  status: string;
  implemented: boolean;
  paramsSchema: Record<string, string>;
  requiredParams: string[];
  footprint: Footprint;
  minVisibleInFrames: number;
  name: string;
  description: string;
  tags: string[];
  license: string;
  provenance: string;
  preview: GalleryPreview | null;
}

/**
 * 从注册表生成目录。
 *
 * ⚠️ 调用方必须**先**装载 spec（`loadSpecsFromDisk()`）——
 *    `custom/*` 不在注册表里时，它们根本不会出现在目录中。
 */
export function buildTemplateCatalog(): TemplateCatalogEntry[] {
  return listTemplates()
    .map((decl) => {
      const meta = META[decl.id];
      const implemented = isImplemented(decl.id);
      const requiredParams = [...(decl.requiredParams ?? [])];
      const params =
        meta?.params ??
        Object.fromEntries(requiredParams.map((key) => [key, '示例文本']));
      return {
        id: decl.id,
        family: decl.family,
        subtype: decl.subtype,
        version: decl.version,
        scope: decl.scope,
        layer: decl.layer,
        occludesSubject: decl.occludesSubject,
        status: decl.status,
        implemented,
        paramsSchema: { ...decl.paramsSchema },
        requiredParams,
        footprint: [...decl.footprint] as Footprint,
        minVisibleInFrames: decl.minVisibleInFrames,
        name: meta?.name ?? decl.subtype,
        description: meta?.description ?? '',
        tags: meta?.tags ?? [decl.family],
        license: 'MIT',
        provenance:
          decl.family === 'custom'
            ? `templates/specs/${decl.subtype}.json`
            : 'src/templates/builtin.ts',
        preview: implemented
          ? {
              durationInFrames: PREVIEW_DURATION,
              frames: [...PREVIEW_FRAMES],
              params: { ...params },
              ...(meta?.caption === undefined ? {} : { caption: meta.caption }),
            }
          : null,
      } satisfies TemplateCatalogEntry;
    })
    // 用码位比较而不是 `localeCompare`：后者依赖运行环境的 locale，
    // 同一份模板表在不同机器上可能排出不同顺序 —— 画廊要求逐字节可复现。
    .sort((a, b) => {
      if (a.family !== b.family) return a.family < b.family ? -1 : 1;
      if (a.id === b.id) return 0;
      return a.id < b.id ? -1 : 1;
    });
}

/** 目录条目 → 单 item 预览故事板（fromFrame 固定 0，时长取预览时长）。 */
export function buildGalleryItem(entry: TemplateCatalogEntry): StoryboardItem {
  if (entry.preview === null) {
    throw new Error(`模板 ${entry.id} 未实现，没有可渲染的预览 item`);
  }
  return {
    fromFrame: 0,
    durationInFrames: entry.preview.durationInFrames,
    motion: entry.id,
    footprint: [...entry.footprint] as Footprint,
    params: { ...entry.preview.params },
  };
}

/** 文件系统安全且唯一的预览图 slug。 */
export function gallerySlug(id: string): string {
  const safe = id.replace(/[/@]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!safe) throw new Error(`无法为模板 id 生成 slug：${JSON.stringify(id)}`);
  return safe;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

const FRAME_LABELS = ['入场', '中段', '收尾'];

/**
 * 生成离线 gallery.html。
 *
 * 约束：不引用任何外部资源（无 CDN / 字体 / 脚本），
 * 同一份 catalog 必须产出逐字节相同的 HTML。
 */
export function renderGalleryHtml(entries: readonly TemplateCatalogEntry[]): string {
  const implemented = entries.filter((e) => e.implemented);
  const missing = entries.filter((e) => !e.implemented);

  const cards = entries
    .map((entry) => {
      const slug = gallerySlug(entry.id);
      const tags = entry.tags
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join('');
      const params = entry.preview
        ? `<code class="params">${escapeHtml(JSON.stringify(entry.preview.params))}</code>`
        : '';
      if (entry.preview === null) {
        return `
      <article class="card missing" data-gallery-card="0" data-motion="${escapeHtml(entry.id)}" id="${slug}">
        <div class="missing-box"><span>未实现</span><small>渲染期为 Placeholder</small></div>
        <div class="body">
          <div class="title-row"><h2>${escapeHtml(entry.name)}</h2><span class="badge warn">未实现</span></div>
          <code class="id">${escapeHtml(entry.id)}</code>
          <p>${escapeHtml(entry.description)}</p>
          <div class="tags">${tags}</div>
          <dl>
            <dt>scope</dt><dd>${escapeHtml(entry.scope)}</dd>
            <dt>状态</dt><dd>${escapeHtml(entry.status)}</dd>
            <dt>provenance</dt><dd>${escapeHtml(entry.provenance)}</dd>
          </dl>
        </div>
      </article>`;
      }

      const frames = entry.preview.frames
        .map(
          (frame, index) => `
          <figure>
            <img src="images/${slug}-f${frame}.png" alt="${escapeHtml(entry.name)} 第 ${index + 1} 帧预览" loading="lazy" />
            <figcaption>${FRAME_LABELS[index] ?? `第 ${index + 1} 帧`} · f${frame}</figcaption>
          </figure>`,
        )
        .join('');
      return `
      <article class="card" data-gallery-card="1" data-motion="${escapeHtml(entry.id)}" id="${slug}">
        <div class="shots">${frames}
        </div>
        <div class="body">
          <div class="title-row"><h2>${escapeHtml(entry.name)}</h2><span class="badge">${escapeHtml(entry.scope)}</span></div>
          <code class="id">${escapeHtml(entry.id)}</code>
          <p>${escapeHtml(entry.description)}</p>
          <div class="tags">${tags}</div>
          <dl>
            <dt>footprint</dt><dd>${escapeHtml(JSON.stringify(entry.footprint))}</dd>
            <dt>最短可见</dt><dd>${entry.minVisibleInFrames} 帧</dd>
            <dt>遮挡主体</dt><dd>${entry.occludesSubject ? '是' : '否'}</dd>
            <dt>预览参数</dt><dd>${params}</dd>
            <dt>provenance</dt><dd>${escapeHtml(entry.provenance)}</dd>
          </dl>
        </div>
      </article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VideoPipeline 模板预览画廊</title>
<style>
  :root { color-scheme: dark; --bg:#0b0f14; --card:#121922; --line:#243242; --ink:#e8eef5; --muted:#8ea0b8; --brand:#60a5fa; --warn:#fbbf24; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.6 system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  header { padding:32px 28px 20px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 8px; font-size:24px; letter-spacing:.02em; }
  .summary { color:var(--muted); }
  .summary b { color:var(--ink); }
  .note { margin-top:12px; padding:10px 12px; border:1px solid var(--line); border-radius:8px; color:var(--muted); background:#0e141b; }
  main { padding:24px 28px 64px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:18px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .shots { display:grid; grid-template-columns:repeat(3, 1fr); gap:1px; background:var(--line); }
  .shots figure { margin:0; background:#080b0f; }
  .shots img { display:block; width:100%; aspect-ratio:16/9; object-fit:cover; }
  .shots figcaption { padding:5px 8px; color:var(--muted); font-size:11px; }
  .body { padding:14px 16px 16px; }
  .title-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  h2 { margin:0; font-size:16px; }
  .badge { flex:none; padding:2px 8px; border:1px solid var(--brand); border-radius:999px; color:var(--brand); font-size:11px; }
  .badge.warn { border-color:var(--warn); color:var(--warn); }
  .id { display:block; margin:4px 0 8px; color:var(--muted); font-size:11px; word-break:break-all; }
  p { margin:0 0 10px; color:#c7d2de; }
  .tags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  .tag { padding:1px 7px; border-radius:999px; background:#1b2633; color:#a9bdd2; font-size:11px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:3px 10px; margin:0; font-size:12px; }
  dt { color:var(--muted); }
  dd { margin:0; word-break:break-all; }
  .params { color:#9ecbff; font-size:11px; }
  .missing { opacity:.85; }
  .missing-box { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:150px; background:repeating-linear-gradient(135deg,#2a2308,#2a2308 12px,#1d1805 12px,#1d1805 24px); color:var(--warn); border-bottom:1px solid var(--line); }
  .missing-box span { font-size:18px; font-weight:700; }
  .missing-box small { color:#c9a94a; }
  footer { padding:0 28px 40px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>VideoPipeline 模板预览画廊</h1>
  <div class="summary">已实现 <b>${implemented.length}</b> 个 · 未实现 <b>${missing.length}</b> 个 · 共 <b>${entries.length}</b> 个声明</div>
  <div class="note">预览使用合成底板（深色渐变 + 主体剪影），不代表最终素材上的遮挡效果。图片由 Remotion renderStill 逐帧产出，文件名与目录一一对应。</div>
</header>
<main>
  <div class="grid">
${cards}
  </div>
</main>
<footer>生成方式：<code>npm run templates:gallery</code> · 数据真源：模板注册表 + 渲染映射表</footer>
</body>
</html>
`;
}
