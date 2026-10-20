/**
 * 校验上下文 —— 一次性把构建期所需的全部结构化数据读齐。
 *
 * 输入边界由 SPEC §2.1 限定：**只读 03-storyboard + 01-align + 02-perceive**
 * （+ 00-input 的素材清单，用于校验项 #10 的成片总时长）。
 * 校验器是**纯函数**：这一层之后不再碰磁盘。
 */

import fs from 'node:fs';
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

  /**
   * 🔴 `meta.alignmentConfidence` 是 SPEC §1.2 强制的 5 个 meta 字段之一，
   * 但 2026-10-19 端到端审计发现它**零消费者** —— 手改 storyboard 把置信度
   * 改成任意值都不会被发现。这里补一次一致性断言（属**结构检查**，
   * 退出码 2，不占 18 项校验名额）。
   *
   * 它不是可编辑字段，是上游测量值的**副本**：改它等于伪造对齐置信度。
   */
  if (storyboard.meta.alignmentConfidence !== alignReport.meanConfidence) {
    throw new ConfigError(
      `meta.alignmentConfidence（${storyboard.meta.alignmentConfidence}）与 ` +
        `01-align/align-report.json 的 meanConfidence（${alignReport.meanConfidence}）不一致。\n` +
        `  该字段是上游测量值的副本，不可手改 —— 改它等于伪造对齐置信度。\n` +
        `  正确做法：改 draft 后重跑 storyboard，由烘焙器回填。`,
    );
  }

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

  assertStageOrderIsSane(base);

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

/**
 * 产物时序自检 ——「下游产物是否比上游旧」（2026-10-20，`F3-2`）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要这道守卫（它与 `assertNotWritingUpstream` 是两件事）
 * ─────────────────────────────────────────────────────────────
 * `assertNotWritingUpstream`（`core/io.ts`）管的是**写入方向**：
 * 「04 阶段不许回写 03 的产物」。它防的是**越权写**。
 *
 * 本函数管的是**时序方向**：**上游产物被更新后，下游有没有跟着重跑。**
 * 这是同一族问题的另一半 —— 前者防「改坏」，本函数防「没跟着改」。
 *
 * ── 实测到的故障（`jobs/e2e-perceive`，2026-10-20 复跑时发现）──
 * ```
 * 10-18 14:53  storyboard.json      ← 用旧版 words.json 烘焙
 * 10-18 14:54  validate-report.json ← 校验的是上面那份 storyboard
 * 10-19 12:57  words.json           ← M-1f 落地后 align --force 重跑，覆盖成新版
 * ```
 * 下游产物比上游**旧 22 小时**，而那份 validate-report 依然写着
 * `ok: true / error: 0`，只是 warning 数从真实的 21 变成了过时的 11。
 *
 * 🔴 **为什么其他断言抓不到**：`alignmentConfidence` 一致性断言（同在本文件）
 *    在这个案例里**是相等的** —— M-1f 只重铺词时、不改均值置信度。
 *    实测已确认相等 ⇒ 现有防线确实漏了这个方向。
 *
 * ── 为什么抛错而不是报warning ──
 * 这不是「内容不合规」，而是「**这份报告本身不可信**」。
 * 让它继续以 warning 形式躺在报告里，等于给一份已知失真的报告盖章。
 * 与同层的 `fps` / `alignmentConfidence` 断言一致：抛 `ConfigError`（退出码 2）。
 *
 * ⚠️ **已知局限（必须如实知道，不是缺陷而是取舍）**：
 *   比的是**文件 mtime**，不是数据依赖关系。`cp` / 解压 / `git checkout`
 *   会改写mtime，理论上可产生假阳性。
 *   本项目 `jobs/*` 被 gitignore（产物不入库），实际风险可控。
 *   更稳的做法是在烘焙时把上游 hash 写进 `storyboard.meta` 再比对——
 *   已登记为待办（见 PROGRESS.md 待办），本函数是成本低、可立即落地的版本。
 */
function assertStageOrderIsSane(base: string): void {
  /** 上游产物 → 下游产物。任一存在时序倒挂即报错。 */
  const pairs: { upstream: string; downstream: string; stage: string }[] = [
    {
      upstream: path.join(base, STAGES.align, 'words.json'),
      downstream: path.join(base, STAGES.storyboard, 'storyboard.json'),
      stage: '01-align → 03-storyboard',
    },
    {
      upstream: path.join(base, STAGES.align, 'words.json'),
      downstream: path.join(base, STAGES.storyboard, 'bake-report.json'),
      stage: '01-align → 03-storyboard',
    },
    {
      upstream: path.join(base, STAGES.perceive, 'regions.json'),
      downstream: path.join(base, STAGES.storyboard, 'storyboard.json'),
      stage: '02-perceive → 03-storyboard',
    },
  ];

  const stale: string[] = [];
  for (const p of pairs) {
    // 任一侧不存在则跳过 —— 缺产物由 readJson 的「缺少前置产物」报错管，
    // 这里只管「都在，但顺序不对」。
    if (!fs.existsSync(p.upstream) || !fs.existsSync(p.downstream)) continue;
    const up = fs.statSync(p.upstream).mtimeMs;
    const down = fs.statSync(p.downstream).mtimeMs;
    if (down < up) {
      stale.push(
        `  ${p.stage}：${path.basename(p.downstream)}（${new Date(down).toISOString()}）` +
          ` 比 ${path.basename(p.upstream)}（${new Date(up).toISOString()}）旧` +
          `${Math.round((up - down) / 60000)} 分钟`,
      );
    }
  }

  if (stale.length === 0) return;

  throw new ConfigError(
    `产物时序倒挂：下游产物比上游旧，说明它们**不是同一版数据跑出来的**。\n` +
      stale.join('\n') +
      `\n\n  后果：本次校验报告的一切数字都不可信 —— 它在用旧的下游配新的上游比对。\n` +
      `  （实测案例：W-C3-01 因此从真实的 14 条报成过时的 4 条，而报告仍显示 ok:true。）\n` +
      `  正确做法：按顺序重跑下游阶段。\n` +
      `    npm run pipeline -- storyboard --job <id> --draft <draft.json>\n` +
      `    npm run pipeline -- validate   --job <id>\n` +
      `  阶段目录是不可变快照，本工具**不会**替你重跑 —— 是否该重跑由你判断。\n` +
      `  ⚠️ 本检查比的是文件修改时间，不是数据依赖（cp / 解压会改写 mtime）。`,
  );
}

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
