/**
 * `06-review/confirmed.json` —— 人工放行记录的结构校验与**阶段匹配**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这组测试必须存在（2026-10-19 端到端审计）
 * ─────────────────────────────────────────────────────────────
 * 占位素材实跑抓到两个真缺口：
 *   ① `storyboard` **从不读** confirmed.json，却在门控失败时让用户写它
 *      ⇒ 照提示写了 `stage:"alignment"` 的记录，重跑**仍然 exit 1**，报错一字不改；
 *   ② `renderGate` 只取 `acknowledgedFullscreen`、**不校验 `stage`**
 *      ⇒ `stage:"alignment"` 的旧凭据也能放行 render 闸（实测已复现）。
 *
 * 这两条属于同一类：「机制写了、档位串了」。所以这里钉三件事：
 *   ① 结构不合法必须报错（此前写错字段名只会被静默当成「没确认」）
 *   ② `lookupConfirmed` 只认自己那一关
 *   ③ 两个消费者（storyboard / renderGate）在真实 job 骨架上的行为
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, StageBlockedError } from '../src/core/exit-code.ts';
import { ensureJobDirs } from '../src/core/io.ts';
import { lookupConfirmed, readConfirmedRecords } from '../src/core/confirmed.ts';
import { runStoryboard } from '../src/stages/storyboard.ts';
import { renderGate } from '../src/stages/render.ts';

const JOB = 'j1';
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-confirmed-'));
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

const BASE_RECORD = {
  jobId: JOB,
  stage: 'alignment',
  reason: '人工核验低置信词后放行',
  confirmedBy: 'FansticB',
  confirmedAt: '2026-10-19T22:30:00+08:00',
};

interface JobOpts {
  gatePassed?: boolean;
  confirmed?: unknown;
  /** 额外写出 03/04 产物，供 renderGate 用。 */
  withRenderable?: boolean;
  /**
   * storyboard 含哪些 track：'fs' = fullscreen item（ambience/noise-grain），
   * 'mr' = must_review item（typography/kinetic-line，overlay-safe —— 刻意不用
   * fullscreen scope，否则先撞 fullscreen 闸，测不到 must_review 分支）。
   */
  sceneTracks?: ('fs' | 'mr')[];
  /** 写出 06-review/preview-props.json：match = hash 与 storyboard 一致，stale = 不一致。 */
  previewHash?: 'match' | 'stale';
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
    gatePassed: opts.gatePassed ?? true,
    lowConfidenceWords: [0],
    textSource: 'srt',
    alignedRatio: 1,
    thresholds: {
      meanConfidenceMin: 0.6,
      lowConfidenceRatioMax: 0.3,
      alignedRatioMin: 0.8,
      silentWordRatioWarnMax: 0.02,
    },
  });
  writeAt('02-perceive/shots.json', [
    { id: 's0', fromFrame: 0, durationInFrames: 300, safeArea: null },
  ]);
  writeAt('02-perceive/regions.json', []);

  if (opts.withRenderable) {
    const tracks = (opts.sceneTracks ?? ['fs']).map<unknown>((id) =>
      id === 'fs'
        ? {
            id: 'fs',
            layer: 100,
            items: [
              {
                fromFrame: 0,
                durationInFrames: 120,
                motion: 'ambience/noise-grain@1.0',
                footprint: [0, 0, 1, 1],
                params: { opacity: 0.2 },
              },
            ],
          }
        : {
            id: 'mr',
            layer: 200,
            items: [
              {
                fromFrame: 10,
                durationInFrames: 60,
                motion: 'typography/kinetic-line@1.0',
                footprint: [0, 0.72, 0.42, 0.18],
                params: { text: 'mr' },
                // 产路地板形态：custom 产路被抬到 must_review
                decision: { sim_max: 1.0, confidence: 0.9, routing: 'custom', review: 'must_review' },
              },
            ],
          },
    );
    writeAt('03-storyboard/storyboard.json', {
      // 必须与 01-align 的 meanConfidence 一致 —— `buildContext` 会做一致性断言
      // （手改置信度 = 伪造对齐置信度，见 context.ts）。
      meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.41 },
      tracks,
      noMotionRanges: [],
    });
    writeAt('03-storyboard/bake-report.json', { fps: 30, records: [] });
    writeAt('04-validate/validate-report.json', { ok: true, summary: { error: 0 } });
  }

  if (opts.previewHash !== undefined) {
    const sb = path.join(root, JOB, '03-storyboard/storyboard.json');
    const real = createHash('sha256').update(fs.readFileSync(sb)).digest('hex');
    writeAt('06-review/preview-props.json', {
      jobId: JOB,
      storyboardHash: opts.previewHash === 'match' ? real : '0'.repeat(64),
    });
  }

  if (opts.confirmed !== undefined) writeAt('06-review/confirmed.json', opts.confirmed);
}

