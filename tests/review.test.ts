/**
 * `review` 命令（P1-a）—— 渲染前的 Remotion Studio 人工审核闸。
 *
 * 钉四件事（plan AC-1）：
 *   ① preview-props 与 render-props **同源**：同一 composeRenderProps 产出，
 *      除 storyboardHash 外内容一致 —— 预览看到的就是会渲出来的；
 *   ② 同一 storyboard 两次执行**逐字节一致**（preview-props 不含墙钟字段）；
 *   ③ 重跑 review 直接覆写 preview-props.json（writeStageJson 只守写入方向）；
 *   ④ 未过 validate 的 job 不得进 review（与 render 同一条起跑线）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 🔴 必须 mock：runReview 的 spawn 是**前台阻塞**进程 —— 不 mock 的话，
// 断言「不该 spawn」的用例会真的把 Studio 拉起来（首版测试就因此假绿：
// 多传的 dryRun 参数被忽略，Studio 起了又退，用例 3.1s 后照样通过）。
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

import { StageBlockedError, ConfigError } from '../src/core/exit-code.ts';
import { ensureJobDirs } from '../src/core/io.ts';
import { runRender } from '../src/stages/render.ts';
import { runReview, writePreviewProps } from '../src/stages/review.ts';
import { hashStoryboardFile } from '../src/stages/render-props.ts';

const JOB = 'j1';
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-review-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeAt(rel: string, data: unknown): string {
  const file = path.join(root, JOB, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return file;
}

interface JobOpts {
  /** storyboard 含 must_review item（mr track）。 */
  withMustReview?: boolean;
  /** 跳过 04-validate 产物（测 review 的起跑线闸）。 */
  skipValidate?: boolean;
}

function makeJob(opts: JobOpts = {}): void {
  ensureJobDirs(JOB, root);
  writeAt('00-input/source.json', {
    video: 'raw.mp4',
    srt: 'raw.srt',
    fps: 30,
    durationInFrames: 300,
  });
  writeAt('01-align/words.json', {
    fps: 30,
    words: [{ index: 0, word: 'a', startFrame: 0, endFrame: 29, confidence: 0.9 }],
    cues: [{ index: 0, fromFrame: 0, toFrame: 29, text: 'a', srtFromSec: 0, srtToSec: 1 }],
  });
  writeAt('01-align/align-report.json', {
    fps: 30,
    mode: 'aligned',
    meanConfidence: 0.41,
    lowConfidenceRatio: 0.5,
    gatePassed: true,
    lowConfidenceWords: [0],
    textSource: 'srt',
    alignedRatio: 1,
    thresholds: { meanConfidenceMin: 0.6, lowConfidenceRatioMax: 0.3, alignedRatioMin: 0.8 },
  });
  writeAt('02-perceive/shots.json', [
    { id: 's0', fromFrame: 0, durationInFrames: 300, safeArea: null },
  ]);
  writeAt('02-perceive/regions.json', []);
  writeAt('03-storyboard/storyboard.json', {
    meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.41 },
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
            ...(opts.withMustReview
              ? {
                  decision: {
                    sim_max: 1.0,
                    confidence: 0.9,
                    routing: 'custom',
                    review: 'must_review',
                  },
                }
              : {}),
          },
        ],
      },
    ],
    noMotionRanges: [],
  });
  writeAt('03-storyboard/bake-report.json', { fps: 30, records: [] });
  if (!opts.skipValidate) {
    writeAt('04-validate/validate-report.json', { ok: true, summary: { error: 0 } });
  }
}

const previewFile = () => path.join(root, JOB, '06-review', 'preview-props.json');
const renderPropsFile = () => path.join(root, JOB, '05-render', 'render-props.json');

describe('writePreviewProps —— 同源映射与确定性（AC-1）', () => {
  it('🔴 preview-props 除 storyboardHash 外与 render-props 完全同源（同一 composeRenderProps）', async () => {
    makeJob();
    await runRender({ jobId: JOB, jobsDir: root, dryRun: true });
    const out = writePreviewProps({ jobId: JOB, jobsDir: root });

    const renderProps = JSON.parse(fs.readFileSync(renderPropsFile(), 'utf8'));
    const preview = JSON.parse(fs.readFileSync(previewFile(), 'utf8'));
    expect(preview.storyboardHash).toBe(out.storyboardHash);
    delete (preview as Record<string, unknown>).storyboardHash;
    expect(preview).toEqual(renderProps);
  });

  it('🔴 同一 storyboard 两次执行逐字节一致（不含墙钟字段）', () => {
    makeJob();
    writePreviewProps({ jobId: JOB, jobsDir: root });
    const first = fs.readFileSync(previewFile());
    writePreviewProps({ jobId: JOB, jobsDir: root });
    const second = fs.readFileSync(previewFile());
    expect(second.equals(first)).toBe(true);
  });

  it('storyboardHash 等于当前 storyboard.json 文件字节 sha256', () => {
    makeJob();
    const out = writePreviewProps({ jobId: JOB, jobsDir: root });
    const sb = path.join(root, JOB, '03-storyboard', 'storyboard.json');
    const expected = createHash('sha256').update(fs.readFileSync(sb)).digest('hex');
    expect(out.storyboardHash).toBe(expected);
    expect(JSON.parse(fs.readFileSync(previewFile(), 'utf8')).storyboardHash).toBe(expected);
  });

  it('重跑直接覆写（writeStageJson 只守写入方向，无需 --force）', () => {
    makeJob();
    writePreviewProps({ jobId: JOB, jobsDir: root });
    // storyboard 变更后重跑 → hash 跟着变，文件被覆写而非报错
    const sb = path.join(root, JOB, '03-storyboard', 'storyboard.json');
    const parsed = JSON.parse(fs.readFileSync(sb, 'utf8'));
    parsed.tracks[0].items[0].fromFrame = 20;
    writeAt('03-storyboard/storyboard.json', parsed);
    const out = writePreviewProps({ jobId: JOB, jobsDir: root });
    const expected = createHash('sha256').update(fs.readFileSync(sb)).digest('hex');
    expect(out.storyboardHash).toBe(expected);
  });

  it('🔴 必须放在 06-review/，不得写 05-render/render-props.json（不可变快照互不触碰）', () => {
    makeJob();
    const out = writePreviewProps({ jobId: JOB, jobsDir: root });
    expect(out.previewFile).toBe(previewFile());
    expect(fs.existsSync(renderPropsFile())).toBe(false);
  });
});

