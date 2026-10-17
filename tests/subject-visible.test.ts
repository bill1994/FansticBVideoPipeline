/**
 * `W-D2-02` 载体变换后主体可见比 —— 第 18 项（P4 重立，2026-10-17）。
 *
 * 🔴 **这份测试的存在理由是「防止第二次撤回」**。
 *   本码当天已「增补 → 撤回 → 重立」一轮，撤回的两条理由是：
 *   ① split-frame 当时无渲染实现；
 *   ② **判据挂在 `footprint` 上 ⇒ 对分屏误报、对放大完全漏报**。
 *   理由②是判据本身的缺陷，只有测试能钉住它是否真的被消解。
 *   ⇒ 下面 `V6` / `V7` 两条**专门覆盖「放大」分支**，不许删。
 *
 * ── 判据 ──────────────────────────────────────────────────────
 *   `|safeArea ∩ visibleRegion| / |safeArea| ≥ MIN_VISIBLE_RATIO(0.5)`
 */

import { describe, expect, it } from 'vitest';
import { runValidation } from '../src/validate/index.ts';
import type { ValidateContext } from '../src/validate/context.ts';
import { MIN_VISIBLE_RATIO } from '../src/core/carrier-window.ts';
import { makeCtx, makeTrack } from './_ctx.ts';

type Rect = [number, number, number, number];

/** 一条载体 item：`footprint` 一律给声明里的值（[0.5,0,0.5,1]）。 */
function carrierItem(params: Record<string, unknown>): Record<string, unknown> {
  return {
    fromFrame: 10,
    durationInFrames: 120,
    motion: 'carrier/split-frame@1.0',
    footprint: [0.5, 0, 0.5, 1],
    params,
  };
}

function ctxWith(item: Record<string, unknown>, safeArea: Rect | null): ValidateContext {
  const c = makeCtx({ tracks: [makeTrack('carrier-1', 70, [item as never])] });
  return {
    ...c,
    perceive: {
      fps: c.fps,
      shots: [{ id: 'shot-1', fromFrame: 0, durationInFrames: 300, safeArea }],
      regions: [],
    },
  } as ValidateContext;
}

const codesOf = (ctx: ValidateContext) => runValidation(ctx).items.map((i) => i.code);

