/**
 * `M-1f` 的测试：铺词 / 覆盖率口径 / 静音判据 / SRT↔音频一致性校验。
 *
 * 🔴 本文件的核心价值是**口径断言** —— 项目里已因「同一个指标两个数法」
 * 吃过亏（占位值 8 vs 7 vs 3、覆盖率 8 条 vs 实测 14 条）。
 * 所以每个数字都断言它来自哪个函数、哪个分母。
 */

import { describe, expect, it } from 'vitest';
import {
  REWEIGH_COVERAGE_MIN,
  checkSrtAudioAgreement,
  cueWords,
  reweighByCharWeight,
  silentWordRatio,
  wordCoverage,
  wordsForCue,
} from '../src/core/word-timeline.ts';
import { parseSilences } from '../src/core/silence.ts';
import type { Cue, WordTimestamp } from '../src/core/types.ts';

const FPS = 60;

function w(word: string, startFrame: number, endFrame: number, cueIndex = 0): WordTimestamp {
  return { word, startFrame, endFrame, confidence: 1, index: 0, cueIndex } as WordTimestamp;
}

function cue(p: Partial<Cue> & { index: number }): Cue {
  return {
    fromFrame: 0,
    toFrame: 100,
    text: 'x',
    ...p,
  } as Cue;
}

describe('cueWords —— 按词落点归属', () => {
  it('取落点落在 [fromFrame-1, toFrame+1] 的词，顺序保持朗读序', () => {
    const c = cue({ index: 0, fromFrame: 0, toFrame: 100 });
    const words = [w('a', 0, 20), w('b', 50, 70), w('c', 200, 220)];
    expect(cueWords(c, words).map((x) => x.word)).toEqual(['a', 'b']);
  });

  it('边界 ±1 帧容差生效', () => {
    const c = cue({ index: 0, fromFrame: 10, toFrame: 100 });
    // 恰好在 fromFrame-1 上：应被收
    expect(cueWords(c, [w('x', 9, 9)]).length).toBe(1);
    // 差 2 帧：应被弃
    expect(cueWords(c, [w('x', 8, 8)]).length).toBe(0);
  });
});

describe('wordCoverage —— 🔴 口径必须写清', () => {
  it('分母是「归属于本 cue 的词数」，不是窗口内词数', () => {
    // 2 个词归属本 cue，其中 1 个落在窗口内⇒ 覆盖率 0.5
    const c = cue({
      index: 0,
      fromFrame: 0,
      toFrame: 120,
      srtFromSec: 0,
      srtToSec: 1, // 0–60 帧
    });
    const words = [w('in', 10, 20), w('out', 100, 110)];
    expect(cueWords(c, words).length).toBe(2);
    expect(wordCoverage(c, words, FPS)).toBeCloseTo(0.5, 5);
  });

  it('缺 srtFromSec/srtToSec 时返回 1（视为可信，不触发重铺）', () => {
    const c = cue({ index: 0, fromFrame: 0, toFrame: 120 });
    expect(wordCoverage(c, [w('a', 999, 1000)], FPS)).toBe(1);
  });

  it('本 cue 无词时返回 0', () => {
    const c = cue({ index: 0, fromFrame: 0, toFrame: 10, srtFromSec: 0, srtToSec: 1 });
    expect(wordCoverage(c, [], FPS)).toBe(0);
  });

  it('±2 帧容差：SRT 换算的帧允许抖动', () => {
    const c = cue({
      index: 0, fromFrame: 0, toFrame: 120, srtFromSec: 0, srtToSec: 1,
    });
    // 窗口 0–60 帧，词起点 62 帧，超出但容差 2 帧内⇒ 仍算在内
    expect(wordCoverage(c, [w('a', 62, 70)], FPS)).toBe(1);
    // 起点 80 帧，超出容差 ⇒ 0
    expect(wordCoverage(c, [w('a', 80, 90)], FPS)).toBe(0);
  });
});

describe('reweighByCharWeight —— 按字数权重的铺词', () => {
  it('窗口被完整填满，不留缝', () => {
    const out = reweighByCharWeight([w('一', 0, 0), w('二', 0, 0)], 0, 100);
    expect(out[0]!.startFrame).toBe(0);
    expect(out[out.length - 1]!.endFrame).toBe(100);
    // 相邻词首尾相接
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.startFrame).toBe(out[i - 1]!.endFrame + 1);
    }
  });

  it('长词分到更长时间（字数权重）', () => {
    const out = reweighByCharWeight([w('ab', 0, 0), w('一', 0, 0)], 0, 100);
    const lenA = out[0]!.endFrame - out[0]!.startFrame + 1;
    const lenB = out[1]!.endFrame - out[1]!.startFrame + 1;
    expect(lenA).toBeGreaterThan(lenB);
  });

  it('零长窗口不崩（span至少 1）', () => {
    const out = reweighByCharWeight([w('a', 0, 0)], 50, 50);
    expect(out[0]!.startFrame).toBe(50);
  });
});