describe('readConfirmedRecords —— 结构校验与多记录', () => {
  it('文件不存在 → 空数组（不是 null，也不是抛错）', () => {
    makeJob();
    expect(readConfirmedRecords(JOB, root)).toEqual([]);
  });

  it('旧写法：顶层单条记录仍兼容', () => {
    makeJob({ confirmed: BASE_RECORD });
    const r = readConfirmedRecords(JOB, root);
    expect(r).toHaveLength(1);
    expect(r[0]?.confirmedBy).toBe('FansticB');
  });

  it('新写法：records 数组可同时承载 alignment 与 render（F3-1）', () => {
    makeJob({
      confirmed: {
        records: [
          BASE_RECORD,
          { ...BASE_RECORD, stage: 'render', acknowledgedFullscreen: ['fs/000'] },
        ],
      },
    });
    const r = readConfirmedRecords(JOB, root);
    expect(r.map((x) => x.stage)).toEqual(['alignment', 'render']);
  });

  it('同一 stage 写两条 → 报错（审计凭据不猜「取最后一条」）', () => {
    makeJob({ confirmed: { records: [BASE_RECORD, BASE_RECORD] } });
    expect(() => readConfirmedRecords(JOB, root)).toThrow(/出现了两次/);
  });

  it('records 为空数组 → 报错（空数组是没说出口的歧义）', () => {
    makeJob({ confirmed: { records: [] } });
    expect(() => readConfirmedRecords(JOB, root)).toThrow(/空数组/);
  });

  it('缺 confirmedBy → 报错，且点名字段与第几条', () => {
    makeJob({
      confirmed: {
        records: [BASE_RECORD, { ...BASE_RECORD, stage: 'render', confirmedBy: '  ' }],
      },
    });
    expect(() => readConfirmedRecords(JOB, root)).toThrow(/confirmedBy/);
    expect(() => readConfirmedRecords(JOB, root)).toThrow(/第 2 条/);
  });

  it('stage 非法 → ConfigError', () => {
    makeJob({ confirmed: { ...BASE_RECORD, stage: 'review' } });
    expect(() => readConfirmedRecords(JOB, root)).toThrow(/stage/);
  });

  it('jobId 与目录不符 → 拒绝（不能复用别的 job 的凭据）', () => {
    makeJob({ confirmed: { ...BASE_RECORD, jobId: 'someone-else' } });
    expect(() => readConfirmedRecords(JOB, root)).toThrow(/不能跨 job 复用/);
  });
});

describe('lookupConfirmed —— 只认自己那一关', () => {
  it('stage 匹配 → 返回该条记录', () => {
    makeJob({ confirmed: BASE_RECORD });
    expect(lookupConfirmed(JOB, 'alignment', root).record?.stage).toBe('alignment');
  });

  it('stage 不匹配 → record 为 null，但 available 列出真实阶段', () => {
    makeJob({ confirmed: BASE_RECORD });
    const r = lookupConfirmed(JOB, 'render', root);
    expect(r.record).toBeNull();
    expect(r.available).toEqual(['alignment']);
  });

  it('多记录时各取各的，互不干扰', () => {
    makeJob({
      confirmed: {
        records: [
          BASE_RECORD,
          { ...BASE_RECORD, stage: 'render', acknowledgedFullscreen: ['fs/000'] },
        ],
      },
    });
    expect(lookupConfirmed(JOB, 'alignment', root).record?.stage).toBe('alignment');
    expect(lookupConfirmed(JOB, 'render', root).record?.acknowledgedFullscreen).toEqual(['fs/000']);
  });
});

