/**
 * `text-align.ts` 的测试。
 *
 * 样本**全部取自 2026-10-14 真实素材实测**（30s 中文口播 + 人工 SRT），
 * 不是编的 —— 编的样本测不出真实世界里的粒度不匹配。
 *
 * 🔴 本文件包含两组**反向锁**，锁的是「已经证伪的错误实现」：
 *   1. 打分公式不许加长度补偿项（会让 DP 吞并）
 *   2. 时间锚不许退到 SRT 时间（会让时间倒退 + cue 重叠）
 *   这两条都曾真的写错过并被实测抓到，锁住以防改回去。
 */

import { describe, it, expect } from 'vitest';
import {
  similarity,
  contentChars,
  alignCuesToSegments,
  composeWords,
  segmentCueText,
  MATCH_MIN_SIMILARITY,
  type WhisperSegment,
} from '../src/stages/text-align.ts';

/** 实测的 whisper segment（`-ojf` 的 segment 层，文本正确）。 */
const SEGMENTS: WhisperSegment[] = [
  { text: '给老婆整了双鞋圈、鞋眼包', startMs: 0, endMs: 2520 },
  { text: '就是耐克和斯达西联名的', startMs: 2520, endMs: 5760 },
  { text: 'Spiritone Cookini II', startMs: 5760, endMs: 8080 },
  {
    text: '他把Spiritone Cage的中底和Cookini的外谷格巧妙的结合在了一起',
    startMs: 8080,
    endMs: 20480,
  },
  { text: '黑白主色调低调耐看', startMs: 20480, endMs: 23200 },
  { text: '鞋子是无鞋绳的一体式网眼袜套', startMs: 23200, endMs: 26560 },
  { text: '贴合感是这双鞋最惊喜的地方', startMs: 26560, endMs: 28960 },
  { text: '他这个tpu', startMs: 28960, endMs: 30960 },
];

/** 实测的人工 SRT（**文本权威**）。 */
const CUES = [
  { index: 0, text: '给老婆整了双鞋圈显眼包' },
  { index: 1, text: '就是耐克和Stussy联名的Spiridon Kukini Ⅱ' },
  { index: 2, text: '它把spirit Donkage的中底和cookie的' },
  { index: 3, text: '外骨骼巧妙的结合在了一起' },
  { index: 4, text: '黑白主色调低调耐看' },
  { index: 5, text: '鞋子是无鞋绳的一体式网眼袜套' },
  { index: 6, text: '贴合感是这双鞋最惊喜的地方' },
  { index: 7, text: '它这个TPU骨架是软的' },
];

describe('text-align / 相似度', () => {
  it('contentChars 剥掉标点与空白、统一小写', () => {
    expect(contentChars('给老婆整了双鞋圈、鞋眼包')).toBe('给老婆整了双鞋圈鞋眼包');
    expect(contentChars('TPU 骨架')).toBe('tpu骨架');
  });

  it('完全相同 → 1', () => {
    expect(similarity('黑白主色调低调耐看', '黑白主色调低调耐看')).toBe(1);
  });

  it('个别错字仍高分（whisper 把「显眼包」听成「鞋眼包」）', () => {
    const s = similarity('给老婆整了双鞋圈显眼包', '给老婆整了双鞋圈、鞋眼包');
    expect(s).toBeGreaterThan(0.85);
  });

  it('完全无关 → 0', () => {
    expect(similarity('给老婆整了双鞋圈显眼包', '黑白主色调低调耐看')).toBe(0);
  });

  /**
   * 🔴 阈值校准的依据数据。这四项构成「可分性」的证据：
   *    正确匹配最低 0.455，错误匹配最高 0.379（B' 是「丢前半段」的错解）。
   *    ⚠️ 注意 0.455 与 0.379 靠得很近 —— **单靠相似度分不开**，
   *    所以才需要「跳过 segment 罚分」来处理 B'，见下面的反向锁。
   */
  it('阈值 0.35 的校准依据（真实样本分布）', () => {
    // 正确匹配
    expect(similarity('给老婆整了双鞋圈显眼包', '给老婆整了双鞋圈、鞋眼包')).toBeGreaterThan(0.85);
    expect(similarity('黑白主色调低调耐看', '黑白主色调低调耐看')).toBe(1);
    // 「whisper 只听半句」—— 仍应算匹配成功
    const halfHeard = similarity('它这个TPU骨架是软的', '他这个tpu');
    expect(halfHeard).toBeGreaterThan(MATCH_MIN_SIMILARITY);
    // 错位
    expect(similarity('贴合感是这双鞋最惊喜的地方', '它这个TPU骨架是软的')).toBeLessThan(0.35);
    expect(similarity('鞋子是无鞋绳的一体式网眼袜套', 'Spiritone Cookini II')).toBe(0);
  });
});

