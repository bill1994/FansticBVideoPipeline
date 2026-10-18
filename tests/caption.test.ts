/**
 * 字幕数据通道的纯函数测试。
 *
 * 刻意与 `template-render.test.tsx` 分开：这里测**数据选取规则**
 * （纯函数，无 React），那边测**渲染产物**。
 * 混在一起会让「数据选错」与「画错了」两种失败难以区分。
 */

import { describe, expect, it } from 'vitest';
import {
  activeWordIndex,
  cueInWindow,
  EMPTY_CAPTION,
  highlightSpan,
  highlightWords,
  nextCueAt,
  toCaptionData,
  wordsInWindow,
} from '../src/remotion/caption.ts';
import type { Cue, WordTimestamp } from '../src/core/types.ts';

function w(index: number, start: number, end: number): WordTimestamp {
  return { index, word: `w${index}`, startFrame: start, endFrame: end, confidence: 0.9 };
}

const WORDS: WordTimestamp[] = [
  w(0, 100, 119),
  w(1, 120, 139),
  w(2, 140, 159),
];

describe('caption · toCaptionData 容错', () => {
  it('合法结构被接受', () => {
    const d = toCaptionData({ words: WORDS, cues: [], fps: 30 });
    expect(d.words).toHaveLength(3);
  });

  it('null / undefined / 非对象 → 空通道，不抛错', () => {
    for (const bad of [null, undefined, 42, 'x', true]) {
      expect(() => toCaptionData(bad)).not.toThrow();
      expect(toCaptionData(bad)).toEqual(EMPTY_CAPTION);
    }
  });

  it('结构不符的条目被剔除，合法条目保留', () => {
    const d = toCaptionData({
      words: [WORDS[0], { word: 123 }, null, { startFrame: 'x', endFrame: 1, word: 'y' }, WORDS[2]],
      cues: [],
    });
    expect(d.words.map((x) => x.index)).toEqual([0, 2]);
  });

  it('NaN / Infinity 时间戳被拒（会在插值里污染画面）', () => {
    const d = toCaptionData({
      words: [w(0, Number.NaN, 10), w(1, Number.POSITIVE_INFINITY, 20), w(2, 1, 2)],
      cues: [],
    });
    expect(d.words.map((x) => x.index)).toEqual([2]);
  });

  it('cues 结构校验同样生效', () => {
    const d = toCaptionData({ words: [], cues: [{ text: 'a', fromFrame: 1, toFrame: 2 }, { text: 5 }] });
    expect(d.cues).toHaveLength(1);
  });
});

describe('caption · wordsInWindow 取词', () => {
  it('完整覆盖时取全部', () => {
    expect(wordsInWindow({ words: WORDS, cues: [], fps: 30 }, 100, 60)).toHaveLength(3);
  });

  it('窗口切在词中间时，边缘的词仍被保留（不能缺字）', () => {
    const got = wordsInWindow({ words: WORDS, cues: [], fps: 30 }, 110, 20);
    // 窗口 [110,130)：word0(100-119) 相交、word1(120-139) 相交、word2 不相交
    expect(got.map((x) => x.index)).toEqual([0, 1]);
  });

  it('窗口与所有词不相交时返回空', () => {
    expect(wordsInWindow({ words: WORDS, cues: [], fps: 30 }, 0, 10)).toHaveLength(0);
  });

  it('零时长窗口不会误取大量词', () => {
    // 边界用例：duration=0 时窗口是空区间，应几乎取不到东西
    expect(wordsInWindow({ words: WORDS, cues: [], fps: 30 }, 100, 0)).toHaveLength(0);
  });
});

describe('caption · activeWordIndex 高亮判定', () => {
  it('帧落在词内 → 返回该词下标', () => {
    expect(activeWordIndex(WORDS, 110)).toBe(0);
    expect(activeWordIndex(WORDS, 130)).toBe(1);
    expect(activeWordIndex(WORDS, 150)).toBe(2);
  });

  it('帧落在词间空隙 → 高亮前面最近的词（不闪全暗）', () => {
    expect(activeWordIndex(WORDS, 119)).toBe(0);
    expect(activeWordIndex(WORDS, 139)).toBe(1);
  });

  it('帧在所有词之前 → -1', () => {
    expect(activeWordIndex(WORDS, 0)).toBe(-1);
  });

  it('帧在所有词之后 → 最后一个词', () => {
    expect(activeWordIndex(WORDS, 9999)).toBe(2);
  });

  it('空数组 → -1', () => {
    expect(activeWordIndex([], 100)).toBe(-1);
  });

  it('区间重叠时先到先得（取第一个）', () => {
    const overlap = [w(0, 100, 130), w(1, 120, 150)];
    expect(activeWordIndex(overlap, 125)).toBe(0);
  });

  it('纯函数：同输入同输出（服务端渲染与 Studio 预览必须一致）', () => {
    for (const f of [0, 99, 100, 110, 125, 160, 5000]) {
      expect(activeWordIndex(WORDS, f)).toBe(activeWordIndex(WORDS, f));
    }
  });
});

