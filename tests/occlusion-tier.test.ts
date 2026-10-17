/**
 * D4 三级退让的**数据变更**断言 —— 校验项 #12 / #13。
 *
 * 🔴 本文件的存在理由（2026-10-13）：
 *   此前 `tests/validate.test.ts` 的 `codesOf()` 辅助函数**只返回错误码列表**，
 *   因此它在**结构上无法断言「footprint 真的被移动了」**。于是下面这个缺陷
 *   长期未被任何测试发现：
 *
 *     tier1 算出了平移后的矩形 → 只拼进 detail 字符串 → 调用方直接 `continue`
 *     ⇒ 校验报「通过」，但 motion 仍压在主体区，成片照样拍出来
 *
 *   事实：`npm test` 73 项全过，而这条链路是错的。
 *   **断言辅助函数的返回类型决定了它能证明什么** —— 这是本文件的教训。
 *
 * 本文件的每条用例都断言**数据真的变了**，而不是「错误码消失了」。
 *
 * ── 测试数据说明 ──────────────────────────────────────────────
 *   下列 footprint 与 region 的组合是**算出来的**，不是拍的：
 *   必须「原位置遮挡 > 预算」才会进 collectHits（原位不超预算 ⇒ 压根不触发退让），
 *   且「平移网格内存在一个候选能消解」。
 *   例如 fp `[0.5,0.5,0.2,0.2]` × handheld 区 `[0.5,0.5,0.4,0.4]`：
 *     原遮挡 25.0% > 预算 20% → 触发；平移至 `[0.3,0.3,0.2,0.2]` 后 0.0% → 退让成功。
 */

import { describe, expect, it } from 'vitest';
import { runValidation } from '../src/validate/index.ts';
import type { StoryboardItem } from '../src/core/types.ts';
import { carrierOf, makeCtx, makeItem, makeOccludingItem, makeTrack, OCCLUDER_MOTION } from './_ctx.ts';

/** 原遮挡 25% > handheld 预算 20%，平移一格即消解。 */
const FP_NUDGEABLE: [number, number, number, number] = [0.5, 0.5, 0.2, 0.2];
const REGION: [number, number, number, number] = [0.5, 0.5, 0.4, 0.4];

const faceRegion = (box: [number, number, number, number]) => [
  { id: 'face-1', kind: 'face' as const, shotId: 's1', fromFrame: 100, durationInFrames: 200, box },
];
const handheldRegion = (box: [number, number, number, number]) => [
  { id: 'hand-1', kind: 'handheld' as const, shotId: 's1', fromFrame: 100, durationInFrames: 200, box },
];
const brollRegion = (box: [number, number, number, number]) => [
  { id: 'broll-1', kind: 'broll' as const, shotId: 's1', fromFrame: 100, durationInFrames: 200, box },
];

/** 与 `codesOf` 的关键区别：**返回 ctx 本身**，让用例能检查被改写后的数据。 */
function runCtx(over: Parameters<typeof makeCtx>[0] = {}) {
  return makeCtx(over);
}

