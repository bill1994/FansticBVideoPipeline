/**
 * 节奏表（pacing）—— 信号检测与整表构建（P1，2026-10-20）。
 *
 * 对应规格：`docs/decisions/OPEN-DECISIONS.md` 的 B1 与 team-lead 的 P1 规格。
 * 这一组测试钉的是**判据口径**：词表 / 正则 / 字数比较，且全表可复现。
 */

import { describe, expect, it } from 'vitest';
import { RHYTHM } from '../src/core/config.ts';
import {
  carrierDisplayRect,
  readCarrierRatio,
  readCarrierSide,
} from '../src/core/carrier-window.ts';
import {
  buildRepeatedTerms,
  buildRhythmTable,
  countChars,
  cueTerms,
  detectSignals,
} from '../src/core/rhythm.ts';
import { generateMotionboard } from '../src/core/rhythm-rules.ts';
import { bindMotionboard } from '../src/core/motionboard.ts';
import type { Cue, PerceiveRegion, RhythmTable } from '../src/core/types.ts';
import { rectArea, rectOverlapArea } from '../src/validate/context.ts';

function cue(index: number, fromFrame: number, toFrame: number, text: string): Cue {
  return { index, fromFrame, toFrame, text };
}

/** 一段中性文本：不含任何词表命中的字，作为反例基线。 */
const NEUTRAL = '这个方法很好用';

describe('detectSignals —— 10 个信号的正例与反例', () => {
  const signalsOf = (text: string, prev: Cue | null = null, ctx = {}) =>
    detectSignals(cue(0, 0, 60, text), prev, ctx);

  it('turn：转折词', () => {
    expect(signalsOf('但是这个方法很好用')).toContain('turn');
    expect(signalsOf(NEUTRAL)).not.toContain('turn');
  });

  it('🔴 信号词在句末（其后不足 2 字）→ 依赖上文的信号不命中', () => {
    // demo cue3 原文：转折词被 SRT 切在句末，属于下一句，本句不该命中
    const tail = '主体位置最后渲染出片整个流程接近全自动但';
    expect(signalsOf(tail)).not.toContain('turn');
    // 定义词 / 收束词同理
    expect(signalsOf('这叫做')).not.toContain('definition');
    expect(signalsOf('总之')).not.toContain('closing');
    // cause-effect 同理
    expect(signalsOf('因为')).not.toContain('cause-effect');
  });

  it('contrast：否定 / 对比词', () => {
    expect(signalsOf('这件事没那么简单')).toContain('contrast');
    expect(signalsOf(NEUTRAL)).not.toContain('contrast');
  });

  it('enum：列举词', () => {
    expect(signalsOf('首先是准备素材')).toContain('enum');
    expect(signalsOf(NEUTRAL)).not.toContain('enum');
  });

  it('question：问号收尾或疑问词', () => {
    expect(signalsOf('这样真的好吗？')).toContain('question');
    expect(signalsOf('你知道吗')).toContain('question');
    expect(signalsOf('为什么要这样做')).toContain('question');
    expect(signalsOf(NEUTRAL)).not.toContain('question');
  });

  it('number：阿拉伯数字或中文数量词', () => {
    expect(signalsOf('大概有3个步骤')).toContain('number');
    expect(signalsOf('效率提升三倍')).toContain('number');
    expect(signalsOf('增长了百分之三十')).toContain('number');
    expect(signalsOf('成功了五成')).toContain('number');
    expect(signalsOf('一共两万')).toContain('number');
    // 「一些」不是数量（parseCnNumber 的负例），不能误命中
    expect(signalsOf('说一些话')).not.toContain('number');
    expect(signalsOf(NEUTRAL)).not.toContain('number');
  });

  it('short-after-long：本条字数 ≤ 前条一半且前条 ≥12 字', () => {
    const prev = cue(0, 0, 60, '这是一个非常长的前置句子用来做比较基准');
    expect(signalsOf('很短', prev)).toContain('short-after-long');
    // 无前条 → 不判
    expect(signalsOf('很短', null)).not.toContain('short-after-long');
    // 前条 8 字（<12）→ 不判
    const shortPrev = cue(0, 0, 60, '一二三四五六七八');
    expect(signalsOf('很短', shortPrev)).not.toContain('short-after-long');
  });

  it('closing：末条标记或收束词', () => {
    expect(signalsOf('总之要记住这一点')).toContain('closing');
    expect(signalsOf(NEUTRAL, null, { isLast: true })).toContain('closing');
    expect(signalsOf(NEUTRAL)).not.toContain('closing');
  });

  it('definition：定义句式', () => {
    expect(signalsOf('这叫做强制对齐')).toContain('definition');
    expect(signalsOf(NEUTRAL)).not.toContain('definition');
  });

  it('cause-effect：因果词', () => {
    expect(signalsOf('因为这样所以更好')).toContain('cause-effect');
    expect(signalsOf(NEUTRAL)).not.toContain('cause-effect');
  });

  it('repetition：全片复现词（由 buildRepeatedTerms 回填）', () => {
    expect(signalsOf(NEUTRAL, null, { repeatedTerms: ['动效'] })).toContain('repetition');
    expect(signalsOf(NEUTRAL)).not.toContain('repetition');
  });

  it('信号顺序稳定（与选型表同序）且不重复', () => {
    const s = signalsOf('但是如果不要做3个步骤，为什么要这样？');
    expect(s).toEqual([...new Set(s)]);
    expect(s.slice(0, 3)).toEqual(['turn', 'contrast', 'question']);
  });
});

