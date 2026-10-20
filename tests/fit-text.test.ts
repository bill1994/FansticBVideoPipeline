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
import { fitScale, fitScaleFor, templateTextMetrics } from '../src/remotion/templates/contract.tsx';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.ts';
import { estimateTextWidthPx } from '../src/validate/text-metrics.ts';
import type { StoryboardItem } from '../src/core/types.ts';

/** 造一个最小可用的 item：只需 motion + footprint 的宽度项。 */
function mkItem(motion: string, fw: number): StoryboardItem {
  return {
    id: 'i1',
    motion,
    trackId: 't1',
    fromFrame: 0,
    durationInFrames: 60,
    footprint: [0.1, 0.1, fw, 0.2],
    params: {},
  } as unknown as StoryboardItem;
}

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

/**
 * 🔴 防「同一个概念两个真源」—— 本组测试的存在理由。
 *
 * 2026-10-20 铺开 `fitScale` 时实测发现：`stat-card` / `tag-float` 的调用把
 * `border:1.5px × 2 = 3px` 算进了 padding（51 / 43），
 * 而契约 `textMetrics` 只算 padding（48 / 40）。
 *
 *🔴 **既有测试只锁了 `fontSizePx == 组件字号`，没锁 padding，也没锁
 *    「组件的 fitScale 调用是否读了契约」** ⇒ 口径分叉能一路活到成片，
 *    且没有任何测试会红（项目第6 次「定义了≠生效」）。
 *
 * 所以这里断言的不是某个数值，而是**结构事实**：调用方一律走
 * `fitScaleFor`（它内部只从契约取值），组件里不允许出现字号/padding 字面量。
 */
describe('fitScale 的字号与内边距只从契约取', () => {
  const WITH_TEXT = BUILTIN_TEMPLATES.filter((t) => t.textMetrics !== undefined);

  it('🔴 带 textMetrics 的模板都已接上fitScale（覆盖不完整 = 机制建好却没用满）', () => {
    // 契约声明了可测文本，就说明模型能填长文本 ⇒ 渲染期必须有兜底。
    // 少一个就会出现「校验报了 warning、渲染却把字甩出画面」。
    const covered = [
      'typography/kinetic-line@1.0',
      'typography/lower-third@1.0',
      'typography/tag-float@1.0',
      'typography/center-emphasis@1.0',
      'data/stat-card@1.0',
    ];
    expect(WITH_TEXT.map((t) => t.id).sort()).toEqual(covered.sort());
  });

  it('🔴 模板源码里不许出现 fontSize / padding 的 fitScale 字面量', () => {
    // 反向断言：任何 `fitScale(<text>, <数字>, ...)` 的直接调用都视为违规。
    // （`fitScaleFor` 内部会调 `fitScale`，但那是契约驱动的，不在此列。）
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const dir = path.join(process.cwd(), 'src/remotion/templates');
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
      if (f === 'contract.tsx') continue; // 定义处本身用字面量是合法的
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      // 匹配 `fitScale(` 后面跟数字（而不是 `fitScaleFor(`）
      if (/fitScale\(\s*['"`]?[\w'"]*\s*,\s*\d/.test(src)) offenders.push(f);
    }
    expect(offenders, `这些模板仍在直接调 fitScale 并写字面量：${offenders.join(', ')}`).toEqual([]);
  });

  it('🔴 fitScaleFor 的结果与「按契约手工算的」完全一致', () => {
    for (const t of WITH_TEXT) {
      const m = templateTextMetrics(t.id);
      expect(m, `${t.id} 应能取到契约度量`).not.toBeNull();
      const fw = t.footprint![2]!;
      const item = mkItem(t.id, fw);
      const long = '字'.repeat(40);
      const expected = fitScale(long, m!.fontSizePx, fw * 1920, m!.paddingPx);
      expect(fitScaleFor(long, t.id, item, 1920)).toBeCloseTo(expected, 10);
    }
  });

  it('🔴 无 textMetrics 的模板返回 1（不缩、不抛）', () => {
    // 字幕带 / 载体类 / fullscreen：文本不来自模型，没有长文案风险。
    // 抛错会让一条参数缺失毁掉整条渲染（同 resolveEnter 的静默回退判断）。
    for (const id of [
      'caption/karaoke-word@1.0',
      'carrier/split-frame@1.0',
      'cinematic/punch-in@1.0',
      'ambience/noise-grain@1.0',
    ]) {
      expect(templateTextMetrics(id), `${id} 不该有 textMetrics`).toBeNull();
      expect(fitScaleFor('字'.repeat(80), id, mkItem(id, 0.3), 1920)).toBe(1);
    }
  });

  it('🔴 契约与校验器用的是同一份度量（渲染期不得比校验期更宽松）', () => {
    // 「校验说没超、渲染却缩了」互相打脸的防线：
    // 同一文本下，渲染期可用宽必须 ≤ 校验期可用宽（即渲染缩得**不更松**）。
    for (const t of WITH_TEXT) {
      const m = t.textMetrics!;
      const slack = m.slackRatio ?? 0.15;
      const pad = m.paddingPx ?? 0;
      const fwPx = t.footprint![2]! * 1920;
      const validateAvail = fwPx - pad;      // 校验器口径（text-metrics.ts: 减一次）
      const renderAvail = fwPx - pad * 2;    // fitScale：available = 宽 − padding×2
      expect(
        renderAvail,
        `${t.id}: 渲染期可用宽 ${renderAvail} 竟大于校验期 ${validateAvail} ⇒ 会「校验没超但渲染缩了」`,
      ).toBeLessThanOrEqual(validateAvail);
      // 且校验器的余量档必须为正，否则估算误差会直接变成误报/漏报
      expect(slack).toBeGreaterThan(0);
      expect(estimateTextWidthPx('字', m)).toBeCloseTo(m.fontSizePx, 5);
    }
  });
});
