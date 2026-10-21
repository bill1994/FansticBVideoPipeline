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
import { getTemplate } from '../templates/registry.ts';
import { lookupConfirmed } from '../core/confirmed.ts';
import { log } from '../core/log.ts';
import { bake } from '../core/bake.ts';
import { computeThreshold, decide, routingFloor, maxReview } from '../core/schedule.ts';
import { buildRhythmTable } from '../core/rhythm.ts';
import { synthDraft } from '../core/rhythm-rules.ts';
import type {
  AlignWords,
  BakeReport,
  PerceiveRegion,
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

/**
 * 起草稿 item 的**允许键**（`P5` 裁决，2026-10-19）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它
 * ─────────────────────────────────────────────────────────────
 * 2026-10-19 端到端审计发现：起草稿 item 多写的字段**没有任何校验**——
 * `bake` 用 `{...item}` 展开，于是 `routing` / `review` / `handoffIn` 这类
 * 写错的键会**原样落进 `storyboard.json`**，全链路不报错、成片也不报错。
 *
 * 这是唯一「静默污染产物」的路径：`params` 内部有 `E-P1-01` 兜着，
 * item 顶层此前是无人区。
 *
 * 归为**结构错误**而不是校验项（→ `ConfigError` / 退出码 2）：
 * 与「`carrier` 引用了未注册模板」同类 —— 起草稿形状不对，不该等到
 * 校验阶段再判，更不该占 18 项的名额。
 */
const ALLOWED_DRAFT_ITEM_KEYS = new Set([
  // 作者语法（烘焙后剥离）
  '_author',
  // 契约字段
  'fromFrame',
  'durationInFrames',
  'motion',
  'footprint',
  'exclusive',
  'footprintAnimates',
  'params',
  'carrier', // 人工返修时可手填（模型不应写）
  // 起草稿专用：闸1 / 闸2 的**输入**（产物里会挪进 `decision`）
  'sim_max',
  'confidence',
]);

/** 键名 → 额外提示。这些是最容易写错的那几个。 */
const KEY_HINTS: Record<string, string> = {
  decision: '（`decision` 是**产物**字段，由烘焙器算出来写入；起草稿只填 `sim_max` / `confidence`）',
  routing: '（`routing` 由闸1 算出，不要在起草稿里写）',
  review: '（`review` 由产路地板算出，不要在起草稿里写）',
  handoffIn: '（该字段已于 2026-10-15 删除 —— 入场方式请用 `params.enter`）',
  handoffTo: '（`handoffTo` 是 **track 层**字段，不能放 item 层）',
  window: '（`window` 是校验期写入的系统字段，不进 params）',
};

/**
 * 起草稿 item 顶层键检查。发现未知键即抛（退出码 2），一次列出全部。
 *
 * ⚠️ 只查 **item 顶层**，不递归 `params` —— 那里有校验项 #16（`E-P1-01`）负责。
 */
export function assertDraftItemKeys(draft: DraftStoryboard): void {
  const problems: string[] = [];
  const tracks = draft.tracks ?? [];
  tracks.forEach((t, ti) => {
    const trackLabel = t.id ?? `#${ti}`;
    (t.items ?? []).forEach((it, ii) => {
      Object.keys(it as object).forEach((k) => {
        if (ALLOWED_DRAFT_ITEM_KEYS.has(k)) return;
        problems.push(`轨「${trackLabel}」第 ${ii} 条：未知键 \`${k}\`${KEY_HINTS[k] ?? ''}`);
      });
    });
  });
  if (problems.length > 0) {
    throw new ConfigError(
      `起草稿含未知 item 字段（共 ${problems.length} 处）：\n` +
        problems.map((p) => `  · ${p}`).join('\n') +
        `\n  item 顶层只允许：${[...ALLOWED_DRAFT_ITEM_KEYS].join(' / ')}。\n` +
        `  这些键若不拦，会原样落进 storyboard.json（bake 用 {...item} 展开），全链路无报错。`,
    );
  }
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
  const regionsFile = path.join(base, STAGES.perceive, 'regions.json');
  if (!exists(alignReportFile) || !exists(wordsFile)) {
    throw new StageBlockedError('01-align 未就绪 —— 不得跳过对齐直接起草 storyboard');
  }
  if (!exists(shotsFile) || !exists(regionsFile)) {
    throw new StageBlockedError(
      '02-perceive 未就绪（shots.json / regions.json 缺失）—— 不得跳过感知直接起草 storyboard',
    );
  }
  const alignReport = readJson<{ gatePassed: boolean; meanConfidence: number; mode?: string }>(
    alignReportFile,
  );
  /**
   * 对齐门控（C2-2 / C2-4）。
   *
   * 🔴 2026-10-19 端到端审计后修复：此前这里**只抛错、从不读放行记录** ——
   *    而 CLI（`cli.ts` 门控分支）与 `align/SKILL.md` 都写着
   *    「写 `06-review/confirmed.json` 后可继续」。
   *    实测：照提示写了 `stage:"alignment"` 的记录，重跑**仍然 exit 1**，
   *    报错一字不改 ⇒ 提示让人做的事做了也没用，用户被堵死在门控前。
   *
   * 现在：门控不过 → 查 `stage:"alignment"` 的放行记录 →
   *   · 有 ⇒ 继续，并把 `confirmedBy` / `confirmedAt` 回填进 `storyboard.meta`（审计链落盘）
   *   · 无 ⇒ 抛错，且**区分「没有记录」与「记录是别的阶段写的」**，给出可执行的下一步
   */
  let alignWaiver: { by: string; at: string; reason: string } | null = null;
  if (!alignReport.gatePassed) {
    const { record, available } = lookupConfirmed(opts.jobId, 'alignment', opts.jobsDir);
    if (!record) {
      const mismatchHint =
        available.length > 0
          ? `\n  ↳ 06-review/confirmed.json 现有记录覆盖的 stage：${available.join(', ')} —— ` +
            `没有 "alignment"，故不能用于本阶段放行。\n` +
            `  该文件支持多条记录：追加一条 alignment 记录即可，不必覆盖已有的。`
          : '';
      throw new StageBlockedError(
        '对齐门控未通过（C2-2 / C2-4）—— 必须人工显式确认后才能继续。\n' +
          '  确认后写入 06-review/confirmed.json（`stage` 必须是 "alignment"）：\n' +
          '    { "jobId": "...", "stage": "alignment", "reason": "...",\n' +
          '      "confirmedBy": "...", "confirmedAt": "ISO 时间" }\n' +
          '  并把 draft.meta.anchorMode 标为实际使用的模式。' +
          mismatchHint,
      );
    }
    alignWaiver = { by: record.confirmedBy, at: record.confirmedAt, reason: record.reason };
    log.warn(
      `对齐门控未通过，但存在人工放行记录（${record.confirmedBy} @ ${record.confirmedAt}）：${record.reason}`,
    );
  }
  /** 🔴 `M-1g`：本job 是否走无字幕模式（详见下方「硬约束」）。 */
  const noSubtitle = alignReport.mode === 'no-subtitle';

  // 禁跨级引用自检：本阶段实际读的就是 00/01/02，其中不得出现 05-render / 06-review
  const referencedStages: string[] = [STAGES.input, STAGES.align, STAGES.perceive];
  assertNoCrossStageReference(referencedStages, STAGES.storyboard);

  const source = readJson<SourceManifest>(path.join(base, STAGES.input, 'source.json'));
  const aligned = readJson<AlignWords>(wordsFile);
  // 🔴 E-D4-01 修复（2026-10-21）：内置生成器必须读区域 —— 不读就是画面全盲，
  //    产出的 storyboard 会在 validate 撞 E-D4-01（基线实测，见节奏表基线报告 §4）。
  const regions = readJson<PerceiveRegion[]>(regionsFile);

  const draftFile = opts.draftPath ?? path.join(outDir, 'draft.json');
  let draft: DraftStoryboard;
  if (exists(draftFile)) {
    // ── 旧路径（逐字节保持原行为）────────────────────────────
    // 有起草稿就用起草稿：不论来自外部模型、人工返修还是上一轮内置生成器落下的
    // `draft.json`，都走同一套「键检查 → 调度 → 烘焙 → 落盘」。
    draft = readJson<DraftStoryboard>(draftFile);
  } else if (opts.draftPath !== undefined) {
    // 显式 `--draft` 指向一个不存在的文件：这是参数错误，不能悄悄改成内置生成。
    throw new ConfigError(
      `--draft 指定的起草稿不存在：${draftFile}\n` +
        `  若要使用内置生成器，请去掉 --draft 并确保 03-storyboard/draft.json 不存在。`,
    );
  } else if (noSubtitle) {
    // 🔴 M-1g：无字幕模式没有 cue，内置生成器无从铺层。
    //    保持「无 cue 不得生成 storyboard」的既有约束，而不是产出一份空壳。
    throw new ConfigError(
      '本 job 是**无字幕模式**（align-report.mode = no-subtitle）—— ' +
        '内置生成器依赖 SRT cue 才能铺字幕轨与节奏表，没有 cue 无法生成起草稿。\n' +
        '  ↳ 用 --draft <file> 提供手写起草稿（只可用 abs: 锚点），或去掉 --no-subtitle 重跑 align。',
    );
  } else {
    // ── 内置确定性生成器（P1，2026-10-20）──────────────────────
    // 没有起草稿、有 cue ⇒ 用节奏表直接合成 draft：
    //   buildRhythmTable（纯函数判断每条 cue 配不配 motion）
    //   → 落 pacing.json（可人工核对判断依据）
    //   → synthDraft（每条 cue 一条 caption + 命中的 MG）
    //   → 继续走既有的调度 / 烘焙 / 落盘流程。
    const cues = aligned.cues ?? [];
    if (cues.length === 0) {
      throw new ConfigError(
        '01-align/words.json 没有 cues —— 内置生成器需要按 cue 铺字幕与节奏表。\n' +
          '  ↳ 若本片其实有 SRT，请重跑 align；否则用 --draft 提供手写起草稿。',
      );
    }

    const table = buildRhythmTable(cues, source.fps, 'aligned');
    // `pacing.json` 与 `storyboard.json` 同属 03-storyboard：它是本阶段的**判断记录**，
    // 供人工核对「为什么这句话配/不配动效」，不参与下游判定。
    writeStageJson({
      jobId: opts.jobId,
      self: STAGES.storyboard,
      target: STAGES.storyboard,
      file: 'pacing.json',
      data: table,
      jobsDir: opts.jobsDir,
    });

    draft = synthDraft(table, cues, {
      fps: source.fps,
      alignmentConfidence: alignReport.meanConfidence,
      regions,
    });

    // 🔴 落 `draft.synth.json` 而不是 `draft.json`（产品缺口修复，2026-10-20）：
    //    用户跑完内置生成器后需要一个**可改的文件**，否则想手工调整时手上什么都没有。
    //    但一旦写成 `draft.json`，下次就会命中上面「有起草稿 → 走旧路径」的分支，
    //    内置生成器**再也不会执行** —— 等于「跑一次就固化」。
    //    `draft.synth.json` 刻意不参与读盘判断（分支只看 `opts.draftPath ?? draft.json`）。
    writeStageJson({
      jobId: opts.jobId,
      self: STAGES.storyboard,
      target: STAGES.storyboard,
      file: 'draft.synth.json',
      data: draft,
      jobsDir: opts.jobsDir,
    });

    const motionCount = table.cues.filter((c) => c.decide === 'motion').length;
    const skippedShort = table.cues.filter((c) => c.skipped === 'too-short').length;
    log.info(
      `内置生成器：${table.cues.length} 条 cue → ${motionCount} 条 motion / ` +
        `${table.cues.length} 条 caption（too-short ${skippedShort} 条），已落 pacing.json；` +
        `已落 draft.synth.json（要手工调整请复制为 draft.json 后修改并重跑）`,
    );
  }
  assertDraftItemKeys(draft);

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
  // 🔴 放行记录优先于 `draft.meta`：前者是人工签的凭据，后者只是模型填的草稿字段。
  const metaConfirmedBy = alignWaiver?.by ?? draft.meta.confirmedBy;
  const metaConfirmedAt = alignWaiver?.at ?? draft.meta.confirmedAt;
  const baked: Storyboard = {
    meta: {
      fps: source.fps,
      anchorMode: draft.meta.anchorMode,
      alignmentConfidence: alignReport.meanConfidence,
      ...(metaConfirmedBy ? { confirmedBy: metaConfirmedBy } : {}),
      ...(metaConfirmedAt ? { confirmedAt: metaConfirmedAt } : {}),
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

  /**
   * 模板声明快照（S1b，2026-10-20）。
   *
   * 两个用途，缺一不可：
   *  ① **浏览器侧 hydrate**：渲染进程与 Node 不是同一个内存，`custom/*` 的
   *     声明必须随 `render-props.json` 送进去，否则 `MotionItem` 查注册表直接抛错。
   *  ② **历史可追溯**：模板日后被删改，旧 job 仍能凭快照校验/渲染，
   *     不会出现「当时能渲、现在 validate 不过」。
   *
   * 只存**本 job 实际用到的** motion（去重），不塞整库 —— 快照是证据，不是镜像。
   */
  const usedMotions = [...new Set(tracks.flatMap((t) => t.items.map((i) => i.motion)))].sort();
  writeStageJson({
    jobId: opts.jobId,
    self: STAGES.storyboard,
    target: STAGES.storyboard,
    file: 'template-snapshot.json',
    data: usedMotions.map((m) => getTemplate(m)),
    jobsDir: opts.jobsDir,
  });
  log.done(
    `storyboard.json 已烘焙：${baked.tracks.length} 轨 / ${report.records.length} 条锚点解析记录`,
  );

  return { storyboard: baked, report, threshold: T, safetyValve };
}
