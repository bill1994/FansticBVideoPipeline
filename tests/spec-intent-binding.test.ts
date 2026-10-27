/**
 * spec 驱动的模板能否被 intent 绑定（2026-10-27）。
 *
 * 🔴 **这个文件是为了锁住一个真实故障**：
 *   8 份基线 spec（`custom/*@1.0`）此前**在真实成片里零使用** ——
 *   demo 5 个模板、kukini 6 个，全是 tsx。根因不是「spec 不好用」，而是**整层没接线**：
 *
 *   ① `rhythm-rules.ts` 的 `MOTIONBOARD_INTENTS` 里 `custom/*` 出现 **0 次**；
 *   ② 就算加进候选，`paramsForMotion()` 的 switch 只列了 5 个 tsx 模板，
 *      `default: return null` ⇒ 所有 `custom/*` 直接 null ⇒ 必然 no-fits；
 *   ③ `paramsWithFeatured()` 只认 `text/value/title`，而 spec 派生的键是 slot 名（`main`）。
 *
 *   ②③ 两条叠加的后果是：**spec 模板永远绑不上**，无论候选里有没有它。
 *   本文件用「26f 短 cue 必须落到 fade-up、31f 必须仍走 kinetic-line」把修好的行为钉住。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { bindMotionboard } from '../src/core/motionboard.ts';
import { loadSpecsFromDisk } from '../src/core/spec-loader.ts';

beforeAll(() => {
  loadSpecsFromDisk();
});

/** 造一个 span 恰好 N 帧的 `keypoint` 条目（word:0 从 0 到 N-1）。 */
function bindKeypoint(span: number): {
  status: string;
  motion: string;
  params: Record<string, unknown> | null;
  tried: string[];
} {
  const words = [{ index: 0, word: 'a', startFrame: 0, endFrame: span - 1, confidence: 0.9 }];
  const cues = [
    {
      index: 0,
      fromFrame: 0,
      toFrame: span - 1,
      text: '这是要点文案',
      srtFromSec: 0,
      srtToSec: span / 30,
    },
  ];
  const board = {
    meta: { fps: 30, anchorMode: 'word' as const, alignmentConfidence: 0.9 },
    tracks: [
      {
        id: 'ov',
        layer: 200,
        items: [
          {
            _author: { anchor: 'word:0' },
            intent: 'keypoint',
            confidence: 0.9,
            featuredText: '要点',
          },
        ],
      },
    ],
    noMotionRanges: [],
  };
  const r = bindMotionboard(board as never, {
    cues: cues as never,
    words: words as never,
    source: { fps: 30, alignmentConfidence: 0.9 },
    regions: [],
  } as never);
  const rec = r.report.records[0];
  return {
    status: String(rec?.status),
    motion: rec?.motion ?? '',
    params: (r.draft.tracks[0]?.items[0]?.params ?? null) as Record<string, unknown> | null,
    tried: rec?.candidatesTried ?? [],
  };
}

describe('spec 模板能不能被 intent 绑定', () => {
  it('🔴 26f 短 cue → 落到 custom/fade-up（kinetic-line 要 30f、tag-float 要 36f，只有它塞得进）', () => {
    const r = bindKeypoint(26);
    expect(r.status).toBe('bound');
    expect(r.motion).toBe('custom/fade-up@1.0');
  });

  it('🔴 29f 同样落到 custom/fade-up（比 minVisible 24 大、比 30 小）', () => {
    expect(bindKeypoint(29).motion).toBe('custom/fade-up@1.0');
  });

  it('31f → 仍优先 kinetic-line（fade-up 只接窄缝，不抢正常时长的 cue）', () => {
    const r = bindKeypoint(31);
    expect(r.status).toBe('bound');
    expect(r.motion).toBe('typography/kinetic-line@1.0');
  });

  it('22f → 仍然 no-fits（连 fade-up 的 24f 都不够，不硬塞）', () => {
    const r = bindKeypoint(22);
    expect(r.status).toBe('no-fits');
    expect(r.motion).toBe('');
  });

  it('候选被逐个试过（candidatesTried 含 spec 模板，证明它真在候选里）', () => {
    expect(bindKeypoint(26).tried).toContain('custom/fade-up@1.0');
  });
});

describe('文案参数键：按模板自己的 schema 走', () => {
  it('spec 模板的键是 slot 名 `main`（不是硬编码的 text）', () => {
    const r = bindKeypoint(26);
    expect(r.params).toEqual({ main: '要点' });
  });

  it('tsx 模板的键仍是 `text`（回归：修 spec 不能改坏既有模板）', () => {
    const r = bindKeypoint(31);
    expect(r.params).toEqual({ text: '要点' });
  });
});
