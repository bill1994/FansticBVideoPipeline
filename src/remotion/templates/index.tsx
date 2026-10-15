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
 *    D-A 加 `typography/center-emphasis`（首个遮挡型叠加）——
 *    未实现的一律不进本表，退回 `Placeholder`）。
 *    其余 3 个的落地时点见优化计划书 §4.6「第1/2/3/4/5 批」。
 */

import type { FC } from 'react';
import { BUILTIN_TEMPLATES } from '../../templates/builtin.ts';
import type { TemplateComponent, TemplateProps } from './contract.tsx';
import { KaraokeWord } from './karaoke-word.tsx';
import { KineticLine } from './kinetic-line.tsx';
import { LowerThird } from './lower-third.tsx';
import { TagFloat } from './tag-float.tsx';
import { StatCard } from './stat-card.tsx';
import { PunchIn } from './punch-in.tsx';
import { NoiseGrain } from './noise-grain.tsx';
import { CenterEmphasis } from './center-emphasis.tsx';

/**
 * 占位组件 —— 声明存在但实现尚未落地时使用。
 *
 * ⚠️ 它与「真实现」在视觉上刻意不同：
 * ·真实现有品牌色/字号/结构；占位块是**等宽灰框 + 斜纹底**
 * · 斜纹（repeating-linear-gradient）是**故意丑的**：它的作用是
 *   在成片里显眼地告诉审片人「这里欠一个实现」，而不是让人
 *   误以为已经做完了。
 *
 * 🔴 若某个模板最终落到这里，validate 阶段不报错（它**不知道**渲染层实现情况），
 *    所以这条信息**只存在于成片里** —— 这也是为什么需要 `data-template-missing`。
 */
const Placeholder: FC<TemplateProps> = ({ frame, item }) => {
  // 仍在动（斜纹滚动），让占位块也遵守「动画属于 frame」——
  // 用 background-position 表达，不用 CSS animation。
  const shift = (frame * 4) % 24;
  return (
    <div
      data-template="placeholder"
      data-template-missing="1"
      data-motion={item.motion}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        background: `repeating-linear-gradient(45deg, rgba(255,197,61,0.10) 0px, rgba(255,197,61,0.10) 12px, transparent 12px, transparent 24px) 0px ${shift}px / auto`,
        border: '2px dashed rgba(255,197,61,0.6)',
        color: '#FFC53D',
        fontFamily: 'monospace',
        fontSize: 16,
        textAlign: 'center',
        padding: 8,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontWeight: 700 }}>未实现：{item.motion}</span>
      <span style={{ fontSize: 13, opacity: 0.85 }}>声明已在册，渲染实现待落地</span>
    </div>
  );
};

/** 已实现模板的映射。键为 `family/subtype@version`，**必须与 builtin.ts 的 id 逐字相同**。 */
const IMPLEMENTED: Record<string, TemplateComponent> = {
  'caption/karaoke-word@1.0': KaraokeWord,
  'typography/kinetic-line@1.0': KineticLine,
  'typography/lower-third@1.0': LowerThird,
  'typography/tag-float@1.0': TagFloat,
  'data/stat-card@1.0': StatCard,
  // ── 批次 2（不依赖 perceive / D4）────────────────────────────
  // punch-in 是首个背景链实现：它**包裹视频**（children 透传），
  // 机制见 src/remotion/carrier.tsx；noise-grain 是首个 fullscreen 实现。
  'cinematic/punch-in@1.0': PunchIn,
  'ambience/noise-grain@1.0': NoiseGrain,
  // ── D-A（2026-10-16）：首个会遮挡主体的叠加模板 ───────────────
  'typography/center-emphasis@1.0': CenterEmphasis,
};

/** 取组件；未实现则返回 `Placeholder`。**永不抛错**。 */
export function getTemplateComponent(motion: string): FC<TemplateProps> {
  return IMPLEMENTED[motion] ?? Placeholder;
}

/** 该 motion 是否已有真实实现。测试与自检用。 */
export function isImplemented(motion: string): boolean {
  return motion in IMPLEMENTED;
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
  const orphans = Object.keys(IMPLEMENTED).filter((id) => !declared.has(id));
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