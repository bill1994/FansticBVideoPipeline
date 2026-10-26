#!/usr/bin/env node
/**
 * 统一入口。
 *
 *   npx tsx src/cli.ts <stage> [options]
 *
 * 五个阶段按序：align → perceive → storyboard → validate → render
 * render 之前可插入 `review`（P1-a）：Studio 人工看片，must_review 确认后才可渲染。
 * 另有 `init` 用于建出一个空 job 骨架。
 *
 * 退出码（§5.3 语义化退出码）：
 *   0 可交付 / 1 校验没过 / 2 参数错 / 3 版式✗ / 4 渲染失败 / 5 排队超时 / 6 内部错误 / 130 中断
 */

import path from 'node:path';
import { DEFAULT_JOBS_DIR, STAGES } from './core/config.ts';
import { ConfigError, EXIT, exitCodeFor, type ExitCode } from './core/exit-code.ts';
import { ensureJobDirs, jobDir, writeJson } from './core/io.ts';
import { log, printBlock } from './core/log.ts';
import { assertRegistryValid } from './templates/registry.ts';
import { loadSpecsFromDisk } from './core/spec-loader.ts';
import { runAlign, runNoSubtitleAlign } from './stages/align.ts';
import { runPerceive } from './stages/perceive.ts';
import { runStoryboard } from './stages/storyboard.ts';
import { runValidateStage } from './stages/validate.ts';
import { runReview } from './stages/review.ts';
import { runRender } from './stages/render.ts';
import { EXEC_ORDER } from './core/config.ts';
import { markStageFinished, markStageRunning } from './core/pipeline-state.ts';
import { runCancelCommand, runResumeCommand, runStatusCommand } from './cli-state.ts';

interface Args {
  stage: string;
  job: string | null;
  jobsDir: string;
  force: boolean;
  dryRun: boolean;
  noSubtitle: boolean;
  interval: number | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    stage: argv[0] ?? '',
    job: null,
    jobsDir: DEFAULT_JOBS_DIR,
    force: false,
    dryRun: false,
    noSubtitle: false,
    interval: null,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i] as string;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new ConfigError(`参数 ${a} 缺少取值`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--job':
      case '-j':
        out.job = next();
        break;
      case '--jobs-dir':
        out.jobsDir = next();
        break;
      case '--interval':
        out.interval = Number.parseFloat(next());
        break;
      case '--force':
        out.force = true;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--no-subtitle':
        out.noSubtitle = true;
        break;
      case '--help':
      case '-h':
        out.stage = 'help';
        break;
      default:
        throw new ConfigError(`未知参数：${a}`);
    }
  }
  return out;
}

const USAGE = `Remotion overlay pipeline —— 在实拍视频上叠加 motion-graphic

用法： npx tsx src/cli.ts <stage> --job <jobId> [options]

阶段（按序执行）：
  init        建出 jobs/<jobId>/{00-input..06-review} 骨架 + source.json 模板
  align       抽音轨 → 16kHz 单声道 wav，强制对齐，置信度门控
  perceive    抽帧 + 主体/手持物/B-roll 检测 + 安全区
  storyboard  读 03-storyboard/motionboard.json（缺失则按节奏表生成意图底稿）
              → 绑定器解析意图 → 烘焙 storyboard.json
  validate    跑构建期校验项（当前 18 项），产出 validate-report.json
  review      产出 06-review/preview-props.json 并启动 Remotion Studio 人工看片
              （P1-a：must_review 条目须确认后才可 render；hash 防 storyboard 漂移）
  render      C6 双栈映射 + 本地渲染（必须显式 --gl=angle）

状态类命令（P1-2，不参与五阶段调度）：
  status      打印各阶段状态 / 耗时 / 退出码；顺带把「进程已死但标着 running」修复为 failed
  cancel      终止正在运行的阶段（按 pid 杀整棵进程树，含 ffmpeg / whisper / chrome）
  resume      从执行顺序上第一个未完成阶段继续；**停在 render 之前**（那一步须人工看片）

选项：
  --job, -j <id>     job 标识（除 init 外必填）
  --jobs-dir <dir>   job 根目录，默认 jobs
  --interval <sec>   抽帧密度，默认 1.5（可调，见 E4）
  --force            忽略不可变快照，强制重跑本阶段
  --dry-run          只做映射与启动闸检查，不真正渲染
  --no-subtitle      align 阶段：声明本片不做字幕对齐（只能用 abs: 锚点）

长任务状态落 jobs/<id>/pipeline-state.json（job 根目录，不进任何阶段快照）。
cancel 不要求阶段支持 abort —— 它靠 pid + taskkill /T，见 core/pipeline-state.ts 文件头。
`;

