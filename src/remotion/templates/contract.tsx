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
import type { CaptionData } from '../caption.ts';

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

/** 满铺一格（footprint 通常不占满屏，但强调类模板需要溢出可见）。 */
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