describe('wordsForCue —— 阈值两侧行为', () => {
  const bad = cue({
    index: 0, fromFrame: 0, toFrame: 600, srtFromSec: 1, srtToSec: 2,
  });

  it(`覆盖率 <${REWEIGH_COVERAGE_MIN} 时重铺回 SRT 窗口`, () => {
    // 词落点在0–100 帧，而 SRT 窗口是 60–120 帧 ⇒ 覆盖率 0
    const out = wordsForCue(bad, [w('甲', 0, 30), w('乙', 40, 70)], FPS, true);
    expect(out[0]!.startFrame).toBeGreaterThanOrEqual(60);
    expect(out[out.length - 1]!.endFrame).toBeLessThanOrEqual(120);
  });

  it('apply=false 时不重铺（只判断）', () => {
    const src = [w('甲', 0, 30), w('乙', 40, 70)];
    const out = wordsForCue(bad, src, FPS, false);
    expect(out[0]!.startFrame).toBe(0);
  });

  it('覆盖率达标时**不动**原词（好数据不被修坏）', () => {
    const good = cue({
      index: 0, fromFrame: 0, toFrame: 120, srtFromSec: 0, srtToSec: 2,
    });
    const words = [w('a', 10, 30), w('b', 40, 60)];
    const out = wordsForCue(good, words, FPS, true);
    expect(out.map((x) => [x.startFrame, x.endFrame])).toEqual([
      [10, 30], [40, 60],
    ]);
  });

  it('cue 为 null 时原样返回', () => {
    const words = [w('a', 1, 2)];
    expect(wordsForCue(null, words, FPS, true)).toBe(words);
  });

  it('无归属词时原样返回（不制造空高亮）', () => {
    const words = [w('a', 5000, 5100)];
    expect(wordsForCue(cue({ index: 0, fromFrame: 0, toFrame: 10 }), words, FPS, true)).toBe(words);
  });

  it('重铺不改词的文本与顺序', () => {
    const src = [w('甲', 0, 30), w('乙', 40, 70), w('丙', 80, 90)];
    const out = wordsForCue(bad, src, FPS, true);
    expect(out.map((x) => x.word)).toEqual(['甲', '乙', '丙']);
  });
});

describe('silentWordRatio —— M-1d 判据', () => {
  it('无静音时为 0', () => {
    expect(silentWordRatio([w('a', 0, 60)], [], FPS)).toBe(0);
  });

  it('无词时为 0', () => {
    expect(silentWordRatio([], [[0, 10]], FPS)).toBe(0);
  });

  it('全部词在静音内时为 1', () => {
    // 词 0–60 帧 = 0–1s，静音 0–2s
    expect(silentWordRatio([w('a', 0, 60)], [[0, 2]], FPS)).toBe(1);
  });

  it('部分在静音内：按**时长**加权而非按个数', () => {
    // w1 在 0–60 帧(1s, 静音内), w2 在 120–600 帧(8s, 静音外)
    const r = silentWordRatio([w('a', 0, 60), w('b', 120, 600)], [[0, 1.5]], FPS);
    expect(r).toBeCloseTo(1 / 9, 3);
  });

  it('与静音区间仅端点相接不算命中', () => {
    // 词 60–120 帧(1–2s)，静音 0–1s ⇒ 不重叠
    expect(silentWordRatio([w('a', 60, 120)], [[0, 1]], FPS)).toBe(0);
  });
});

describe('checkSrtAudioAgreement —— M-1f Q2', () => {
  it('无静音时返回 null（不校验）', () => {
    expect(checkSrtAudioAgreement([], [])).toBeNull();
  });

  it('SRT 与长静音吻合时返回 null', () => {
    const cues = [cue({ index: 0, srtFromSec: 0, srtToSec: 8 })]; // 结束于 8s
    // 静音 8.39–15.13
    expect(checkSrtAudioAgreement(cues, [[8.39, 15.13]])).toBeNull();
  });

  it('SRT cue 压进长静音时报不吻合', () => {
    const cues = [cue({ index: 3, srtFromSec: 9, srtToSec: 17 })]; // 整条落在静音里
    const r = checkSrtAudioAgreement(cues, [[8.39, 15.13]]);
    expect(r).not.toBeNull();
    expect(r).toContain('cue#3');
  });

  it('短静音（句中换气）**不**报不吻合', () => {
    // 实测 kukini 有 0.53s/0.57s 的换气，不该被判为错位
    const cues = [cue({ index: 0, srtFromSec: 86.08, srtToSec: 88.6 })];
    expect(checkSrtAudioAgreement(cues, [[87.07, 87.6]])).toBeNull();
  });

  it('全部静音都短于阈值时返回 null（不制造噪声警告）', () => {
    const cues = [cue({ index: 0, srtFromSec: 10, srtToSec: 20 })];
    expect(checkSrtAudioAgreement(cues, [[10.1, 10.4]])).toBeNull();
  });

  it('重叠不足容差时不报', () => {
    // 静音 8.0–10.0（长），cue 只探进来 0.2s
    const cues = [cue({ index: 0, srtFromSec: 7.9, srtToSec: 8.2 })];
    expect(checkSrtAudioAgreement(cues, [[8.0, 10.0]])).toBeNull();
  });
});

describe('parseSilences —— ffmpeg 输出解析', () => {
  it('解析成对的 start/end', () => {
    const err = [
      '[Parsed_silencedetect_0 @ 0x1] silence_start: 8.389875',
      '[Parsed_silencedetect_0 @ 0x1] silence_end: 15.125438 | silence_duration: 6.735563',
    ].join('\n');
    expect(parseSilences(err)).toEqual([[8.389875, 15.125438]]);
  });

  it('多段', () => {
    const err = [
      'silence_start: 8.389875',
      'silence_end: 15.125438 | silence_duration: 6.735563',
      'silence_start: 87.067312',
      'silence_end: 87.597813 | silence_duration: 0.5305',
    ].join('\n');
    expect(parseSilences(err)).toHaveLength(2);
  });

  it('末尾只有 start 没有 end 时丢弃（宁可漏报不臆造）', () => {
    const err = 'silence_start: 100.0';
    expect(parseSilences(err)).toEqual([]);
  });

  it('乱序的 end 先于 start 时不产生区间', () => {
    const err = ['silence_end: 5.0', 'silence_start: 1.0', 'silence_end: 2.0'].join('\n');
    expect(parseSilences(err)).toEqual([[1, 2]]);
  });

  it('空输入返回空数组', () => {
    expect(parseSilences('')).toEqual([]);
  });
});