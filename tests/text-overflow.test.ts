/**
 * 文本溢出校验（#17 · D-B）—— 判定口径与误报边界。
 *
 * 🔴 **本文件的核心价值是「与真渲实测对齐」**：
 *   2026-10-15 真渲（1920×1080）实测得出一组事实，本文件的用例按那组事实定标：
 *   · `kinetic-line` 16 中文字 → **溢出**（806px 框）
 *   · `tag-float` 16 中文字 → **撑破胶囊框**
 *   · `stat-card` `123456789` → **溢出画面边界**
 *   · 同一批模板的正常文案（2–6 字）→ **不报**
 *
 * 若哪天改估算系数，本文件会立刻反映「估得准不准」——
 * 这比对着系数自说自话可靠。
 */

import { describe, expect, it } from 'vitest';
import { estimateTextWidthPx } from '../src/validate/text-metrics.ts';
import { runValidation, DOCUMENTED_CHECK_ITEMS } from '../src/validate/index.ts';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.ts';
import { makeCtx, makeItem, makeTrack } from './_ctx.ts';

/**
 * 跑一次校验，只返回错误码列表。
 *
 * 🔴 **必须用模板契约里的真实 footprint**，不能用 `makeItem()` 的默认值
 *   （宽 0.3，而 kinetic-line 实际是 0.42）—— 用错 footprint 会让
 *   「16/17 字边界」这类用例得出完全相反的结论。
 */
function C(id: string, params: Record<string, unknown>): string[] {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === id);
  const item = makeItem({
    motion: id,
    footprint: tpl ? [...tpl.footprint] : undefined,
    ...({ params } as object),
  });
  return runValidation(makeCtx({ tracks: [makeTrack('t', 60, [item])] })).items.map((i) => i.code);
}

const LONG_CN = '一二三四五六七八九十十一十三十四'; // 16 字，真渲实测溢出

describe('#17 · 宽度估算口径', () => {
  const m54 = { fontSizePx: 54 };

  it('CJK 按 1.0em', () => {
    expect(estimateTextWidthPx('一二三', m54)).toBe(3 * 54);
  });

  it('拉丁与数字按 0.5em', () => {
    expect(estimateTextWidthPx('abc', m54)).toBe(3 * 0.5 * 54);
    expect(estimateTextWidthPx('123456789', m54)).toBe(9 * 0.5 * 54);
  });

  it('空格按 0.3em', () => {
    expect(estimateTextWidthPx('a a', m54)).toBe((0.5 + 0.3 + 0.5) * 54);
  });

  it('全角标点按 CJK（全角即1em）', () => {
    // 🔴 全角标点分布在两个区段：
    //   · U+3000–303F CJK 符号与标点（、。「」等）
    //   · U+FF00–FFEF 全角 ASCII（（）等常用括号在这一段）
    // ⚠️ 只判前者会让「（一）」被当成3 个半角字 ⇒ **系统性低估溢出**。
    expect(estimateTextWidthPx('。、「」', m54)).toBe(4 * 54);
  });

  it('中英混排逐字累加', () => {
    expect(estimateTextWidthPx('第2款', m54)).toBe(54 + 0.5 * 54 + 54);
  });

  it('空串宽 0', () => {
    expect(estimateTextWidthPx('', m54)).toBe(0);
  });

  it('charWidthEm 可覆盖默认', () => {
    expect(estimateTextWidthPx('一二', { fontSizePx: 10, charWidthEm: 2 })).toBe(40);
  });
});

