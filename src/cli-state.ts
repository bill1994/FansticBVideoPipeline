/**
 * `status` / `cancel` / `resume` 三个命令（EAC P1-2，2026-10-26）。
 *
 * 与 `cli.ts` 分文件的原因：cli 已 260+ 行，且这三个命令**不参与五阶段调度**，
 * 只读写 `pipeline-state.json` 并对进程发信号。放一起会让人误以为它们是阶段。
 */

import { runForText } from './core/child-output.ts';
import fs from 'node:fs';
import path from 'node:path';
import { EXEC_ORDER, STAGES } from './core/config.ts';
import { EXIT, type ExitCode } from './core/exit-code.ts';
import { jobDir } from './core/io.ts';
import { log } from './core/log.ts';
import {
  execIndex,
  isPidAlive,
  markStageFinished,
  readState,
  reconcileState,
  summarize,
  type PipelineState,
  type StageRun,
} from './core/pipeline-state.ts';

export interface StateCommandArgs {
  job: string;
  jobsDir?: string;
}

/** 状态符号：一眼分辨「跑完了 / 跑挂了 / 还没轮到」。 */
const MARK: Record<StageRun['status'], string> = {
  pending: '·',
  running: '▶',
  done: '✔',
  failed: '✗',
  cancelled: '⏹',
};

