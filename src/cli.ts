#!/usr/bin/env node
/**
 * 统一入口。
 *
 *   npx tsx src/cli.ts <stage> [options]
 *
 * 五个阶段按序：align → perceive → storyboard → validate → render
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
import { runRender } from './stages/render.ts';

interface Args {
  stage: string;
  job: string | null;
  jobsDir: string;
  draft: string | null;
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
    draft: null,
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
      case '--draft':
        out.draft = next();
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
  storyboard  按词级锚点起草并烘焙 storyboard.json
  validate    跑构建期校验项（当前 18 项），产出 validate-report.json
  render      C6 双栈映射 + 本地渲染（必须显式 --gl=angle）

选项：
  --job, -j <id>     job 标识（除 init 外必填）
  --jobs-dir <dir>   job 根目录，默认 jobs
  --draft <file>     storyboard 起草稿路径（默认 03-storyboard/draft.json）
  --interval <sec>   抽帧密度，默认 1.5（可调，见 E4）
  --force            忽略不可变快照，强制重跑本阶段
  --dry-run          只做映射与启动闸检查，不真正渲染
  --no-subtitle      align 阶段：声明本片不做字幕对齐（只能用 abs: 锚点）
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

  switch (args.stage) {
    case 'align': {
      // 🔴 `M-1g`：显式声明「本片不做字幕对齐」。产出的是**显式标记的空产物**
      //   （`mode:'no-subtitle'`），不是伪造的测量值 —— 见
      //   `createNoSubtitleAlignReport` 的说明。
      if (args.noSubtitle) {
        runNoSubtitleAlign({
          jobId: args.job,
          jobsDir: args.jobsDir,
          force: args.force,
        });
        return EXIT.OK;
      }
      const outcome = runAlign({ jobId: args.job, jobsDir: args.jobsDir, force: args.force });
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
            '  · 若降级到 cue 级，storyboard.meta.anchorMode 必须标 "cue"',
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
        jobId: args.job,
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
        jobId: args.job,
        jobsDir: args.jobsDir,
        ...(args.draft ? { draftPath: args.draft } : {}),
      });
      if (outcome.safetyValve) {
        log.warn('安全阀触发：整批 sim_max 中位数 < 0.4 → 整批转 custom + 人审（未降阈值硬套库）');
      }
      log.done('storyboard 已就绪，下一步 validate。');
      return EXIT.OK;
    }

    case 'validate': {
      const { report } = runValidateStage({ jobId: args.job, jobsDir: args.jobsDir });
      return report.ok ? EXIT.OK : EXIT.VALIDATION_FAILED;
    }

    case 'render': {
      const outcome = runRender({
        jobId: args.job,
        jobsDir: args.jobsDir,
        ...(args.dryRun ? { dryRun: true } : {}),
      });
      log.done(`映射完成：${outcome.propsFile}`);
      return EXIT.OK;
    }

    default:
      throw new ConfigError(`未知阶段：${args.stage}\n\n${USAGE}`);
  }
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
