/**
 * 跨阶段集成测试（A4，2026-10-26）。
 *
 * 🔴 **为什么必须有这个文件**：此前 53 个测试文件**全是单元级** ——
 *   每个阶段单独可测，但「五阶段串起来还成立吗」从未被任何测试证明。
 *   README 的第一条命令能不能跑，只能靠人手工试。
 *
 * 编排：五份输入夹具（`tests/fixtures/e2e-job.ts` 内嵌原 demo 的已知良好数据，
 *   运行时写入临时目录、跑完即删）→ 依次真跑
 *   `storyboard` → `validate` → `review` → `render --dry-run`，
 *   每段断言**产物契约**，而不是只断言「没抛错」。
 *
 * ⚠️ **刻意划定的边界**（不覆盖，也不假装覆盖）：
 *  · `align` / `perceive` **不重跑** —— 需要 whisper.cpp 模型与 scdet/ffmpeg，
 *    分钟级且依赖本机模型文件；demo 的 `01-align` / `02-perceive` 作为 fixture 输入。
 *    这两个阶段的单元测试在 `align*.test.ts` / `perceive*.test.ts`。
 *  · `render` 只跑 `--dry-run` —— 真渲 900 帧约 1 分钟且依赖 headless Chrome。
 *    真渲的确定性由 `npm run determinism` 单独负责（D5.6）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStoryboard } from '../src/stages/storyboard.ts';
import { runValidateStage } from '../src/stages/validate.ts';
import { writePreviewProps } from '../src/stages/review.ts';
import { runRender } from '../src/stages/render.ts';
import { ConfigError } from '../src/core/exit-code.ts';
import { writeE2EFixture } from './fixtures/e2e-job.ts';

const JOB = 'demo';
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-e2e-'));
  writeE2EFixture(root, JOB);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function readJson<T = Record<string, unknown>>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, JOB, rel), 'utf8')) as T;
}

function writeJson(rel: string, data: unknown): void {
  const file = path.join(root, JOB, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// 2026-10-31：examples/demo 已按用户裁决移除，夹具改由 fixtures/e2e-job.ts
// 运行时生成（仓库零假数据文件），集成覆盖恢复全量。

describe('跨阶段集成：storyboard → validate → review → render', () => {
  it('① storyboard 重烘焙：三份产物齐备，且写入输入指纹', () => {
    runStoryboard({ jobId: JOB, jobsDir: root });

    const sb = readJson<{ meta: { inputsHash?: string; fps: number } }>(
      '03-storyboard/storyboard.json',
    );
    // 指纹是新增契约（P0-4），且必须是 64 位 hex —— 不能是占位字符串
    expect(sb.meta.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sb.meta.fps).toBe(30);

    const bind = readJson<{ inputs?: { motionboardHash: string; wordsHash: string } }>(
      '03-storyboard/bind-report.json',
    );
    expect(bind.inputs?.motionboardHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bind.inputs?.wordsHash).toMatch(/^[0-9a-f]{64}$/);

    expect(readJson('03-storyboard/bake-report.json')).toBeDefined();
  });

  it('② validate 接在烘焙之后：18 项全跑、0 error、2 条 extra', () => {
    runStoryboard({ jobId: JOB, jobsDir: root });
    const { report } = runValidateStage({ jobId: JOB, jobsDir: root });

    expect(report.ok).toBe(true);
    expect(report.summary.checked).toBe(18);
    expect(report.summary.error).toBe(0);
    // demo 故意把 s2 标低置信，用来演示人工兜底通道
    expect(report.summary.extra).toEqual(['W-D3-01', 'W-F6-01']);
  });

  it('③ 端到端验证 P0-4：改稿不重跑 → validate 当场拦下', () => {
    runStoryboard({ jobId: JOB, jobsDir: root });
    // 模拟用户改稿：只动 motionboard，不重跑 storyboard
    const mb = readJson('03-storyboard/motionboard.json');
    writeJson('03-storyboard/motionboard.json', { ...mb, meta: { ...(mb['meta'] as object), edited: 1 } });

    expect(() => runValidateStage({ jobId: JOB, jobsDir: root })).toThrow(ConfigError);
    expect(() => runValidateStage({ jobId: JOB, jobsDir: root })).toThrow(/输入不一致/);
  });

  it('④ review 产出 preview-props（与 render-props 同源）', () => {
    runStoryboard({ jobId: JOB, jobsDir: root });
    runValidateStage({ jobId: JOB, jobsDir: root });
    writePreviewProps({ jobId: JOB, jobsDir: root });

    const preview = readJson<{ storyboardHash: string }>('06-review/preview-props.json');
    expect(preview.storyboardHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('⑤ render 先被 must_review 闸拦，补确认后放行（走真实闸门，不 mock）', async () => {
    runStoryboard({ jobId: JOB, jobsDir: root });
    runValidateStage({ jobId: JOB, jobsDir: root });
    // 🔴 重烘焙后必须重跑 review：renderGate 会校验 preview-props 的 storyboardHash
    //    与当前 storyboard 是否一致（防「照着旧样片确认」的漂移）。
    //    这条不是测试凑数 —— 第一次写本用例时正是被它拦下的，属于真实闸门行为。
    writePreviewProps({ jobId: JOB, jobsDir: root });

    // 未确认 → 拒绝启动，且报错点名具体条目
    await expect(runRender({ jobId: JOB, jobsDir: root, dryRun: true })).rejects.toThrow(
      /must_review/,
    );
    await expect(runRender({ jobId: JOB, jobsDir: root, dryRun: true })).rejects.toThrow(
      /typo-main\/002/,
    );

    // 写人工看片确认（结构见 core/confirmed.ts 的 ConfirmedRecord）
    writeJson('06-review/confirmed.json', {
      records: [
        {
          jobId: JOB,
          stage: 'render',
          reason: '集成测试：模拟人工看片后确认',
          confirmedBy: 'e2e',
          confirmedAt: '2026-10-26T00:00:00.000Z',
          acknowledgedReview: ['typo-main/002'],
        },
      ],
    });

    const out = await runRender({ jobId: JOB, jobsDir: root, dryRun: true });
    expect(out.propsFile).toContain('render-props.json');
    expect(fs.existsSync(out.propsFile)).toBe(true);

    // dry-run 不产 render-report（渲染尚未发生）—— 契约边界，别搞混
    expect(fs.existsSync(path.join(root, JOB, '05-render', 'render-report.json'))).toBe(false);
  });
});
