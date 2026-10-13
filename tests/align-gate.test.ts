/**
 * 对齐门控 —— C2-2 与 **M-1c**（`alignedRatio`）。
 *
 * 重点在M-1c 引入的第二个维度：`alignedRatio` 衡量「SRT 与音频是否对得上」，
 * 与 `meanConfidence`（whisper 对自己听到的词有多自信）**互不覆盖**。
 */

import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../src/stages/align.ts';
import { ALIGN_GATE } from '../src/core/config.ts';
import type { WordTimestamp } from '../src/core/types.ts';

function words(n: number, confidence = 0.9): WordTimestamp[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    word: `w${i}`,
    startFrame: i * 20,
    endFrame: i * 20 + 19,
    confidence,
  }));
}

describe('C2-2 置信度门控', () => {
  it('全部高置信 → 通过', () => {
    expect(evaluateGate(words(20)).gatePassed).toBe(true);
  });

  it('均值低于阈值 → 不通过', () => {
    expect(evaluateGate(words(20, 0.4)).gatePassed).toBe(false);
  });

  it('低置信词占比超阈值 → 不通过', () => {
    // 30% 低置信 + 均值仍高：正是「听得很自信但错了很多」的场景
    const w = words(20, 0.95);
    for (const x of w.slice(0, 8)) x.confidence = 0.3;
    const g = evaluateGate(w);
    expect(g.lowConfidenceRatio).toBeGreaterThan(ALIGN_GATE.lowConfidenceRatioMax);
    expect(g.gatePassed).toBe(false);
  });

  it('空结果 → 直接抛错（不返回「通过」）', () => {
    expect(() => evaluateGate([])).toThrow();
  });
});

describe('M-1c alignedRatio —— 与置信度互不覆盖的第二个维度', () => {
  it('🔴 whisper 很自信、但 SRT 与音频对不上 → 必须拦住', () => {
    // 这是 meanConfidence 测不到的场景：置信度全 0.95，但 alignedRatio 只有 0.4
    const g = evaluateGate(words(30, 0.95), 0.4);
    expect(g.meanConfidence).toBeGreaterThan(ALIGN_GATE.meanConfidenceMin);
    expect(g.lowConfidenceRatio).toBeLessThan(ALIGN_GATE.lowConfidenceRatioMax);
    // 即前两个维度都过了，仍必须被拦住
    expect(g.gatePassed).toBe(false);
  });

  it('alignedRatio 达标 → 通过', () => {
    expect(evaluateGate(words(30, 0.95), 0.95).gatePassed).toBe(true);
  });

  it('未回传 alignedRatio → 不参与门控，但如实记为 null（不伪造）', () => {
    const g = evaluateGate(words(20, 0.95));
    expect(g.alignedRatio).toBeNull();
    // 此时仍按置信度维度判定
    expect(g.gatePassed).toBe(true);
  });

  it('阈值被记录进结果，便于事后追溯', () => {
    const g = evaluateGate(words(20), 0.95);
    expect(g.thresholds.alignedRatioMin).toBe(ALIGN_GATE.alignedRatioMin);
  });

  it('🔴 边界：恰好等于阈值 → 通过（与 > 的约定一致）', () => {
    expect(evaluateGate(words(20, 0.95), ALIGN_GATE.alignedRatioMin).gatePassed).toBe(true);
  });
});
