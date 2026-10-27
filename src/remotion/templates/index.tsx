/**
 * 渲染期模板映射表 —— `motion id → React 组件`。
 *
 * 🔴 **这是 D1「产出无价值」的真正病根所在。**
 *    此前`getTemplate()` 只返回**声明**（scope / layer / paramsSchema…），
 *    从 id 到**组件**之间没有任何映射，于是 `MotionItem` 只能统一画一个灰框
 *    —— **10 个模板渲染结果逐像素相同**。
 *
 * ── 本表的三条纪律 ─────────────────────────────────────────────
 * 1. **未实现 ≠ 画成别的**。查不到实现时落 `Placeholder`，并打
 *    `data-template-missing="1"` 标记：让「还没做」在成片里**看得见**，
 *    而不是伪装成已实现。诚实留空优于占位冒充。
 * 2. **启动期自检**：声明了但没实现的模板，在`assertRenderMapValid()`
 *    里被列成一张清单 —— 加模板忘了写实现，会立刻在自检里暴露。
 * 3. **本表只收有真实实现的模板**（D1 第一轮 5 个 `overlay-safe`；
 *    批次 2 加 `cinematic/punch-in`（背景链）/ `ambience/noise-grain`（fullscreen）；
 *    D-A 加 `typography/center-emphasis`（首个遮挡型叠加）；
 *    D4-t2 的 P2 加 `carrier/split-frame`（首个**裁切型**背景链）——
 *    未实现的一律不进本表，退回 `Placeholder`）。
 *    其余 2 个的落地时点见优化计划书 §4.6「第 4/5 批」。
 */

import type { FC } from 'react';
import { BUILTIN_TEMPLATES } from '../../templates/builtin.ts';
import { getTemplate, hasTemplate } from '../../templates/registry.ts';
import type { TemplateComponent, TemplateProps } from './contract.tsx';
import { Placeholder } from './placeholder.tsx';
import { SpecRenderer } from './SpecRenderer.tsx';
import { KaraokeWord } from './karaoke-word.tsx';
import { KineticLine } from './kinetic-line.tsx';
import { LowerThird } from './lower-third.tsx';
import { TagFloat } from './tag-float.tsx';
import { MarkerUnderline } from './marker-underline.tsx';
import { OutlineFill } from './outline-fill.tsx';
import { StatCard } from './stat-card.tsx';
import { PunchIn } from './punch-in.tsx';
import { NoiseGrain } from './noise-grain.tsx';
import { CenterEmphasis } from './center-emphasis.tsx';
import { SplitFrame } from './split-frame.tsx';
import { PointerCallout } from './pointer-callout.tsx';
import { WhipPan } from './whip-pan.tsx';

/** 已实现模板的映射。键为 `family/subtype@version`，**必须与 builtin.ts 的 id 逐字相同**。 */
const IMPLEMENTED: Record<string, TemplateComponent> = {
  'caption/karaoke-word@1.0': KaraokeWord,
  'typography/kinetic-line@1.0': KineticLine,
  'typography/lower-third@1.0': LowerThird,
  'typography/tag-float@1.0': TagFloat,
  'typography/marker-underline@1.0': MarkerUnderline,
  'typography/outline-fill@1.0': OutlineFill,
  'data/stat-card@1.0': StatCard,
  // ── 批次 2（不依赖 perceive / D4）────────────────────────────
  // punch-in 是首个背景链实现：它**包裹视频**（children 透传），
  // 机制见 src/remotion/carrier.tsx；noise-grain 是首个 fullscreen 实现。
  'cinematic/punch-in@1.0': PunchIn,
  'ambience/noise-grain@1.0': NoiseGrain,
  // ── D-A（2026-10-16）：首个会遮挡主体的叠加模板 ───────────────
  'typography/center-emphasis@1.0': CenterEmphasis,
  // ── D4-t2 P2（2026-10-17）：首个**裁切型**背景链 ─────────────
  // 与 punch-in 的差别：punch-in 改的是「放大」（footprint 全屏），
  // split-frame 改的是「**画面被劈开、视频挪到一侧**」——
  // 正因如此，它的可见区域不在 footprint 上而在 params.window 上（见 core/carrier-window.ts）。
  'carrier/split-frame@1.0': SplitFrame,
  // ── 2026-10-24：补齐最后两个声明（11/11）─────────────────────
  // pointer-callout 是唯一 `anchored` 实现：footprint 即目标区域；
  // whip-pan 是唯一 fullscreen 转场，触发 D3-a 人工确认闸。
  'annotation/pointer-callout@1.0': PointerCallout,
  'transition/whip-pan@1.0': WhipPan,
};

