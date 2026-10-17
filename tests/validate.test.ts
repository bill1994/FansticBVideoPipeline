/**
 * 构建期校验项（当前 17 项）+ 起草原生约束。
 * 每条用例都对应 SPEC §2.2 / §2.3 的一行，或一份真源里的明文规定。
 */

import { describe, expect, it } from 'vitest';
import { runValidation, DOCUMENTED_CHECK_ITEMS, EXTRA_CHECKS } from '../src/validate/index.ts';
import type { BakeRecord } from '../src/core/types.ts';
import { carrierOf, makeCtx, makeItem, makeOccludingItem, makeTrack, makeWords, type CtxOverrides } from './_ctx.ts';

const STAT = 'data/stat-card@1.0'; // overlay-safe, minVisible 45
const CARRIER = 'carrier/split-frame@1.0'; // subject-transform
const FULLSCREEN = 'transition/whip-pan@1.0'; // fullscreen
// 注：原先此处有 `const OVERLAY = 'typography/kinetic-line@1.0'`，
// 2026-10-15 起遮挡类测试改用 `makeOccludingItem()`（见 _ctx.ts），
// 该常量已无消费方故删除 —— 不留"定义了没人用"的死符号（同问题 9）。

function codesOf(over: CtxOverrides = {}): string[] {
  return runValidation(makeCtx(over)).items.map((i) => i.code);
}

describe('基线', () => {
  it('空 storyboard → ok，且 18 项全跑', () => {
    const r = runValidation(makeCtx());
    expect(r.ok).toBe(true);
    // 18 = 17 + #18（`W-D2-02` 载体变换后主体可见比，P4 于 2026-10-17 当晚重立）
    // 三段历史见 `src/validate/index.ts` 注释：上午增补 → 同日撤回 → 当晚换源重立。
    expect(r.summary.checked).toBe(18);
    expect(DOCUMENTED_CHECK_ITEMS).toHaveLength(18);
    expect(r.summary.extra).toEqual(['W-D3-01', 'W-F6-01']);
    expect(r.items).toEqual([]);
  });

  it('确定性：同一输入两次运行逐字节一致', () => {
    const over: CtxOverrides = {
      tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 205, durationInFrames: 10 })])],
    };
    expect(JSON.stringify(runValidation(makeCtx(over)))).toBe(
      JSON.stringify(runValidation(makeCtx(over))),
    );
  });

  it('排序：error 在 warning 之前', () => {
    const r = runValidation(
      makeCtx({
        tracks: [
          makeTrack('a', 10, [makeItem({ fromFrame: 105, durationInFrames: 10 })]), // E-C3-01
          makeTrack('b', 20, [makeItem({ fromFrame: 100, durationInFrames: 60 })]), // W-C3-01
        ],
      }),
    );
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    expect(r.items[0]?.level).toBe('error');
    expect(r.items.at(-1)?.level).toBe('warning');
  });
});