describe('short-after-long 的边界（前条 11 字 vs 12 字）', () => {
  const prev11 = cue(0, 0, 60, '一二三四五六七八九十百'); // 11 个可数汉字
  const prev12 = cue(0, 0, 60, '一二三四五六七八九十百千'); // 12 个
  const cur5 = cue(1, 60, 120, '一二三四五'); // 5 字

  it('字数口径：标点与空白不计', () => {
    expect(countChars(prev11.text)).toBe(11);
    expect(countChars(prev12.text)).toBe(12);
    expect(countChars('一，二 三！')).toBe(3);
  });

  it('前条 11 字 → 不触发（门槛是 ≥12 字）', () => {
    expect(detectSignals(cur5, prev11)).not.toContain('short-after-long');
  });

  it('前条 12 字且本条 ≤ 6 字 → 触发', () => {
    // 5 ≤ 12 * 0.5 = 6
    expect(detectSignals(cur5, prev12)).toContain('short-after-long');
  });

  it('前条 12 字但本条 7 字 → 不触发（7 > 6）', () => {
    const cur7 = cue(1, 60, 120, '一二三四五六七');
    expect(detectSignals(cur7, prev12)).not.toContain('short-after-long');
  });
});

describe('buildRepeatedTerms —— 全片词频统计', () => {
  it('同一句内去重：单句重复不算跨 cue 复现', () => {
    const terms = cueTerms('动效动效动效');
    expect(terms.filter((t) => t === '动效')).toHaveLength(1);
  });

  it('某词在 ≥3 条 cue 中出现才算复现', () => {
    const cues = [
      cue(0, 0, 30, '叠加动效图层'),
      cue(1, 30, 60, '动效要自然'),
      cue(2, 60, 90, '这里的动效不错'),
      cue(3, 90, 120, '别的话'),
    ];
    const repeated = buildRepeatedTerms(cues);
    expect(repeated[0]).toContain('动效');
    expect(repeated[1]).toContain('动效');
    expect(repeated[2]).toContain('动效');
    expect(repeated[3]).not.toContain('动效');
  });

  it('只出现 2 条 cue → 不算复现', () => {
    const cues = [cue(0, 0, 30, '动效图层'), cue(1, 30, 60, '动效要自然')];
    expect(buildRepeatedTerms(cues).flat()).not.toContain('动效');
  });
});

describe('buildRhythmTable —— 门槛与快照', () => {
  it('meta 记录 fps / mode / version', () => {
    const table = buildRhythmTable([cue(0, 0, 60, '这是一句话')], 30, 'aligned');
    expect(table.meta).toEqual({ fps: 30, mode: 'aligned', version: '1.0' });
  });

  it(`< ${RHYTHM.minCueFramesForMotion} 帧 → skipped:'too-short'（即便信号很强）`, () => {
    // 9 帧 < 10；文本含数字（强信号），若不看门槛本会配 stat-card
    const table = buildRhythmTable([cue(0, 0, 9, '这里有3个要点')], 30, 'aligned');
    const row = table.cues[0]!;
    expect(row.decide).toBe('none');
    expect(row.skipped).toBe('too-short');
    expect(row.motion).toBeUndefined();
    expect(row.signal).toEqual([]);
    expect(row.reason).toContain('门槛');
  });

  it('恰好 = 门槛（10 帧）→ 不因门槛跳过，而是进入模板门控', () => {
    const table = buildRhythmTable([cue(0, 0, 10, '这里有3个要点')], 30, 'aligned');
    const row = table.cues[0]!;
    expect(row.skipped).not.toBe('too-short');
    // 10 帧比所有候选模板的下限都短 ⇒ 最终是 no-template-fits
    expect(row.skipped).toBe('no-template-fits');
  });

  it('12 帧 + 无短模板 → skipped:no-template-fits', () => {
    // closing 是强信号，首选 center-emphasis（30 帧）→ 兜底 kinetic-line（30 帧）也不够
    const table = buildRhythmTable([cue(0, 0, 12, '总之记住这一点')], 30, 'aligned');
    const row = table.cues[0]!;
    expect(row.decide).toBe('none');
    expect(row.skipped).toBe('no-template-fits');
  });

  it('fromFrame / durationInFrames 原样抄 cue 区间（快照，不推导）', () => {
    const table = buildRhythmTable([cue(3, 320, 448, '这里有一句话')], 30, 'aligned');
    expect(table.cues[0]!.cueIndex).toBe(3);
    expect(table.cues[0]!.fromFrame).toBe(320);
    expect(table.cues[0]!.durationInFrames).toBe(128);
  });

  it('确定性：同一输入两次构建逐字节一致', () => {
    const cues = [cue(0, 0, 90, '首先这样做'), cue(1, 90, 180, '因为所以')];
    expect(JSON.stringify(buildRhythmTable(cues, 30, 'aligned'))).toBe(
      JSON.stringify(buildRhythmTable(cues, 30, 'aligned')),
    );
  });
});

