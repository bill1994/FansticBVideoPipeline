/**
 * 模板组件契约。
 *
 * 🔴 **为什么组件不自己调 `useCurrentFrame()`** ──────────────────
 * 1. **可测**：Remotion 的 `useCurrentFrame()` 依赖 React context，
 *    纯组件渲染测试必须包一层 Provider。用 frame 作 prop 传入后，
 *    测试可以直接 `renderToStaticMarkup(<X frame={12} ... />)`，
 *    不碰 context、**且能断言「不同帧产出不同 DOM」** ——
 *    这正是「动效真的在动」唯一可靠的自动化判据。
 * 2. **唯一读取点**：满足 E2 确定性红线（动画推进权属于 frame）时，
 *    整个渲染树只有 `MotionItem` 一处读时钟，出错时只需查一处。
 * 3. **纯函数**：`frame → JSX` 是纯函数，服务端渲染与 Studio 预览必然一致。
 *
 * ⚠️ 因此：**新增组件一律用本文件的 `TemplateComponent` 类型**，
 *    不要在组件内部调 `useCurrentFrame()`。想读时钟就加 prop。
 */

import type { CSSProperties, FC, ReactNode } from 'react';
import type { StoryboardItem } from '../../core/types.ts';
import { getTemplate } from '../../templates/registry.ts';
import type { CaptionData } from '../caption.ts';
import { estimateTextWidthPx } from '../../validate/text-metrics.ts';

/**
 * 所有模板组件的统一 props。
 *
 * `frame` 是 **item 内相对帧**（`<Sequence>` 已把绝对帧转成轨道内相对帧，
 * 而 `MotionItem` 又减去 item 起点）—— 0 表示 item 的第一帧。
 */
export interface TemplateProps {
  /** item 内相对帧，从 0 起。 */
  frame: number;
  /** item 总帧数（**相对**，非绝对帧）。 */
  durationInFrames: number;
  item: StoryboardItem;
  caption: CaptionData;
  /**
   * **载体类专属**：被包裹的实拍视频（或更内层的载体结构）。
   *
   * 叠加类组件收到的一律是 `undefined`；只有 `subject-transform` /
   * `footage-transform` 的组件会由 `Overlay` 传入 —— 它们的职责是
   * 「改变视频的呈现」，而不是「在视频上盖一层」（C6 双栈的语义分界）。
   *
   * 组件应把 children 放进自己的变换容器**原样透传**；
   * **不要** clone / 改 props / 假设它是什么 —— 它不是「内容」，是**下一层**。
   */
  children?: ReactNode;
  /**
   * 本次渲染的画面宽度（px）。**`P6` 用**：文字超出 `footprint` 时要缩到框内，
   * 而「框有多宽」= `footprint[2] × canvasWidth`，没有它算不出来。
   *
   * 缺省 1920（与旧行为等价），所以模板单测不需要构造 Remotion context。
   * `MotionItem` 会从 `useVideoConfig().width` 传真实值 —— P4 之后画面宽度
   * 不再是常量（竖屏/任意分辨率都可能）。
   */
  canvasWidth?: number;
}

export type TemplateComponent = FC<TemplateProps>;

/**
 * 读字符串参数。
 *
 * ⚠️ 返回 `''` 而非 `undefined`：**校验项 #16 已保证类型**，
 *    这里是防御性降级，不是校验。字符串拼接里 `undefined` 会渲染出
 *    字面量 "undefined"，那比空串糟糕得多。
 */
export function str(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  return typeof v === 'string' ? v : '';
}

