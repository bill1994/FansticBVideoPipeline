import type { FC, ReactNode } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { StoryboardItem } from '../core/types.ts';
import { getTemplate } from '../templates/registry.ts';
import { EMPTY_CAPTION, type CaptionData } from './caption.ts';
import { getTemplateComponent } from './templates/index.tsx';
import type { StylePack as PackStyle } from '../core/style-pack.ts';

/**
 * motion item 的渲染壳 —— 负责「定位 + 时间换算 + 分发」，**不负责画什么**。
 *
 * ⚠️ 本文件此前自述「渲染的是结构占位块，不是真正的动效实现」。
 *    那句话描述的是**病**（10 个模板渲染结果逐像素相同），
 *    D1 第一轮起已修：真正的实现在 `templates/<name>.tsx`，
 *    由 `getTemplateComponent()` 按 `motion id` 分发。
 *    本壳退回到它该干的活 —— 这是**职责收敛**，不是留个壳偷懒。
 *
 * 确定性红线（E2）：动画的推进权必须属于 frame。
 *   · **整个渲染树只有本组件一处调 `useCurrentFrame()`**
 *   · 子组件只收 `frame` prop（见 templates/contract.tsx），
 *     这样每个模板都是 `frame → JSX` 的纯函数，可直接单测
 *   · 禁 `Date.now()` / `performance.now()`
 *   · 禁 `Math.random()`（要用伪随机请走 mulberry32，seed 从 item index 派生）
 *   · 禁 CSS animation / transition
 *   · 禁 R3F `useFrame()`、禁非 paused 的 GSAP ticker
 */
export const MotionItem: FC<{
  trackId: string;
  itemIndex: number;
  item: StoryboardItem;
  caption?: CaptionData;
  /** 样式包（P1-4）：由 Overlay 从 render props 透传，缺省走 tokens。 */
  style?: PackStyle;
  /**
   * 载体类专属：被包裹的内层（实拍视频 / 更内层载体结构）。
   * 叠加类不传 —— 组件拿到的 children 恒为 `undefined`（见 contract.tsx）。
   */
  children?: ReactNode;
}> = ({ trackId, itemIndex, item, caption, style, children }) => {
  const frame = useCurrentFrame();
  // 画面宽度（P6）：模板要用它把 `footprint` 换算成像素宽，才能判断文字放不放得下。
  // P4 之后画面宽度不再是常量（竖屏/任意分辨率），不能由模板自己假设 1920。
  const { width: canvasWidth } = useVideoConfig();
  const tpl = getTemplate(item.motion);
  const Component = getTemplateComponent(item.motion);
  const cap = caption ?? EMPTY_CAPTION;

  return (
    <div
      data-track={trackId}
      data-item={itemIndex}
      data-motion={item.motion}
      data-scope={tpl.scope}
      style={{
        position: 'absolute',
        left: `${item.footprint[0] * 100}%`,
        top: `${item.footprint[1] * 100}%`,
        width: `${item.footprint[2] * 100}%`,
        height: `${item.footprint[3] * 100}%`,
      }}
    >
      <Component
        frame={frame}
        durationInFrames={item.durationInFrames}
        item={item}
        caption={cap}
        canvasWidth={canvasWidth}
        {...(style === undefined ? {} : { style })}
      >
        {children}
      </Component>
    </div>
  );
};