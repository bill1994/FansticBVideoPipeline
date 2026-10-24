/**
 * M-3 契约层（2026-10-24）：语义 pacing 与 buildContext 结构断言。
 *
 * ─────────────────────────────────────────────────────────────────
 * 背景（M-3，2026-10-23 用户裁决）
 * ─────────────────────────────────────────────────────────────────
 * pacing（节奏表）首选路径 = LLM 创作期语义判定：模型读 01-align 的 cues/words，
 * 按语义产出每条 cue 的 decide/motion/signal/reason，与 motionboard 同批落盘
 * （meta.source = 'semantic'）。规则节奏表降级为兜底先验（不退役）。
 *
 * 本文件测的是裁决 ⑤ 的一致性校验 —— 走 buildContext 结构断言层
 * （ConfigError → 退出码 2），**不占 18 项校验名额**：
 *   · cue 索引存在性（pacing 引用的 cue 必须真存在于 words.json）
 *   · motion id 已注册（防自造模板 id）
 *   · decide 与条目对齐（motion 字段与 decide 互斥一致）
 *
 * ⚠️ 刻意不校验「pacing 与 board 的分布一致」：模型合法地偏离先验是
 *    语义路径的能力本身（语义优先于规则），硬绑会把这个能力锁死。
 *    对账手段是人工核对 pacing.json 的 reason —— 这正是留痕的目的。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import { buildContext } from '../src/validate/context.ts';
import { STAGES } from '../src/core/config.ts';
import type { RhythmTable } from '../src/core/types.ts';

const CUE = {
  index: 0,
  fromFrame: 100,
  toFrame: 300,
  text: '示例句',
  srtFromSec: 3.33,
  srtToSec: 10.0,
};

/** 造一个最小合法 job 目录（同 stage-order.test.ts 的夹具模式）。 */
function makeJob(root: string): string {
  const base = path.join(root, 'j');
  for (const s of Object.values(STAGES)) fs.mkdirSync(path.join(base, s), { recursive: true });

  fs.writeFileSync(
    path.join(base, STAGES.input, 'source.json'),
    JSON.stringify({ video: 'v.mp4', srt: 'v.srt', fps: 30, durationInFrames: 900 }),
  );
  fs.writeFileSync(
    path.join(base, STAGES.align, 'words.json'),
    JSON.stringify({ fps: 30, words: [], cues: [CUE] }),
  );
  fs.writeFileSync(
    path.join(base, STAGES.align, 'align-report.json'),
    JSON.stringify({
      fps: 30,
      meanConfidence: 0.9,
      lowConfidenceRatio: 0,
      gatePassed: true,
      lowConfidenceWords: [],
      textSource: 'srt',
      alignedRatio: 1,
      thresholds: {
        alignedRatioMin: 0.8,
        lowConfidenceRatioMax: 0.3,
        meanConfidenceMin: 0.6,
        silentWordRatioWarnMax: 0.02,
      },
    }),
  );
  fs.writeFileSync(path.join(base, STAGES.perceive, 'shots.json'), JSON.stringify([]));
  fs.writeFileSync(path.join(base, STAGES.perceive, 'regions.json'), JSON.stringify([]));
  fs.writeFileSync(
    path.join(base, STAGES.storyboard, 'storyboard.json'),
    JSON.stringify({
      meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
      tracks: [],
      noMotionRanges: [],
    }),
  );
  fs.writeFileSync(
    path.join(base, STAGES.storyboard, 'bake-report.json'),
    JSON.stringify({ fps: 30, resolved: [] }),
  );
  return base;
}

function writePacing(base: string, table: RhythmTable): void {
  fs.writeFileSync(
    path.join(base, STAGES.storyboard, 'pacing.json'),
    JSON.stringify(table),
  );
}

function expectConfigError(run: () => unknown): string {
  let msg = '';
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    msg = (e as Error).message;
  }
  expect(msg, '应当抛 ConfigError').not.toBe('');
  return msg;
}

describe('M-3 契约层：pacing 一致性断言（结构检查，退出码 2，不占 18 项）', () => {
  let root: string;
  let base: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-pacing-'));
    base = makeJob(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('无 pacing.json → 通过（规则兜底可缺席；一致性只对存在的表负责）', () => {
    expect(() => buildContext('j', root)).not.toThrow();
  });

  it('旧格式规则表（无 meta.source）→ 通过（向后兼容已落盘产物）', () => {
    writePacing(base, {
      meta: { fps: 30, mode: 'aligned', version: '1' },
      cues: [
        {
          cueIndex: 0,
          fromFrame: 100,
          durationInFrames: 200,
          decide: 'none',
          reason: '字数低于门槛',
          signal: [],
          skipped: 'too-short',
        },
      ],
    });
    expect(() => buildContext('j', root)).not.toThrow();
  });

  it('合法 semantic 表（自由文本 signal）→ 通过', () => {
    writePacing(base, {
      meta: { fps: 30, mode: 'aligned', version: '1', source: 'semantic' },
      cues: [
        {
          cueIndex: 0,
          fromFrame: 100,
          durationInFrames: 200,
          decide: 'motion',
          motion: 'typography/kinetic-line@1.0',
          reason: '本句是全片的价值主张，需要瞬时强调',
          signal: ['价值主张', '全片高潮'],
        },
      ],
    });
    expect(() => buildContext('j', root)).not.toThrow();
  });

  it('cueIndex 不存在（引用了 words.json 里没有的 cue）→ ConfigError', () => {
    writePacing(base, {
      meta: { fps: 30, mode: 'aligned', version: '1', source: 'semantic' },
      cues: [
        {
          cueIndex: 7,
          fromFrame: 0,
          durationInFrames: 30,
          decide: 'none',
          reason: '',
          signal: [],
        },
      ],
    });
    const msg = expectConfigError(() => buildContext('j', root));
    expect(msg).toContain('cue');
    expect(msg).toContain('words.json');
  });

  it('decide=motion 但 motion id 未注册 → ConfigError', () => {
    writePacing(base, {
      meta: { fps: 30, mode: 'aligned', version: '1', source: 'semantic' },
      cues: [
        {
          cueIndex: 0,
          fromFrame: 100,
          durationInFrames: 200,
          decide: 'motion',
          motion: 'typography/不存在@9.9',
          reason: '',
          signal: [],
        },
      ],
    });
    const msg = expectConfigError(() => buildContext('j', root));
    expect(msg).toContain('未注册');
  });

  it('decide=none 却带 motion 字段 → ConfigError（条目自相矛盾）', () => {
    writePacing(base, {
      meta: { fps: 30, mode: 'aligned', version: '1', source: 'semantic' },
      cues: [
        {
          cueIndex: 0,
          fromFrame: 100,
          durationInFrames: 200,
          decide: 'none',
          motion: 'typography/kinetic-line@1.0',
          reason: '',
          signal: [],
        },
      ],
    });
    const msg = expectConfigError(() => buildContext('j', root));
    expect(msg).toContain('decide');
  });

  it('decide=motion 但缺 motion 字段 → ConfigError（同上另一侧）', () => {
    writePacing(base, {
      meta: { fps: 30, mode: 'aligned', version: '1', source: 'semantic' },
      cues: [
        {
          cueIndex: 0,
          fromFrame: 100,
          durationInFrames: 200,
          decide: 'motion',
          reason: '',
          signal: [],
        },
      ],
    });
    const msg = expectConfigError(() => buildContext('j', root));
    expect(msg).toContain('decide');
  });
});
