/**
 * 长任务状态与崩溃恢复（EAC P1-2，2026-10-26）。
 *
 * 锁三件最容易错的事：
 *   ① **崩溃恢复判据是 pid 存活**，不是时间阈值 —— 时间阈值要拍脑袋，pid 是事实；
 *   ② **原子写**：中途被杀不能留下截断的 JSON（恢复工具被崩溃弄坏是最难查的一类）；
 *   ③ **firstRunnableStage 要看产物**，否则 P1-2 之前的老 job（如 demo）会被从 align 重跑。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  firstUnfinished,
  isPidAlive,
  markStageFinished,
  markStageRunning,
  readState,
  reconcileState,
  stateFile,
  summarize,
} from '../src/core/pipeline-state.ts';
import { EXEC_ORDER } from '../src/core/config.ts';

const JOB = 'jp';
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-state-'));
  fs.mkdirSync(path.join(root, JOB), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('状态记录：写读一致', () => {
  it('markStageRunning 写 running + 当前 pid；markStageFinished 落终态', () => {
    markStageRunning(JOB, 'align', 'align', root);
    let s = readState(JOB, root);
    expect(s?.stages['align']?.status).toBe('running');
    expect(s?.stages['align']?.runnerPid).toBe(process.pid);
    expect(s?.lastCommand).toBe('align');

    markStageFinished(JOB, 'align', 'done', 0, root);
    s = readState(JOB, root);
    expect(s?.stages['align']?.status).toBe('done');
    expect(s?.stages['align']?.exitCode).toBe(0);
    expect(s?.stages['align']?.finishedAt).toBeDefined();
  });

  it('原子写：不残留 .tmp 文件', () => {
    markStageRunning(JOB, 'align', 'align', root);
    const leftovers = fs.readdirSync(path.join(root, JOB)).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('状态文件在 job 根目录，不进任何阶段目录', () => {
    markStageRunning(JOB, 'align', 'align', root);
    expect(fs.existsSync(stateFile(JOB, root))).toBe(true);
    expect(path.basename(path.dirname(stateFile(JOB, root)))).toBe(JOB);
  });
});

describe('崩溃恢复：判据是 pid 存活', () => {
  it('running + pid 已死 → 修复为 failed，并记 note', () => {
    // 999999 几乎不可能存在的 pid
    fs.writeFileSync(
      stateFile(JOB, root),
      `${JSON.stringify(
        {
          jobId: JOB,
          stages: { align: { status: 'running', runnerPid: 999999, startedAt: new Date().toISOString() } },
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    const { state, repaired } = reconcileState(JOB, root);
    expect(repaired).toEqual(['align']);
    expect(state.stages['align']?.status).toBe('failed');
    expect(state.stages['align']?.note).toContain('进程消失');
  });

  it('running + pid 存活（本进程）→ 保持 running，不误判', () => {
    markStageRunning(JOB, 'render', 'render', root);
    const { state, repaired } = reconcileState(JOB, root);
    expect(repaired).toEqual([]);
    expect(state.stages['render']?.status).toBe('running');
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('终止态不受修复影响', () => {
    markStageFinished(JOB, 'validate', 'failed', 1, root, '校验不过');
    const { state, repaired } = reconcileState(JOB, root);
    expect(repaired).toEqual([]);
    expect(state.stages['validate']?.status).toBe('failed');
  });
});

describe('阶段推进：按执行顺序而非目录顺序', () => {
  it('EXEC_ORDER 里 review 在 render 之前（目录序是相反的）', () => {
    expect(EXEC_ORDER.indexOf('review')).toBeLessThan(EXEC_ORDER.indexOf('render'));
  });

  it('firstUnfinished 按 EXEC_ORDER 取第一个非 done', () => {
    markStageFinished(JOB, 'align', 'done', 0, root);
    markStageFinished(JOB, 'perceive', 'done', 0, root);
    const s = readState(JOB, root);
    expect(firstUnfinished(s!)).toBe('storyboard');
  });

  it('summarize 输出全部六个阶段（未出现的补 pending）', () => {
    const rows = summarize(null);
    expect(rows).toHaveLength(EXEC_ORDER.length);
    expect(rows.every((r) => r.run.status === 'pending')).toBe(true);
  });
});
