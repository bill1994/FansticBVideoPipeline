import type { FC } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { StoryboardItem } from '../core/types.ts';
import { getTemplate } from '../templates/registry.ts';

/**
 * motion item 的渲染壳。
 *
 * ⚠️ 这里渲染的是**结构占位块**，不是真正的动效实现 —— 模板库的首批实现
 *    属实现期任务（见 docs/spec 附录）。占位块的作用是让「双栈分离 / z 序 /
 *    时间映射」这三件最容易出错的事**在没有任何真实模板时也能被肉眼验证**。
 *
 * 确定性红线（E2）：动画的推进权必须属于 frame。
 *   · 只读 `useCurrentFrame()`
 *   · 禁 `Date.now()` / `performance.now()`
 *   · 禁 `Math.random()`（要用伪随机请走 mulberry32，seed 从 item index 派生）
 *   · 禁 CSS animation / transition
 *   · 禁 R3F `useFrame()`、禁非 paused 的 GSAP ticker
 */
export const MotionItem: FC<{
  trackId: string;
  itemIndex: number;
  item: StoryboardItem;
}> = ({ trackId, itemIndex, item }) => {
  const frame = useCurrentFrame();
  const tpl = getTemplate(item.motion);

  const [x, y, w, h] = item.footprint;
  const local = normalizeFrame(frame, item.durationInFrames);
  const opacity = interpolate(local, [0, 0.1, 0.9, 1], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const label = item.params && typeof item.params.text === 'string' ? item.params.text : tpl.subtype;

  return (
    <div
      data-track={trackId}
      data-item={itemIndex}
      data-motion={item.motion}
      data-scope={tpl.scope}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        opacity,
        border: '2px solid rgba(255,255,255,0.55)',
        background: 'rgba(20,24,28,0.45)',
        color: '#fff',
        fontFamily: 'monospace',
        fontSize: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 6,
        boxSizing: 'border-box',
      }}
    >
      <span>
        {item.motion}
        {label ? `\n${label}` : ''}
      </span>
    </div>
  );
};

/** item 内的归一化进度 0–1。纯函数，服务端与客户端结果一致。 */
export function normalizeFrame(frame: number, durationInFrames: number): number {
  if (durationInFrames <= 0) return 0;
  return Math.min(Math.max(frame / durationInFrames, 0), 1);
}
