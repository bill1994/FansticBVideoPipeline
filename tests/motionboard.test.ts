/**
 * motionboard 绑定器与生成器 —— 统一意图层（plan v2 / spec Wave 5）。
 *
 * 钉死的测试口径：
 *  - intent 与 motion 二选一（assertMotionboardKeys）
 *  - 绑定器 = 调度前解析步：intent → 候选逐个过时长门控 → params → carrier 退路
 *  - 钉死条目直通（sim_max 保留，缺省 1.0）
 *  - no-fits 显式落 report，不静默
 *  - 同一 motionboard 两次绑定逐字节一致
 */

import { describe, expect, it } from 'vitest';
import { buildRhythmTable } from '../src/core/rhythm.ts';
import { builtinTemplateLookup, generateMotionboard } from '../src/core/rhythm-rules.ts';
import {
  assertMotionboardKeys,
  bindMotionboard,
  MOTIONBOARD_INTENTS,
} from '../src/core/motionboard.ts';
import type { Cue, MotionBoard, MotionBoardItem, WordTimestamp } from '../src/core/types.ts';

const FPS = 30;
const REGISTRY = builtinTemplateLookup();

function words(n: number): WordTimestamp[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    word: `w${i}`,
    startFrame: i * 20,
    endFrame: i * 20 + 19,
    confidence: 0.9,
  }));
}

function cue(index: number, fromFrame: number, toFrame: number, text: string): Cue {
  return { index, fromFrame, toFrame, text };
}

function intentItem(over: Partial<MotionBoardItem> & { anchor: string }): MotionBoardItem {
  return {
    _author: { anchor: over.anchor },
    intent: 'closing-verdict',
    confidence: 0.8,
    ...over,
  } as MotionBoardItem;
}

function mb(items: MotionBoardItem[], cues: Cue[], over: Partial<MotionBoard> = {}): MotionBoard {
  return {
    meta: { fps: FPS, alignmentConfidence: 0.9 },
    tracks: [{ id: 'motion', layer: 60, items }],
    noMotionRanges: [],
    ...over,
  };
}

const bindCtx = (cues: Cue[]) => ({
  cues,
  words: words(60),
  source: { fps: FPS, alignmentConfidence: 0.9 },
});

// ── assertMotionboardKeys ────────────────────────────────────

describe('assertMotionboardKeys —— 契约门（退出码 2，不静默）', () => {
  const base: MotionBoardItem = {
    _author: { anchor: 'cue:0' },
    motion: 'typography/kinetic-line@1.0',
    confidence: 0.8,
  };

  it('intent 与 motion 双写 → ConfigError（二选一）', () => {
    const bad: MotionBoard = {
      meta: { fps: FPS, alignmentConfidence: 0.9 },
      tracks: [
        { id: 't', layer: 60, items: [{ ...base, intent: 'question' }] },
      ],
      noMotionRanges: [],
    };
    expect(() => assertMotionboardKeys(bad, FPS)).toThrow(/二选一/);
  });

  it('intent 与 motion 都缺 → ConfigError', () => {
    const bad: MotionBoard = {
      meta: { fps: FPS, alignmentConfidence: 0.9 },
      tracks: [{ id: 't', layer: 60, items: [{ _author: { anchor: 'cue:0' }, confidence: 0.8 }] }],
      noMotionRanges: [],
    };
    expect(() => assertMotionboardKeys(bad, FPS)).toThrow(/二选一/);
  });

  it('未知 intent → ConfigError 并列出词表', () => {
    const bad: MotionBoard = {
      meta: { fps: FPS, alignmentConfidence: 0.9 },
      tracks: [
        { id: 't', layer: 60, items: [intentItem({ anchor: 'cue:0', intent: 'make-it-pop' })] },
      ],
      noMotionRanges: [],
    };
    expect(() => assertMotionboardKeys(bad, FPS)).toThrow(/未知 intent/);
  });

  it('item 未知顶层键 → ConfigError 一次列全', () => {
    const bad: MotionBoard = {
      meta: { fps: FPS, alignmentConfidence: 0.9 },
      tracks: [
        {
          id: 't',
          layer: 60,
          items: [{ ...base, routing: 'template' } as unknown as MotionBoardItem],
        },
      ],
      noMotionRanges: [],
    };
    expect(() => assertMotionboardKeys(bad, FPS)).toThrow(/未知键/);
  });

  it('meta.fps 与素材不一致 → ConfigError', () => {
    const bad: MotionBoard = {
      meta: { fps: 24, alignmentConfidence: 0.9 },
      tracks: [{ id: 't', layer: 60, items: [base] }],
      noMotionRanges: [],
    };
    expect(() => assertMotionboardKeys(bad, FPS)).toThrow(/fps/);
  });

  it('demo 形态（全钉死 + sim_max + durationInFrames）放行', () => {
    const ok: MotionBoard = {
      meta: { fps: FPS, anchorMode: 'word', alignmentConfidence: 0.91 },
      tracks: [
        {
          id: 'bg-punch',
          layer: 1,
          items: [
            {
              _author: { anchor: 'word:8', offset: '-8f' },
              motion: 'cinematic/punch-in@1.0',
              footprint: [0, 0, 1, 1],
              durationInFrames: 120,
              sim_max: 0.86,
              confidence: 0.8,
              params: { scale: 1.08 },
            },
          ],
        },
      ],
      noMotionRanges: [],
    };
    expect(() => assertMotionboardKeys(ok, FPS)).not.toThrow();
  });
});

