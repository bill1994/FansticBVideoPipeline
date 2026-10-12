/**
 * 首批模板种子清单。
 *
 * ⚠️ 【实现期拟定，文档未点名】
 *    进度文档只规定「模板库首批清单」是**实现期第一件事**（§7 待补清单第 6 项），
 *    **未给出具体清单**。下面是可与管线跑通的最小种子集，不是文档结论。
 *
 * 契约字段含义见 ./types.ts；双轴 family × scope 的枚举值是文档明示的。
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
    paramsSchema: { highlightColor: 'string', boxed: 'boolean' },
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
