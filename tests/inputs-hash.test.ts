/**
 * 输入指纹守卫（P0-4，2026-10-26）。
 *
 * 要防的具体事故：**改完 motionboard 忘了重跑 storyboard**，
 * `validate` 拿旧绑定照常通过 —— 报告全绿，成片与稿子对不上。
 * 现有 mTime 版时序守卫挡不住（`cp` / `git checkout` 都会改 mtime）。
 *
 * 本文件走**真实 job 目录 + 真实 buildContext**（不 mock），
 * 因为要验的正是「读盘算出来的指纹」与「落盘写进去的指纹」对不对得上。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureJobDirs } from '../src/core/io.ts';
import { composeInputsHash, computeInputsFingerprint } from '../src/core/stage-inputs.ts';
import { buildContext } from '../src/validate/context.ts';
import { ConfigError } from '../src/core/exit-code.ts';

const JOB = 'ji';
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-inputshash-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeAt(rel: string, data: unknown): void {
  const file = path.join(root, JOB, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** 造一套能过 buildContext 的产物；`inputsHash` 由调用方决定写什么。 */
function makeJob(inputsHash?: string): void {
  ensureJobDirs(JOB, root);
  writeAt('00-input/source.json', { video: 'raw.mp4', srt: 'raw.srt', fps: 30, durationInFrames: 300 });
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
  writeAt('03-storyboard/motionboard.json', {
    meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
    tracks: [],
    noMotionRanges: [],
  });
  writeAt('03-storyboard/storyboard.json', {
    meta: {
      fps: 30,
      anchorMode: 'word',
      alignmentConfidence: 0.9,
      ...(inputsHash === undefined ? {} : { inputsHash }),
    },
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
}

describe('输入指纹守卫', () => {
  it('指纹吻合 → buildContext 正常返回', () => {
    makeJob();
    const fp = computeInputsFingerprint(JOB, root);
    makeJob(fp.inputsHash); // 用刚算出的指纹重建（模拟「烘焙时写入、之后没动过」）
    expect(() => buildContext(JOB, root)).not.toThrow();
  });

  it('🔴 烘焙后改 motionboard（不重跑 storyboard）→ ConfigError，消息点明「验证的是旧绑定」', () => {
    makeJob();
    const fp = computeInputsFingerprint(JOB, root);
    makeJob(fp.inputsHash);

    // 模拟用户改稿：只动 motionboard，storyboard 保持原样
    writeAt('03-storyboard/motionboard.json', {
      meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
      tracks: [
        {
          id: 'ov',
          layer: 200,
          items: [
            {
              _author: { anchor: 'word:0' },
              intent: 'number-emphasis',
              confidence: 0.9,
              featuredText: '改过的稿子',
            },
          ],
        },
      ],
      noMotionRanges: [],
    });

    expect(() => buildContext(JOB, root)).toThrow(ConfigError);
    expect(() => buildContext(JOB, root)).toThrow(/输入不一致/);
    expect(() => buildContext(JOB, root)).toThrow(/旧绑定/);
    expect(() => buildContext(JOB, root)).toThrow(/storyboard --job/);
  });

  it('🔴 烘焙后改 words.json → 同样拦下（对齐产物也是输入）', () => {
    makeJob();
    const fp = computeInputsFingerprint(JOB, root);
    makeJob(fp.inputsHash);

    writeAt('01-align/words.json', {
      fps: 30,
      words: [{ index: 0, word: ' changed', startFrame: 0, endFrame: 29, confidence: 0.9 }],
      cues: [{ index: 0, fromFrame: 0, toFrame: 29, text: 'a', srtFromSec: 0, srtToSec: 1 }],
    });

    // 🔴 关键：把**两个下游产物**的 mtime 都改成「比上游更新」，模拟 `cp` / 解压 /
    //    `git checkout` 改写时间戳的场景 —— 此时 mTime 版守卫会放过，必须由 hash 守卫拦下。
    //    这正是 P0-4 相对 PROGRESS #14（mTime 版）的增量价值。
    //    （mTime 版的对子有两组：words→storyboard 与 words→bake-report，两个都要碰。）
    const future = new Date(Date.now() + 60_000);
    for (const f of ['storyboard.json', 'bake-report.json']) {
      const p = path.join(root, JOB, '03-storyboard', f);
      fs.utimesSync(p, future, future);
    }

    expect(() => buildContext(JOB, root)).not.toThrow(/时序倒挂/); // mTime 版确实放过了
    expect(() => buildContext(JOB, root)).toThrow(/输入不一致/); // hash 版拦住
  });

  it('旧产物没有 inputsHash → 跳过比对（向后兼容，不误伤历史 job）', () => {
    makeJob(undefined); // 不写 inputsHash
    expect(() => buildContext(JOB, root)).not.toThrow();
  });

  it('motionboard 被删 → 跳过比对（缺产物由 readJson 负责，守卫不越权）', () => {
    makeJob();
    const fp = computeInputsFingerprint(JOB, root);
    makeJob(fp.inputsHash);
    fs.rmSync(path.join(root, JOB, '03-storyboard', 'motionboard.json'));

    // 不因「无法计算指纹」而报错
    expect(() => buildContext(JOB, root)).not.toThrow();
  });
});

describe('指纹算法：写侧与校验侧共用同一实现', () => {
  it('composeInputsHash 是纯函数：同输入同输出', () => {
    expect(composeInputsHash('a', 'b')).toBe(composeInputsHash('a', 'b'));
    expect(composeInputsHash('a', 'b')).not.toBe(composeInputsHash('b', 'a'));
  });

  it('computeInputsFingerprint 的 inputsHash = composeInputsHash(两个子 hash)', () => {
    makeJob();
    const fp = computeInputsFingerprint(JOB, root);
    expect(fp.inputsHash).toBe(composeInputsHash(fp.motionboardHash, fp.wordsHash));
  });
});
