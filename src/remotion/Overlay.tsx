import type { FC, ReactNode } from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence } from 'remotion';
import { MotionItem } from './MotionItem.tsx';
import type { Storyboard, StoryboardTrack } from '../core/types.ts';
import { EMPTY_CAPTION, type CaptionData } from './caption.ts';
import { isCarrierScope, getScopeOf } from './scope.ts';
import { CarrierTimeline } from './carrier.tsx';

/**
 * 渲染 props —— 由 `05-render/render-props.json` 经 `--props` 注入。
 *
 * 用 `type` 而非 `interface`：Remotion 的 `Composition<Props>` 约束
 * `Props extends Record<string, unknown>`，而 interface 没有隐式索引签名。
 */
export type RenderProps = {
  jobId: string;
  fps: number;
  durationInFrames: number;
  /** 相对 05-render/ 的视频路径；渲染时由 --props 传入。 */
  video: string;
  /** 素材是否真实存在。不存在时渲染占位底，便于无素材环境下做结构自检。 */
  hasVideo: boolean;
  storyboard: Storyboard;
  stacks: { background: string[]; overlay: string[] };
  /**
   * 影子载体轨（D4-t3）—— 由「叠加 item 上的 `carrier` 声明」在 render 侧合成。
   *
   * 🔴 它**不在** `storyboard.tracks` 里：`storyboard` 必须保持模型产物的原貌，
   *    否则 `03-storyboard/storyboard.json` 与渲染输入就会说两套话。
   *    缺省 `[]` ⇒ 与旧行为完全等价（无 carrier 声明时什么都不合成）。
   */
  carrierTracks?: StoryboardTrack[];
  /**
   * 字幕数据（词级时间戳 + cue），来自 `01-align/words.json`。
   *
   * 🔴 这是 `caption/karaoke-word` 的**唯一**文本来源 ——
   *    该模板刻意不声明 `text` 参数（P1：字幕文本来自 SRT，不是模型自由填写）。
   *    缺它 ⇒ 字幕模板无文本可显示，这是数据缺口的诚实表现，不是 bug。
   *
   * ⚠️ 可选：`align` 未跑或 `words.json` 不存在时缺失，模板降级为空序列。
   */
  caption?: CaptionData;
};

/** 单个 track 的渲染片段（不含定位）。 */
const TrackBody: FC<{ track: StoryboardTrack; caption: CaptionData }> = ({ track, caption }) => {
  const start = Math.min(...track.items.map((i) => i.fromFrame));
  return (
    <>
      {track.items.map((item, idx) => (
        <Sequence
          key={`${track.id}-${idx}`}
          from={item.fromFrame - start}
          durationInFrames={item.durationInFrames}
        >
          <MotionItem trackId={track.id} itemIndex={idx} item={item} caption={caption} />
        </Sequence>
      ))}
    </>
  );
};

/**
 * C6 时间映射：**每 track 一个外层 `<Sequence>`** 包住，内层 item 用相对偏移。
 *
 * 外层的唯一意义是把绝对帧转成轨道内相对帧 —— 否则轨道一重排，
 * 所有内层 `from` 全得改（与 C5 否掉 item 层 handoffFrom 是同一个理由）。
 *
 * ⚠️ **禁用 `<Series>`**：它语义是「依次播放」，内部自动把后一个的起点算作
 *    前一个的终点，**结构上无法表达重叠**，与硬约束 3 直接冲突。
 */
const TrackSequence: FC<{ track: StoryboardTrack; caption: CaptionData }> = ({ track, caption }) => {
  if (track.items.length === 0) return null;
  const start = Math.min(...track.items.map((i) => i.fromFrame));
  const end = Math.max(...track.items.map((i) => i.fromFrame + i.durationInFrames));
  return (
    <Sequence from={start} durationInFrames={end - start}>
      <TrackBody track={track} caption={caption} />
    </Sequence>
  );
};

/**
 * 载体链：`subject-transform` / `footage-transform` 作用于**实拍视频本身**，
 * 必须**串联**施加（裁切 → 缩放 → 再裁切），永远在最底层且独占视频元素。
 *
 * 若把载体类塞进叠加栈会出现**语义倒置** —— 它成了「盖在视频上的一层」，
 * 而正确行为是「改变视频的呈现」。
 *
 * 每层用 `CarrierTrack` 做**分段包裹**（item 段包裹 / 间隙段透传），
 * 见 `carrier.tsx` 的文件头：为什么必须分段、以及重叠的降级语义。
 */
const CarrierChain: FC<{
  carriers: StoryboardTrack[];
  caption: CaptionData;
  /** 🔴 必须传：载体轨只覆盖部分时间轴，轨道窗口之外仍需透传视频（见下）。 */
  durationInFrames: number;
  children: ReactNode;
}> = ({ carriers, caption, durationInFrames, children }) => {
  // 🔴 2026-10-18：不再逐轨嵌套 —— 嵌套会叠加 `<Sequence>` 的时间偏移，
  //   让内层载体静默失效（详见 `carrier.tsx` 的 `composeCarrierTimeline` 文件头）。
  //   改为「先把多条轨合并成一张绝对时间表，再逐窗渲染」，视频任一时刻只渲染一次。
  return (
    <AbsoluteFill data-carrier-chain={carriers.length > 0 ? carriers.length : undefined}>
      <CarrierTimeline tracks={carriers} caption={caption} durationInFrames={durationInFrames}>
        {children}
      </CarrierTimeline>
    </AbsoluteFill>
  );
};

export const Overlay: FC<RenderProps> = ({
  storyboard,
  video,
  hasVideo,
  durationInFrames,
  caption,
  carrierTracks,
}) => {
  const cap = caption ?? EMPTY_CAPTION;
  // 🔴 D4-t3 ②：影子轨**恒为最内层**（紧贴视频）⇒ 必须排在真实载体轨之前。
  //   `CarrierChain` 用 reduce 依次包裹，数组第一个元素最贴近 children。
  const carriers: StoryboardTrack[] = [...(carrierTracks ?? [])];
  const overlays: { track: StoryboardTrack; trackIndex: number }[] = [];

  storyboard.tracks.forEach((track, trackIndex) => {
    const scope = getScopeOf(track);
    if (scope !== null && isCarrierScope(scope)) {
      carriers.push(track);
    } else {
      overlays.push({ track, trackIndex });
    }
  });

  // C6 ② z 序：按 (layer 升序, trackIndex 升序) 排序后依次嵌套为 AbsoluteFill 的子元素。
  // layer 小 → 先嵌套 → 在下；同 layer → trackIndex 大（后声明）→ 在上。
  // ⚠️ 禁用显式 z-index：transform 会创建新的层叠上下文，「设了却失效」极难排查。
  overlays.sort((a, b) => {
    if (a.track.layer !== b.track.layer) return a.track.layer - b.track.layer;
    return a.trackIndex - b.trackIndex;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* 背景链：载体类，串联 */}
      <CarrierChain
        carriers={carriers}
        caption={cap}
        durationInFrames={durationInFrames}
      >
        {hasVideo && video ? (
          <AbsoluteFill>
            <OffthreadVideo src={video} />
          </AbsoluteFill>
        ) : (
          <AbsoluteFill
            style={{
              backgroundColor: '#101418',
              color: '#4b5563',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              fontFamily: 'monospace',
            }}
          >
            [no source video]
          </AbsoluteFill>
        )}
      </CarrierChain>

      {/* 叠加栈：其余四类，并列 */}
      {overlays.map(({ track }) => (
        <AbsoluteFill key={track.id}>
          <TrackSequence track={track} caption={cap} />
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};
