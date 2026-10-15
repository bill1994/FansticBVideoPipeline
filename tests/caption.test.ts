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
  EMPTY_CAPTION,
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
    const d = toCaptionData({ words: WORDS, cues: [] });
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
    expect(wordsInWindow({ words: WORDS, cues: [] }, 100, 60)).toHaveLength(3);
  });

  it('窗口切在词中间时，边缘的词仍被保留（不能缺字）', () => {
    const got = wordsInWindow({ words: WORDS, cues: [] }, 110, 20);
    // 窗口 [110,130)：word0(100-119) 相交、word1(120-139) 相交、word2 不相交
    expect(got.map((x) => x.index)).toEqual([0, 1]);
  });

  it('窗口与所有词不相交时返回空', () => {
    expect(wordsInWindow({ words: WORDS, cues: [] }, 0, 10)).toHaveLength(0);
  });

  it('零时长窗口不会误取大量词', () => {
    // 边界用例：duration=0 时窗口是空区间，应几乎取不到东西
    expect(wordsInWindow({ words: WORDS, cues: [] }, 100, 0)).toHaveLength(0);
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
  const data = { words: WORDS, cues };

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