describe('#1 时序校验 E-C2-5-01（区间下界 = 锚定词所在 cue 的起点，C2-5a）', () => {
  const rec = (fromFrame: number): BakeRecord => ({
    trackId: 'a',
    itemIndex: 0,
    anchor: 'word:5',
    offset: '-60f',
    wordIndex: 5,
    wordStartFrame: 200,
    wordEndFrame: 219,
    fromFrame,
  });

  /** 一条覆盖 word:5（200..219）的 cue。 */
  const cue = (fromFrame: number) => [{ index: 0, fromFrame, toFrame: 400, text: '示例句' }];

  it('落在目标词区间内 → 通过', () => {
    expect(codesOf({ bake: { fps: 30, records: [rec(205)] } })).not.toContain('E-C2-5-01');
  });

  it('晚于目标词 → error', () => {
    expect(codesOf({ bake: { fps: 30, records: [rec(260)] } })).toContain('E-C2-5-01');
  });

  it('abs 逃生口无目标词 → 不参与本项', () => {
    const r = rec(140);
    expect(codesOf({ bake: { fps: 30, records: [{ ...r, wordIndex: -1, wordStartFrame: -1 }] } }))
      .not.toContain('E-C2-5-01');
  });

  // ── C2-5a 的核心：负偏移＝抢拍，合法 ──────────────────────
  it('负偏移仍在 cue 内 → 通过（这是修正后的关键行为）', () => {
    // cue 起点 150，词起点 200，fromFrame 160 早于词但在 cue 内
    expect(codesOf({ bake: { fps: 30, records: [rec(160)] }, cues: cue(150) }))
      .not.toContain('E-C2-5-01');
  });

  it('负偏移跨过 cue 起点 → error（真错位）', () => {
    // cue 起点 180，fromFrame 160 已抢到上一句
    expect(codesOf({ bake: { fps: 30, records: [rec(160)] }, cues: cue(180) }))
      .toContain('E-C2-5-01');
  });

  it('无 cue 覆盖该词 → 退化为词起点（保守）', () => {
    // 不传 cues，fromFrame 160 < 词起点 200 → 报错
    expect(codesOf({ bake: { fps: 30, records: [rec(160)] } })).toContain('E-C2-5-01');
  });

  it('错误消息能区分「抢过头」与「太晚」', () => {
    const early = runValidation(makeCtx({ bake: { fps: 30, records: [rec(160)] }, cues: cue(180) }));
    const late = runValidation(makeCtx({ bake: { fps: 30, records: [rec(260)] }, cues: cue(150) }));
    expect(early.items.find((i) => i.code === 'E-C2-5-01')?.hint).toContain('上一句');
    expect(late.items.find((i) => i.code === 'E-C2-5-01')?.hint).toContain('晚于');
  });

  it('负偏移本身被明确说明为合法（hint 不误导）', () => {
    const r = runValidation(
      makeCtx({ bake: { fps: 30, records: [rec(160)] }, cues: cue(180) }),
    );
    expect(r.items.find((i) => i.code === 'E-C2-5-01')?.hint).toContain('负偏移本身是合法的');
  });
});

describe('#2 密度校验 E-C2-5-02', () => {
  const fourItems = () =>
    [110, 150, 190, 230].map((f, i) =>
      makeItem({
        fromFrame: f,
        durationInFrames: 40,
        footprint: [0.02 + (i % 2) * 0.4, 0.02 + Math.floor(i / 2) * 0.4, 0.1, 0.1],
      }),
    );

  it('每 cue item 超阈值（占位阈值 3）→ error', () => {
    const codes = codesOf({
      tracks: [makeTrack('a', 60, fourItems())],
      cues: [{ index: 0, fromFrame: 100, toFrame: 300, text: '一句话塞满动效' }],
    });
    expect(codes).toContain('E-C2-5-02');
  });

  it('未超阈值 → 不报', () => {
    const codes = codesOf({
      tracks: [makeTrack('a', 60, fourItems().slice(0, 3))],
      cues: [{ index: 0, fromFrame: 100, toFrame: 300, text: 'ok' }],
    });
    expect(codes).not.toContain('E-C2-5-02');
  });
});

