/**
 * 校验上下文 —— 一次性把构建期所需的全部结构化数据读齐。
 *
 * 输入边界由 SPEC §2.1 限定：**只读 03-storyboard + 01-align + 02-perceive**
 * （+ 00-input 的素材清单，用于校验项 #10 的成片总时长）。
 * 校验器是**纯函数**：这一层之后不再碰磁盘。
 */

import path from 'node:path';
import { ConfigError } from '../core/exit-code.ts';
import { jobDir, readJson, stageDir } from '../core/io.ts';
import { STAGES } from '../core/config.ts';
import { getTemplate } from '../templates/registry.ts';
import type { TemplateDeclaration } from '../templates/types.ts';
import type {
  AlignReport,
  AlignWords,
  BakeReport,
  Cue,
  PerceiveResult,
  SourceManifest,
  Storyboard,
  StoryboardItem,
  StoryboardTrack,
  WordTimestamp,
} from '../core/types.ts';

/** 展平后的一个 motion item，带定位信息与模板声明。 */
export interface SceneItem {
  trackId: string;
  trackIndex: number;
  itemIndex: number;
  track: StoryboardTrack;
  item: StoryboardItem;
  tpl: TemplateDeclaration;
  /** 起始帧（含）。 */
  start: number;
  /** 结束帧（不含）。 */
  end: number;
  /** `trackId/000`，用于报告定位。 */
  ref: string;
}

export interface ValidateContext {
  jobId: string;
  source: SourceManifest;
  fps: number;
  storyboard: Storyboard;
  words: WordTimestamp[];
  cues: Cue[];
  alignReport: AlignReport;
  perceive: PerceiveResult;
  bake: BakeReport;
  /** 展平并按 (trackIndex, itemIndex) 稳定排序的全部 item。 */
  scene: SceneItem[];
}

function loadOrDefault<T>(file: string, fallback: T): T {
  try {
    return readJson<T>(file);
  } catch {
    return fallback;
  }
}

export function buildContext(jobId: string, jobsDir?: string): ValidateContext {
  const base = jobDir(jobId, jobsDir);

  const source = readJson<SourceManifest>(path.join(base, STAGES.input, 'source.json'));
  const alignWords = readJson<AlignWords>(path.join(base, STAGES.align, 'words.json'));
  const alignReport = readJson<AlignReport>(path.join(base, STAGES.align, 'align-report.json'));
  const shotsFile = path.join(base, STAGES.perceive, 'shots.json');
  const regionsFile = path.join(base, STAGES.perceive, 'regions.json');
  const perceive: PerceiveResult = {
    fps: source.fps,
    shots: readJson<PerceiveResult['shots']>(shotsFile),
    regions: readJson<PerceiveResult['regions']>(regionsFile),
  };
  const storyboard = readJson<Storyboard>(path.join(base, STAGES.storyboard, 'storyboard.json'));
  const bake = readJson<BakeReport>(path.join(base, STAGES.storyboard, 'bake-report.json'));

  const fps = storyboard.meta.fps;

  // fps 与烘焙绑定：改 fps 必须重新烘焙，不允许跨 fps 复用（C6 工程约束之二）。
  if (source.fps !== fps) {
    throw new ConfigError(
      `fps 不一致：素材清单为 ${source.fps}，storyboard.meta.fps 为 ${fps}。` +
        `改 fps 会让全部已烘焙 fromFrame 语义漂移 → 必须重新烘焙。`,
    );
  }
  if (alignWords.fps !== fps) {
    throw new ConfigError(
      `fps 不一致：01-align 为 ${alignWords.fps}，storyboard.meta.fps 为 ${fps}。`,
    );
  }
  if (bake.fps !== fps) {
    throw new ConfigError(
      `fps 不一致：03-storyboard/bake-report.json 为 ${bake.fps}，storyboard.meta.fps 为 ${fps}。`,
    );
  }

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

  return {
    jobId,
    source,
    fps,
    storyboard,
    words: alignWords.words,
    cues: alignWords.cues,
    alignReport,
    perceive,
    bake,
    scene,
  };
}

// ─────────────────────────────────────────────────────────────
// 通用小工具
// ─────────────────────────────────────────────────────────────

/** 半开区间 [aStart,aEnd) 与 [bStart,bEnd) 是否相交（严格）。 */
export function framesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 归一化矩形相交面积（0 表示不相交或仅贴边）。 */
export function rectOverlapArea(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x = Math.max(ax, bx);
  const y = Math.max(ay, by);
  const right = Math.min(ax + aw, bx + bw);
  const bottom = Math.min(ay + ah, by + bh);
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

export function rectArea([, , w, h]: readonly [number, number, number, number]): number {
  return Math.max(0, w) * Math.max(0, h);
}

/** 把矩形夹在画面内（0–1）。 */
export function clampRect(
  [x, y, w, h]: readonly [number, number, number, number],
): [number, number, number, number] {
  const cw = Math.min(w, 1);
  const ch = Math.min(h, 1);
  return [
    Math.min(Math.max(x, 0), 1 - cw),
    Math.min(Math.max(y, 0), 1 - ch),
    cw,
    ch,
  ];
}
