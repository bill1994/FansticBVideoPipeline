/**
 * D4-t2 / P1 —— `StoryboardItem.carrier` 契约的结构校验。
 *
 * 🔴 **这个文件在防什么**：
 * `carrier.template` 是一个**跨文档引用**（指向模板注册表）。若注册表里没有它、
 * 或它指向的不是一个载体类模板，那么「画面缩进载体」这件事在渲染期就无从谈起 ——
 * 而校验器若静默放过，成片会**照常渲染出来、报告写着通过**，只是画面没退让。
 * 这与项目反复出现的同款病（「定义了没人用」「出了错没人拦」）是同一类。
 *
 * 三条判定都归**结构检查**（抛 `ConfigError` → 退出码 2），不降级成 report 条目：
 * 模板 id 打错是**配置写错**，不是「内容没做好」—— 报成校验项会让返修方向从一开始就错
 * （读者会去调 footprint，而真正要改的是 id）。
 *
 * ── 刻意不覆盖的 ────────────────────────────────────────────────
 * `carrier.params` 的**语义**校验（`side` / `ratio` / `window` 的值域）不在这里：
 * 载体模板 `carrier/split-frame@1.0` **尚无 .tsx 实现**，P2 才定 paramsSchema。
 * 现在校验值域等于凭空发明规则 —— 那是 `D-B` 栽过的跟头（通用系数套不住差异巨大的容器）。
 */

import { describe, expect, it } from 'vitest';
import { bake } from '../src/core/bake.ts';
import { ConfigError } from '../src/core/exit-code.ts';
import { runValidation } from '../src/validate/index.ts';
import type { CarrierRef, Storyboard } from '../src/core/types.ts';
import {
  CARRIER,
  carrierOf,
  makeCtx,
  makeOccludingItem,
  makeTrack,
  makeWords,
} from './_ctx.ts';

const OVERLAY = 'typography/kinetic-line@1.0'; // overlay-safe ⇒ 非载体类

/** 跑一次校验，把 item 的 carrier 声明注入到夹具上。 */
function runWith(carrier: CarrierRef | undefined, extra: Record<string, unknown> = {}) {
  const item = makeOccludingItem({
    fromFrame: 111,
    durationInFrames: 60,
    ...(carrier === undefined ? {} : { carrier }),
    ...extra,
  });
  return runValidation(makeCtx({ tracks: [makeTrack('a', 60, [item])] }));
}

describe('P1 · carrier 引用合法（不该拦的场景）', () => {
  it('未声明 carrier → 不报错（它是可选字段，不是必填）', () => {
    const report = runWith(undefined);
    expect(report.ok).toBe(true);
    expect(report.items).toEqual([]);
  });

  it('声明合法的载体模板 → 同样不报错', () => {
    const report = runWith(carrierOf());
    expect(report.ok).toBe(true);
  });

  it('未声明 carrier 时**不产生任何 carrier 相关码**（契约不凭空造条目）', () => {
    const codes = runWith(undefined).items.map((i) => i.code);
    expect(codes.filter((c) => c.includes('D4'))).toEqual([]);
  });
});

describe('P1 · carrier 引用非法（必须 ConfigError，不是 report 条目）', () => {
  it('模板未注册 → 抛错，消息点出 item ref 与模板名', () => {
    expect(() => runWith(carrierOf('carrier/does-not-exist@1.0'))).toThrow(ConfigError);
    expect(() => runWith(carrierOf('carrier/does-not-exist@1.0'))).toThrow(/a\/000/);
    expect(() => runWith(carrierOf('carrier/does-not-exist@1.0'))).toThrow(
      /does-not-exist/,
    );
  });

  it('指向叠加类模板 → 抛错（语义倒置：overlay 不能去包视频）', () => {
    expect(() => runWith(carrierOf(OVERLAY))).toThrow(ConfigError);
    expect(() => runWith(carrierOf(OVERLAY))).toThrow(/不是载体类/);
  });

  it('template 为空串 → 抛错', () => {
    expect(() => runWith(carrierOf(''))).toThrow(/非空字符串/);
  });

  it('params 为数组 → 抛错（渲染期键访问会静默失效）', () => {
    const bad = { template: CARRIER, params: [] as unknown as Record<string, unknown> };
    expect(() => runWith(bad)).toThrow(/必须是对象/);
  });

  it('params 为 null → 抛错（typeof null === "object" 的经典坑）', () => {
    const bad = { template: CARRIER, params: null as unknown as Record<string, unknown> };
    expect(() => runWith(bad)).toThrow(/必须是对象/);
  });
});

describe('P1 · 契约字段必须扛过烘焙', () => {
  it('bake 之后 carrier 仍在（烘焙器不得白名单式丢字段）', () => {
    const draft: Storyboard = {
      meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
      tracks: [
        {
          id: 'typo-a',
          layer: 60,
          items: [
            {
              fromFrame: 100,
              durationInFrames: 60,
              motion: OVERLAY,
              footprint: [0.05, 0.72, 0.3, 0.16],
              params: { text: 't' },
              carrier: carrierOf(),
            },
          ],
        },
      ],
      noMotionRanges: [],
    };
    const { storyboard } = bake(draft, makeWords(10), 30);
    expect(storyboard.tracks[0]?.items[0]?.carrier?.template).toBe(CARRIER);
  });

  it('bake 之前是**非法**引用 → 校验期仍须拦下（结构检查不因烘焙而放松）', () => {
    const draft: Storyboard = {
      meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
      tracks: [
        {
          id: 'typo-a',
          layer: 60,
          items: [
            {
              fromFrame: 100,
              durationInFrames: 60,
              motion: OVERLAY,
              footprint: [0.05, 0.72, 0.3, 0.16],
              params: { text: 't' },
              carrier: carrierOf(OVERLAY),
            },
          ],
        },
      ],
      noMotionRanges: [],
    };
    const { storyboard } = bake(draft, makeWords(10), 30);
    expect(() => runValidation(makeCtx({ tracks: storyboard.tracks }))).toThrow(ConfigError);
  });
});