describe('#3 / #4 / #5 / #11 footprint 相交仲裁', () => {
  const overlapping = (a: Parameters<typeof makeItem>[0], b: Parameters<typeof makeItem>[0]) => ({
    tracks: [makeTrack('a', 60, [makeItem(a)]), makeTrack('b', 61, [makeItem(b)])],
  });

  it('#3 同 exclusive 组相交 → E-C4-01', () => {
    const codes = codesOf(
      overlapping(
        { fromFrame: 205, durationInFrames: 60, exclusive: 'lower-third', footprint: [0.1, 0.7, 0.3, 0.2] },
        { fromFrame: 215, durationInFrames: 60, exclusive: 'lower-third', footprint: [0.15, 0.72, 0.3, 0.2] },
      ),
    );
    expect(codes).toContain('E-C4-01');
  });

  it('#4 异 exclusive 组相交 → warning W-C4-01，不拦', () => {
    const r = runValidation(
      makeCtx(
        overlapping(
          { fromFrame: 205, durationInFrames: 60, exclusive: 'lower-third', footprint: [0.1, 0.7, 0.3, 0.2] },
          { fromFrame: 215, durationInFrames: 60, exclusive: 'stat-zone', footprint: [0.15, 0.72, 0.3, 0.2] },
        ),
      ),
    );
    expect(r.items.map((i) => i.code)).toContain('W-C4-01');
    expect(r.ok).toBe(true);
  });

  it('不相交 → 通过，即便同组（规则不应误伤）', () => {
    const codes = codesOf(
      overlapping(
        { fromFrame: 205, durationInFrames: 60, exclusive: 'lower-third', footprint: [0.0, 0.7, 0.2, 0.2] },
        { fromFrame: 215, durationInFrames: 60, exclusive: 'lower-third', footprint: [0.6, 0.7, 0.2, 0.2] },
      ),
    );
    expect(codes).not.toContain('E-C4-01');
    expect(codes).not.toContain('W-C4-01');
  });

  it('时间不重叠 → 不判（时间重叠是常态，只有空间冲突才仲裁）', () => {
    const codes = codesOf(
      overlapping(
        { fromFrame: 205, durationInFrames: 40, exclusive: 'g', footprint: [0.1, 0.7, 0.3, 0.2] },
        { fromFrame: 400, durationInFrames: 40, exclusive: 'g', footprint: [0.1, 0.7, 0.3, 0.2] },
      ),
    );
    expect(codes).not.toContain('E-C4-01');
  });

  it('#5 主从冲突（载体类 × 叠加类）自动放行，由 scope 枚举推导', () => {
    const codes = codesOf({
      tracks: [
        makeTrack('bg', 5, [makeItem({ motion: CARRIER, fromFrame: 205, durationInFrames: 100, footprint: [0, 0, 1, 1] })]),
        makeTrack('fg', 60, [makeItem({ fromFrame: 215, durationInFrames: 60, footprint: [0.1, 0.1, 0.3, 0.3] })]),
      ],
    });
    expect(codes).not.toContain('E-C4-01');
    expect(codes).not.toContain('W-C4-01');
  });

  it('#11 声明 footprintAnimates → 同组相交降级为 warning W-C3-02', () => {
    const codes = codesOf(
      overlapping(
        { fromFrame: 205, durationInFrames: 60, exclusive: 'g', footprint: [0.1, 0.7, 0.3, 0.2], footprintAnimates: true },
        { fromFrame: 215, durationInFrames: 60, exclusive: 'g', footprint: [0.15, 0.72, 0.3, 0.2] },
      ),
    );
    expect(codes).toContain('W-C3-02');
    expect(codes).not.toContain('E-C4-01');
  });
});

describe('#6 最小可见时长 E-C3-01', () => {
  it('低于模板 minVisibleInFrames → error', () => {
    // kinetic-line@1.0 的 minVisibleInFrames = 30
    expect(codesOf({ tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 105, durationInFrames: 29 })])] }))
      .toContain('E-C3-01');
  });

  it('恰好等于下限 → 通过', () => {
    expect(codesOf({ tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 105, durationInFrames: 30 })])] }))
      .not.toContain('E-C3-01');
  });

  it('不同模板下限不同（图形类可远短于文字类）', () => {
    // transition/whip-pan@1.0 的 minVisibleInFrames = 10
    expect(codesOf({ tracks: [makeTrack('a', 100, [makeItem({ motion: FULLSCREEN, fromFrame: 105, durationInFrames: 12, footprint: [0, 0, 1, 1] })])] }))
      .not.toContain('E-C3-01');
  });
});

describe('#7 词级边界 W-C3-01', () => {
  it('起点恰好落在词 startFrame → warning', () => {
    // makeWords: 100 + 20i
    expect(codesOf({ tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 140, durationInFrames: 60 })])] }))
      .toContain('W-C3-01');
  });

  it('非边界 → 不报', () => {
    expect(codesOf({ tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 141, durationInFrames: 60 })])] }))
      .not.toContain('W-C3-01');
  });
});

describe('#8 跨越 subject-transform 裁切边界 E-C3-02', () => {
  it('骑跨端点 → error', () => {
    const codes = codesOf({
      tracks: [
        makeTrack('bg', 5, [makeItem({ motion: CARRIER, fromFrame: 401, durationInFrames: 100, footprint: [0.5, 0, 0.5, 1] })]),
        makeTrack('fg', 60, [makeItem({ fromFrame: 391, durationInFrames: 30 })]),
      ],
    });
    expect(codes).toContain('E-C3-02');
  });

  it('完全落在裁切段内 → 不报', () => {
    const codes = codesOf({
      tracks: [
        makeTrack('bg', 5, [makeItem({ motion: CARRIER, fromFrame: 401, durationInFrames: 100, footprint: [0.5, 0, 0.5, 1] })]),
        makeTrack('fg', 60, [makeItem({ fromFrame: 421, durationInFrames: 30 })]),
      ],
    });
    expect(codes).not.toContain('E-C3-02');
  });
});

