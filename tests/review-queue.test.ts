/**
 * 人工审核队列（`P2` 裁决，2026-10-19）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么
 * ─────────────────────────────────────────────────────────────
 * `item.decision.review` 由产路地板算出（`custom` 一律 `must_review`），
 * 但 2026-10-19 端到端审计发现它**零消费者** —— 算完写进 storyboard 就没人看。
 *
 * 本项目没有审片 UI，也没有「待办」通道，所以这套分级唯一能落地的形式，
 * 是 validate 报告里的一份**清单**：告诉你哪几条必须看。
 */

import { describe, expect, it } from 'vitest';
import { runValidation } from '../src/validate/index.ts';
import { makeCtx, makeItem, makeTrack } from './_ctx.ts';

function ctxWith(review: 'auto' | 'alternatives' | 'must_review') {
  return makeCtx({
    tracks: [
      makeTrack('t1', 50, [
        makeItem({
          fromFrame: 100,
          durationInFrames: 60,
          decision: { sim_max: 0.5, confidence: 0.9, routing: 'template', review },
        }),
      ]),
    ],
  });
}

describe('reviewQueue —— decision.review 的落地形式', () => {
  it('must_review → 进队列，带 ref 与 motion', () => {
    const r = runValidation(ctxWith('must_review'));
    expect(r.reviewQueue).toEqual([{ ref: 't1/000', motion: 'typography/kinetic-line@1.0' }]);
  });

  it('auto / alternatives → 不进队列（alternatives 的备选机制本项目不存在）', () => {
    expect(runValidation(ctxWith('auto')).reviewQueue).toBeUndefined();
    expect(runValidation(ctxWith('alternatives')).reviewQueue).toBeUndefined();
  });

  it('没有 decision 字段（旧 storyboard）→ 不报错、不产队列', () => {
    const r = runValidation(
      makeCtx({ tracks: [makeTrack('t1', 50, [makeItem({ fromFrame: 100, durationInFrames: 60 })])] }),
    );
    expect(r.reviewQueue).toBeUndefined();
  });

  it('🔴 队列不是校验项：不影响 ok、不进 checked、不产 ReportItem', () => {
    const r = runValidation(ctxWith('must_review'));
    expect(r.ok).toBe(true);
    expect(r.summary.checked).toBe(18);
    expect(r.items.some((i) => i.code.includes('REVIEW'))).toBe(false);
  });
});
