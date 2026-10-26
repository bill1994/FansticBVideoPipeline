/**
 * render 的**成功路径**单测（A5，2026-10-26）。
 *
 * 背景：`stages/render.ts` 是三轮渲染 bug（视频路径 / 载体轨裁视频 / 载体轨嵌套偏移）
 * 的共同产源地，但此前它**没有一行单测**。已有测试只覆盖失败与 dry-run：
 *   · `render-failure.test.ts`        分类器判据
 *   · `render-failure-write.test.ts`  失败落盘
 *   · `render-video-presence.test.ts` 素材闸三档
 *   · `review.test.ts`                dry-run + preview 同源
 * **「渲染成功之后报告长什么样」没有人验过** —— 本文件补这一块。
 *
 * 做法：mock `spawn` 成功退出，并按真实行为在退出前**创建 out.mp4**
 * （`runRender` 用 `fs.existsSync(outVideo)` 判断字节数，不创建就永远是 0）。
 * 除渲染进程外，其余全走真实代码：renderGate → composeRenderProps → writeStageJson。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    // 模拟「渲染成功」：先按 args 里的输出路径造一个假 mp4，再 exit 0。
    spawn: (_cmd: string, args: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { EventEmitter } = require('node:events') as typeof import('node:events');
      const child = new EventEmitter() as unknown as {
        stdout: InstanceType<typeof EventEmitter>;
        stderr: InstanceType<typeof EventEmitter>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => {
        // args 形如 [remotion, render, <entry>, <comp>, <out>, ...]
        const out = args[4];
        if (typeof out === 'string') {
          fs.writeFileSync(out, Buffer.alloc(2048, 7)); // 2KB 假成片
        }
        child.stdout.emit('data', Buffer.from('Rendered 30/30\n'));
        (child as unknown as InstanceType<typeof EventEmitter>).emit('close', 0);
      }, 0);
      return child;
    },
  };
});

const { runRender } = await import('../src/stages/render.ts');
const { ensureJobDirs } = await import('../src/core/io.ts');

const JOB = 'js';
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-rendersuccess-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeAt(rel: string, data: unknown): void {
  const file = path.join(root, JOB, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** 造一个能过 renderGate 的最小 job（validate ok、无 fullscreen / must_review）。 */
function makeJob(): void {
  ensureJobDirs(JOB, root);
  writeAt('00-input/source.json', {
    video: 'raw.mp4',
    srt: 'raw.srt',
    fps: 30,
    durationInFrames: 300,
    allowNoVideo: true, // 本文件测渲染报告，不关心素材是否存在
  });
  // 真实放一个视频壳，让 videoMissing 走 false 分支（两条分支都值得测）
  fs.writeFileSync(path.join(root, JOB, '00-input', 'raw.mp4'), Buffer.alloc(16));
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

describe('render 成功路径：报告契约', () => {
  it('🔴 成功时写 render-report：ok=true / failed=false / items 为空数组 / 各项齐备', async () => {
    makeJob();
    const out = await runRender({ jobId: JOB, jobsDir: root });
    expect(out.propsFile).toContain('render-props.json');

    const r = JSON.parse(
      fs.readFileSync(path.join(root, JOB, '05-render', 'render-report.json'), 'utf8'),
    ) as Record<string, unknown>;

    // ① 成功标识必须成对出现 —— 只看 ok 会漏掉「failed 字段漂移」
    expect(r['ok']).toBe(true);
    expect(r['failed']).toBe(false);

    // ② 渲染期兜底条目：成功路径恒为空数组（= 跑了且无条目），不是 null
    expect(r['items']).toEqual([]);

    // ③ 成片大小来自真实文件，不是硬编码
    expect(r['bytes']).toBe(2048);
    expect(r['outFile']).toBe('out.mp4');

    // ④ 确定性相关字段：gl 必须显式 angle（Remotion 4.0.x 必填）
    expect(r['gl']).toBe('angle');
    expect(typeof r['wallMs']).toBe('number');

    // ⑤ 素材存在 → videoMissing=false
    expect(r['videoMissing']).toBe(false);

    // ⑥ 媒体 QA 块必须存在（哪怕 ffmpeg 缺席，也要如实记录 unavailable）
    expect(r['qa']).toBeDefined();
  });

  it('素材缺失但 allowNoVideo → 报告记 videoMissing=true（如实标注「这版没有实拍画面」）', async () => {
    makeJob();
    fs.rmSync(path.join(root, JOB, '00-input', 'raw.mp4'));
    await runRender({ jobId: JOB, jobsDir: root });

    const r = JSON.parse(
      fs.readFileSync(path.join(root, JOB, '05-render', 'render-report.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(r['ok']).toBe(true);
    expect(r['videoMissing']).toBe(true);
  });

  it('成功路径也写 render-props.json（review 与 render 同源的真源）', async () => {
    makeJob();
    await runRender({ jobId: JOB, jobsDir: root });
    const propsFile = path.join(root, JOB, '05-render', 'render-props.json');
    expect(fs.existsSync(propsFile)).toBe(true);
    const props = JSON.parse(fs.readFileSync(propsFile, 'utf8')) as Record<string, unknown>;
    expect(props['hasVideo']).toBe(true);
    expect(props['storyboard']).toBeDefined();
  });
});
