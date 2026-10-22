/**
 * TemplateGallery —— 单模板预览合成（P0-1 模板预览画廊）。
 *
 * 为什么单独做一个合成，而不是直接复用 `Overlay`：
 * · `Overlay` 需要完整 storyboard / 轨道 / 双栈划分，做一张预览图要构造一整套假产物；
 * · 本合成只渲染**一个 item**，直接走 `MotionItem`（与成片同一条渲染主链），
 *   背景换成固定的合成底板，避免预览图里出现 `[no source video]`。
 *
 * 🔴 确定性沿用全项目红线：本组件不读时钟，`frame` 仍由 `MotionItem` 唯一读取。
 */

import type { FC } from 'react';
import { AbsoluteFill } from 'remotion';
import type { StoryboardItem } from '../../core/types.ts';
import type { TemplateDeclaration } from '../../templates/types.ts';
import { isCarrierScope } from '../../templates/types.ts';
import { getTemplate, hydrateTemplates } from '../../templates/registry.ts';
import { MotionItem } from '../MotionItem.tsx';
import type { CaptionData } from '../caption.ts';

export type GalleryProps = {
  item: StoryboardItem;
  caption?: CaptionData;
  /** `custom/*` 的声明不在浏览器 bundle 里，必须随 props 送进来再 hydrate。 */
  templates?: TemplateDeclaration[];
};

export const DEFAULT_GALLERY_PROPS: GalleryProps = {
  item: {
    fromFrame: 0,
    durationInFrames: 90,
    motion: 'typography/kinetic-line@1.0',
    footprint: [0, 0.72, 0.42, 0.18],
    params: { text: '模板预览', enter: 'from-left' },
  },
};

/**
 * 合成底板 —— 深色渐变 + 版式网格 + 主体剪影。
 *
 * 剪影不是装饰：`center-emphasis` / `split-frame` 这类模板的语义就是
 * 「压在人身上」/「把人留在窗口里」，没有主体就预览不出它们的真实形态。
 * ⚠️ 它只用于画廊，不代表最终素材；gallery.html 里已显式注明。
 */
const Backdrop: FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(circle at 50% 36%, #1b2836 0%, #0d131a 56%, #080b0f 100%)',
    }}
  >
    <AbsoluteFill
      style={{
        backgroundImage:
          'linear-gradient(rgba(120,160,200,.07) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(120,160,200,.07) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
      }}
    />
    {/* 身体 */}
    <div
      style={{
        position: 'absolute',
        left: '37%',
        top: '19%',
        width: '26%',
        height: '64%',
        borderRadius: '46% 46% 18% 18% / 28% 28% 12% 12%',
        background: 'linear-gradient(180deg, #31465a, #1a2733)',
        border: '1px solid rgba(160,190,220,.22)',
        boxShadow: '0 24px 80px rgba(0,0,0,.45)',
      }}
    />
    {/* 头 */}
    <div
      style={{
        position: 'absolute',
        left: '43%',
        top: '23%',
        width: '14%',
        height: '14%',
        borderRadius: '50%',
        background: 'linear-gradient(180deg, #4a6176, #2a3a4a)',
        border: '1px solid rgba(180,205,230,.24)',
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: 28,
        top: 24,
        fontFamily: 'monospace',
        fontSize: 18,
        letterSpacing: 2,
        color: 'rgba(160,190,220,.55)',
      }}
    >
      PREVIEW BACKDROP
    </div>
  </AbsoluteFill>
);

export const TemplateGallery: FC<GalleryProps> = ({ item, caption, templates }) => {
  // 🔴 必须在任何 getTemplate 之前 hydrate：custom/* 的声明只存在于 Node 侧。
  hydrateTemplates(templates ?? []);
  const carrier = isCarrierScope(getTemplate(item.motion).scope);

  return (
    <AbsoluteFill style={{ backgroundColor: '#080b0f' }}>
      {carrier ? null : <Backdrop />}
      <MotionItem trackId="gallery" itemIndex={0} item={item} caption={caption}>
        <Backdrop />
      </MotionItem>
    </AbsoluteFill>
  );
};