function fmtDuration(run: StageRun): string {
  if (run.startedAt === undefined) return '—';
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt === undefined ? Date.now() : Date.parse(run.finishedAt);
  if (Number.isNaN(start)) return '—';
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m${String(sec % 60).padStart(2, '0')}s`;
}

/**
 * 各阶段的**关键产物**（判定「这阶段到底跑完没有」）。
 *
 * 🔴 为什么不能只用「目录非空」：`05-render` 里 `render-props.json` 是 `--dry-run`
 *   就会产出的映射文件，**不代表渲染完成**。用目录非空判定会把「只 dry-run 过」
 *   误报成 done。故每个阶段认一个"终点产物"：
 */
const KEY_ARTIFACT: Record<string, string> = {
  align: 'words.json',
  perceive: 'shots.json',
  storyboard: 'storyboard.json',
  validate: 'validate-report.json',
  review: 'preview-props.json',
  render: 'render-report.json',
};

/**
 * 该阶段是否已有**终点产物**（而非仅仅是跑过一次）。
 *
 * 🔴 为什么需要：`pipeline-state.json` 是 P1-2（2026-10-26）才有的，**此前的 job
 *   全都没有状态记录**（如 `examples/demo` 的 01/02 是 fixture 给的）。
 *   若只看 state 就说「下一步 align」，用户会去重跑一个本来就有产物的阶段。
 *   ⇒ 这里如实标成「有产物·无记录」，与「真的没跑过」区分开。
 */
function hasArtifacts(job: string, jobsDir: string | undefined, stage: string): boolean {
  const dir = (STAGES as Record<string, string>)[stage];
  const key = KEY_ARTIFACT[stage];
  if (dir === undefined || key === undefined) return false;
  return fs.existsSync(path.join(jobDir(job, jobsDir), dir, key));
}

/**
 * `pipeline status --job <id>`
 *
 * 🔴 会**先做一次修复**（`reconcileState`）：上一轮 `running` 但进程已消失的阶段
 *   在这里被标成 `failed`。这样「状态」本身就是可信的，不需要人去判断
 *   「它到底还在跑还是已经死了」。
 */
export function runStatusCommand(args: StateCommandArgs): ExitCode {
  const { state, repaired } = reconcileState(args.job, args.jobsDir);
  if (repaired.length > 0) {
    log.warn(`修复中断阶段（进程已不存在）：${repaired.join(', ')} → failed`);
  }

  const rows = summarize(state).map((r) => {
    // pending + 目录有产物 ⇒ 老 job（P1-2 之前跑的），标出来而不是谎报 pending
    const legacy = r.run.status === 'pending' && hasArtifacts(args.job, args.jobsDir, r.stage);
    return { ...r, legacy };
  });

  const hasAny = rows.some((r) => r.run.status !== 'pending' || r.legacy);
  if (!hasAny) {
    log.info(
      `${args.job}：还没有任何阶段记录（pipeline-state.json 不存在，且各阶段目录为空）。\n` +
        `  ↳ 跑过任一阶段后会自动生成：<jobs-dir>/${args.job}/pipeline-state.json`,
    );
    return EXIT.OK;
  }

  const lines = rows.map((r) => {
    const { run } = r;
    const mark = r.legacy ? '◌' : MARK[run.status];
    const status = r.legacy ? 'done?' : run.status;
    const dur = fmtDuration(run);
    const code = run.exitCode === undefined ? '' : ` exit=${run.exitCode}`;
    const note =
      r.legacy
        ? '  有产物但无状态记录（P1-2 之前跑的）'
        : run.note === undefined
          ? ''
          : `  ${run.note}`;
    return `  ${mark} ${r.stage.padEnd(10)} ${status.padEnd(9)} ${dur.padStart(7)}${code}${note}`;
  });
  log.info(
    `\n${args.job} 阶段状态（按执行顺序）：\n${lines.join('\n')}\n` +
      `  图例：· 未跑  ▶ 运行中  ✔ 完成  ✗ 失败  ⏹ 已取消  ◌ 有产物无记录`,
  );

  const next = firstRunnableStage(state, args.job, args.jobsDir);
  if (next === null) {
    log.done('全部阶段已完成。');
  } else {
    log.info(`下一步：${next}`);
    if (next === 'render') {
      log.info('  ⚠️ render 前必须人工看片：npm run pipeline -- review --job <id>');
    }
  }
  return EXIT.OK;
}

/**
 * 第一个「既没标 done、也没有终点产物」的阶段。
 *
 * 🔴 为什么要看产物而不只看 state：`pipeline-state.json` 是 P1-2（2026-10-26）才有的。
 *   对 P1-2 之前的 job（如 `examples/demo`，01/02 由 fixture 提供），state 里一片 pending ——
 *   只看 state 的话 `resume` 会从头跑 `align`，而 demo 根本没有视频素材，一跑就炸。
 *   「有终点产物」= 这阶段已经完成过，跳过去。`status` 与 `resume` 共用这一判定。
 */
function firstRunnableStage(
  state: PipelineState,
  job: string,
  jobsDir: string | undefined,
): string | null {
  for (const stage of EXEC_ORDER) {
    if (state.stages[stage]?.status === 'done') continue;
    if (hasArtifacts(job, jobsDir, stage)) continue;
    return stage;
  }
  return null;
}

/** 取该 stage 的 runnerPid 并杀整棵进程树。 */
function killTree(pid: number): { ok: boolean; detail: string } {
  if (process.platform === 'win32') {
    // /T 杀子树（npx → node → chrome / ffmpeg 都在树里），/F 强制
    // ⚠️ 必须经 runForText 解码：taskkill 的回执是 GBK，直接 utf8 读会得到 `�ɹ�: ����ֹ PID …`
    const r = runForText('taskkill', ['/PID', String(pid), '/T', '/F']);
    return { ok: r.status === 0, detail: r.output === '' ? `taskkill exit=${String(r.status)}` : r.output };
  }
  try {
    process.kill(pid, 'SIGTERM');
    return { ok: true, detail: 'SIGTERM' };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/**
 * `pipeline cancel --job <id>`
 *
 * 🔴 靠 **pid + 杀进程树**，不要求阶段内部支持 abort：
 *   `align` / `render` 的 ffmpeg、whisper、chrome 都是执行该阶段的父进程的子孙，
 *   `taskkill /T` 一并清理。这样 cancel 不需要改任何阶段的子进程调用方式。
 */
export function runCancelCommand(args: StateCommandArgs): ExitCode {
  /**
   * ⚠️ 这里**刻意不调 `reconcileState`**：它会把「running 但进程已死」先修成 failed，
   *    于是 cancel 抬头就看不到任何 running 阶段，只能回一句「无需取消」——
   *    而用户刚刚亲眼看到它显示 running，会以为 cancel 坏了。
   *    cancel 自己判断 pid 存活并落 `cancelled`，语义更准（是取消，不是崩溃修复）。
   */
  const state = readState(args.job, args.jobsDir);
  if (state === null) {
    log.info(`${args.job}：还没有任何阶段记录（pipeline-state.json 不存在）。`);
    return EXIT.OK;
  }
  const running = Object.entries(state.stages).filter(([, r]) => r.status === 'running');

  if (running.length === 0) {
    log.info(`${args.job}：没有正在运行的阶段（无需取消）。`);
    return EXIT.OK;
  }

  let acted = 0;
  for (const [stage, run] of running) {
    if (run.runnerPid === undefined) {
      log.warn(`${stage}：running 但没有 runnerPid 记录 —— 无法定位进程，标为 cancelled 以便 resume。`);
      markStageFinished(args.job, stage, 'cancelled', EXIT.INTERRUPTED, args.jobsDir, 'cancel：无 pid');
      acted += 1;
      continue;
    }
    if (!isPidAlive(run.runnerPid)) {
      log.warn(`${stage}：pid ${String(run.runnerPid)} 已不存在（可能刚刚结束），标为 cancelled。`);
      markStageFinished(args.job, stage, 'cancelled', EXIT.INTERRUPTED, args.jobsDir, 'cancel：pid 已退出');
      acted += 1;
      continue;
    }
    const r = killTree(run.runnerPid);
    if (r.ok) {
      log.done(`${stage}：已终止 pid ${String(run.runnerPid)} 及其子进程（${r.detail}）`);
      markStageFinished(args.job, stage, 'cancelled', EXIT.INTERRUPTED, args.jobsDir, 'cancel 命令终止');
    } else {
      log.error(`${stage}：终止失败 —— ${r.detail}`);
    }
    acted += 1;
  }
  return acted > 0 ? EXIT.OK : EXIT.INTERNAL;
}

/**
 * `pipeline resume --job <id>`
 *
 * 从**执行顺序**上第一个非 done 的阶段继续。
 *
 * 🔴 刻意**停在 render 之前**：`render` 的前置是人工看片（P1-a 的 must_review 闸），
 *   自动续跑到 render 只会撞闸然后失败，或者更糟 —— 让人以为"自动跑完了"。
 *   所以 resume 跑完 review 就收工，并明确提示下一步是人工看片 + render。
 *
 * @param runStage 由 cli 注入的阶段执行函数（避免本文件反向依赖 cli 的调度）
 */
export async function runResumeCommand(
  args: StateCommandArgs,
  runStage: (stage: string) => Promise<ExitCode>,
): Promise<ExitCode> {
  const { state, repaired } = reconcileState(args.job, args.jobsDir);
  if (repaired.length > 0) {
    log.warn(`修复中断阶段（进程已不存在）：${repaired.join(', ')} → failed`);
  }

  const next = firstRunnableStage(state, args.job, args.jobsDir);
  if (next === null) {
    log.done('全部阶段已完成，无需 resume。');
    return EXIT.OK;
  }

  const startAt = execIndex(next);
  const order = EXEC_ORDER.slice(startAt);
  log.info(`resume：从 ${next} 继续（跳过已完成的前 ${String(startAt)} 个阶段）`);

  let current: PipelineState | null = state;
  for (const stage of order) {
    if (stage === 'render') {
      log.info(
        '\n停在 render 之前 —— 它需要人工看片确认（P1-a 闸）。\n' +
          `  ① 看片：npm run pipeline -- review --job ${args.job}\n` +
          `  ② 出片：npm run pipeline -- render --job ${args.job}`,
      );
      return EXIT.OK;
    }
    const code = await runStage(stage);
    if (code !== EXIT.OK) {
      log.error(`resume 在 ${stage} 停止（exit=${String(code)}）。修掉问题后再跑 resume。`);
      return code;
    }
    current = readState(args.job, args.jobsDir);
    if (current === null) break;
  }
  const last = current === null ? null : firstRunnableStage(current, args.job, args.jobsDir);
  if (last === 'render') {
    log.info(`\n除 render 外全部完成。下一步需人工看片后出片：\n  npm run pipeline -- review --job ${args.job}`);
  }
  return EXIT.OK;
}
