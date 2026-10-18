/**
 * 锚点 → 帧的一次性烘焙（C2 / SPEC §1.5）。
 * 关键不变量：**锚点用完即弃** —— 烘焙后 `_author` 必须消失。
 */

import { describe, expect, it } from 'vitest';
import { bake, parseOffset, resolveAnchor } from '../src/core/bake.ts';
import { ConfigError } from '../src/core/exit-code.ts';
import { getTemplate } from '../src/templates/registry.ts';
import type { Storyboard } from '../src/core/types.ts';
import { makeWords } from './_ctx.ts';

const FPS = 30;
const WORDS = makeWords(50); // word:37 → startFrame = 100 + 37*20 = 840

describe('parseOffset', () => {
  it('缺省为 0', () => {
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset('')).toBe(0);
  });
  it('解析 ±Nf', () => {
    expect(parseOffset('-8f')).toBe(-8);
    expect(parseOffset('+4f')).toBe(4);
    expect(parseOffset('0f')).toBe(0);
  });
  it('非法语法直接报错，不猜', () => {
    expect(() => parseOffset('8')).toThrow(ConfigError);
    expect(() => parseOffset('-8s')).toThrow(ConfigError);
  });
});

describe('resolveAnchor', () => {
  it('word:37 + (-8f) → 词起点前移 8 帧', () => {
    const r = resolveAnchor('word:37', '-8f', WORDS, FPS);
    expect(r.fromFrame).toBe(840 - 8);
    expect(r.wordIndex).toBe(37);
    expect(r.wordStartFrame).toBe(840);
    expect(r.wordEndFrame).toBe(859);
  });

  it('词号不存在 → ConfigError（不静默取最近的词）', () => {
    expect(() => resolveAnchor('word:999', undefined, WORDS, FPS)).toThrow(ConfigError);
  });

  it('abs:<帧> 是手写逃生口，且不带目标词', () => {
    const r = resolveAnchor('abs:372', undefined, WORDS, FPS);
    expect(r.fromFrame).toBe(372);
    expect(r.wordIndex).toBeNull();
  });

  it('abs:<秒>s 按 fps 换算', () => {
    expect(resolveAnchor('abs:12.4s', undefined, WORDS, FPS).fromFrame).toBe(372);
  });

  it('未知锚点语法 → ConfigError', () => {
    expect(() => resolveAnchor('xx:3', undefined, WORDS, FPS)).toThrow(ConfigError);
  });

  // ── C2-6：cue:N 锚点（2026-10-18）────────────────────────────
  // 字幕按 cue 切分时，模型不该手算「显示多少帧」；cue 锚点一次给出起点 + 长度。
  it('cue:1 + (-4f) → 起点前移且时长扣掉偏移量', () => {
    const cues = [{ index: 1, fromFrame: 300, toFrame: 399, text: '示例句' }];
    const r = resolveAnchor('cue:1', '-4f', WORDS, FPS, cues);
    expect(r.fromFrame).toBe(296);
    expect(r.cueIndex).toBe(1);
    // 半开区间 [from, toFrame) ⇒ 时长 = 399 - 296 = 103
    expect(r.cueDurationInFrames).toBe(103);
    // 与 word 锚点互斥：不能把 cue 序号误记成词序号
    expect(r.wordIndex).toBeNull();
    expect(r.wordStartFrame).toBeNull();
  });

  it('cue:0 无 offset → 时长恰为 cue 跨度（半开区间）', () => {
    const cues = [{ index: 0, fromFrame: 0, toFrame: 149, text: 'A' }];
    const r = resolveAnchor('cue:0', undefined, WORDS, FPS, cues);
    expect(r.fromFrame).toBe(0);
    expect(r.cueDurationInFrames).toBe(149);
  });

  it('cue 序号不存在 → ConfigError，且提示可改用 word/abs', () => {
    const cues = [{ index: 0, fromFrame: 0, toFrame: 149, text: 'A' }];
    expect(() => resolveAnchor('cue:9', undefined, WORDS, FPS, cues)).toThrow(/改用 word/);
  });

  it('cue 序号非法（非整数）→ ConfigError', () => {
    expect(() => resolveAnchor('cue:abc', undefined, WORDS, FPS, [])).toThrow(ConfigError);
  });
});