/**
 * 取组件；未实现则返回 `Placeholder`。**永不抛错**。
 *
 * 🔴 `custom/*` 走**通配分发**（S1b）：spec 模板没有手写组件，
 *    统一由 `SpecRenderer` 按 spec 出画面。`SpecRenderer` 内部再查 spec，
 *    缺失时自己退回 Placeholder —— 这样旧 job 引用了已删除的 spec 也不会崩。
 */
export function getTemplateComponent(motion: string): FC<TemplateProps> {
  const exact = IMPLEMENTED[motion];
  if (exact) return exact;
  if (motion.startsWith('custom/')) return SpecRenderer;
  return Placeholder;
}

/**
 * 该 motion 是否已有真实实现。测试与自检用。
 *
 * `custom/*` 的「已实现」= 注册表里有带 `spec` 的声明（否则 SpecRenderer
 * 会退回占位块，不能算实现）。
 */
export function isImplemented(motion: string): boolean {
  if (motion in IMPLEMENTED) return true;
  if (!motion.startsWith('custom/') || !hasTemplate(motion)) return false;
  return getTemplate(motion).spec !== undefined;
}

/** 已实现模板的 id 清单。 */
export function listImplemented(): string[] {
  return Object.keys(IMPLEMENTED).sort();
}

/** 声明了但尚未实现的模板 id 清单。 */
export function listUnimplemented(): string[] {
  return BUILTIN_TEMPLATES.map((t) => t.id).filter((id) => !(id in IMPLEMENTED)).sort();
}

/**
 * 启动期自检：**映射表里的 id 必须与 builtin.ts 的声明逐字对应**。
 *
 * 🔴 查这一条是因为最危险的错不是"少写一个实现"，而是
 *    **拼错 id**（如 `karaoke-word@1.1`、`typography/kinetic_line`）。
 *    拼错 ⇒ `IMPLEMENTED[id]` 永远命中不了 ⇒ 该模板静默退回占位块，
 *    而**校验全绿、单测全过、类型检查通过** —— 没人会发现。
 *    这类错只有显式比对两张表才能兜住。
 */
export function assertRenderMapValid(): void {
  const declared = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
  // `custom/*` 不写进 IMPLEMENTED（走通配分发）——若将来有人硬登记，
  // 它也不在 builtin 声明里，这里跳过前缀避免被误判 orphan。
  const orphans = Object.keys(IMPLEMENTED).filter(
    (id) => !declared.has(id) && !id.startsWith('custom/'),
  );
  if (orphans.length > 0) {
    throw new Error(
      `渲染映射表里有未声明的模板 id：${orphans.join(', ')}。` +
        `id 拼错（如版本号 / 下划线）会让该模板静默退回占位块，` +
        `且校验与类型检查都发现不了。请与 src/templates/builtin.ts 逐字比对。`,
    );
  }
}

/** 已实现数 / 声明总数 —— 用于日志与文档同步。 */
export function renderCoverage(): { implemented: number; declared: number } {
  return { implemented: Object.keys(IMPLEMENTED).length, declared: BUILTIN_TEMPLATES.length };
}