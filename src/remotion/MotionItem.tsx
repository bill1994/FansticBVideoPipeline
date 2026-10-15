import type { FC } from 'react';
import { useCurrentFrame } from 'remotion';
import type { StoryboardItem } from '../core/types.ts';
import { getTemplate } from '../templates/registry.ts';
import { EMPTY_CAPTION, type CaptionData } from './caption.ts';
import { getTemplateComponent } from './templates/index.tsx';

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
}> = ({ trackId, itemIndex, item, caption }) => {
  const frame = useCurrentFrame();
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
      />
    </div>
  );
};

/** item 内的归一化进度 0–1。纯函数，服务端与客户端结果一致。 */
export function normalizeFrame(frame: number, durationInFrames: number): number {
  if (durationInFrames <= 0) return 0;
  return Math.min(Math.max(frame / durationInFrames, 0), 1);
}