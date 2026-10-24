/**
 * 测试用上下文构造器（非测试文件，不参与收集）。
 *
 * 刻意**不读磁盘** —— 校验器是纯函数，测试就该只喂结构化数据。
 * 磁盘那一层由 `npm run demo` 端到端覆盖。
 */

import type { SceneItem, ValidateContext } from '../src/validate/context.ts';
import { getTemplate, registerTemplate } from '../src/templates/registry.ts';
import type {
  AlignReport,
  AlignWords,
  BakeReport,
  CarrierRef,
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

/**
 * 🔴 造一个「声明遮挡主体」的 item —— 遮挡类测试用。
 *
 * ── 为什么要专门造，而不是直接用 makeItem() ──────────────────────
 * 2026-10-15 补`occludesSubject` 消费时发现：默认 motion
 * `typography/kinetic-line@1.0` 声明 `occludesSubject: false`，
 * 于是它**压根不会进入遮挡判定**（`collectHits` 按该字段过滤）。
 *
 * 而首批 10 个模板里，声明 `true` 的 3 个（`carrier/split-frame` /
 * `cinematic/punch-in` / `transition/whip-pan`）**全部是载体类或 fullscreen**，
 * 又被 `collectHits` 的前两条规则排除
 * ⇒ **当前模板集下没有任何模板能真正触发遮挡判定**（实测 0/10）。
 *
 * 所以遮挡链路测试需要一个"够格"的 motion。这里用 `registerTemplate`
 * 临时注册一个**声明遮挡主体的 overlay-safe 模板**：
 * · 它是 `overlay-safe` ⇒ 通过 scope 过滤
 * · 它 `occludesSubject: true` ⇒ 通过遮挡意图过滤
 * · `minVisibleInFrames` 给足，避免被校验项#6 抢先报错
 *
 * ⚠️ **这是测试夹具，不是产品模板**。它不在 `builtin.ts` 里，
 *    也**不应**被加进去 —— 真正该补的是一个"会遮挡主体的叠加模板"
 *    （如压在人身上的大字），那是**产品决策**，已登记为待裁决
 *    （见 `docs/decisions/OPEN-DECISIONS.md` 待裁决D-A）。
 *
 * 🔴 用它驱动测试的前提必须显式声明，否则测试会「测别的项」与
 *    「必须用遮挡型模板」两件事耦死 —— 那正是 2026-10-13
 *    tier1 假绿能潜伏那么久的同款病。
 */
let occluderSeq = 0;

/** 一个专供测试的「遮挡型叠加模板」。仅注册一次，重复调用返回同一 id。 */
export const OCCLUDER_MOTION = 'test/occluding-overlay@1.0';

export function makeOccludingItem(over: Partial<StoryboardItem> = {}): StoryboardItem {
  if (occluderSeq === 0) {
    registerTemplate(
      {
        id: OCCLUDER_MOTION,
        family: 'custom',
        subtype: 'occluding-overlay',
        version: '1.0',
        scope: 'overlay-safe',
        layer: 60,
        occludesSubject: true, // ← 唯一关键点：让它进入遮挡判定
        status: 'custom',
        // ⚠️ 空paramsSchema：夹具不承载任何参数。故下面 `params: {}` 必须是空对象 ——
        //    沿用 makeItem() 的默认 `{ text: 't' }` 会触发校验项 #16 的 E-P1-01
        //    （参数含未声明键），那是与遮挡测试无关的噪音报错。
        paramsSchema: {},
        footprint: [0.05, 0.72, 0.3, 0.16],
        minVisibleInFrames: 1,
      },
      'tests/_ctx.ts#makeOccludingItem',
    );
    occluderSeq += 1;
  }
  return makeItem({ motion: OCCLUDER_MOTION, params: {}, ...over });
}

/** 载体类默认引用：`carrier/split-frame@1.0`（`subject-transform`，已声明但尚未有 .tsx）。 */
export const CARRIER = 'carrier/split-frame@1.0';

/**
 * D4-t2 载体声明构造器。
 *
 * 载体档**逐 item 声明**（`item.carrier`）；原来的全局 `setCarrierFallback(motion, …)`
 * 映射表已于 2026-10-17 按裁决 Q2 废除 —— 它按 motion 索引，放不下逐 item 几何。
 */
export function carrierOf(
  template: string = CARRIER,
  params: Record<string, unknown> = {},
): CarrierRef {
  return { template, params };
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
    // M-1c：测试上下文固定为 SRT 权威 + 完全对齐
    textSource: 'srt',
    alignedRatio: 1,
    thresholds: {
      meanConfidenceMin: 0.6,
      lowConfidenceRatioMax: 0.3,
      alignedRatioMin: 0.8,
      silentWordRatioWarnMax: 0.02,
    },
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
