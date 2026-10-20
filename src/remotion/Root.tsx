import type { FC } from 'react';
import { Composition } from 'remotion';
import { Overlay, type RenderProps } from './Overlay.tsx';

/**
 * 合成入口。
 *
 * 时长 / fps / **画面尺寸**都不写死 —— 它们必须来自 `05-render/render-props.json`
 * （尺寸由 `core/video-size.ts` 的 `resolveRenderSize()` 决定：清单 → ffprobe → 兜底）。
 * 写死会让「fps 与烘焙绑定」与「素材分辨率进契约」两条约束同时形同虚设。
 */

const DEFAULT_RENDER_PROPS: RenderProps = {
  jobId: '',
  fps: 30,
  durationInFrames: 1,
  video: '',
  hasVideo: false,
  storyboard: {
    meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0 },
    tracks: [],
    noMotionRanges: [],
  },
  stacks: { background: [], overlay: [] },
  carrierTracks: [],
};

/**
 * Remotion 的 `Composition` 泛型参数第一位是 Zod schema，props 类型靠推断，
 * 推不出我们这份「无 schema / 纯 TS 类型」的 props。这里给出一个窄化的函数签名，
 * 换取 `component` / `defaultProps` / `calculateMetadata` 三者的类型一致。
 */
const TypedComposition = Composition as unknown as FC<{
  id: string;
  component: FC<RenderProps>;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps: RenderProps;
  calculateMetadata: (args: { props: RenderProps }) => {
    fps: number;
    durationInFrames: number;
    width: number;
    height: number;
  };
}>;

export const RemotionRoot = () => {
  return (
    <TypedComposition
      id="Overlay"
      component={Overlay}
      width={1920}
      height={1080}
      fps={DEFAULT_RENDER_PROPS.fps}
      durationInFrames={DEFAULT_RENDER_PROPS.durationInFrames}
      defaultProps={DEFAULT_RENDER_PROPS}
      calculateMetadata={({ props }) => ({
        fps: props.fps,
        // Remotion 要求 durationInFrames ≥ 1；素材时长为 0 时给出显式下限而非静默截断
        durationInFrames: Math.max(1, props.durationInFrames),
        // P4：素材分辨率进契约后，画面尺寸由 props 决定（缺省 1920×1080，与旧行为等价）
        width: props.width ?? 1920,
        height: props.height ?? 1080,
      })}
    />
  );
};
