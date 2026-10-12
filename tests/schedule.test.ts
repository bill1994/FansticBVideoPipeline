/**
 * N-3 产路地板 —— **必须单测覆盖的 5 组用例**。
 *
 * 真源：登记册「N-3 章节 → 必须单测覆盖的用例」；SPEC §4.5。
 * 第 5 组是地板锁死验证：custom + confidence=0.99 仍须 must_review。
 */

import { describe, expect, it } from 'vitest';
import {
  computeThreshold,
  decide,
  finalReview,
  gate2,
  route,
  routingFloor,
  quantile,
} from '../src/core/schedule.ts';
import { SAFETY_VALVE_MEDIAN, T_BOUNDS, T_SMALL_SAMPLE } from '../src/core/config.ts';

describe('闸2 —— 只吃 confidence', () => {
  it('高 confidence → auto', () => {
    expect(gate2(0.95)).toBe('auto');
  });
  it('中 confidence → alternatives', () => {
    expect(gate2(0.6)).toBe('alternatives');
  });
  it('低 confidence → must_review', () => {
    expect(gate2(0.2)).toBe('must_review');
  });
});

describe('产路地板', () => {
  it('template 地板 = auto（闸2 调节能力完全保留）', () => {
    expect(routingFloor('template')).toBe('auto');
  });
  it('custom 地板 = must_review（闸2 被锁死）', () => {
    expect(routingFloor('custom')).toBe('must_review');
  });
});

describe('N-3 必测 5 组用例', () => {
  it('1. template × 高 confidence → auto', () => {
    expect(finalReview('template', 0.95)).toBe('auto');
  });

  it('2. template × 中 confidence → alternatives', () => {
    expect(finalReview('template', 0.6)).toBe('alternatives');
  });

  it('3. template × 低 confidence → must_review', () => {
    expect(finalReview('template', 0.2)).toBe('must_review');
  });

  it('4. custom × 任意 confidence → must_review（三格全测）', () => {
    expect(finalReview('custom', 0.2)).toBe('must_review');
    expect(finalReview('custom', 0.6)).toBe('must_review');
    expect(finalReview('custom', 0.95)).toBe('must_review');
  });

  it('5. custom × confidence=0.99 → 仍须 must_review（地板锁死验证）', () => {
    expect(finalReview('custom', 0.99)).toBe('must_review');
  });

  it('组合矩阵两行与文档一致', () => {
    const matrix = (['template', 'custom'] as const).map((routing) =>
      [0.2, 0.6, 0.95].map((c) => finalReview(routing, c)),
    );
    expect(matrix).toEqual([
      ['must_review', 'alternatives', 'auto'],
      ['must_review', 'must_review', 'must_review'],
    ]);
  });
});

describe('闸1 —— 路由与动态阈值', () => {
  it('sim_max ≥ T → template；否则 custom', () => {
    expect(route(0.8, 0.7)).toBe('template');
    expect(route(0.7, 0.7)).toBe('template');
    expect(route(0.69, 0.7)).toBe('custom');
  });

  it('样本少（N < 8）→ 退化固定 T = 0.65', () => {
    const r = computeThreshold([0.9, 0.85, 0.8, 0.75, 0.7]);
    expect(r.T).toBe(T_SMALL_SAMPLE.threshold);
    expect(r.safetyValve).toBe(false);
  });

  it('安全阀：中位数 < 0.4 → 触发（禁止降阈值硬套库）', () => {
    const r = computeThreshold([0.1, 0.2, 0.3, 0.35, 0.38, 0.1, 0.2, 0.25, 0.3]);
    expect(r.safetyValve).toBe(true);
    expect(r.reason).toContain('库不适配');
  });

  it('阈值被硬边界夹住（T_min=0.50 / T_max=0.80）', () => {
    const low: number[] = [];
    for (let i = 0; i < 20; i += 1) low.push(0.45 + i * 0.001);
    expect(computeThreshold(low).T).toBeLessThanOrEqual(T_BOUNDS.max);
    expect(computeThreshold(low).T).toBeGreaterThanOrEqual(T_BOUNDS.min);
  });

  it('安全阀阈值就是 0.4 本身', () => {
    expect(SAFETY_VALVE_MEDIAN).toBe(0.4);
  });

  it('quantile 是线性插值（R-7）', () => {
    expect(quantile([0, 1, 2, 3, 4], 0)).toBe(0);
    expect(quantile([0, 1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([0, 1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([0, 10], 0.5)).toBe(5);
  });
});

describe('decide —— Given routing 与 confidence，review 唯一确定', () => {
  it('同一输入重复调用结果一致（纯函数）', () => {
    const a = decide(0.9, 0.3, 0.7);
    const b = decide(0.9, 0.3, 0.7);
    expect(a).toEqual(b);
    expect(a).toEqual({ sim_max: 0.9, confidence: 0.3, routing: 'template', review: 'must_review' });
  });

  it('安全阀整批转 custom 后，地板自动把整批抬到 must_review', () => {
    for (const c of [0.1, 0.5, 0.99]) {
      expect(finalReview('custom', c)).toBe('must_review');
    }
  });
});
