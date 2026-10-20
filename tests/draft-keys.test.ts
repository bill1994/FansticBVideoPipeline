/**
 * 起草稿 item 顶层键检查（`P5` 裁决，2026-10-19）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要（端到端审计发现）
 * ─────────────────────────────────────────────────────────────
 * `bake` 用 `{...item}` 展开，所以起草稿里**多写的任何键**都会原样落进
 * `storyboard.json` —— 而 item 顶层此前**没有任何校验**。
 *
 * 对比：`params` 内部有 `E-P1-01`（未知键）兜着，item 顶层是无人区。
 * 模型写错一个 `routing` / `handoffIn`，成片正常、校验全绿、产物里多一坨垃圾。
 */

import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import { assertDraftItemKeys, type DraftStoryboard } from '../src/stages/storyboard.ts';

function draftWith(item: Record<string, unknown>): DraftStoryboard {
  return {
    meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
    tracks: [
      {
        id: 't1',
        layer: 50,
        items: [item as never],
      },
    ],
    noMotionRanges: [],
  };
}

const LEGAL = {
  _author: { anchor: 'abs:0' },
  motion: 'typography/kinetic-line@1.0',
  footprint: [0.1, 0.1, 0.3, 0.1],
  params: { text: 'x' },
  sim_max: 0.9,
  confidence: 0.9,
};

describe('assertDraftItemKeys —— 只查 item 顶层', () => {
  it('合法起草稿 → 不抛', () => {
    expect(() => assertDraftItemKeys(draftWith(LEGAL))).not.toThrow();
  });

  it('允许 "carrier"（人工返修可手填）与契约字段', () => {
    expect(() =>
      assertDraftItemKeys(
        draftWith({ ...LEGAL, carrier: { template: 'carrier/split-frame@1.0', params: {} } }),
      ),
    ).not.toThrow();
    expect(() =>
      assertDraftItemKeys(draftWith({ ...LEGAL, exclusive: 'grp', footprintAnimates: true })),
    ).not.toThrow();
  });

  it('🔴 未知键 → ConfigError，且点明轨与序号', () => {
    expect(() => assertDraftItemKeys(draftWith({ ...LEGAL, routing: 'custom' }))).toThrow(
      ConfigError,
    );
    expect(() => assertDraftItemKeys(draftWith({ ...LEGAL, routing: 'custom' }))).toThrow(
      /轨「t1」第 0 条：未知键 `routing`/,
    );
  });

  it('已知易错键给出针对性提示', () => {
    expect(() => assertDraftItemKeys(draftWith({ ...LEGAL, decision: {} }))).toThrow(/产物/);
    expect(() => assertDraftItemKeys(draftWith({ ...LEGAL, handoffIn: 'x' }))).toThrow(/params\.enter/);
    expect(() => assertDraftItemKeys(draftWith({ ...LEGAL, handoffTo: 't2' }))).toThrow(/track 层/);
  });

  it('多个未知键一次列全（不是遇到第一个就停）', () => {
    try {
      assertDraftItemKeys(draftWith({ ...LEGAL, routing: 'custom', review: 'auto', foo: 1 }));
      expect.unreachable('应当抛错');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/共 3 处/);
      expect(msg).toMatch(/`routing`/);
      expect(msg).toMatch(/`review`/);
      expect(msg).toMatch(/`foo`/);
    }
  });

  it('params 内部的键不归这里管（交给校验项 #16 的 E-P1-01）', () => {
    expect(() =>
      assertDraftItemKeys(draftWith({ ...LEGAL, params: { text: 'x', color: 'red' } })),
    ).not.toThrow();
  });

  it('空 tracks / 缺 items 时安全（其他校验会管结构）', () => {
    expect(() =>
      assertDraftItemKeys({ meta: {} as never, tracks: [], noMotionRanges: [] }),
    ).not.toThrow();
  });
});