describe('bake', () => {
  const draft: Storyboard = {
    meta: { fps: FPS, anchorMode: 'word', alignmentConfidence: 0.9 },
    tracks: [
      {
        id: 'typo-a',
        layer: 60,
        items: [
          {
            _author: { anchor: 'word:37', offset: '-8f' },
            fromFrame: Number.NaN,
            durationInFrames: Number.NaN,
            motion: 'typography/kinetic-line@1.0',
            footprint: [0, 0.72, 0.42, 0.18],
            exclusive: 'lower-third',
          },
        ],
      },
      {
        id: 'data-b',
        layer: 55,
        handoffTo: 'typo-a',
        items: [
          {
            fromFrame: 400,
            durationInFrames: 60,
            motion: 'data/stat-card@1.0',
            footprint: [0.62, 0.12, 0.32, 0.24],
          },
        ],
      },
    ],
    noMotionRanges: [],
  };

  const { storyboard, report } = bake(draft, WORDS, FPS);

  it('锚点解析为绝对帧', () => {
    expect(storyboard.tracks[0]?.items[0]?.fromFrame).toBe(832);
  });

  it('锚点用完即弃 —— _author 必须消失', () => {
    for (const t of storyboard.tracks) {
      for (const i of t.items) {
        expect('_author' in i).toBe(false);
      }
    }
  });

  it('无锚点的 item 保持原 fromFrame 不变', () => {
    expect(storyboard.tracks[1]?.items[0]?.fromFrame).toBe(400);
  });

  it('时长缺省时取 max(模板 minVisibleInFrames, 锚定词区间长度)', () => {
    const tpl = getTemplate('typography/kinetic-line@1.0');
    const wordSpan = 859 - 840 + 1; // 20 帧
    expect(storyboard.tracks[0]?.items[0]?.durationInFrames).toBe(
      Math.max(tpl.minVisibleInFrames, wordSpan),
    );
  });

  it('产出 bake-report —— 校验项 #1 需要它才能判「目标词」', () => {
    expect(report.records).toHaveLength(1);
    expect(report.records[0]).toMatchObject({
      trackId: 'typo-a',
      itemIndex: 0,
      anchor: 'word:37',
      offset: '-8f',
      wordIndex: 37,
      wordStartFrame: 840,
      wordEndFrame: 859,
      fromFrame: 832,
    });
  });

  it('缺 _author 又缺 fromFrame → 报错，不猜', () => {
    const bad: Storyboard = {
      ...draft,
      tracks: [
        {
          id: 'x',
          layer: 1,
          items: [
            {
              fromFrame: Number.NaN,
              durationInFrames: 30,
              motion: 'typography/kinetic-line@1.0',
              footprint: [0, 0, 0.2, 0.2],
            },
          ],
        },
      ],
    };
    expect(() => bake(bad, WORDS, FPS)).toThrow(ConfigError);
  });
});

// ─────────────────────────────────────────────────────────────
// C2-6：cue:N 锚点（2026-10-18）
//
// 立法意图：模型**只写「覆盖哪条字幕」**，不写「显示多少帧」。
// 48 条 cue 手算 48 次时长，正是铁律 2（写锚点、不手算帧）要禁的事。
// ─────────────────────────────────────────────────────────────
describe('bake · cue:N 锚点（C2-6）', () => {
  const CUES = [
    { index: 0, fromFrame: 0, toFrame: 59, text: '第一句' },
    { index: 1, fromFrame: 60, toFrame: 149, text: '第二句' },
  ];

  const cueDraft = (extra: Record<string, unknown> = {}): Storyboard => ({
    meta: { fps: FPS, anchorMode: 'word', alignmentConfidence: 0.9 },
    tracks: [
      {
        id: 'caption-bar',
        layer: 90,
        items: [
          {
            _author: { anchor: 'cue:1' },
            fromFrame: Number.NaN,
            durationInFrames: Number.NaN,
            motion: 'caption/karaoke-word@1.0',
            footprint: [0.1, 0.86, 0.8, 0.1],
            ...extra,
          },
        ],
      },
    ],
    noMotionRanges: [],
  });

  it('不写 durationInFrames 时，时长取 cue 自身跨度（半开区间）', () => {
    const { storyboard, report } = bake(cueDraft(), WORDS, FPS, CUES);
    const it0 = storyboard.tracks[0]!.items[0]!;
    expect(it0.fromFrame).toBe(60);
    expect(it0.durationInFrames).toBe(89); // 149 - 60（半开区间）
    expect(report.records[0]!.cueIndex).toBe(1);
    expect(report.records[0]!.wordIndex).toBe(-1);
  });

  it('显式 durationInFrames 仍优先（沿用时长来源第 1 条）', () => {
    const { storyboard } = bake(cueDraft({ durationInFrames: 12 }), WORDS, FPS, CUES);
    expect(storyboard.tracks[0]!.items[0]!.durationInFrames).toBe(12);
  });

  it('模板 minVisibleInFrames 是下限，不会把 cue 长度压小', () => {
    const shortCues = [{ index: 0, fromFrame: 0, toFrame: 2, text: '嗯' }];
    const draft = cueDraft();
    (draft.tracks[0]!.items[0]!._author as { anchor: string }).anchor = 'cue:0';
    const { storyboard } = bake(draft, WORDS, FPS, shortCues);
    // karaoke-word 的 minVisibleInFrames = 12 > cue 跨度 3
    expect(storyboard.tracks[0]!.items[0]!.durationInFrames).toBe(
      getTemplate('caption/karaoke-word@1.0').minVisibleInFrames,
    );
  });

  it('cue 锚点解析后 _author 仍被剥离（锚点用完即弃）', () => {
    const { storyboard } = bake(cueDraft(), WORDS, FPS, CUES);
    expect(storyboard.tracks[0]!.items[0]!._author).toBeUndefined();
  });
});