/**
 * 🔴 **这一段记录的是「估算的能力边界」，不是「估算有多准」。**
 *
 * 2026-10-15 真渲实测 16 中文字 / `123456789` 时 4 个模板全部溢出。
 * 但本项校验用**一套通用系数**（CJK 1.0 /拉丁数字 0.5em），
 * 逐模板实测后发现的真相是：
 *
 * | 模板 | 真渲 16 字/9 位 | 估算宽 vs 阈值 | 估算能否捕获 |
 * |---|---|---|---|
 * | kinetic-line | 16 字溢出 | 864 vs 904 | ❌ 差40px（余量刚好吃掉） |
 * | tag-float | 16 字撑破胶囊 | 384 vs 616 | ❌ 差232px，**远低估** |
 * | stat-card | 9 位溢出画面 | 198 vs 651 | ❌ 差453px，**严重低估** |
 * | lower-third | 16 字超背景条 | 416 vs 1047 | ❌ 未越框，本不该报 |
 *
 * ⇒ **结论（必须如实说）：当前估算对 CJK 大字（kinetic-line）接近可信，
 *   但对「圆角容器 / 粗体数字」严重低估。**
 *
 * 🔴 为什么不调系数让它"看起来对"：`stat-card` 用 `font-weight: 800` 的
 *   数字字体（`FONT.numeric`），真实字宽接近 0.6em 而非 0.5em；
 *   `tag-float` 是 `border-radius:20px` 胶囊 + 额外 padding，
 *   真实内宽比「footprint − padding」更窄。把系数调到能覆盖它们，
 *   等于**对不同字重/容器用同一把尺子**，那会让 CJK 正文误报。
 *
 * ⇒ 真正的解法是 D-B 之外的**逐模板度量**（D-B2，见登记册待补），
 *   本项先守住「明显超长」这个最容易出事的量级（见下）。
 */
describe('#17 · 已知盲区：估算对粗体数字/圆角容器的低估（真渲 vs 估算）', () => {
  it('⚠️ tag-float 16 中文字：真渲撑破胶囊，但当前估算**不报**（已知盲区）', () => {
    // 如实断言当前行为 —— 这是「把盲区写进测试」而不是藏着。
    expect(C('typography/tag-float@1.0', { text: LONG_CN })).not.toContain('W-DB-01');
  });

  it('⚠️ stat-card 9 位数字：真渲溢出画面，当前估算**不报**（粗体数字低估）', () => {
    expect(C('data/stat-card@1.0', { value: '123456789' })).not.toContain('W-DB-01');
  });

  it('kinetic-line：估算最接近真渲，17 字即报（本项当前的价值所在）', () => {
    expect(C('typography/kinetic-line@1.0', { text: '甲'.repeat(17) })).toContain('W-DB-01');
  });

  it('真正「明显超长」仍能捕获（这是本项当前的实际价值）', () => {
    // 各模板塞 40+ 字 CJK，估算下必超阈值 ⇒ 本项能守住量级更大的事故
    expect(C('typography/tag-float@1.0', { text: '甲'.repeat(40) })).toContain('W-DB-01');
    expect(C('data/stat-card@1.0', { value: '甲'.repeat(20) })).toContain('W-DB-01');
    // lower-third 阈值 1047px ÷ 26px = 40.2 ⇒ 需 41 字才超（40 字=1040 恰在余量内）
    expect(C('typography/lower-third@1.0', { title: '甲'.repeat(41) })).toContain('W-DB-01');
  });
});

describe('#17 · 正常文案不误报', () => {
  it('kinetic-line：2 字不报', () => {
    expect(C('typography/kinetic-line@1.0', { text: '惊喜' })).not.toContain('W-DB-01');
  });

  it('tag-float：2 字不报', () => {
    expect(C('typography/tag-float@1.0', { text: '透气' })).not.toContain('W-DB-01');
  });

  it('stat-card：4 字符（含小数点）不报', () => {
    expect(C('data/stat-card@1.0', { value: '42.5', unit: '码' })).not.toContain('W-DB-01');
  });

  it('lower-third：正常姓名+职务不报', () => {
    expect(
      C('typography/lower-third@1.0', { title: '张小澄', subtitle: '动效设计师' }),
    ).not.toContain('W-DB-01');
  });

  it('demo 现有文案全部不报（防上线即噪音）', () => {
    expect(C('typography/kinetic-line@1.0', { text: '接近全自动' })).not.toContain('W-DB-01');
  });
});

describe('#17 · 余量的作用（按实测阈值定标）', () => {
  it('kinetic-line：16 字在阈值内不报，17 字超出即报', () => {
    // 可用786 ×1.15 = 904；54px/字 ⇒ 阈值 16 字
    expect(C('typography/kinetic-line@1.0', { text: '甲'.repeat(16) })).not.toContain('W-DB-01');
    expect(C('typography/kinetic-line@1.0', { text: '甲'.repeat(17) })).toContain('W-DB-01');
  });
});