describe('#18 W-D2-02 载体变换后主体可见比', () => {
  it('V1 无裁切（无 window 无 scale）⇒ 不报（无从切走主体）', () => {
    const ctx = ctxWith(carrierItem({ side: 'right', ratio: 0.5 }), [0.3, 0.05, 0.4, 0.35]);
    expect(codesOf(ctx)).not.toContain('W-D2-02');
  });

  it('V2 窗口锚定主体 ⇒ 主体完整可见 ⇒ 不报', () => {
    // window 覆盖整个 safeArea ⇒ 可见比 = 100%
    const ctx = ctxWith(carrierItem({ side: 'right', ratio: 0.5, window: [0.3, 0, 0.4, 1] }), [
      0.3, 0.05, 0.4, 0.35,
    ]);
    expect(codesOf(ctx)).not.toContain('W-D2-02');
  });

  it('V3 🔴 窗口把主体切掉大半 ⇒ 必须报（分屏分支，撤回理由①的正面覆盖）', () => {
    // window 只留最左 15%，主体在 [0.3,0.7] ⇒ 可见比 0%
    const ctx = ctxWith(carrierItem({ side: 'right', ratio: 0.5, window: [0, 0, 0.15, 1] }), [
      0.3, 0.05, 0.4, 0.35,
    ]);
    expect(codesOf(ctx)).toContain('W-D2-02');
  });

  it('V4 主体部分可见但低于阈值 ⇒ 报；恰好等于阈值 ⇒ 不报（边界不含）', () => {
    // safeArea 宽 0.4，window 与它只重叠 0.2 ⇒ 可见比 50% = 阈值 ⇒ 不报
    const exact = ctxWith(carrierItem({ window: [0, 0, 0.5, 1] }), [0.3, 0, 0.4, 1]);
    expect(codesOf(exact)).not.toContain('W-D2-02');

    // 重叠 0.18 ⇒ 45% < 50% ⇒ 报
    const under = ctxWith(carrierItem({ window: [0, 0, 0.45, 1] }), [0.3, 0, 0.4, 1]);
    expect(codesOf(under)).toContain('W-D2-02');
  });

  it('V5 safeArea 为 null（主体不在场）⇒ 跳过而非误报', () => {
    const ctx = ctxWith(carrierItem({ window: [0, 0, 0.1, 1] }), null);
    expect(codesOf(ctx)).not.toContain('W-D2-02');
  });

  // 🔴🔴 下面两条是本文件的核心：撤回理由②「对放大完全漏报」是否已被消解
  it('V6 🔴 punch-in 放大裁边 —— 主体在画面外缘时被检出（D2-2 撤回理由②的正面覆盖）', () => {
    // punch-in scale=1.4 ⇒ 可见区 = 中央 1/1.4 ≈ [0.143, 0.143, 0.714, 0.714]
    // 主体放在最左缘 [0, 0, 0.2, 1] ⇒ 与可见区几乎无交集 ⇒ 必须报
    const ctx = ctxWith(
      {
        fromFrame: 10,
        durationInFrames: 120,
        motion: 'cinematic/punch-in@1.0',
        footprint: [0, 0, 1, 1],
        params: { scale: 1.4 },
      },
      [0, 0, 0.2, 1],
    );
    expect(codesOf(ctx)).toContain('W-D2-02');
  });

  it('V7 🔴 punch-in scale ≤ 1 不裁切 ⇒ 不报；主体在中央 ⇒ 不报', () => {
    // scale=1（无裁切）⇒ 无论主体在哪都不报
    const noCrop = ctxWith(
      {
        fromFrame: 10,
        durationInFrames: 120,
        motion: 'cinematic/punch-in@1.0',
        footprint: [0, 0, 1, 1],
        params: { scale: 1 },
      },
      [0, 0, 0.2, 1],
    );
    expect(codesOf(noCrop)).not.toContain('W-D2-02');

    // scale=1.4 但主体在中央 ⇒ 完整可见 ⇒ 不报
    const centered = ctxWith(
      {
        fromFrame: 10,
        durationInFrames: 120,
        motion: 'cinematic/punch-in@1.0',
        footprint: [0, 0, 1, 1],
        params: { scale: 1.4 },
      },
      [0.35, 0.2, 0.3, 0.5],
    );
    expect(codesOf(centered)).not.toContain('W-D2-02');
  });

  it('V8 叠加类模板不参与本项（只有载体类才改变视频呈现）', () => {
    const c = makeCtx({
      tracks: [
        makeTrack('ov', 70, [
          {
            fromFrame: 10,
            durationInFrames: 120,
            motion: 'typography/center-emphasis@1.0',
            footprint: [0, 0, 0.2, 1],
            params: { text: '压左边' },
            // 叠加类即使带 window 也不该被本项判（window 是载体语义）
            carrier: { template: 'carrier/split-frame@1.0', params: { window: [0.9, 0, 0.1, 1] } },
          } as never,
        ]),
      ],
    });
    const ctx = {
      ...c,
      perceive: {
        fps: c.fps,
        shots: [{ id: 'shot-1', fromFrame: 0, durationInFrames: 300, safeArea: [0, 0, 0.2, 1] as Rect }],
        regions: [],
      },
    } as ValidateContext;
    expect(codesOf(ctx)).not.toContain('W-D2-02');
  });

  it('V9 判据阈值须等于 MIN_VISIBLE_RATIO（防止两处各写一个数）', () => {
    const ctx = ctxWith(carrierItem({ window: [0, 0, 0.45, 1] }), [0.3, 0, 0.4, 1]);
    const item = runValidation(ctx).items.find((i) => i.code === 'W-D2-02');
    // 消息里应出现阈值百分比，与常量同源
    expect(item?.message).toContain(`${(MIN_VISIBLE_RATIO * 100).toFixed(0)}%`);
    // 且必须自报「阈值仍是占位值」，提醒人工校准
    expect(item?.hint).toMatch(/占位值/);
  });

  it('V10 可见区非法形状 ⇒ 抛 ConfigError（不静默当「全可见」）', () => {
    const ctx = ctxWith(carrierItem({ window: [0, 0, 0] }), [0.3, 0, 0.4, 1]);
    expect(() => runValidation(ctx)).toThrow();
  });
});
