/**
 * 长任务状态与崩溃恢复（EAC P1-2，2026-10-26）。
 *
 * 解决的问题：`align` 14–28 分钟、`render` 20–22 分钟。进程被杀之后，
 *   人只能翻日志，**拿不到「跑到哪个阶段、什么时候开始、能不能续跑」**。
 *
 * ── 三个刻意的设计决定 ──────────────────────────────────────────
 *
 * 1. **落点是 job 根目录，不是任何阶段目录**
 *    `jobs/<id>/pipeline-state.json`。阶段目录是**不可变快照**（`assertNotWritingUpstream`
 *    守着），把可变运行状态塞进去会直接破坏那条纪律。根目录是它们共同的父级，不属任何阶段。
 *
 * 2. **允许时钟，不进任何产物哈希**
 *    `Date.now()` 的确定性红线只针对**渲染产物**（`src/remotion/`，字幕与模板组件）。
 *    本文件是工具元数据，不参与 `hashStoryboardFile` / `canonicalSpecHash` / 逐帧 diff，
 *    因此时间戳在这里是安全的、也是必要的（「跑了多久」正是要回答的问题之一）。
 *
 * 3. **`cancel` 靠 pid + 杀进程树，不要求子进程可 abort**
 *    方案原文写「把 `spawnSync` 改为可中断的 `spawn`」。核对代码后发现不必：
 *    `cancel` 是**另一个进程**发起的，它只需要知道「谁在跑」并对整棵树 `taskkill /T`。
 *    而执行 `align` 的父进程 pid 在阶段开始时就已知（`process.pid`），
 *    ffmpeg / whisper 都是它的子孙 ⇒ 杀树即可。
 *    改成 async spawn 的代价是把整条 align 链同步→异步（波及 cli、测试与 execFileSync 的
 *    pipe/inherit 语义），收益为零。**这是对原方案的有意偏离，理由记录在此。**
 */

import fs from 'node:fs';
import path from 'node:path';
import { EXEC_ORDER } from './config.ts';
import { jobDir } from './io.ts';

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface StageRun {
  status: StageStatus;
  /** ISO 时间串。**仅用于人读**，不参与任何确定性判定（见文件头第 2 条）。 */
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  /**
   * 执行该阶段的**父进程** pid（`process.pid`）。
   * `cancel` 用它 `taskkill /T /F` 杀整棵树 —— 不需要子进程自己配合 abort。
   */
  runnerPid?: number;
  /** 失败/取消的人话原因（不填错误码，错误码在 exitCode 里）。 */
  note?: string;
}

export interface PipelineState {
  jobId: string;
  /** 各阶段运行状态。未出现的阶段视为 `pending`。 */
  stages: Record<string, StageRun>;
  updatedAt: string;
  /** 最近一次触发的命令（`align` / `resume` …），排查时序用。 */
  lastCommand?: string;
}

export function stateFile(jobId: string, jobsDir?: string): string {
  return path.join(jobDir(jobId, jobsDir), 'pipeline-state.json');
}

export function readState(jobId: string, jobsDir?: string): PipelineState | null {
  const file = stateFile(jobId, jobsDir);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PipelineState;
}

/**
 * 原子写：先写 `.tmp` 再 `rename`。
 *
 * 🔴 为什么不用 `fs.writeFileSync` 直写：跑到一半被 kill 时，直写会留下**截断的 JSON**，
 *   下一次读直接抛 `SyntaxError` —— 「崩溃恢复」的工具被崩溃本身弄坏，是最难查的一类问题。
 */
function writeState(state: PipelineState, jobId: string, jobsDir?: string): void {
  const file = stateFile(jobId, jobsDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/** pid 是否还活着（`kill(pid, 0)` 只探测不发送）。 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读并**顺带修复**：把上一轮遗留的 `running` 判定为 `failed`。
 *
 * 判据不是「时间过了多久」，而是 **runnerPid 是否还活着** ——
 * 时间阈值需要拍脑袋定，pid 存活是事实。
 * 同一台机上 pid 可能被复用，但配合「阶段开始时间」人工可辨；这里宁可误判 failed
 * 也不让 `running` 永远挂着（挂着的后果是 `resume` 永远认为它在跑）。
 */
export function reconcileState(
  jobId: string,
  jobsDir?: string,
): { state: PipelineState; repaired: string[] } {
  const existing = readState(jobId, jobsDir);
  const state: PipelineState =
    existing ?? { jobId, stages: {}, updatedAt: new Date().toISOString() };

  const repaired: string[] = [];
  for (const [stage, run] of Object.entries(state.stages)) {
    if (run.status !== 'running') continue;
    if (run.runnerPid !== undefined && isPidAlive(run.runnerPid)) continue;
    run.status = 'failed';
    run.finishedAt = new Date().toISOString();
    run.note = '上次运行期间进程消失（崩溃 / 被杀），此处由状态修复标记为 failed';
    repaired.push(stage);
  }
  if (repaired.length > 0) {
    state.updatedAt = new Date().toISOString();
    writeState(state, jobId, jobsDir);
  }
  return { state, repaired };
}

/** 阶段开始：写 `running` + 当前 pid。 */
export function markStageRunning(
  jobId: string,
  stage: string,
  command: string,
  jobsDir?: string,
): void {
  const { state } = reconcileState(jobId, jobsDir);
  state.stages[stage] = {
    status: 'running',
    startedAt: new Date().toISOString(),
    runnerPid: process.pid,
  };
  state.lastCommand = command;
  state.updatedAt = new Date().toISOString();
  writeState(state, jobId, jobsDir);
}

/** 阶段结束：写终态。`exitCode` 原样记录（0 表示成功）。 */
export function markStageFinished(
  jobId: string,
  stage: string,
  status: Extract<StageStatus, 'done' | 'failed' | 'cancelled'>,
  exitCode: number,
  jobsDir?: string,
  note?: string,
): void {
  const state = readState(jobId, jobsDir) ?? { jobId, stages: {}, updatedAt: '' };
  const prev = state.stages[stage] ?? { status: 'pending' as const };
  state.stages[stage] = {
    ...prev,
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
    ...(note === undefined ? {} : { note }),
  };
  state.updatedAt = new Date().toISOString();
  writeState(state, jobId, jobsDir);
}

/** 按**执行顺序**找第一个未完成的阶段；全部完成返回 null。 */
export function firstUnfinished(state: PipelineState): string | null {
  for (const stage of EXEC_ORDER) {
    if (state.stages[stage]?.status !== 'done') return stage;
  }
  return null;
}

/** 按执行顺序列出现状（`status` 命令用）。 */
export function summarize(state: PipelineState | null): { stage: string; run: StageRun }[] {
  return EXEC_ORDER.map((stage) => ({
    stage,
    run: state?.stages[stage] ?? ({ status: 'pending' } as StageRun),
  }));
}

/** 单调递增的阶段序号（与 `EXEC_ORDER` 对齐），进度文案用。 */
export function execIndex(stage: string): number {
  return EXEC_ORDER.indexOf(stage as (typeof EXEC_ORDER)[number]);
}
