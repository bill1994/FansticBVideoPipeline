/**
 * 测试用上下文构造器（非测试文件，不参与收集）。
 *
 * 刻意**不读磁盘** —— 校验器是纯函数，测试就该只喂结构化数据。
 * 磁盘那一层由 `npm run demo` 端到端覆盖。
 */

import type { SceneItem, ValidateContext } from '../src/validate/context.ts';
import { getTemplate } from '../src/templates/registry.ts';
import type {
  AlignReport,
  AlignWords,
  BakeReport,
  Cue,
  PerceiveRegion,
  PerceiveResult,
  Shot,
  SourceManifest,
  Storyboard,
  StoryboardItem,
  StoryboardTrack,
  WordTimestamp,
} from '../src/core/types.ts';

export const FPS = 30;

/** 造 n 个词，每个词 20 帧，词间无空隙。 */
export function makeWords(n: number, startFrame = 100): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  for (let i = 0; i < n; i += 1) {
    words.push({
      index: i,
      word: `w${i}`,
      startFrame: startFrame + i * 20,
      endFrame: startFrame + i * 20 + 19,
      confidence: 0.9,
    });
  }
  return words;
}

/**
 * 默认 motion 是 `typography/kinetic-line@1.0`（`requiredParams: ['text']`），
 * 故默认补一个 `params.text` —— 否则校验项 #16 会让每一条未显式指定 params 的
 * 用例都报 `E-P1-02`，把「测别的项」与「必须填 params」两件事耦死。
 *
 * 需要测 params 契约本身的用例请显式传 `params`（见 `params-schema.test.ts`），
 * 或用 `params: {}` / 不传来覆盖缺省路径。
 */
export function makeItem(over: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    fromFrame: 100,
    durationInFrames: 60,
    motion: 'typography/kinetic-line@1.0',
    footprint: [0.05, 0.72, 0.3, 0.16],
    params: { text: 't' },
    ...over,
  };
}

export function makeTrack(id: string, layer: number, items: StoryboardItem[], handoffTo?: string): StoryboardTrack {
  return handoffTo === undefined ? { id, layer, items } : { id, layer, items, handoffTo };
}

export interface CtxOverrides {
  tracks?: StoryboardTrack[];
  noMotionRanges?: Storyboard['noMotionRanges'];
  words?: WordTimestamp[];
  cues?: Cue[];
  shots?: Shot[];
  regions?: PerceiveRegion[];
  bake?: BakeReport;
  durationInFrames?: number;
  fps?: number;
}

export function makeCtx(over: CtxOverrides = {}): ValidateContext {
  const fps = over.fps ?? FPS;
  const words = over.words ?? makeWords(40); // 100..879
  const durationInFrames = over.durationInFrames ?? 900;

  const storyboard: Storyboard = {
    meta: { fps, anchorMode: 'word', alignmentConfidence: 0.9 },
    tracks: over.tracks ?? [],
    noMotionRanges: over.noMotionRanges ?? [],
  };

  const source: SourceManifest = {
    video: 'raw.mp4',
    srt: 'raw.srt',
    fps,
    durationInFrames,
  };

  const alignReport: AlignReport = {
    fps,
    meanConfidence: 0.9,
    lowConfidenceRatio: 0.01,
    gatePassed: true,
    lowConfidenceWords: [],
    thresholds: { meanConfidenceMin: 0.6, lowConfidenceRatioMax: 0.3 },
  };

  const perceive: PerceiveResult = {
    fps,
    shots: over.shots ?? [],
    regions: over.regions ?? [],
  };

  const bake: BakeReport = over.bake ?? { fps, records: [] };

  const scene: SceneItem[] = [];
  storyboard.tracks.forEach((track, trackIndex) => {
    track.items.forEach((item, itemIndex) => {
      scene.push({
        trackId: track.id,
        trackIndex,
        itemIndex,
        track,
        item,
        tpl: getTemplate(item.motion),
        start: item.fromFrame,
        end: item.fromFrame + item.durationInFrames,
        ref: `${track.id}/${String(itemIndex).padStart(3, '0')}`,
      });
    });
  });

  const aligned: AlignWords = { fps, words, cues: over.cues ?? [] };

  return {
    jobId: 'test',
    source,
    fps,
    storyboard,
    words: aligned.words,
    cues: aligned.cues,
    alignReport,
    perceive,
    bake,
    scene,
  };
}
