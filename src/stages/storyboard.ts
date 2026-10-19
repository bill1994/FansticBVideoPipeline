/**
 * Stage 3 · storyboard —— 按词级锚点起草并烘焙 storyboard.json。
 *
 * 铁律（C2 / C4 / C5 / C6 / B6 / N-3）：
 *  1. 模型**只填表不写代码** —— 只挑模板 + 填文字，禁写坐标/帧数/颜色/CSS
 *  2. 写**锚点**，不手算帧；烘焙一次性完成，**锚点用完即弃**
 *  3. 只许引用 01/02 的产物，**禁跨级引用**（引 05 会形成环路）
 *  4. 调度走两道闸 + 产路地板；`custom` 不许绕过 must_review
 */

import path from 'node:path';
import { STAGES } from '../core/config.ts';
import { ConfigError, StageBlockedError } from '../core/exit-code.ts';
import { exists, jobDir, readJson, stageDir, writeStageJson } from '../core/io.ts';
import { log } from '../core/log.ts';
import { bake } from '../core/bake.ts';
import { computeThreshold, decide, routingFloor, maxReview } from '../core/schedule.ts';
import type {
  AlignWords,
  BakeReport,
  SourceManifest,
  Storyboard,
  StoryboardItem,
} from '../core/types.ts';
import { assertNoCrossStageReference } from '../core/io.ts';

/**
 * 起草稿的 item。
 *
 * 与最终契约的差别（都来自「模型只填表不写代码」这条铁律）：
 *  · `fromFrame` / `durationInFrames` **可省略** —— 前者由锚点烘焙得出，
 *    后者由 `max(模板 minVisibleInFrames, 锚定词区间长度)` 推导。
 *    模型禁写帧数，所以正常路径下这两个字段都不该出现。
 *  · 额外允许携带匹配器给出的 `sim_max` 与模型的 `confidence`，
 *    它们是闸1 / 闸2 的输入。
 */
export type DraftItem = Omit<StoryboardItem, 'fromFrame' | 'durationInFrames'> & {
  fromFrame?: number;
  durationInFrames?: number;
  sim_max?: number;
  confidence?: number;
};

export interface DraftTrack {
  id: string;
  layer: number;
  handoffTo?: string | null;
  items: DraftItem[];
}

export interface DraftStoryboard {
  meta: {
    fps: number;
    anchorMode: Storyboard['meta']['anchorMode'];
    alignmentConfidence: number;
    confirmedBy?: string;
    confirmedAt?: string;
  };
  tracks: DraftTrack[];
  noMotionRanges: Storyboard['noMotionRanges'];
}

export interface StoryboardOptions {
  jobId: string;
  jobsDir?: string;
  /** 起草稿路径。省略时读 `03-storyboard/draft.json`。 */
  draftPath?: string;
}

export interface StoryboardOutcome {
  storyboard: Storyboard;
  report: BakeReport;
  threshold: number;
  safetyValve: boolean;
}

