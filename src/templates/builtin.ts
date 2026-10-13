/**
 * 首批模板清单。
 *
 * ✅ 清单与契约值已定：`docs/templates/2026-10-13-模板库首批清单.md`
 *    （首批 10 个，逐个模板的`layer` / `occludesSubject` / `footprint` /
 *    `minVisibleInFrames` 推导依据，以及 7 条扩补纪律均在文档中）
 *
 * 真源：SPEC §3（双轴框架 + §3.5 首批清单指向）。
 *
 * 三个容易踩的点（文档 §2.2 有详述，此处只留提醒）：
 * - `scope` 与 `occludesSubject` 是**两个独立维度** ——
 *   `ambience/noise-grain` 是 fullscreen 但 `occludesSubject: false`。
 * - `caption/karaoke-word` 的 `paramsSchema` **不含 `text`** ——
 *   字幕文本来自 SRT，不是模型自由填写。
 * - 依赖 perceive 主体框的两个模板标 `experimental`，
 *   因 perceive 模型尚未接入（`PERCEIVER_CMD` 未配置时退出码 2）。
 *
 * 版本已锁：`@1.0`。升级走 `@1.1` 新增，**不改旧 storyboard**。
 */

import type { TemplateDeclaration } from './types.ts';

export const BUILTIN_TEMPLATES: TemplateDeclaration[] = [
  // ── caption（B6 必备家族）────────────────────────────────────
  {
    id: 'caption/karaoke-word@1.0',
    family: 'caption',
    subtype: 'karaoke-word',
    version: '1.0',
    scope: 'overlay-safe',
    layer: 90,
    occludesSubject: false,
    status: 'core',
    // 🔴 刻意**不含 `text`**（P1）：字幕文本来自 SRT，不是模型自由填写。
    //    模型若也能写 text，就会出现「字幕与语音对不上」，而时序校验只看帧区间、
    //    任何校验项都拦不住。
    // 🔴 刻意**不含 `highlightColor`**：Spec 附录 A 第 1 条硬约束明文
    //    「禁写坐标 / 帧数 / **颜色** / CSS」。留着它等于让模型能硬编码色值。
    //    高亮色由渲染期按命名令牌（'brand' | 'accent'）解析，不经 params。
    paramsSchema: { boxed: 'boolean' },
    // `boxed` **不标必填**：它有天然默认值（无框），强制模型写 `boxed:false`
    // 是纯噪音，违反「不让模型为默认值做无谓决策」的立法意图。
    // ⚠️ 本模板因此**没有任何必填参数** —— 字幕的一切都来自 SRT。
    footprint: [0.1, 0.86, 0.8, 0.1],
    minVisibleInFrames: 12,
  },

  // ── typography ──────────────────────────────────────────────
  {
    id: 'typography/kinetic-line@1.0',
    family: 'typography',
    subtype: 'kinetic-line',
    version: '1.0',
    scope: 'overlay-safe',
    layer: 60,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { text: 'string', enter: 'string' },
    requiredParams: ['text'], // enter 有天然默认值，可选
    footprint: [0, 0.72, 0.42, 0.18],
    minVisibleInFrames: 30,
    handoffIn: 'from-left',
  },
  {
    id: 'typography/lower-third@1.0',
    family: 'typography',
    subtype: 'lower-third',
    version: '1.0',
    scope: 'overlay-safe',
    layer: 60,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { title: 'string', subtitle: 'string' },
    requiredParams: ['title'], // subtitle 可选
    footprint: [0.05, 0.78, 0.5, 0.14],
    minVisibleInFrames: 45,
  },
  {
    id: 'typography/tag-float@1.0',
    family: 'typography',
    subtype: 'tag-float',
    version: '1.0',
    scope: 'overlay-safe',
    layer: 60,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { text: 'string' },
    requiredParams: ['text'],
    footprint: [0.5, 0.1, 0.3, 0.2],
    minVisibleInFrames: 36,
    handoffIn: 'fade-up',
  },

  // ── data ────────────────────────────────────────────────────
  {
    id: 'data/stat-card@1.0',
    family: 'data',
    subtype: 'stat-card',
    version: '1.0',
    scope: 'overlay-safe',
    layer: 55,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { value: 'string', unit: 'string' },
    requiredParams: ['value'], // unit 可选
    footprint: [0.62, 0.12, 0.32, 0.24],
    minVisibleInFrames: 45,
  },

  // ── annotation ──────────────────────────────────────────────
  {
    id: 'annotation/pointer-callout@1.0',
    family: 'annotation',
    subtype: 'pointer-callout',
    version: '1.0',
    scope: 'anchored',
    layer: 70,
    occludesSubject: false,
    status: 'experimental',
    paramsSchema: { target: 'string' },
    requiredParams: ['target'], // 无 target 则标注无指向对象，语义上必填
    footprint: [0.3, 0.3, 0.2, 0.2],
    minVisibleInFrames: 24,
  },

  // ── carrier / cinematic（载体类：作用于实拍视频本身）────────
  {
    id: 'carrier/split-frame@1.0',
    family: 'carrier',
    subtype: 'split-frame',
    version: '1.0',
    scope: 'subject-transform',
    layer: 5,
    occludesSubject: true,
    status: 'experimental',
    paramsSchema: { inset: 'number' },
    footprint: [0.5, 0, 0.5, 1],
    minVisibleInFrames: 30,
  },
  {
    id: 'cinematic/punch-in@1.0',
    family: 'cinematic',
    subtype: 'punch-in',
    version: '1.0',
    scope: 'footage-transform',
    layer: 1,
    occludesSubject: true,
    status: 'core',
    paramsSchema: { scale: 'number' },
    footprint: [0, 0, 1, 1],
    minVisibleInFrames: 24,
  },

  // ── transition / ambience（fullscreen：必然覆盖全画面）───────
  {
    id: 'transition/whip-pan@1.0',
    family: 'transition',
    subtype: 'whip-pan',
    version: '1.0',
    scope: 'fullscreen',
    layer: 100,
    occludesSubject: true,
    status: 'core',
    paramsSchema: { direction: 'string' },
    footprint: [0, 0, 1, 1],
    minVisibleInFrames: 10,
  },
  {
    id: 'ambience/noise-grain@1.0',
    family: 'ambience',
    subtype: 'noise-grain',
    version: '1.0',
    scope: 'fullscreen',
    layer: 0,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { opacity: 'number' },
    footprint: [0, 0, 1, 1],
    minVisibleInFrames: 60,
  },
];
