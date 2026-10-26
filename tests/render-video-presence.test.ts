/**
 * 素材存在性闸（2026-10-26）。
 *
 * 背景：`render-props.ts` 的 `hasVideo: fs.existsSync(...)` 让「无视频」走占位底，
 * 这是 demo 的合法路径。但它同时把「素材忘拷 / 路径写错」也吞掉了 ——
 * 实测：`video` 指向不存在的文件，Remotion 照样渲完 30 帧、`ok:true`。
 *
 * 现在分三档，本文件锁住这三档的边界（尤其是**不能误伤 demo 的合法无视频路径**）。
 *
 * 渲染子进程被 mock 成立即失败：本文件只关心「素材闸放不放行」，
 * 不关心渲染成败（后者由 render-failure*.test.ts 覆盖）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { EventEmitter } = require('node:events') as typeof import('node:events');
      const child = new EventEmitter() as unknown as {
        stdout: InstanceType<typeof EventEmitter>;
        stderr: InstanceType<typeof EventEmitter>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => {
        child.stderr.emit('data', Buffer.from('Rendered 0/30'));
        (child as unknown as InstanceType<typeof EventEmitter>).emit('close', 1);
      }, 0);
      return child;
    },
  };
});

const { runRender } = await import('../src/stages/render.ts');
const { ensureJobDirs } = await import('../src/core/io.ts');
const { StageBlockedError } = await import('../src/core/exit-code.ts');

const JOB = 'jv';
let root: string;
const reportFile = (): string => path.join(root, JOB, '05-render', 'render-report.json');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-videopresence-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeAt(rel: string, data: unknown): void {
  const file = path.join(root, JOB, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function makeJob(opts: { allowNoVideo?: boolean } = {}): void {
  ensureJobDirs(JOB, root);
  writeAt('00-input/source.json', {
    video: 'raw.mp4',
    srt: 'raw.srt',
    fps: 30,
    durationInFrames: 300,
    ...(opts.allowNoVideo ? { allowNoVideo: true } : {}),
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

describe('素材存在性闸', () => {
  it('🔴 声明了 video 但文件不存在、且未声明 allowNoVideo → 阻断，且不产 render-report', async () => {
    makeJob();
    await expect(runRender({ jobId: JOB, jobsDir: root })).rejects.toThrow(StageBlockedError);
    await expect(runRender({ jobId: JOB, jobsDir: root })).rejects.toThrow(
      /00-input\/raw\.mp4 不存在/,
    );
    expect(fs.existsSync(reportFile())).toBe(false);
  });

  it('错误信息点明后果（会产出没有实拍画面的成片），并给出两条出路', async () => {
    makeJob();
    await expect(runRender({ jobId: JOB, jobsDir: root })).rejects.toThrow(
      /allowNoVideo/,
    );
  });

  it('视频存在 → 放行（视频文件内容无关，闸只查存在性）', async () => {
    makeJob();
    fs.writeFileSync(path.join(root, JOB, '00-input', 'raw.mp4'), Buffer.alloc(0));
    // 渲染被 mock 成立即失败，故这里只断言「不是素材闸拦的」
    await expect(runRender({ jobId: JOB, jobsDir: root })).rejects.toThrow(/渲染失败/);
    const r = JSON.parse(fs.readFileSync(reportFile(), 'utf8')) as { videoMissing: boolean };
    expect(r.videoMissing).toBe(false);
  });

  it('allowNoVideo: true → 放行，但报告如实记 videoMissing: true', async () => {
    makeJob({ allowNoVideo: true });
    await expect(runRender({ jobId: JOB, jobsDir: root })).rejects.toThrow(/渲染失败/);
    const r = JSON.parse(fs.readFileSync(reportFile(), 'utf8')) as { videoMissing: boolean };
    expect(r.videoMissing).toBe(true);
  });

  it('--dry-run 不做素材检查（只验结构，不需要素材落地）', async () => {
    makeJob();
    const out = await runRender({ jobId: JOB, jobsDir: root, dryRun: true });
    expect(out.propsFile).toContain('render-props.json');
    // dry-run 不产 render-report（渲染还没发生）
    expect(fs.existsSync(reportFile())).toBe(false);
  });
});
