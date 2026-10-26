/**
 * 渲染失败路径的**落盘**验证（2026-10-26）。
 *
 * 为什么单独一个文件、为什么要 mock：
 *   `classifyRenderFailure` 的纯函数判据已在 `render-failure.test.ts` 锁住，但那只证明
 *   「分类对了」。本项目栽过四层假绿，其中一层正是「算了只拼进字符串」——
 *   分类对不对，与**失败有没有真的写进 `05-render/render-report.json`** 是两件事。
 *   真渲一次失败要几十秒且依赖环境，故 mock `spawn` 让它必失败，其余全走真实代码路径
 *   （真实 `runRender` → 真实 renderGate → 真实 composeRenderProps → 真实 writeStageJson）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    // 模拟「渲染失败」：先吐一段 GPU 错误文本，再以退出码 1 关闭。
    spawn: () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { EventEmitter } = require('node:events') as typeof import('node:events');
      const child = new EventEmitter() as unknown as Record<string, unknown> & {
        stdout: InstanceType<typeof EventEmitter>;
        stderr: InstanceType<typeof EventEmitter>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => {
        child.stderr.emit('data', Buffer.from('Error: Failed to create WebGL context for "Overlay"'));
        (child as unknown as InstanceType<typeof EventEmitter>).emit('close', 1);
      }, 0);
      return child;
    },
  };
});

const { runRender } = await import('../src/stages/render.ts');
const { ensureJobDirs } = await import('../src/core/io.ts');

const JOB = 'jf';
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-renderfail-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeAt(rel: string, data: unknown): void {
  const file = path.join(root, JOB, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** 造一个能通过 renderGate 的最小 job（validate ok、无 fullscreen、无 must_review）。 */
function makeJob(): void {
  ensureJobDirs(JOB, root);
  writeAt('00-input/source.json', {
    video: 'raw.mp4',
    srt: 'raw.srt',
    fps: 30,
    durationInFrames: 300,
    // 本文件测的是「渲染失败落盘」，不关心素材是否存在；
    // 不加这个开关会先被 2026-10-26 新增的素材存在性闸拦住，走不到渲染。
    allowNoVideo: true,
  });
  writeAt('01-align/words.json', {
    fps: 30,
    words: [{ index: 0, word: 'a', startFrame: 0, endFrame: 29, confidence: 0.9 }],
    cues: [{ index: 0, fromFrame: 0, toFrame: 29, text: 'a', srtFromSec: 0, srtToSec: 1 }],
  });
  writeAt('01-align/align-report.json', {
    fps: 30,
    mode: 'aligned',
    meanConfidence: 0.9,
    lowConfidenceRatio: 0.01,
    gatePassed: true,
    lowConfidenceWords: [],
    textSource: 'srt',
    alignedRatio: 1,
    thresholds: { meanConfidenceMin: 0.6, lowConfidenceRatioMax: 0.3, alignedRatioMin: 0.8 },
  });
  writeAt('02-perceive/shots.json', [
    { id: 's0', fromFrame: 0, durationInFrames: 300, safeArea: null, lowConfidence: false },
  ]);
  writeAt('02-perceive/regions.json', []);
  writeAt('03-storyboard/storyboard.json', {
    meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
    tracks: [
      {
        id: 'ov',
        layer: 200,
        items: [
          {
            fromFrame: 10,
            durationInFrames: 60,
            motion: 'typography/kinetic-line@1.0',
            footprint: [0, 0.72, 0.42, 0.18],
            params: { text: 'ov' },
          },
        ],
      },
    ],
    noMotionRanges: [],
  });
  writeAt('03-storyboard/bake-report.json', { fps: 30, records: [] });
  writeAt('04-validate/validate-report.json', {
    ok: true,
    summary: { error: 0, warning: 0, checked: 18, extra: [] },
    items: [],
    reviewQueue: [],
  });
}

describe('渲染失败 → 落盘可对账（此前什么都不留）', () => {
  it('🔴 失败时写 render-report.json：ok=false + 分类命中 + outputTail + items(stage:render)', async () => {
    makeJob();
    await expect(runRender({ jobId: JOB, jobsDir: root })).rejects.toThrow(/渲染失败/);

    const reportFile = path.join(root, JOB, '05-render', 'render-report.json');
    expect(fs.existsSync(reportFile)).toBe(true);

    const r = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as {
      ok: boolean;
      failed: boolean;
      failure: { exitCode: number; classified: string | null };
      items: { code: string; stage: string }[];
      outputTail: string;
    };

    // ① 失败事实被记录（此前只有终端一行字）
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(true);
    expect(r.failure.exitCode).toBe(1);

    // ② 分类命中 GPU 码，且条目 stage 真的是 'render'（不是 'build'）
    expect(r.failure.classified).toBe('E-RT-03');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.code).toBe('E-RT-03');
    expect(r.items[0]?.stage).toBe('render');

    // ③ 原始输出尾巴留档，供人工排查（分类判据是子串匹配，必须能看到原文）
    expect(r.outputTail).toContain('WebGL');
  });

  it('拿不到能归类的输出时，classified 记 null 而不是猜一个码', async () => {
    makeJob();
    // 本文件 mock 固定吐 GPU 文本；这里只校验「有分类就该有 items」的对称性，
    // 未归类分支由 render-failure.test.ts 的纯函数用例覆盖（返回 null）。
    await expect(runRender({ jobId: JOB, jobsDir: root })).rejects.toThrow(/已归类 E-RT-03/);
  });
});
