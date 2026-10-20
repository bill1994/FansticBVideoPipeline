/**
 * 占位组件 —— 声明存在但渲染实现尚未落地时使用（S1b 抽出为独立文件）。
 *
 * ⚠️ 它与「真实现」在视觉上刻意不同：
 * ·真实现有品牌色/字号/结构；占位块是**等宽灰框 + 斜纹底**
 * · 斜纹（repeating-linear-gradient）是**故意丑的**：它的作用是
 *   在成片里显眼地告诉审片人「这里欠一个实现」，而不是让人
 *   误以为已经做完了。
 *
 * 🔴 若某个模板最终落到这里，validate 阶段不报错（它**不知道**渲染层实现情况），
 *    所以这条信息**只存在于成片里** —— 这也是为什么需要 `data-template-missing`。
 *
 * ⚠️ 从 `templates/index.tsx` 抽出的理由：`SpecRenderer` 也要用它
 *    （spec 缺失时诚实留空），若留在 index 里会形成
 *    `index → SpecRenderer → index` 的运行时循环依赖。
 */

import type { FC } from 'react';
import type { TemplateProps } from './contract.tsx';

export interface PlaceholderProps extends TemplateProps {
  /** 具体缺失原因（如「spec 缺失」），显示在占位块第二行。 */
  reason?: string;
}

export const Placeholder: FC<PlaceholderProps> = ({ frame, item, reason }) => {
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
      <span style={{ fontSize: 13, opacity: 0.85 }}>
        {reason ?? '声明已在册，渲染实现待落地'}
      </span>
    </div>
  );
};