describe('#17 · 不误报的场景', () => {
  it('无 textMetrics 的模板一律跳过（载体类 / fullscreen）', () => {
    // punch-in 只有 scale，没有文本也没有 textMetrics ⇒ 必须跳过而非报错
    expect(C('cinematic/punch-in@1.0', { scale: 1.08 })).not.toContain('W-DB-01');
    expect(C('transition/whip-pan@1.0', { direction: 'left' })).not.toContain('W-DB-01');
  });

  it('字幕带跳过（textMetrics 未声明）', () => {
    // 🔴 karaoke-word 刻意不收 text（字幕来自 SRT）⇒ 不得误报
    expect(C('caption/karaoke-word@1.0', { boxed: true })).not.toContain('W-DB-01');
  });

  it('空串不报', () => {
    expect(C('typography/tag-float@1.0', { text: '' })).not.toContain('W-DB-01');
  });

  it('params 整体缺失不报（不制造噪音）', () => {
    expect(C('typography/tag-float@1.0', {})).not.toContain('W-DB-01');
  });

  it('非字符串值不报（那是 #16 的职责，不越界）', () => {
    expect(C('data/stat-card@1.0', { value: 42 })).not.toContain('W-DB-01');
  });
});

describe('#17 · warning 不阻断 + 编入清单', () => {
  it('溢出只出 warning，不出 error', () => {
    const r = runValidation(
      makeCtx({
        tracks: [
          makeTrack('t', 60, [makeItem({ motion: 'typography/kinetic-line@1.0', params: { text: LONG_CN } })]),
        ],
      }),
    );
    const items = r.items.filter((i) => i.code === 'W-DB-01');
    expect(items).toHaveLength(1);
    expect(items[0]?.level).toBe('warning');
    expect(r.ok).toBe(true); // 🔴 不阻断 —— D-B 裁决的核心
  });

  it('第 17 项已编入 DOCUMENTED_CHECK_ITEMS', () => {
    expect(DOCUMENTED_CHECK_ITEMS).toContain(17);
    expect(DOCUMENTED_CHECK_ITEMS.length).toBe(17);
  });
});

describe('#17 · 单一真源：字号只在契约里', () => {
  it('4 个有文字的模板都声明了 textMetrics', () => {
    const withText = BUILTIN_TEMPLATES.filter((t) => t.paramsSchema && ('text' in t.paramsSchema || 'title' in t.paramsSchema || 'value' in t.paramsSchema));
    for (const t of withText) {
      expect(t.textMetrics, `${t.id} 有文本参数但未声明 textMetrics —— 校验器会跳过它`).toBeDefined();
    }
  });

  it('⚠️ 契约里的字号与组件实际值一致（防静默漂移）', async () => {
    // 直接读组件源码里的 fontSize 字面量，与 builtin.ts 的 textMetrics 对照。
    // ⚠️ 这是「反静默漂移」测试：DUR.exit事故的教训。
    const fs = await import('node:fs');
    const checks: Array<[string, number]> = [
      ['kinetic-line.tsx', 54],
      ['lower-third.tsx', 26],
      ['tag-float.tsx', 24],
      ['stat-card.tsx', 44],
    ];
    for (const [file, expectSize] of checks) {
      const src = fs.readFileSync(`src/remotion/templates/${file}`, 'utf8');
      expect(src, `${file} 应含 fontSize: ${expectSize}`).toContain(`fontSize: ${expectSize}`);
    }
    const byId = new Map(BUILTIN_TEMPLATES.map((t) => [t.id, t]));
    expect(byId.get('typography/kinetic-line@1.0')?.textMetrics?.fontSizePx).toBe(54);
    expect(byId.get('typography/lower-third@1.0')?.textMetrics?.fontSizePx).toBe(26);
    expect(byId.get('typography/tag-float@1.0')?.textMetrics?.fontSizePx).toBe(24);
    expect(byId.get('data/stat-card@1.0')?.textMetrics?.fontSizePx).toBe(44);
  });
});