/** 读数值参数；非有限值回退 `fallback`。 */
export function num(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 读布尔参数。 */
export function bool(params: Record<string, unknown> | undefined, key: string, fallback = false): boolean {
  const v = params?.[key];
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * 通用定位样式：把 `footprint`（0–1 归一化）转成绝对定位。
 *
 * ⚠️ **footprint 是「取全动画期最大包围盒」**（`types.ts` 定义），
 *    语义上它圈的是**空间**，不是时间 —— 所以这里不做 scale，
 *    只做定位。模板内部的进出场动画若会造成溢出（例如放大 1.1 倍），
 *    那是**校验器该拦的事**（footprint 应当已含动画期包围盒），
 *    组件不擅自改 footprint 去迁就动画。
 */
export function footprintStyle(item: StoryboardItem): CSSProperties {
  const [x, y, w, h] = item.footprint;
  return {
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    boxSizing: 'border-box',
  };
}

/**
 * 文字超出 `footprint` 时的**等比缩小比例**（`P6` 第一步，2026-10-19）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要（端到端审计 + 手感表实测）
 * ─────────────────────────────────────────────────────────────
 * 模板全部 `whiteSpace: nowrap` ⇒ 长文本**既不折行也不缩放**，直接跑出框
 * （真渲实测 16 中文字时 4 个模板全溢出，`stat-card` 甚至溢出画面）。
 * 而构建期校验 #17 只是**估算**，且已知低估（16 字实测溢出、估算说没超）。
 *
 * ⇒ 渲染期必须有一条**硬兜底**：算出来放不下就缩，保证不出画面。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么用估算而不是 DOM 测量
 * ─────────────────────────────────────────────────────────────
 * 渲染是确定性的：DOM 测量（`getBoundingClientRect`）在服务端渲染阶段拿不到，
 * 且会让「同一帧两次渲出不同结果」成为可能。字符估算虽然不精确，
 * 但**确定性**且与校验项 #17 同源 —— 两处口径一致才不会出现
 * 「校验说没超、渲染却缩了」这种互相打脸。
 *
 * 🔴 `minScale = 0.7`：缩到 0.7 以下就不像设计了，那是「该改文案」的信号。
 *    到下限后仍溢出，宁可让它溢出 —— 那说明这不是排版问题，是文案问题。
 */
export function fitScale(
  text: string,
  fontSizePx: number,
  footprintWidthPx: number,
  paddingPx = 0,
  minScale = 0.7,
): number {
  if (!text) return 1;
  const needed = estimateTextWidthPx(text, { fontSizePx });
  const available = Math.max(1, footprintWidthPx - paddingPx * 2);
  if (needed <= available) return 1;
  return Math.max(minScale, available / needed);
}

/**
 * 满铺一格（footprint 通常不占满屏，但强调类模板需要溢出可见）。 */
export function fillParent(children: ReactNode, extra?: CSSProperties): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...extra,
  };
}

/**
 * 按模板契约算出 `fitScale` 需要的两个数 —— **组件侧的 `textMetrics` 唯一入口**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它（2026-10-20，`fitScale` 铺开时发现）
 * ─────────────────────────────────────────────────────────────
 * `fitScale(text, fontSize, width, padding)` 要字号与内边距，而这两个数**已经在契约里**
 * （`TemplateDeclaration.textMetrics`）—— 校验项 #17 用的就是它。
 * 若每个组件各写一份字面量，会出现**同一个概念两个真源**，后果是：
 * · 改组件字号 → 校验器失准（`DUR.exit` / 契约字号事故的同款病）；
 * · 校验期与渲染期口径分叉 ⇒「校验说没超、渲染却缩了」互相打脸。
 *
 * 🔴 **实测已发生**：`stat-card` 与 `tag-float` 的 `fitScale` 调用把
 *    `border: 1.5px × 2 = 3px` 算进了 padding（51/43），
 *    而契约 `textMetrics` 只算 padding（48/40）⇒ **两套口径并存且无人守护**。
 *    实测 6–8 字符时两套口径结论相同，但文案再长一点就会给出相反判定。
 *
 * ⇒ 一律用本函数，**禁止在组件里写字号/padding 字面量**。
 *
 * @param motion `item.motion`（`family/subtype@version`）
 * @returns 契约声明的 `{ fontSizePx, paddingPx }`；
 *          模板未声明 `textMetrics` 时返回 `null`（该模板无可测文本，不应调`fitScale`）。
 */
export function templateTextMetrics(motion: string): { fontSizePx: number; paddingPx: number } | null {
  const m = getTemplate(motion).textMetrics;
  if (!m) return null;
  return { fontSizePx: m.fontSizePx, paddingPx: m.paddingPx ?? 0 };
}

/**
 * 便捷封装：按契约算出该缩多少。
 *
 * ⚠️ 模板未声明 `textMetrics` 时**返回 1（不缩）**而不是抛错 ——
 *    字幕带/载体类本就没有模型可填的长文本，不该因缺声明而崩掉整条渲染
 *    （同 `resolveEnter` 对未知预设「静默回退」的判断：渲染期不因参数缺失而毁掉整条）。
 *
 * @param text 要测量的主文本（**只测主文本**：多行模板按主行判定，与 `widthKeysOf` 同口径）
 */
export function fitScaleFor(
  text: string,
  motion: string,
  item: StoryboardItem,
  canvasWidth?: number,
): number {
  const m = templateTextMetrics(motion);
  if (!m) return 1;
  return fitScale(text, m.fontSizePx, item.footprint[2] * (canvasWidth ?? 1920), m.paddingPx);
}