/** 阶段目录清单，供 init 打印。 */
function stageList(): string {
  return Object.values(STAGES).join(' → ');
}

function runInit(args: Args): ExitCode {
  if (!args.job) throw new ConfigError('init 需要 --job <jobId>');
  const root = ensureJobDirs(args.job, args.jobsDir);
  const manifest = path.join(root, STAGES.input, 'source.json');
  writeJson(manifest, {
    video: 'raw.mp4',
    srt: 'raw.srt',
    fps: 30,
    durationInFrames: 0,
  });
  printBlock(
    [
      `已建出 job 骨架：${root}`,
      `  阶段目录：${stageList()}`,
      `  素材清单：${manifest}`,
      '',
      '下一步：',
      `  1. 把「已粗剪拼接、无文字无特效的视频 + SRT」放进 ${STAGES.input}/`,
      `  2. 填好 source.json 的 video / srt / fps / durationInFrames`,
      '  3. 每个阶段目录都是一份不可变快照：返修第 3 级，第 4/5 级作废重跑',
    ].join('\n'),
  );
  return EXIT.OK;
}

async function main(): Promise<ExitCode> {
  assertRegistryValid();
  // S1a：装载 templates/specs/*.json（目录不存在则静默跳过）。
  // 必须在任何阶段消费模板声明之前执行 —— 否则 custom/* 会被判「未注册」。
  loadSpecsFromDisk();
  const args = parseArgs(process.argv.slice(2));

  if (args.stage === '' || args.stage === 'help') {
    printBlock(USAGE);
    return args.stage === '' ? EXIT.BAD_ARGS : EXIT.OK;
  }

  if (args.stage === 'init') return runInit(args);

  if (!args.job) throw new ConfigError(`阶段 ${args.stage} 需要 --job <jobId>`);
  // 提到闭包外：`dispatchStage` 是箭头函数，TS 的类型收窄在闭包里失效，
  // 每次用 `args.job` 都要重申一次非空，这里收敛成一个局部常量。
  const jobId: string = args.job;

  /**
   * 阶段调度本体 —— 抽成函数只为**统一包状态跟踪**（P1-2，2026-10-26）：
   * 每个阶段开始时写 `running`、结束时写 `done/failed`，异常路径也能落 `failed`。
   * 保持原有缩进不动，避免为了对齐产生上百行噪音 diff。
   */
  const dispatchStage = async (stage: string): Promise<ExitCode> => {
  switch (stage) {
    case 'align': {
      // 🔴 `M-1g`：显式声明「本片不做字幕对齐」。产出的是**显式标记的空产物**
      //   （`mode:'no-subtitle'`），不是伪造的测量值 —— 见
      //   `createNoSubtitleAlignReport` 的说明。
      if (args.noSubtitle) {
        runNoSubtitleAlign({
          jobId,
          jobsDir: args.jobsDir,
          force: args.force,
        });
        return EXIT.OK;
      }
      const outcome = runAlign({ jobId, jobsDir: args.jobsDir, force: args.force });
      const r = outcome.report;
      printBlock(
        [
          `对齐完成：均值置信度 ${r.meanConfidence.toFixed(4)}，低置信词占比 ${(r.lowConfidenceRatio * 100).toFixed(2)}%`,
          `  阈值：均值 ≥ ${r.thresholds.meanConfidenceMin} 且 低置信占比 ≤ ${r.thresholds.lowConfidenceRatioMax}`,
        ].join('\n'),
      );
      if (!outcome.gatePassed) {
        log.error('门控未通过 → 阻断（C2-4：降级必须阻断）。');
        printBlock(
          [
            '停在这里，等人工显式确认。确认后：',
            '  · 写 06-review/confirmed.json（stage="alignment"）',
            '  · 若降级到 cue 级，motionboard.meta.anchorMode 必须标 "cue"',
            `  · 低置信词：${r.lowConfidenceWords.slice(0, 20).join(', ')}${r.lowConfidenceWords.length > 20 ? ' …' : ''}`,
            '  ⚠️ 阈值 0.60 / 30% 是初值，待实测校准（§10.5）。',
          ].join('\n'),
        );
        return EXIT.VALIDATION_FAILED;
      }
      log.done('门控通过，可进入 perceive。');
      return EXIT.OK;
    }

    case 'perceive': {
      const outcome = await runPerceive({
        jobId,
        jobsDir: args.jobsDir,
        force: args.force,
        ...(args.interval !== null ? { frameIntervalSec: args.interval } : {}),
      });
      const n = outcome.result.regions.length;
      log.done(`感知完成：${outcome.result.shots.length} 个 shot / ${n} 个区域`);
      if (outcome.lowConfidenceShots.length > 0) {
        log.warn(
          `低置信 shot：${outcome.lowConfidenceShots.join(', ')} —— 不阻断，validate 会出 W-F6-01，人工在编辑页兜底`,
        );
      }
      return EXIT.OK;
    }

    case 'storyboard': {
      const outcome = runStoryboard({
        jobId,
        jobsDir: args.jobsDir,
      });
      if (outcome.safetyValve) {
        log.warn('安全阀触发：整批 sim_max 中位数 < 0.4 → 整批转 custom + 人审（未降阈值硬套库）');
      }
      log.done('storyboard 已就绪，下一步 validate。');
      return EXIT.OK;
    }

    case 'validate': {
      const { report } = runValidateStage({ jobId, jobsDir: args.jobsDir });
      return report.ok ? EXIT.OK : EXIT.VALIDATION_FAILED;
    }

    case 'review': {
      runReview({
        jobId,
        jobsDir: args.jobsDir,
        ...(args.dryRun ? { dryRun: true } : {}),
      });
      return EXIT.OK;
    }

    case 'render': {
      const outcome = await runRender({
        jobId,
        jobsDir: args.jobsDir,
        ...(args.dryRun ? { dryRun: true } : {}),
      });
      log.done(`映射完成：${outcome.propsFile}`);
      return EXIT.OK;
    }

    default:
      throw new ConfigError(`未知阶段：${stage}\n\n${USAGE}`);
  }
  };

  // ── 状态类命令（不跟踪自身状态，也不属于五阶段）────────────
  if (args.stage === 'status') return runStatusCommand({ job: args.job, jobsDir: args.jobsDir });
  if (args.stage === 'cancel') return runCancelCommand({ job: args.job, jobsDir: args.jobsDir });
  if (args.stage === 'resume') {
    return await runResumeCommand(
      { job: args.job, jobsDir: args.jobsDir },
      // 注入调度函数：resume 不反向依赖 cli，同时复用同一套阶段实现
      async (s) => runTracked(s),
    );
  }

  /** 带状态跟踪地跑一个阶段。 */
  async function runTracked(stage: string): Promise<ExitCode> {
    const tracked = (EXEC_ORDER as readonly string[]).includes(stage);
    if (tracked) markStageRunning(jobId, stage, stage, args.jobsDir);
    try {
      const code = await dispatchStage(stage);
      if (tracked) {
        markStageFinished(
          jobId,
          stage,
          code === EXIT.OK ? 'done' : 'failed',
          code,
          args.jobsDir,
        );
      }
      return code;
    } catch (e) {
      if (tracked) {
        markStageFinished(
          jobId,
          stage,
          'failed',
          exitCodeFor(e),
          args.jobsDir,
          ((e as Error).message ?? String(e)).split('\n')[0]?.slice(0, 200),
        );
      }
      throw e;
    }
  }

  return await runTracked(args.stage);
}

const code = await (async (): Promise<ExitCode> => {
  try {
    return await main();
  } catch (e) {
    const mapped = exitCodeFor(e);
    // 只有「没被归类的异常」才值得打栈；已知类型打人话就够。
    if (mapped === EXIT.INTERNAL) {
      log.error(`内部错误：${(e as Error).stack ?? String(e)}`);
    } else {
      log.error((e as Error).message);
    }
    return mapped;
  }
})();

process.exitCode = code;

export { jobDir };