// ── bindMotionboard ──────────────────────────────────────────

describe('bindMotionboard —— intent 解析（调度前解析步）', () => {
  it('closing-verdict → center-emphasis；featuredText 进 params.text；sim_max 首选 0.85；caption 轨每 cue 一条', () => {
    const cues = [cue(0, 0, 90, '总之这双联名鞋值回票价')];
    const { draft, report } = bindMotionboard(
      mb([intentItem({ anchor: 'cue:0', featuredText: '值回票价了吗' })], cues),
      bindCtx(cues),
    );

    const motionTrack = draft.tracks.find((t) => t.id === 'motion')!;
    expect(motionTrack.items).toHaveLength(1);
    const item = motionTrack.items[0]!;
    expect(item.motion).toBe('typography/center-emphasis@1.0');
    expect(item.params).toEqual({ text: '值回票价了吗' });
    expect(item.sim_max).toBe(0.85);
    expect(item.confidence).toBe(0.8);
    expect(item._author).toEqual({ anchor: 'cue:0' });
    // 意图字段不进 draft（随 _author 在 bake 剥离）
    expect((item as Record<string, unknown>)['intent']).toBeUndefined();

    const captionTrack = draft.tracks.find((t) => t.id === 'caption')!;
    expect(captionTrack.layer).toBe(90);
    expect(captionTrack.items).toHaveLength(1);
    expect(captionTrack.items[0]!.motion).toBe('caption/karaoke-word@1.0');

    expect(report.records[0]).toMatchObject({
      source: 'intent',
      intent: 'closing-verdict',
      motion: 'typography/center-emphasis@1.0',
      candidateOrder: 0,
      status: 'bound',
    });
  });

  it('候选降级：首选不满足时长门控 → 次选，candidateOrder=1', () => {
    const cues = [cue(0, 0, 30, '首先准备素材然后开拍')]; // 31 帧：lower-third 需 45 ✗，kinetic-line 需 30 ✓
    const { draft, report } = bindMotionboard(
      mb([intentItem({ anchor: 'cue:0', intent: 'enum' })], cues),
      bindCtx(cues),
    );
    const item = draft.tracks.find((t) => t.id === 'motion')!.items[0]!;
    expect(item.motion).toBe('typography/kinetic-line@1.0');
    expect(report.records[0]).toMatchObject({ candidateOrder: 1, status: 'bound' });
    expect(report.records[0]!.candidatesTried).toEqual([
      'typography/lower-third@1.0',
      'typography/kinetic-line@1.0',
    ]);
  });

  it('全部候选失败 → no-fits 显式记录，条目不产 MG，字幕轨恒在', () => {
    const cues = [cue(0, 0, 19, '一句话')]; // 20 帧 < stat-card 45 / kinetic-line 30
    const { draft, report } = bindMotionboard(
      mb([intentItem({ anchor: 'cue:0', intent: 'number-emphasis' })], cues),
      bindCtx(cues),
    );
    expect(draft.tracks.find((t) => t.id === 'motion')!.items).toHaveLength(0);
    expect(draft.tracks.find((t) => t.id === 'caption')!.items).toHaveLength(1);
    expect(report.noFits).toBe(1);
    expect(report.records[0]).toMatchObject({ status: 'no-fits', intent: 'number-emphasis' });
  });

  it('钉死条目直通：motion/params/footprint/exclusive/sim_max 保留，report 标 pinned', () => {
    const cues = [cue(0, 0, 90, '一句话')];
    const pinned: MotionBoardItem = {
      _author: { anchor: 'word:4', offset: '-8f' },
      motion: 'typography/kinetic-line@1.0',
      footprint: [0.02, 0.74, 0.4, 0.16],
      exclusive: 'lower-third',
      sim_max: 0.82,
      confidence: 0.88,
      params: { text: '接近全自动' },
    };
    const { draft, report } = bindMotionboard(mb([pinned], cues), bindCtx(cues));
    const item = draft.tracks.find((t) => t.id === 'motion')!.items[0]!;
    expect(item).toMatchObject({
      motion: 'typography/kinetic-line@1.0',
      footprint: [0.02, 0.74, 0.4, 0.16],
      exclusive: 'lower-third',
      sim_max: 0.82,
      confidence: 0.88,
      params: { text: '接近全自动' },
    });
    expect(report.records[0]).toMatchObject({ source: 'pinned', pinned: true, status: 'bound' });
  });

  it('钉死条目缺 sim_max → 绑定器补 1.0（不让人算调度分）', () => {
    const cues = [cue(0, 0, 90, '一句话')];
    const { draft } = bindMotionboard(
      mb(
        [
          {
            _author: { anchor: 'cue:0' },
            motion: 'typography/kinetic-line@1.0',
            params: { text: 'x' },
            confidence: 0.9,
          },
        ],
        cues,
      ),
      bindCtx(cues),
    );
    expect(draft.tracks.find((t) => t.id === 'motion')!.items[0]!.sim_max).toBe(1);
  });

  it('face 预算 0%：intent 条目继承区域感知 carrier 退路', () => {
    const cues = [cue(0, 0, 90, '总之这双鞋值得买')];
    const regions = [
      {
        id: 'r-face-x',
        kind: 'face' as const,
        shotId: 's1',
        fromFrame: 0,
        durationInFrames: 600,
        box: [0.386, 0.106, 0.158, 0.324] as [number, number, number, number],
      },
    ];
    const { draft, report } = bindMotionboard(
      mb([intentItem({ anchor: 'cue:0', featuredText: '值回票价' })], cues),
      { ...bindCtx(cues), regions },
    );
    const item = draft.tracks.find((t) => t.id === 'motion')!.items[0]!;
    expect(item.carrier).toBeDefined();
    expect(item.carrier!.template).toBe('carrier/split-frame@1.0');
    expect(report.records[0]!.status).toBe('bound');
  });

  it('确定性：同一 motionboard 两次绑定逐字节一致', () => {
    const cues = [cue(0, 0, 90, '总之这双鞋值得买'), cue(1, 90, 180, '大概有3个卖点')];
    const board = mb(
      [
        intentItem({ anchor: 'cue:0', featuredText: '值回票价' }),
        intentItem({ anchor: 'cue:1', intent: 'number-emphasis' }),
      ],
      cues,
    );
    const a = bindMotionboard(board, bindCtx(cues));
    const b = bindMotionboard(board, bindCtx(cues));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── generateMotionboard ──────────────────────────────────────

describe('generateMotionboard —— 规则底稿（intent 形态）', () => {
  it('信号 → 意图映射：number/closing/question/contrast-turn/enum/definition/repetition-term', () => {
    // 🔴 夹具句不得含中文数字（「一个」的「一」会命中 number 信号）、
    //    不得含否定词（contrast）—— 这是节奏表判据的口径，不是 bug。
    const LONG = '这个前置句子非常漫长只是用来做对比的参照';
    // ⚠️ 末条 cue 恒有 closing 信号（isLast 语义）—— 目标 cue 后必须垫中性尾巴
    const TAIL = cue(99, 900, 990, '这个方法很好用');
    const cases: Array<[Cue[], string]> = [
      [[cue(0, 0, 90, '大概有3个步骤'), TAIL], 'number-emphasis'],
      [[cue(0, 0, 90, '总之要记住这一点'), TAIL], 'closing-verdict'],
      [[cue(0, 0, 90, '为什么要这样做但其实不是'), TAIL], 'question'],
      // contrast + short-after-long（前句 ≥12 字、本句 ≤ 一半）→ 两个弱信号成对
      [
        [cue(0, 0, 90, LONG), cue(1, 90, 180, '但实际上并不是这样'), TAIL],
        'contrast-turn',
      ],
      // enum + short-after-long
      [
        [cue(0, 0, 90, LONG), cue(1, 90, 180, '首先是准备素材'), TAIL],
        'enum',
      ],
      [[cue(0, 0, 90, '这个叫做强制对齐'), TAIL], 'definition'],
      // repetition（二字词出现在 ≥3 条 cue）+ short-after-long
      [
        [
          cue(0, 0, 90, LONG),
          cue(1, 90, 180, '大家都在用这个方法'),
          cue(2, 180, 270, '大家都在讨论这个功能'),
          cue(3, 270, 360, '大家都在用确实很好'),
          TAIL,
        ],
        'repetition-term',
      ],
    ];
    for (const [cues, intent] of cases) {
      const table = buildRhythmTable(cues, FPS, 'aligned');
      const board = generateMotionboard(table, cues, { fps: FPS, alignmentConfidence: 0.9 });
      const motionItems = board.tracks.find((t) => t.id === 'motion')!.items;
      expect(motionItems.length, cues.map((c) => c.text).join('|')).toBeGreaterThan(0);
      expect(motionItems[0]!.intent, cues.map((c) => c.text).join('|')).toBe(intent);
      expect(motionItems[0]!.motion).toBeUndefined();
    }
  });

  it('decide=none 的 cue 不产 MG 条目；caption 为钉死条目', () => {
    const cues = [cue(0, 0, 90, '这个方法很好用'), cue(1, 90, 180, '这个方法很好用')];
    const table = buildRhythmTable(cues, FPS, 'aligned');
    const board = generateMotionboard(table, cues, { fps: FPS, alignmentConfidence: 0.9 });
    // cue0 无信号（非末条）→ 不产 MG；cue1 是末条 → closing → 有一条，但锚点是 cue:1
    const motionItems = board.tracks.find((t) => t.id === 'motion')!.items;
    expect(motionItems.find((i) => i._author.anchor === 'cue:0')).toBeUndefined();
    const caption = board.tracks.find((t) => t.id === 'caption')!.items[0]!;
    expect(caption.motion).toBe('caption/karaoke-word@1.0');
    expect(caption.intent).toBeUndefined();
  });

  it('金样：基线式信号组合经 生成→绑定 后得到与旧选型一致的 motion id', () => {
    const LONG = '这个前置句子非常漫长只是用来做对比的参照';
    const TAIL = cue(99, 900, 990, '这个方法很好用');
    const cases: Array<[Cue[], string]> = [
      [[cue(0, 0, 90, '为什么要这样做但其实不是'), TAIL], 'typography/kinetic-line@1.0'],
      [[cue(0, 0, 90, '大概有3个步骤'), TAIL], 'data/stat-card@1.0'],
      [[cue(0, 0, 90, '总之这双联名鞋值回票价'), TAIL], 'typography/center-emphasis@1.0'],
      [[cue(0, 0, 90, LONG), cue(1, 90, 180, '首先是准备素材'), TAIL], 'typography/lower-third@1.0'],
    ];
    for (const [cues, expectedMotion] of cases) {
      const table = buildRhythmTable(cues, FPS, 'aligned');
      const board = generateMotionboard(table, cues, { fps: FPS, alignmentConfidence: 0.9 });
      const { draft } = bindMotionboard(board, bindCtx(cues));
      const item = draft.tracks.find((t) => t.id === 'motion')!.items[0]!;
      expect(item.motion, cues.map((c) => c.text).join('|')).toBe(expectedMotion);
    }
  });

  it('词表完整性：每个 intent 的候选都已注册（AC-6）', () => {
    for (const [intent, def] of Object.entries(MOTIONBOARD_INTENTS)) {
      expect(def.candidates.length, intent).toBeGreaterThan(0);
      for (const c of def.candidates) {
        expect(REGISTRY.get(c), `${intent} -> ${c}`).toBeDefined();
      }
    }
  });
});
