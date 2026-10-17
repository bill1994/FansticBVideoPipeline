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

describe('#13 tier2 载体档 —— P3 起真正施加载体变换', () => {
  /** face 预算 0% + footprint 与区域完全重合 ⇒ 平移网格内无解，必落到 tier2。 */
  const BIG_FP: [number, number, number, number] = [0.2, 0.2, 0.6, 0.6];
  const BIG_BOX: [number, number, number, number] = [0.2, 0.2, 0.6, 0.6];

  it('T3 tier2 必须**真正写入** carrier.params.window（主体锚定裁切窗）', () => {
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
    runValidation(ctx);

    // 🔴 P3 的核心断言：声明了载体**必须**留下可被渲染期消费的 window。
    //   通道方案 A 打通后，这个 window 真的会改变成片 —— 写不进去就是又一次假绿。
    const w = ctx.scene[0]?.item.carrier?.params?.['window'];
    expect(w).toBeDefined();
    expect(Array.isArray(w)).toBe(true);
    const [wx = -1, wy = -1, ww = -1, wh = -1] = w as number[];
    // 全高竖条
    expect(wy).toBe(0);
    expect(wh).toBe(1);
    // 宽被钳制在 [0.3, 0.7]
    expect(ww).toBeGreaterThanOrEqual(0.3);
    expect(ww).toBeLessThanOrEqual(0.7);
    // 左边界必须钳在画面内（主体贴边时窗口不能有一部分落在画面外）
    expect(wx).toBeGreaterThanOrEqual(0);
    expect(wx + ww).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('T3a 施加后若仍超预算 → 必须报 E-D2-01，不得谎称退让成功', () => {
    // face 预算为 0，而载体最低只能缩到 30% 宽 ⇒ 主体必然还有部分落在展示条内。
    // 这是 P3 实测中暴露的第三层假绿：几何写了，但冲突一点没解。
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
    const codes = runValidation(ctx).items.map((i) => i.code);

    expect(codes).toContain('E-D2-01');
    expect(codes).not.toContain('W-D4-01');
    // 且必须解释清楚「为什么载体救不了」—— 预算是 0，载体有下限
    const item = runValidation(ctx).items.find((i) => i.code === 'E-D2-01');
    expect(item?.message).toMatch(/仍被遮挡/);
  });

  it('T3b 退让成功后不得静默 —— 必须留下可对账的条目', () => {
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
    // 与 T3a 同一场景，但断言「必须有条目」这件事本身：
    // 无论成功还是失败，都不允许静默通过（2026-10-13 起的老规矩）。
    const items = runValidation(ctx).items;
    expect(items.length).toBeGreaterThan(0);
    // 载体系信息必须出现在消息里，含裁切窗与前后遮挡率，可对账
    const carrierish = items.find((i) => /载体档|展示条/.test(i.message));
    expect(carrierish?.message).toMatch(/展示条|裁切窗/);
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
