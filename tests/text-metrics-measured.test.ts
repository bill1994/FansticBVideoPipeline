/**
 * D-B2 实测表 ↔ 契约值一致性。
 *
 * ── 为什么这条测试值得存在 ─────────────────────────────────────
 * 实测表（`docs/templates/2026-10-24-文本度量实测表.json`）是**证据**，
 * 契约里的 `charWidthEm` / `latinWidthEm` 是**判定依据**。两者一旦分叉：
 * 表说「这模板数字 0.667em」，校验器却仍按 0.5em 估 ⇒ 实测表变成摆设。
 *
 * 这与本项目反复栽过的「同一概念两个真源」同款（split-frame 坐标系 /
 * `clampScale` / 字号表），所以这里把两张表钉在一起：
 * **改契约必须重跑工具**（或至少让这条测试变红）。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.ts';
import { isImplemented } from '../src/remotion/templates/index.tsx';

interface ClassRow {
  char: string;
  lengths: number[];
  widthsPx: number[];
  pxPerChar: number;
  measuredEm: number;
  currentEm: number;
}

interface MeasuredRow {
  id: string;
  key: string;
  fontSizePx: number;
  classes: { cjk: ClassRow; latin: ClassRow };
}

interface MeasuredPayload {
  tool: string;
  method: { composition: string; lengths: number[]; classes: Array<{ name: string; char: string }> };
  environment: { platform: string };
  measurements: MeasuredRow[];
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const tablePath = path.join(repoRoot, 'docs/templates/2026-10-24-文本度量实测表.json');
const table = JSON.parse(readFileSync(tablePath, 'utf8')) as MeasuredPayload;

describe('D-B2 实测表 · 结构与来源', () => {
  it('由约定工具生成，测量的是真实模板合成', () => {
    expect(table.tool).toBe('tools/measure-text-metrics.mts');
    expect(table.method.composition).toBe('TextMetricsProbe');
    expect(table.method.lengths).toEqual([1, 2, 10]);
    expect(table.environment.platform).toBe('win32');
  });

  it('按 CJK 与数字两类分别测量', () => {
    expect(table.method.classes).toEqual([
      { name: 'cjk', char: '测' },
      { name: 'latin', char: '1' },
    ]);
    for (const row of table.measurements) {
      expect(row.classes.cjk.char).toBe('测');
      expect(row.classes.latin.char).toBe('1');
    }
  });

  it('覆盖全部「有 textMetrics 且已实现」的内置模板', () => {
    const expected = BUILTIN_TEMPLATES.filter((t) => t.textMetrics && isImplemented(t.id))
      .map((t) => t.id)
      .sort();
    expect(table.measurements.map((m) => m.id).sort()).toEqual(expected);
  });
});

describe('D-B2 实测表 · 与契约值一致', () => {
  it('每个模板的实测 em 都等于契约（未声明 = 默认值）', () => {
    for (const row of table.measurements) {
      const tpl = BUILTIN_TEMPLATES.find((t) => t.id === row.id);
      expect(tpl, `${row.id} 不在声明表里`).toBeDefined();
      expect(tpl!.textMetrics?.fontSizePx, `${row.id} 字号与实测不符`).toBe(row.fontSizePx);
      expect(
        tpl!.textMetrics?.charWidthEm ?? 1,
        `${row.id} 的 CJK 系数与实测表不一致（改契约须重跑测量工具）`,
      ).toBeCloseTo(row.classes.cjk.measuredEm, 3);
      expect(
        tpl!.textMetrics?.latinWidthEm ?? 0.5,
        `${row.id} 的拉丁/数字系数与实测表不一致（改契约须重跑测量工具）`,
      ).toBeCloseTo(row.classes.latin.measuredEm, 3);
    }
  });

  it('🔴 stat-card 的数字是 0.667em，CJK 仍是 1.0em（两把尺子）', () => {
    const row = table.measurements.find((m) => m.id === 'data/stat-card@1.0')!;
    expect(row.classes.latin.pxPerChar).toBeCloseTo(29.35, 1);
    expect(row.classes.latin.measuredEm).toBeCloseTo(0.667, 3);
    expect(row.classes.cjk.measuredEm).toBeCloseTo(1, 3);
  });

  it('D-B2 的核心发现：CJK 仍是 1.0em，但数字普遍宽于旧的 0.5em 假设', () => {
    for (const row of table.measurements) {
      expect(row.classes.cjk.measuredEm, row.id).toBeCloseTo(1, 3);
      // 旧默认 0.5em 对所有模板都低估；实测落在 0.61–0.67（本机字体栈）
      expect(row.classes.latin.measuredEm, row.id).toBeGreaterThan(0.5);
      expect(row.classes.latin.measuredEm, row.id).toBeLessThan(0.7);
    }
  });
});