describe('text-align / 分词', () => {
  it('中文按词切，丢掉纯标点', () => {
    const parts = segmentCueText('给老婆整了双鞋圈、鞋眼包');
    expect(parts).toContain('老婆');
    expect(parts).not.toContain('、');
    expect(parts.join('')).toBe('给老婆整了双鞋圈鞋眼包');
  });

  it('🔴 确定性：同输入必须同输出（word:N 锚点依赖它）', () => {
    const a = segmentCueText('就是耐克和Stussy联名的Spiridon Kukini Ⅱ');
    const b = segmentCueText('就是耐克和Stussy联名的Spiridon Kukini Ⅱ');
    expect(a).toEqual(b);
  });
});

describe('text-align / 匹配（真实素材全量）', () => {
  it('🔴 8 条 cue 全部匹配上（alignedRatio = 1）', () => {
    const r = alignCuesToSegments(CUES, SEGMENTS);
    expect(r.matchedCues).toBe(8);
    expect(r.alignedRatio).toBe(1);
  });

  it('🔴「多对一」：cue 2、3 共享 seg 3', () => {
    const r = alignCuesToSegments(CUES, SEGMENTS);
    expect(r.cueToSegment[2]).toBe(3);
    expect(r.cueToSegment[3]).toBe(3);
  });

  it('🔴「一对多」：cue 1 横跨 seg 1 与 seg 2', () => {
    const r = alignCuesToSegments(CUES, SEGMENTS);
    expect(r.cueToSegment[1]).toBe(1);
    expect(r.cueToLastSegment[1]).toBe(2);
  });

  it('反向锁：文本完全对不上时必须低 alignedRatio（不能假绿）', () => {
    const garbage = [
      { index: 0, text: '今天天气不错适合出门散步' },
      { index: 1, text: '明天可能会下雨记得带伞' },
    ];
    const r = alignCuesToSegments(garbage, SEGMENTS);
    expect(r.alignedRatio).toBe(0);
  });

  it('空输入不崩', () => {
    expect(alignCuesToSegments([], SEGMENTS).alignedRatio).toBe(0);
    expect(alignCuesToSegments(CUES, []).alignedRatio).toBe(0);
  });
});