describe('generateMotionboard → bindMotionboard —— 字幕恒在，MG 只按节奏表', () => {
  /** 生成 → 绑定（等价于 storyboard 阶段对底稿做的事）。 */
  function genAndBind(cues: Cue[], regions: PerceiveRegion[] = []) {
    const table = buildRhythmTable(cues, 30, 'aligned');
    const board = generateMotionboard(table, cues, { fps: 30, alignmentConfidence: 0.9 });
    return bindMotionboard(board, {
      cues,
      words: [],
      source: { fps: 30, alignmentConfidence: 0.9 },
      regions,
    });
  }

  it('每条 cue 都有一条 caption item（含 <门槛 的短 cue）', () => {
    const cues = [
      cue(0, 0, 9, '这里有3个要点'), // too-short，但字幕必须有
      cue(1, 9, 129, '但这一步别再拖了'), // turn + contrast，120 帧
      cue(2, 129, 141, '结束语'), // 末条 closing，但 13 帧无模板可用 → no-fits
    ];
    const { draft, report } = genAndBind(cues);

    const caption = draft.tracks.find((t) => t.id === 'caption')!;
    const motion = draft.tracks.find((t) => t.id === 'motion')!;

    expect(caption.layer).toBe(90);
    expect(motion.layer).toBe(60);
    expect(caption.items).toHaveLength(3);
    expect(caption.items.map((i) => i.motion)).toEqual([
      'caption/karaoke-word@1.0',
      'caption/karaoke-word@1.0',
      'caption/karaoke-word@1.0',
    ]);
    expect(caption.items.map((i) => i._author!.anchor)).toEqual(['cue:0', 'cue:1', 'cue:2']);

    // 短 cue 不产 MG；末条 13 帧也不产 —— 但这在**表级**就定了（decide=none +
    // skipped: 'no-template-fits'），绑定器 noFits 恒 0（它只对手写 intent 负责）
    expect(motion.items).toHaveLength(1);
    expect(motion.items[0]!._author!.anchor).toBe('cue:1');
    expect(motion.items[0]!.motion).toBe('typography/kinetic-line@1.0');
    expect(report.noFits).toBe(0);
  });

  it('调度分：caption 1.0 / 绑定意图首选 0.85，confidence 恒 1.0（规则置信度）', () => {
    const cues = [cue(0, 0, 90, '这里有3个要点')];
    const { draft } = genAndBind(cues);
    expect(draft.tracks[0]!.items[0]!.sim_max).toBe(1);
    expect(draft.tracks[0]!.items[0]!.confidence).toBe(1);
    const mg = draft.tracks[1]!.items[0]!;
    expect(mg.sim_max).toBe(0.85);
    expect(mg.confidence).toBe(1);
  });

  it('footprint 直接取模板声明（不自造坐标）', () => {
    const cues = [cue(0, 0, 90, '这里有3个要点')];
    const { draft } = genAndBind(cues);
    // 与 templates/builtin.ts 的声明一致
    expect(draft.tracks[0]!.items[0]!.footprint).toEqual([0.1, 0.86, 0.8, 0.1]);
    expect(draft.tracks[1]!.items[0]!.footprint).toEqual([0.62, 0.12, 0.32, 0.24]);
  });

  it('节奏表与 cue 数量不一致 → 抛 ConfigError（必须同源）', () => {
    const table = buildRhythmTable([cue(0, 0, 90, '一句话')], 30, 'aligned');
    expect(() =>
      generateMotionboard(table, [cue(0, 0, 90, '一句话'), cue(1, 90, 180, '两句')], {
        fps: 30,
        alignmentConfidence: 0.9,
      }),
    ).toThrow(/必须用同一份/);
  });

  // 🔴 区域感知载体退路（E-D4-01 修复）的行为测试已随意图层迁移：
  //   tests/motionboard.test.ts「face 预算 0% → carrier 退路」覆盖同一链路
  //   （生成器→绑定器继承 carrierRouteForSpan），fixture 与断言口径不变。
});