describe('acknowledgedReview —— must_review 确认字段（P1-a 审核闸）', () => {
  it('render 记录可带 acknowledgedReview，与 acknowledgedFullscreen 同记录共存（F3-1）', () => {
    makeJob({
      confirmed: {
        records: [
          BASE_RECORD,
          {
            ...BASE_RECORD,
            stage: 'render',
            acknowledgedFullscreen: ['fs/000'],
            acknowledgedReview: ['x/000', 'y/001'],
          },
        ],
      },
    });
    const rec = lookupConfirmed(JOB, 'render', root).record;
    expect(rec?.acknowledgedReview).toEqual(['x/000', 'y/001']);
    expect(rec?.acknowledgedFullscreen).toEqual(['fs/000']);
  });

  it('🔴 数组里混入非字符串 → ConfigError 点名字段（静默丢弃 = 闸形同虚设）', () => {
    makeJob({
      confirmed: { ...BASE_RECORD, stage: 'render', acknowledgedReview: ['x/000', 7] },
    });
    expect(() => readConfirmedRecords(JOB, root)).toThrow(/acknowledgedReview/);
  });

  it('写字符串而非数组 → 同样拒绝', () => {
    makeJob({
      confirmed: { ...BASE_RECORD, stage: 'render', acknowledgedReview: 'x/000' },
    });
    expect(() => readConfirmedRecords(JOB, root)).toThrow(/acknowledgedReview/);
  });

  it('不写该字段 → 不受影响（旧记录零成本兼容）', () => {
    makeJob({ confirmed: { ...BASE_RECORD, stage: 'render', acknowledgedFullscreen: ['fs/000'] } });
    expect(lookupConfirmed(JOB, 'render', root).record?.acknowledgedReview).toBeUndefined();
  });
});

describe('renderGate —— stage 必须匹配', () => {
  it('🔴 只有 alignment 凭据 → 拒绝，并提示「追加」而非覆盖', () => {
    makeJob({
      withRenderable: true,
      confirmed: { ...BASE_RECORD, acknowledgedFullscreen: ['fs/000'] },
    });
    const blocked = renderGate(JOB, root);
    expect(blocked).not.toBeNull();
    expect(blocked).toMatch(/没有 stage:"render" 的记录/);
    expect(blocked).toMatch(/追加/);
  });

  it('🔴 多记录：alignment + render 并存 → 放行（修复前结构上做不到）', () => {
    makeJob({
      withRenderable: true,
      confirmed: {
        records: [
          BASE_RECORD,
          { ...BASE_RECORD, stage: 'render', acknowledgedFullscreen: ['fs/000'] },
        ],
      },
    });
    expect(renderGate(JOB, root)).toBeNull();
  });

  it('render 记录漏了 item → 拒绝，并点名未确认的 ref', () => {
    makeJob({
      withRenderable: true,
      confirmed: { ...BASE_RECORD, stage: 'render', acknowledgedFullscreen: [] },
    });
    expect(renderGate(JOB, root)).toMatch(/fs\/000/);
  });
});