describe('#12 tier1 平移 —— 必须真正改写 footprint', () => {
  it('T1 平移成功 → footprint 真的被改写（不再等于原值）', () => {
    const item: StoryboardItem = makeOccludingItem({
      fromFrame: 111,
      durationInFrames: 60,
      footprint: [...FP_NUDGEABLE],
    });
    const ctx = runCtx({
      tracks: [makeTrack('a', 60, [item])],
      regions: handheldRegion(REGION),
    });

    const report = runValidation(ctx);

    // 🔴 核心断言：数据变了。若用 codesOf() 这里根本测不出来。
    expect(ctx.scene[0]?.item.footprint).not.toEqual(FP_NUDGEABLE);
    // 不报 error（退让成功）
    expect(report.items.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('T1b 改写后的遮挡率确实落回预算内', () => {
    const ctx = runCtx({
      tracks: [
        makeTrack('a', 60, [
          makeOccludingItem({ fromFrame: 111, durationInFrames: 60, footprint: [...FP_NUDGEABLE] }),
        ]),
      ],
      regions: handheldRegion(REGION),
    });
    runValidation(ctx);
    const after = ctx.scene[0]?.item.footprint ?? [0, 0, 0, 0];
    // 重算遮挡率：与 region 的交叠 / region 面积应 ≤ 20%
    const [ax, ay, aw, ah] = after;
    const [bx, by, bw, bh] = REGION;
    const w = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
    const h = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
    expect((w * h) / (bw * bh)).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('T1c 平移成功时必须留下可对账的告警（不再是静默通过）', () => {
    const ctx = runCtx({
      tracks: [
        makeTrack('a', 60, [
          makeOccludingItem({ fromFrame: 111, durationInFrames: 60, footprint: [...FP_NUDGEABLE] }),
        ]),
      ],
      regions: handheldRegion(REGION),
    });
    const codes = runValidation(ctx).items.map((i) => i.code);
    // 修复前：这里会是空数组（静默 continue）。修复后必须能对账。
    expect(codes).toContain('W-D2-01');
  });

  it('T7 退让结果是确定性的（同输入两次结果一致）', () => {
    const build = () =>
      runCtx({
        tracks: [
          makeTrack('a', 60, [
            makeOccludingItem({ fromFrame: 111, durationInFrames: 60, footprint: [...FP_NUDGEABLE] }),
          ]),
        ],
        regions: handheldRegion(REGION),
      });
    const c1 = build();
    const c2 = build();
    runValidation(c1);
    runValidation(c2);
    expect(c1.scene[0]?.item.footprint).toEqual(c2.scene[0]?.item.footprint);
  });

  it('T8 B-roll 链路同样必须回写（不能只有 face/handheld 生效）', () => {
    // broll 预算 30%，故须用比 handheld 更大的 fp：
    // [0.5,0.5,0.3,0.3] × [0.5,0.5,0.4,0.4] → 原遮挡 56.3% > 30%，平移至[0.3,...] 后 6.2%
    const bigFp: [number, number, number, number] = [0.5, 0.5, 0.3, 0.3];
    const ctx = runCtx({
      tracks: [makeTrack('a', 60, [makeOccludingItem({ fromFrame: 111, durationInFrames: 60, footprint: [...bigFp] })])],
      regions: brollRegion(REGION),
    });
    runValidation(ctx);
    expect(ctx.scene[0]?.item.footprint).not.toEqual(bigFp);
  });
});

describe('#13 tier2 载体档 —— 目前不施加变换，必须诚实告警', () => {
  /** face 预算 0% + footprint 与区域完全重合 ⇒ 平移网格内无解，必落到 tier2。 */
  const BIG_FP: [number, number, number, number] = [0.2, 0.2, 0.6, 0.6];
  const BIG_BOX: [number, number, number, number] = [0.2, 0.2, 0.6, 0.6];

  it('T3 声明 item.carrier 后：冲突被抑制，但 motion 与 footprint 均未被改写（已知缺口）', () => {
    const ctx = runCtx({
      tracks: [
        makeTrack('a', 60, [
          makeOccludingItem({
            fromFrame: 111,
            durationInFrames: 60,
            footprint: [...BIG_FP],
            carrier: carrierOf(),
          }),
        ]),
      ],
      regions: faceRegion(BIG_BOX),
    });
    const report = runValidation(ctx);
    const codes = report.items.map((i) => i.code);

    // 冲突被抑制：不报 E-D4-01
    expect(codes).not.toContain('E-D4-01');
    // 🔴 但必须明确告知「未实际退让」，而不是静默假绿
    expect(codes).toContain('W-D4-01');
    // 且数据确实没变 —— 这是当前实现的真实状态，如实断言
    expect(ctx.scene[0]?.item.footprint).toEqual(BIG_FP);
    expect(ctx.scene[0]?.item.motion).toBe(OCCLUDER_MOTION);
  });

  it('T3b W-D4-01 的消息必须点明「未实际施加」', () => {
    const ctx = runCtx({
      tracks: [
        makeTrack('a', 60, [
          makeOccludingItem({
            fromFrame: 111,
            durationInFrames: 60,
            footprint: [...BIG_FP],
            carrier: carrierOf(),
          }),
        ]),
      ],
      regions: faceRegion(BIG_BOX),
    });
    const item = runValidation(ctx).items.find((i) => i.code === 'W-D4-01');
    expect(item?.message).toMatch(/未.*施加|尚未实现/);
    expect(item?.hint).toMatch(/尚未实现|不会.*改变成片/);
  });

  it('T5 未声明 item.carrier 时 E-D4-01 仍可达（防止未来误删此码）', () => {
    const ctx = runCtx({
      tracks: [makeTrack('a', 60, [makeOccludingItem({ fromFrame: 111, durationInFrames: 60, footprint: [...BIG_FP] })])],
      regions: faceRegion(BIG_BOX),
    });
    expect(runValidation(ctx).items.map((i) => i.code)).toContain('E-D4-01');
  });

  it('T2 tier1 顺序优先于 tier2（两者都可行时应选平移）', () => {
    const ctx = runCtx({
      tracks: [
        makeTrack('a', 60, [
          makeOccludingItem({
            fromFrame: 111,
            durationInFrames: 60,
            footprint: [...FP_NUDGEABLE],
            carrier: carrierOf(),
          }),
        ]),
      ],
      regions: handheldRegion(REGION),
    });
    const codes = runValidation(ctx).items.map((i) => i.code);
    // 平移成功 → 出 W-D2-01，而非 W-D4-01（tier2）
    expect(codes).toContain('W-D2-01');
    expect(codes).not.toContain('W-D4-01');
    // 且 motion 不该被改成 carrier
    expect(ctx.scene[0]?.item.motion).toBe(OCCLUDER_MOTION);
  });

  it('T4 tier2 也失败（区域占满画面）→ E-D2-01 仍然报错', () => {
    const ctx = runCtx({
      tracks: [
        makeTrack('a', 60, [
          makeOccludingItem({
            fromFrame: 111,
            durationInFrames: 60,
            footprint: [0, 0, 1, 1],
            carrier: carrierOf(),
          }),
        ]),
      ],
      regions: faceRegion([0, 0, 1, 1]),
    });
    expect(runValidation(ctx).items.map((i) => i.code)).toContain('E-D2-01');
  });
});