describe('text-align / 合成时间', () => {
  const { words, match, unmatchedCues } = composeWords(CUES, SEGMENTS);

  it('无未匹配 cue', () => {
    expect(unmatchedCues).toEqual([]);
  });

  it('🔴 时间严格单调（0 处倒退）', () => {
    let viol = 0;
    for (let i = 1; i < words.length; i += 1) {
      if (words[i]!.startMs < words[i - 1]!.startMs) viol += 1;
    }
    expect(viol).toBe(0);
  });

  it('🔴 无负时长 / 无零时长', () => {
    expect(words.filter((w) => w.endMs < w.startMs)).toHaveLength(0);
    expect(words.filter((w) => w.endMs === w.startMs)).toHaveLength(0);
  });

  it('🔴 无时间空洞（相邻词条间隔 < 500ms）', () => {
    const gaps: number[] = [];
    for (let i = 1; i < words.length; i += 1) {
      const g = words[i]!.startMs - words[i - 1]!.endMs;
      if (g > 500) gaps.push(g);
    }
    // 这条是**反向锁**：曾因打分公式错误，cue 1 丢掉前半段，
    // 出现 3240ms 空洞，而 alignedRatio 仍是 1.0（静默假绿）。
    expect(gaps).toEqual([]);
  });

  it('🔴 不同 cue 的词条时间不重叠', () => {
    const byCue = new Map<number, typeof words>();
    for (const w of words) {
      const arr = byCue.get(w.cueIndex) ?? [];
      arr.push(w);
      byCue.set(w.cueIndex, arr);
    }
    const keys = [...byCue.keys()].sort((a, b) => a - b);
    for (let i = 1; i < keys.length; i += 1) {
      const prev = byCue.get(keys[i - 1]!)!;
      const cur = byCue.get(keys[i]!)!;
      const prevEnd = prev[prev.length - 1]!.endMs;
      expect(cur[0]!.startMs).toBeGreaterThanOrEqual(prevEnd);
    }
  });

  it('🔴 时间锚来自音频，不是 SRT（cue 1 起点应是 2520 而非 SRT 的 2650）', () => {
    const cue1 = words.filter((w) => w.cueIndex === 1);
    expect(cue1[0]!.startMs).toBe(2520);
  });

  it('🔴 覆盖整段音频（首词 0、末词 ≈ 末 segment 结束）', () => {
    expect(words[0]!.startMs).toBe(0);
    expect(words[words.length - 1]!.endMs).toBe(SEGMENTS[SEGMENTS.length - 1]!.endMs);
  });

  it('词条序号连续（word:N 锚点依赖）', () => {
    words.forEach((w, i) => expect(w.index).toBe(i));
  });

  it('文本全部来自 SRT（不采信 whisper 的乱码 token）', () => {
    const all = words.map((w) => w.text).join('');
    // SRT 是「显眼包」「Stussy」「Spiridon Kukini」，whisper 是「鞋眼包」「斯达西」
    expect(all).toContain('显眼包');
    expect(all).toContain('Stussy');
    expect(all).toContain('Spiridon');
    expect(all).toContain('无鞋绳');
    expect(all).not.toContain('鞋眼包');
    expect(all).not.toContain('斯达西');
    // 决不允许出现替换字符（token 层损坏的标志）
    expect(all).not.toContain('\uFFFD');
  });

  it('置信度：完美匹配为 1，听错字的高但 <1', () => {
    const cue5 = words.filter((w) => w.cueIndex === 5);
    expect(cue5[0]!.confidence).toBe(1);
    const cue0 = words.filter((w) => w.cueIndex === 0);
    expect(cue0[0]!.confidence).toBeGreaterThan(0.85);
    expect(cue0[0]!.confidence).toBeLessThan(1);
  });
});

describe('text-align / 反向锁：未匹配的 cue 不许编造时间', () => {
  it('多出来且对不上的 cue → 不产词条，只记 unmatchedCues', () => {
    const withExtra = [
      ...CUES,
      { index: 99, text: '这是一句完全不存在于音频里的台词内容' },
    ];
    const { words, unmatchedCues } = composeWords(withExtra, SEGMENTS);
    expect(unmatchedCues).toContain(99);
    expect(words.filter((w) => w.cueIndex === 99)).toHaveLength(0);
  });
});

describe('text-align / 末段外溢：压缩而非丢弃', () => {
  /**
   * 🔴 真实场景：whisper 末段标到 30960ms，而音频只到 30000ms。
   *
   * 曾经的错解：换算成帧后统一夹到上限 —— 结果把末段内的
   * 「骨架 是 软 的」4 个**真实词条整条丢掉**（72 → 68 个词）。
   *
   * 正确行为：在毫秒层把末段压回可用区间，**词一个不少**，
   * 只是时间更紧，且末词恰好在 maxEndMs 结束。
   */
  it('压缩后词条一个不少，且末词结束于上限', () => {
    const full = composeWords(CUES, SEGMENTS);
    const clamped = composeWords(CUES, SEGMENTS, { maxEndMs: 30000 });

    expect(clamped.words).toHaveLength(full.words.length);
    expect(clamped.words[clamped.words.length - 1]!.endMs).toBe(30000);

    // 末段的 7 个词仍在，且顺序不变
    const tail = clamped.words.slice(-7).map((w) => w.text);
    expect(tail).toEqual(['它', '这个', 'TPU', '骨架', '是', '软', '的']);
  });

  it('压缩不打乱时间单调性', () => {
    const clamped = composeWords(CUES, SEGMENTS, { maxEndMs: 30000 });
    let viol = 0;
    for (let i = 1; i < clamped.words.length; i += 1) {
      if (clamped.words[i]!.startMs < clamped.words[i - 1]!.startMs) viol += 1;
    }
    expect(viol).toBe(0);
    expect(clamped.words.filter((w) => w.endMs < w.startMs)).toHaveLength(0);
  });

  it('未超限时压缩参数不产生任何影响', () => {
    const a = composeWords(CUES, SEGMENTS, { maxEndMs: 99999 });
    const b = composeWords(CUES, SEGMENTS);
    expect(a.words.map((w) => w.endMs)).toEqual(b.words.map((w) => w.endMs));
  });
});
