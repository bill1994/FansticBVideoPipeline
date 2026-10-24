/**
 * 文本溢出校验（#17 · D-B）—— 判定口径与误报边界。
 *
 * 🔴 **本文件的核心价值是「与真渲实测对齐」**：
 *   · `kinetic-line` 16 中文字在 806px 框内**刚好放下**、17 字才报；
 *   · `tag-float` 16 字 = 384px 文本 + 40 padding + 3 边框 = 427px < 576px 框 ⇒ **不越框**；
 *   · `stat-card` 9 位数字 = 264px + 48 padding + 3 边框 = 315px < 614px 框 ⇒ **不越框**；
 *   · 同一批模板的正常文案（2–6 字）→ **不报**。
 *
 * ⚠️ **2026-10-24 D-B2 复核更正**：2026-10-15 记录的「tag-float 16 字撑破 /
 *   stat-card 9 位溢出画面」在**声明 footprint** 下无法复现（算术见上）。
 *   那两条旧观测应来自被覆盖过的 footprint；现以
 *   `docs/templates/2026-10-24-文本度量实测表.json` 为准 ——
 *   实测显示 CJK 系数 1.0 是对的，数字系数被旧默认 0.5 低估约 33%
 *   （各模板 0.615–0.667，已回填 `latinWidthEm`）。
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

  it('🔴 D-B2：latinWidthEm 与 charWidthEm 是两把尺子', () => {
    expect(estimateTextWidthPx('12', { fontSizePx: 10, latinWidthEm: 0.667 })).toBeCloseTo(13.34, 5);
    // 拉丁系数不影响 CJK
    expect(estimateTextWidthPx('一二', { fontSizePx: 10, charWidthEm: 1, latinWidthEm: 0.667 })).toBe(20);
  });
});

/**
 * 🔴 **D-B2 实测后的边界（2026-10-24），不是「估算有多准」的猜测。**
 *
 * 实测表（`docs/templates/2026-10-24-文本度量实测表.json`）给出：
 * · 6 个文字模板的 CJK 系数全部 = 1.000em；
 * · 数字系数 0.615–0.667em，旧默认 0.5em **系统性低估约 33%**；
 * · `stat-card` 的 `FONT.numeric` 800 粗体最宽（0.667em）。
 *
 * 这解释了旧记录的两个「溢出」为何复现不了：
 * · tag-float 16 字 → 文本 384px + padding 40 + 边框 3 = 427px < footprint 576px；
 * · stat-card 9 位 → 文本约 264px + padding 48 + 边框 3 = 315px < footprint 614px。
 * ⇒ 在**声明 footprint** 下它们本就放得下，不报是正确行为，不是盲区。
 *   （旧观测很可能用了被覆盖过的 footprint；D-B2 以声明值为准。）
 *
 * 当前仍要守的是「明显超长」：40+ 字 CJK / 30 位数字（见下）。
 */
describe('#17 · D-B2 实测后的边界（旧「16字/9位溢出」结论已复核）', () => {
  it('tag-float 16 中文字：声明 footprint 下放得下 ⇒ 不报（不是盲区）', () => {
    expect(C('typography/tag-float@1.0', { text: LONG_CN })).not.toContain('W-DB-01');
  });

  it('stat-card 9 位数字：声明 footprint 下放得下 ⇒ 不报（不是盲区）', () => {
    expect(C('data/stat-card@1.0', { value: '123456789' })).not.toContain('W-DB-01');
  });

  it('kinetic-line：估算最接近真渲，17 字即报（本项当前的价值所在）', () => {
    expect(C('typography/kinetic-line@1.0', { text: '甲'.repeat(17) })).toContain('W-DB-01');
  });

  it('真正「明显超长」仍能捕获（这是本项当前的实际价值）', () => {
    // 各模板塞 40+ 字 CJK，估算下必超阈值 ⇒ 本项能守住量级更大的事故
    expect(C('typography/tag-float@1.0', { text: '甲'.repeat(40) })).toContain('W-DB-01');
    // stat-card 的系数按**数字**实测（0.667em，D-B2）；用数字做超长用例，
    // 因为该模板语义上就是数字卡，CJK 不是合法用法（#16 只验类型、不判语义）。
    expect(C('data/stat-card@1.0', { value: '1'.repeat(30) })).toContain('W-DB-01');
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

  it('pointer-callout 的 target 参与判定（不是零覆盖字段）', () => {
    // footprint 0.2×1920=384，padding 26 ⇒ 可用 358×1.15≈412；30 字×20px=600 必超
    expect(C('annotation/pointer-callout@1.0', { target: '甲'.repeat(30) })).toContain('W-DB-01');
    // 正常长度（≤20 字 = 400px）不报
    expect(C('annotation/pointer-callout@1.0', { target: '鞋底纹路' })).not.toContain('W-DB-01');
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
    // 刻意不断言长度：清单是活清单，每增补一项都要改这里就是脆弱耦合。
    // 长度由 tests/validate.test.ts 的基线测试统一把关。
  });
});

describe('#17 · 单一真源：字号只在契约里', () => {
  it('所有带文字参数的模板都声明了 textMetrics（含 D-A 新增）', () => {
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
      ['center-emphasis.tsx', 72],
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
    expect(byId.get('typography/center-emphasis@1.0')?.textMetrics?.fontSizePx).toBe(72);
  });
});