describe('#9 接力 gap W-C5-01', () => {
  it('gap > 1.5s → warning', () => {
    const codes = codesOf({
      tracks: [
        makeTrack('a', 60, [makeItem({ fromFrame: 201, durationInFrames: 100 })], 'b'),
        makeTrack('b', 61, [makeItem({ fromFrame: 401, durationInFrames: 60 })]),
      ],
    });
    expect(codes).toContain('W-C5-01');
  });

  it('gap ≤ 1.5s（45 帧）→ 不报', () => {
    const codes = codesOf({
      tracks: [
        makeTrack('a', 60, [makeItem({ fromFrame: 201, durationInFrames: 100 })], 'b'),
        makeTrack('b', 61, [makeItem({ fromFrame: 346, durationInFrames: 60 })]),
      ],
    });
    expect(codes).not.toContain('W-C5-01');
  });
});

describe('#10 composition 尾部截断 E-C6-01', () => {
  it('结束帧超出成片总时长 → error（不可省）', () => {
    expect(codesOf({
      tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 881, durationInFrames: 60 })])],
      durationInFrames: 900,
    })).toContain('E-C6-01');
  });

  it('恰好贴到末帧 → 通过', () => {
    expect(codesOf({
      tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 841, durationInFrames: 59 })])],
      durationInFrames: 900,
    })).not.toContain('E-C6-01');
  });
});

/**
 * 🔴 遮挡类测试必须用「声明遮挡主体」的 motion（2026-10-15）。
 *
 * `collectHits` 按 `occludesSubject` 过滤，而默认 motion
 * `kinetic-line` 声明 `false` ⇒ 它压根不会进入遮挡判定。
 * 首批 10 个模板里声明 `true` 的 3 个全是载体类/fullscreen，
 * 又被 scope 规则排除 ⇒ 实测 **0/10 能触发遮挡判定**。
 * 故此处用测试夹具 `makeOccludingItem`（overlay-safe + occludesSubject:true）。
 * 详见 `_ctx.ts` 的说明与登记册待裁决 D-A。
 */
describe('#12 / #13 遮挡预算与三级退让', () => {
  const faceRegion = (box: [number, number, number, number]) => [
    { id: 'face-1', kind: 'face' as const, shotId: 's1', fromFrame: 100, durationInFrames: 200, box },
  ];

  it('#13 挪不动且无载体映射 → E-D4-01（三级退让无法启动）', () => {
    expect(codesOf({
      tracks: [makeTrack('a', 60, [makeOccludingItem({ fromFrame: 111, durationInFrames: 60, footprint: [0.2, 0.2, 0.6, 0.6] })])],
      regions: faceRegion([0.2, 0.2, 0.6, 0.6]),
    })).toContain('E-D4-01');
  });

  it('退让成功（挪开 footprint 完全避开 0% 预算的人脸区）→ 不报错', () => {
    expect(codesOf({
      tracks: [makeTrack('a', 60, [makeOccludingItem({ fromFrame: 111, durationInFrames: 60, footprint: [0.4, 0.4, 0.2, 0.2] })])],
      regions: faceRegion([0.4, 0.4, 0.2, 0.2]),
    })).not.toContain('E-D4-01');
  });

  it('人脸预算为 0：只要还有重叠就退让不成功 → E-D4-01', () => {
    expect(codesOf({
      tracks: [makeTrack('a', 60, [makeOccludingItem({ fromFrame: 111, durationInFrames: 60, footprint: [0.02, 0.02, 0.3, 0.3] })])],
      regions: faceRegion([0.02, 0.02, 0.3, 0.3]),
    })).toContain('E-D4-01');
  });

  it('#12 已声明载体但区域几乎占满画面 → E-D2-01（退路不够）', () => {
    // 🔴 载体档**逐 item 声明**（D4-t2）：声明在 item 上，不再有按 motion 索引的全局表。
    expect(codesOf({
      tracks: [
        makeTrack('a', 60, [
          makeOccludingItem({
            fromFrame: 111,
            durationInFrames: 60,
            footprint: [0, 0, 1, 1],
            carrier: carrierOf(),
          }),
        ]),
      ],
      regions: faceRegion([0, 0, 1, 1]),
    })).toContain('E-D2-01');
  });

  it('🔴 声明 occludesSubject:false 的 motion 不进遮挡判定（字段确实被消费）', () => {
    // 这条是 2026-10-15 补消费的正向证据：同样的几何，改用默认 motion
    // （kinetic-line，声明 false）就**不报** E-D4-01。
    // 若此用例将来挂了，说明 collectHits 又退回不读该字段。
    expect(codesOf({
      tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 111, durationInFrames: 60, footprint: [0.2, 0.2, 0.6, 0.6] })])],
      regions: faceRegion([0.2, 0.2, 0.6, 0.6]),
    })).not.toContain('E-D4-01');
  });
});