describe('renderGate —— must_review 硬闸（P1-a）', () => {
  it('🔴 有 must_review 条目但未跑 review（无 preview-props.json）→ 拒绝并指引先跑 review', () => {
    makeJob({ withRenderable: true, sceneTracks: ['mr'] });
    const blocked = renderGate(JOB, root);
    expect(blocked).not.toBeNull();
    expect(blocked).toMatch(/preview-props\.json/);
    expect(blocked).toMatch(/review/);
  });

  it('preview-props 的 storyboardHash 与当前 storyboard.json 不一致 → 拒绝（确认不跨 storyboard 版本）', () => {
    makeJob({ withRenderable: true, sceneTracks: ['mr'], previewHash: 'stale' });
    const blocked = renderGate(JOB, root);
    expect(blocked).not.toBeNull();
    expect(blocked).toMatch(/hash|不一致|重跑/);
  });

  it('hash 一致但无 render 确认记录 → 拒绝，给出 acknowledgedReview 写法', () => {
    makeJob({
      withRenderable: true,
      sceneTracks: ['mr'],
      previewHash: 'match',
      confirmed: BASE_RECORD, // 只有 alignment 记录：文件存在但缺 render 记录
    });
    const blocked = renderGate(JOB, root);
    expect(blocked).not.toBeNull();
    expect(blocked).toMatch(/acknowledgedReview/);
    expect(blocked).toMatch(/mr\/000/);
  });

  it('acknowledgedReview 未覆盖全部 → 拒绝，逐一列出缺失 ref', () => {
    makeJob({
      withRenderable: true,
      sceneTracks: ['mr'],
      previewHash: 'match',
      confirmed: { ...BASE_RECORD, stage: 'render', acknowledgedReview: ['别的/001'] },
    });
    expect(renderGate(JOB, root)).toMatch(/mr\/000/);
  });

  it('🔴 acknowledgedReview 覆盖全部（且 hash 一致）→ 放行', () => {
    makeJob({
      withRenderable: true,
      sceneTracks: ['mr'],
      previewHash: 'match',
      confirmed: { ...BASE_RECORD, stage: 'render', acknowledgedReview: ['mr/000'] },
    });
    expect(renderGate(JOB, root)).toBeNull();
  });

  it('🔴 must_review 与 fullscreen 并存：一条 render 记录带两个字段 → 放行（F3-1）', () => {
    makeJob({
      withRenderable: true,
      sceneTracks: ['fs', 'mr'],
      previewHash: 'match',
      confirmed: {
        ...BASE_RECORD,
        stage: 'render',
        acknowledgedFullscreen: ['fs/000'],
        acknowledgedReview: ['mr/000'],
      },
    });
    expect(renderGate(JOB, root)).toBeNull();
  });

  it('🔴 无 must_review 条目的 job → 不要求 preview-props 与确认（AC-4 回归）', () => {
    makeJob({
      withRenderable: true,
      confirmed: { ...BASE_RECORD, stage: 'render', acknowledgedFullscreen: ['fs/000'] },
    });
    expect(renderGate(JOB, root)).toBeNull();
  });
});

describe('storyboard —— 对齐门控的人工放行', () => {
  it('门控失败且无放行记录 → StageBlockedError', () => {
    makeJob({ gatePassed: false });
    expect(() => runStoryboard({ jobId: JOB, jobsDir: root })).toThrow(StageBlockedError);
  });

  it('🔴 门控失败 + alignment 记录 → 继续，并把签名回填 meta', () => {
    makeJob({ gatePassed: false, confirmed: BASE_RECORD });
    const out = runStoryboard({ jobId: JOB, jobsDir: root });
    expect(out.storyboard.meta.confirmedBy).toBe('FansticB');
    expect(out.storyboard.meta.confirmedAt).toBe(BASE_RECORD.confirmedAt);
  });

  it('门控失败 + 只有 render 记录 → 报错说明缺 alignment', () => {
    makeJob({ gatePassed: false, confirmed: { ...BASE_RECORD, stage: 'render' } });
    expect(() => runStoryboard({ jobId: JOB, jobsDir: root })).toThrow(/没有 "alignment"/);
  });

  it('🔴 门控失败 + 多记录（alignment 在数组里）→ 仍然放行', () => {
    makeJob({
      gatePassed: false,
      confirmed: {
        records: [BASE_RECORD, { ...BASE_RECORD, stage: 'render', acknowledgedFullscreen: [] }],
      },
    });
    const out = runStoryboard({ jobId: JOB, jobsDir: root });
    expect(out.storyboard.meta.confirmedBy).toBe('FansticB');
  });
});