describe('caption · nextCueAt 取下一条 cue', () => {
  const cues: Cue[] = [
    { index: 0, fromFrame: 100, toFrame: 160, text: '第一条' },
    { index: 1, fromFrame: 200, toFrame: 260, text: '第二条' },
  ];
  const data = { words: WORDS, cues, fps: 30 };

  it('返回首个未开始的 cue', () => {
    expect(nextCueAt(data, 50)?.text).toBe('第一条');
    expect(nextCueAt(data, 150)?.text).toBe('第二条');
  });

  it('全部已过 → null', () => {
    expect(nextCueAt(data, 999)).toBeNull();
  });

  it('无 cue → null', () => {
    expect(nextCueAt(EMPTY_CAPTION, 10)).toBeNull();
  });
});
// ─────────────────────────────────────────────────────────────
// C2-6 补正：字幕的**时间**用 SRT、**文字**用 cue.text、词只负责高亮
//
// 起因：用户反馈「字幕拆开后不连贯」。实测那条 cue 早 7 秒出现在静音空镜上。
// 两层根因：① cue 帧区间取词落点（会漂）；② 组件用「窗口内的词」拼字幕
// ⇒ 时间一旦对齐到 SRT，拼出来的就是别的句子。
// ─────────────────────────────────────────────────────────────
describe('caption · cueInWindow（时序以 SRT 为准）', () => {
  const FPS = 30;
  // 同一个 cue：词落点说 0–60 帧，SRT 说 300–390 帧（差 10 秒，模拟漂移）
  const drifted: Cue = {
    index: 3,
    fromFrame: 0,
    toFrame: 60,
    text: '它把中底和外骨骼结合在了一起',
    srtFromSec: 10,
    srtToSec: 13,
  };
  const data = { words: WORDS, cues: [drifted], fps: FPS };

  it('按 SRT 秒定位：落在 SRT 区间内才命中', () => {
    expect(cueInWindow(data, 300, 90)?.index).toBe(3);
    // 词落点区间（0–60）**不再**让它命中 —— 否则字幕会早 10 秒冒出来
    expect(cueInWindow(data, 0, 60)).toBeNull();
  });

  it('没有 srt 字段时回退到词落点（demo / 外部对齐器兼容）', () => {
    const legacy: Cue = { index: 0, fromFrame: 100, toFrame: 160, text: '第一条' };
    const d = { words: WORDS, cues: [legacy], fps: FPS };
    expect(cueInWindow(d, 120, 20)?.index).toBe(0);
    expect(cueInWindow(d, 400, 20)).toBeNull();
  });

  it('无 cue → null（组件退回用词拼句的旧路径）', () => {
    expect(cueInWindow(EMPTY_CAPTION, 0, 100)).toBeNull();
  });
});

describe('caption · highlightSpan（在 SRT 原文里定位高亮词）', () => {
  const text = '它把中底和外骨骼结合在了一起';
  const words: WordTimestamp[] = [
    { index: 0, word: '它把', startFrame: 0, endFrame: 10, confidence: 1 },
    { index: 1, word: '中底', startFrame: 10, endFrame: 20, confidence: 1 },
    { index: 2, word: '和外骨骼', startFrame: 20, endFrame: 30, confidence: 1 },
  ];

  it('按顺序逐词定位，重复字也不会错位', () => {
    expect(highlightSpan(text, words, 1)).toEqual({ start: 2, end: 4 });
    expect(highlightSpan(text, words, 2)).toEqual({ start: 4, end: 8 });
  });

  it('词与原文对不上（对齐漂移）→ null，宁可整句不高亮', () => {
    const alien: WordTimestamp[] = [
      { index: 0, word: '完全不同的词', startFrame: 0, endFrame: 10, confidence: 1 },
    ];
    expect(highlightSpan(text, alien, 0)).toBeNull();
  });

  it('active 越界 → null', () => {
    expect(highlightSpan(text, words, -1)).toBeNull();
    expect(highlightSpan(text, words, 9)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 高亮词的重分配（词落点漂了，但顺序与归属可信）
//
// 背景：whisper 把跨静音的文本压进一个长分段，9 个词被放进 6.74 秒真静音里
// （-ml/-sow 都改不动）。字幕内容已按 SRT 修好，但**高亮**仍缺 ——
// 这里按「顺序 + 字数权重」把词重铺回该 cue 的 SRT 窗口，只影响高亮定位。
// ─────────────────────────────────────────────────────────────
describe('caption · highlightWords（漂移时按 SRT 窗口重铺）', () => {
  const FPS = 30;
  const words: WordTimestamp[] = [
    { index: 0, word: '它把', startFrame: 0, endFrame: 20, confidence: 1 },
    { index: 1, word: '中底', startFrame: 20, endFrame: 40, confidence: 1 },
    { index: 2, word: '和外骨骼', startFrame: 40, endFrame: 60, confidence: 1 },
  ];

  it('覆盖率 < 0.8 → 重铺到 SRT 窗口内，且保持顺序、首尾对齐窗口', () => {
    const drifted: Cue = {
      index: 0,
      fromFrame: 0,
      toFrame: 60,
      text: '它把中底和外骨骼',
      srtFromSec: 10,
      srtToSec: 13,
    };
    const got = highlightWords(drifted, words, FPS);
    expect(got.map((w) => w.word)).toEqual(['它把', '中底', '和外骨骼']);
    expect(got[0]!.startFrame).toBe(300); // 10s × 30
    expect(got.at(-1)!.endFrame + 1).toBe(390); // 13s × 30
    // 单调不减：重铺不能打乱朗读顺序
    for (let i = 1; i < got.length; i += 1) {
      expect(got[i]!.startFrame).toBeGreaterThanOrEqual(got[i - 1]!.endFrame);
    }
  });

  it('覆盖率够（≥0.8）→ 原样返回，不把好数据"修"坏', () => {
    const good: Cue = {
      index: 0,
      fromFrame: 0,
      toFrame: 60,
      text: '它把中底和外骨骼',
      srtFromSec: 0,
      srtToSec: 2,
    };
    const got = highlightWords(good, words, FPS);
    expect(got.map((w) => w.startFrame)).toEqual([0, 20, 40]);
  });

  it('无 cue（旧数据）→ 原样返回传入的词', () => {
    expect(highlightWords(null, words, FPS)).toBe(words);
  });
});