describe('writePreviewProps —— must_review 队列', () => {
  it('返回 must_review refs 供确认闸与打印', () => {
    makeJob({ withMustReview: true });
    const out = writePreviewProps({ jobId: JOB, jobsDir: root });
    expect(out.mustReviewRefs).toEqual(['ov/000']);
  });

  it('无 must_review 条目 → 空队列（review 仍可用作自愿全量看片）', () => {
    makeJob();
    const out = writePreviewProps({ jobId: JOB, jobsDir: root });
    expect(out.mustReviewRefs).toEqual([]);
  });
});

describe('review 起跑线 —— validate 必须先过', () => {
  it('🔴 未跑 validate（缺 validate-report.json）→ StageBlockedError', () => {
    makeJob({ skipValidate: true });
    expect(() => writePreviewProps({ jobId: JOB, jobsDir: root })).toThrow(StageBlockedError);
  });

  it('validate 报告 ok=false → 拒绝（先走人工返修回路）', () => {
    makeJob();
    writeAt('04-validate/validate-report.json', { ok: false, summary: { error: 2 } });
    expect(() => writePreviewProps({ jobId: JOB, jobsDir: root })).toThrow(/ok=false|校验报告/);
  });
});

describe('runReview —— spawn 构造与 dry-run 退化（plan edge case）', () => {
  it('🔴 dryRun：只落 preview-props，不启动 Studio', () => {
    const spawn = vi.mocked(execFileSync);
    spawn.mockClear();
    makeJob({ withMustReview: true });
    const out = runReview({ jobId: JOB, jobsDir: root, dryRun: true });
    expect(out.mustReviewRefs).toEqual(['ov/000']);
    expect(fs.existsSync(previewFile())).toBe(true);
    expect(fs.existsSync(renderPropsFile())).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('非 dry-run：以 --props 与 --public-dir 前台启动 Studio', () => {
    const spawn = vi.mocked(execFileSync);
    spawn.mockClear();
    makeJob();
    const out = runReview({ jobId: JOB, jobsDir: root });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawn.mock.calls[0]!;
    expect(cmd).toBe('npx');
    expect(args).toContain('remotion');
    expect(args).toContain('studio');
    expect(args).toContain(`--props=${out.previewFile}`);
    expect(args!.join(' ')).toContain('--public-dir=');
  });

  it('🔴 Studio 异常退出（非中断退出码）→ 报错，不得假装看片完成', () => {
    const spawn = vi.mocked(execFileSync);
    spawn.mockImplementation(() => {
      const e = new Error('Command failed: npx remotion studio') as Error & { status: number };
      e.status = 1;
      throw e;
    });
    makeJob();
    expect(() => runReview({ jobId: JOB, jobsDir: root })).toThrow(ConfigError);
    expect(() => runReview({ jobId: JOB, jobsDir: root })).toThrow(/看片未完成|Studio/);
  });

  it('用户中断（Windows 0xC000013A）→ 正常收尾，不算失败', () => {
    const spawn = vi.mocked(execFileSync);
    spawn.mockImplementation(() => {
      const e = new Error('interrupted by user') as Error & { status: number };
      e.status = 3221225786; // STATUS_CONTROL_C_EXIT
      throw e;
    });
    makeJob();
    const out = runReview({ jobId: JOB, jobsDir: root });
    expect(out.previewFile).toBeTruthy();
  });
});

describe('hashStoryboardFile —— 前置产物缺失的报错形态', () => {
  it('🔴 缺 storyboard.json → ConfigError（exit 2 语义）而非裸 ENOENT（exit 6 堆栈）', () => {
    ensureJobDirs(JOB, root);
    expect(() => hashStoryboardFile(JOB, root)).toThrow(ConfigError);
    expect(() => hashStoryboardFile(JOB, root)).toThrow(/缺少前置产物|storyboard/);
  });
});