export function runStoryboard(opts: StoryboardOptions): StoryboardOutcome {
  const base = jobDir(opts.jobId, opts.jobsDir);
  const outDir = stageDir(opts.jobId, STAGES.storyboard, opts.jobsDir);

  // 前置：01-align 必须已通过门控
  const alignReportFile = path.join(base, STAGES.align, 'align-report.json');
  const wordsFile = path.join(base, STAGES.align, 'words.json');
  const shotsFile = path.join(base, STAGES.perceive, 'shots.json');
  if (!exists(alignReportFile) || !exists(wordsFile)) {
    throw new StageBlockedError('01-align 未就绪 —— 不得跳过对齐直接起草 storyboard');
  }
  const alignReport = readJson<{ gatePassed: boolean; meanConfidence: number; mode?: string }>(
    alignReportFile,
  );
  if (!alignReport.gatePassed) {
    throw new StageBlockedError(
      '对齐门控未通过（C2-2 / C2-4）—— 必须人工显式确认后才能继续。' +
        '确认后写入 06-review/confirmed.json，并把 meta.anchorMode 标为实际使用的模式。',
    );
  }
  /** 🔴 `M-1g`：本job 是否走无字幕模式（详见下方「硬约束」）。 */
  const noSubtitle = alignReport.mode === 'no-subtitle';
  if (!exists(shotsFile)) {
    throw new StageBlockedError('02-perceive 未就绪 —— 不得跳过感知直接起草 storyboard');
  }

  // 禁跨级引用自检：本阶段实际读的就是 00/01/02，其中不得出现 05-render / 06-review
  const referencedStages: string[] = [STAGES.input, STAGES.align, STAGES.perceive];
  assertNoCrossStageReference(referencedStages, STAGES.storyboard);

  const source = readJson<SourceManifest>(path.join(base, STAGES.input, 'source.json'));
  const aligned = readJson<AlignWords>(wordsFile);

  const draftFile = opts.draftPath ?? path.join(outDir, 'draft.json');
  if (!exists(draftFile)) {
    throw new ConfigError(
      `缺少起草稿：${draftFile}\n` +
        `  起草稿是「模型产出」的等价物，本仓库不内置模型调用。\n` +
        `  用 --draft <file> 指定，或放到 03-storyboard/draft.json。`,
    );
  }
  const draft = readJson<DraftStoryboard>(draftFile);

  /**
   * 🔴 `M-1g`：无字幕模式下的**硬约束**。
   *
   * `mode === 'no-subtitle'` 时 `words`/`cues` 为**空数组** —— 若不拦：
   * · `word:0` 会取到 `undefined` → 烘焙期报「锚点序号非法」，看起来像 draft 写错
   * · `cue:0` 会取到空条目 → 隐式时长算成 0
   * 真实原因不是 draft 写错，而是「这条 job 刻意没做对齐」⇒ 必须在这里说清楚。
   */
  if (noSubtitle) {
    const bad: string[] = [];
    for (const t of draft.tracks ?? []) {
      for (const it of t.items ?? []) {
        // 🔴 锚点在 `_author` 里，不是顶层字段（`bake.ts:181` 读的就是它）。
        const anchor = it._author?.anchor ?? '';
        if (anchor.startsWith('word:') || anchor.startsWith('cue:')) {
          bad.push(`轨「${t.id}」的 ${anchor}`);
        }
        if (it.motion === 'caption/karaoke-word') {
          bad.push(`轨「${t.id}」的字幕模板 caption/karaoke-word`);
        }
      }
    }
    if (bad.length > 0) {
      throw new ConfigError(
        '本 job 是**无字幕模式**（align 报告 mode = no-subtitle）—— ' +
          '没有词级时间戳也没有 cue，下列写法不可用：\n' +
          bad.map((b) => `  · ${b}`).join('\n') +
          '\n  ↳ 改用 `abs:<帧>` 或 `abs:<秒>s` 锚点（不依赖对齐数据）。' +
          '\n  ↳ 若本片其实有 SRT，请去掉 --no-subtitle 重跑 align。',
      );
    }
    log.info('无字幕模式：已校验全部 item 均用 abs: 锚点且不含字幕模板（M-1g）。');
  }

  if (draft.meta.fps !== source.fps) {
    throw new ConfigError(
      `起草稿 fps ${draft.meta.fps} 与素材清单 ${source.fps} 不一致 —— fps 与烘焙绑定，必须先统一`,
    );
  }

  // ── 调度：闸1 路由 + 闸2 审核强度 + 产路地板 ────────────────
  const scores = draft.tracks.flatMap((t) => t.items.map((i) => i.sim_max));
  const missing = scores.filter((s) => typeof s !== 'number').length;
  if (missing > 0) {
    throw new ConfigError(
      `起草稿中有 ${missing} 个 item 缺少 sim_max —— 闸1 无法判定产路（来自模板匹配器）`,
    );
  }
  const { T, safetyValve, reason } = computeThreshold(scores as number[]);
  log.info(`闸1 阈值：T=${T.toFixed(3)}（${reason}）`);

  const withDecision: DraftStoryboard = {
    ...draft,
    tracks: draft.tracks.map((t) => ({
      ...t,
      items: t.items.map((item) => {
        const confidence = item.confidence;
        if (typeof confidence !== 'number') {
          throw new ConfigError(`track "${t.id}" 的 item 缺少 confidence —— 闸2 无法判定审核强度`);
        }
        const d = decide(item.sim_max as number, confidence, T);
        if (safetyValve) {
          // 安全阀：整批转 custom + 人审，禁止降阈值硬套库
          const forced = { ...d, routing: 'custom' as const, sim_max: d.sim_max };
          return {
            ...item,
            decision: { ...forced, review: maxReview('must_review', routingFloor('custom')) },
          };
        }
        return { ...item, decision: d };
      }),
    })),
  };

  // ── 烘焙：锚点 → 帧，随后剥离 _author ───────────────────────
  // `cues` 必须一起传：`cue:N` 锚点（C2-6）靠它取起点与**隐式时长**。
  const { storyboard, report } = bake(
    withDecision as unknown as Storyboard,
    aligned.words,
    source.fps,
    aligned.cues ?? [],
  );

  // 起草稿专用字段不落盘：`sim_max` / `confidence` 是闸1/闸2 的**输入**，
  // 结论已经写进 `decision`，把它们留在最终产物里等于往契约里塞临时状态。
  const tracks: Storyboard['tracks'] = storyboard.tracks.map((t) => ({
    ...t,
    items: t.items.map((item) => {
      const clean = { ...item } as StoryboardItem & { sim_max?: number; confidence?: number };
      delete clean.sim_max;
      delete clean.confidence;
      return clean;
    }),
  }));

  // 回填 meta（5 个字段，见 SPEC §1.2）
  const baked: Storyboard = {
    meta: {
      fps: source.fps,
      anchorMode: draft.meta.anchorMode,
      alignmentConfidence: alignReport.meanConfidence,
      ...(draft.meta.confirmedBy ? { confirmedBy: draft.meta.confirmedBy } : {}),
      ...(draft.meta.confirmedAt ? { confirmedAt: draft.meta.confirmedAt } : {}),
    },
    tracks,
    noMotionRanges: storyboard.noMotionRanges,
  };

  // 🔴 落盘走 writeStageJson：不可变快照守卫的唯一执行点（2026-10-18 接线）。
  writeStageJson({
    jobId: opts.jobId,
    self: STAGES.storyboard,
    target: STAGES.storyboard,
    file: 'storyboard.json',
    data: baked,
    jobsDir: opts.jobsDir,
  });
  writeStageJson({
    jobId: opts.jobId,
    self: STAGES.storyboard,
    target: STAGES.storyboard,
    file: 'bake-report.json',
    data: report,
    jobsDir: opts.jobsDir,
  });
  log.done(
    `storyboard.json 已烘焙：${baked.tracks.length} 轨 / ${report.records.length} 条锚点解析记录`,
  );

  return { storyboard: baked, report, threshold: T, safetyValve };
}
