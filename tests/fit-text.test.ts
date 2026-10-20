/**
 * 渲染期「缩到框内」（`P6` 第一步，2026-10-19）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要
 * ─────────────────────────────────────────────────────────────
 * 模板全 `whiteSpace: nowrap` ⇒ 长文本既不折行也不缩放，直接跑出框
 * （真渲实测：16 中文字时 4 个模板全溢出，`stat-card` 甚至溢出画面）。
 * 构建期 #17 只是**估算**且已知低估，不能当唯一防线。
 *
 * 这里钉的是渲染期硬兜底：**放不下就等比缩，保证不出画面**。
 */

import { describe, expect, it } from 'vitest';
import { fitScale } from '../src/remotion/templates/contract.tsx';

describe('fitScale —— 放不下就缩，下限 0.7', () => {
  it('短文本 → 1（不缩放）', () => {
    expect(fitScale('惊喜', 54, 800)).toBe(1);
  });

  it('空文本 → 1', () => {
    expect(fitScale('', 54, 100)).toBe(1);
  });

  it('刚好放得下 → 1（不因估算抖动而误缩）', () => {
    // 10 个 CJK 字 × 54 = 540，框宽 540
    expect(fitScale('一二三四五六七八九十', 54, 540)).toBe(1);
  });

  it('🔴 放不下 → 按比例缩小（16 字 / 54px / 800px 框）', () => {
    const s = fitScale('一二三四五六七八九十一二三四五六', 54, 800);
    expect(s).toBeLessThan(1);
    // 800 / (16×54) ≈ 0.926
    expect(s).toBeCloseTo(800 / 864, 3);
  });

  it('🔴 触底 0.7：再长也不继续缩（那是文案问题，不是排版问题）', () => {
    expect(fitScale('字'.repeat(80), 54, 800)).toBe(0.7);
  });

  it('padding 会吃掉可用宽（少算 padding = 系统性低估溢出）', () => {
    const noPad = fitScale('一二三四五六七八九十', 54, 600);
    const withPad = fitScale('一二三四五六七八九十', 54, 600, 60);
    expect(withPad).toBeLessThan(noPad);
  });

  it('框越窄缩得越狠', () => {
    const wide = fitScale('一二三四五六七八九十', 54, 800);
    const narrow = fitScale('一二三四五六七八九十', 54, 400);
    expect(narrow).toBeLessThanOrEqual(wide);
  });
});