describe('#14 B-roll 主体遮挡 E-D2-02', () => {
  it('超过 30% 预算且无退路 → E-D2-02', () => {
    expect(codesOf({
      tracks: [
        makeTrack('a', 60, [
          makeOccludingItem({
            fromFrame: 111,
            durationInFrames: 60,
            footprint: [0, 0, 1, 1],
            carrier: carrierOf(),
          }),
        ]),
      ],
      regions: [{ id: 'broll-1', kind: 'broll', shotId: 's1', fromFrame: 100, durationInFrames: 200, box: [0, 0, 1, 1] }],
    })).toContain('E-D2-02');
  });
});

describe('D3 fullscreen 需人工确认 W-D3-01', () => {
  it('存在 fullscreen motion → warning，且不进遮挡预算', () => {
    const r = runValidation(
      makeCtx({
        // `params: {}` 显式覆盖 makeItem 的默认 —— whip-pan 未声明 text，
        // 用默认值会把无关的 E-P1-01 带进来
        tracks: [makeTrack('fs', 100, [makeItem({ motion: FULLSCREEN, fromFrame: 111, durationInFrames: 40, footprint: [0, 0, 1, 1], params: {} })])],
        regions: [{ id: 'face-1', kind: 'face', shotId: 's1', fromFrame: 100, durationInFrames: 200, box: [0, 0, 1, 1] }],
      }),
    );
    const codes = r.items.map((i) => i.code);
    expect(codes).toContain('W-D3-01');
    expect(codes).not.toContain('E-D2-01');
    expect(codes).not.toContain('E-D4-01');
    expect(r.ok).toBe(true);
  });
});

describe('F6 主体未确 W-F6-01（唯一语义为「不阻断」的码）', () => {
  it('shot 标 lowConfidence → warning，ok 仍为 true', () => {
    const r = runValidation(
      makeCtx({
        shots: [{ id: 's1', fromFrame: 0, durationInFrames: 300, safeArea: null, lowConfidence: true }],
      }),
    );
    expect(r.items.map((i) => i.code)).toContain('W-F6-01');
    expect(r.ok).toBe(true);
  });
});

describe('禁配段 E-E5-01（SPEC §1.4 / E5）', () => {
  it('motion 与 noMotionRanges 相交 → error', () => {
    const codes = codesOf({
      tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 111, durationInFrames: 60 })])],
      noMotionRanges: [{ fromFrame: 150, durationInFrames: 60, reason: '片头实拍空镜' }],
    });
    expect(codes).toContain('E-E5-01');
  });

  it('不相交 → 不报', () => {
    const codes = codesOf({
      tracks: [makeTrack('a', 60, [makeItem({ fromFrame: 111, durationInFrames: 30 })])],
      noMotionRanges: [{ fromFrame: 400, durationInFrames: 60, reason: '空镜' }],
    });
    expect(codes).not.toContain('E-E5-01');
  });
});

describe('词表与 cue 的联动', () => {
  it('makeWords 生成的词按 20 帧等距排列', () => {
    const w = makeWords(3, 100);
    expect(w.map((x) => x.startFrame)).toEqual([100, 120, 140]);
  });
});
