/**
 * 占位值注册表 —— D6.4 的防线。
 *
 * ─────────────────────────────────────────────────────────────
 * 这组测试要防的不是「代码 bug」，是**资产盘点失真**
 * ─────────────────────────────────────────────────────────────
 * 「占位值有几个」曾同时存在 8 / 7 / 3 三个口径，且没有一个能自证。
 * 结果是「校准占位值」这项工作**无法声明范围** —— 做完了也不知道做完了没有。
 *
 * 所以这里钉四件事：
 *   ① 计数唯一：只认 `PLACEHOLDERS.length`，id 必须唯一且稳定
 *   ② 值是真源的引用：`read()` 必须返回有限数，且与直接读常量**逐个相等**
 *   ③ 交叉引用不悬空：`alignWith` 指向的 id 必须存在
 *   ④ 历史标记不漏登记：`DENSITY` / `CONFIDENCE_BANDS` 上的 `placeholder: true`
 *      是上一代标记方式，它们必须仍被注册表覆盖（否则就是把旧标记删了却没补进新表）
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDERS,
  placeholderCount,
  placeholderValueCount,
  renderPlaceholderTable,
} from '../src/core/placeholders.ts';
import {
  ALIGN_GATE,
  DENSITY,
  HANDHELD_EXPANSION,
  PERCEIVE,
  RHYTHM,
  SALIENCY_TARGET_AREA_RATIO,
  SILENCE,
} from '../src/core/config.ts';
import { CONFIDENCE_BANDS } from '../src/core/schedule.ts';
import { CARRIER_RATIO_DEFAULT, MIN_VISIBLE_RATIO } from '../src/core/carrier-window.ts';
import { REWEIGH_COVERAGE_MIN } from '../src/core/word-timeline.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('占位值注册表 / 结构', () => {
  it('id 唯一且非空', () => {
    const ids = PLACEHOLDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.trim()).not.toBe('');
      // kebab-case：文档与日志会引用它，别用驼峰或中文
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('每项至少一个 member，且 label 不重复', () => {
    for (const p of PLACEHOLDERS) {
      expect(p.members.length).toBeGreaterThan(0);
      const labels = p.members.map((m) => m.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('计数与数组长度一致（项数 / 数值数两个口径都要能自证）', () => {
    expect(placeholderCount()).toBe(PLACEHOLDERS.length);
    expect(placeholderValueCount()).toBe(
      PLACEHOLDERS.reduce((n, p) => n + p.members.length, 0),
    );
  });

  it('alignWith 指向的 id 都存在，且不指向自己', () => {
    const ids = new Set(PLACEHOLDERS.map((p) => p.id));
    for (const p of PLACEHOLDERS) {
      for (const ref of p.alignWith ?? []) {
        expect(ids.has(ref), `${p.id} 引用了不存在的 ${ref}`).toBe(true);
        expect(ref).not.toBe(p.id);
      }
    }
  });

  it('source 形如 文件#符号，且文件真实存在', () => {
    for (const p of PLACEHOLDERS) {
      const [file, sym] = p.source.split('#');
      expect(sym, `${p.id} 的 source 缺少 #符号`).toBeTruthy();
      expect(existsSync(path.join(repoRoot, file!)), `${file} 不存在`).toBe(true);
    }
  });

  it('每项都写清了 basis / calibration / impact（空字符串不算）', () => {
    for (const p of PLACEHOLDERS) {
      for (const field of ['basis', 'calibration', 'impact'] as const) {
        expect(p[field].trim().length, `${p.id}.${field} 为空`).toBeGreaterThan(8);
      }
    }
  });
});

describe('占位值注册表 / 值是真源的引用而非副本', () => {
  it('read() 全部返回有限数', () => {
    for (const p of PLACEHOLDERS) {
      for (const m of p.members) {
        const v = m.read();
        expect(Number.isFinite(v), `${p.id}.${m.label} 不是有限数：${v}`).toBe(true);
      }
    }
  });

  it('每个 read() 与直接读常量逐个相等（防"抄一份数字"漂移）', () => {
    // 期望值一律**从真源取**，不在测试里写第二份数字
    const expected: Record<string, number> = {
      meanConfidenceMin: ALIGN_GATE.meanConfidenceMin,
      lowConfidenceRatioMax: ALIGN_GATE.lowConfidenceRatioMax,
      alignedRatioMin: ALIGN_GATE.alignedRatioMin,
      maxItemsPerCue: DENSITY.maxItemsPerCue,
      minCueFramesForMotion: RHYTHM.minCueFramesForMotion,
      'high': CONFIDENCE_BANDS.high,
      'mid': CONFIDENCE_BANDS.mid,
      safeAreaTopRatio: PERCEIVE.safeAreaTopRatio,
      widthRatio: HANDHELD_EXPANSION.widthRatio,
      heightRatio: HANDHELD_EXPANSION.heightRatio,
      targetAreaRatio: SALIENCY_TARGET_AREA_RATIO,
      CARRIER_RATIO_DEFAULT: CARRIER_RATIO_DEFAULT,
      MIN_VISIBLE_RATIO: MIN_VISIBLE_RATIO,
      noiseDb: SILENCE.noiseDb,
      minDurationSec: SILENCE.minDurationSec,
      longSilenceSec: SILENCE.longSilenceSec,
      overlapToleranceSec: SILENCE.overlapToleranceSec,
      REWEIGH_COVERAGE_MIN: REWEIGH_COVERAGE_MIN,
    };

    for (const p of PLACEHOLDERS) {
      for (const m of p.members) {
        const key = m.label.split('（')[0]!;
        const want = expected[key];
        expect(want, `测试期望表缺 ${p.id}.${m.label}`).toBeDefined();
        expect(m.read(), `${p.id}.${m.label}`).toBe(want);
      }
    }
  });

  it('注册表源码不含字面阈值（只许引用，不许抄数）', () => {
    // 🔴 这是本文件最关键的一条：`read: () => 0.35` 与直接引常量**单测测不出区别**，
    //    因为两者返回值相同。只有静态扫描才能抓住"抄一份数字"这种慢性漂移。
    const src = readFileSync(
      path.join(repoRoot, 'src/core/placeholders.ts'),
      'utf8',
    );
    // 排除接口声明行 `read: () => number;`（它不是一条注册项）
    const reads = src
      .split('\n')
      .filter((l) => l.includes('read: () =>') && !/read:\s*\(\)\s*=>\s*number\s*;/.test(l));
    expect(reads.length).toBe(placeholderValueCount());

    for (const line of reads) {
      const body = line.split('read: () =>')[1] ?? '';
      // 允许 `ALIGN_GATE.meanConfidenceMin`，禁止 `0.35` / `3` / `0.6 as const`
      expect(body, `出现字面阈值：${line.trim()}`).toMatch(
        /^\s*[A-Za-z_][\w.]*\s*[,}\]]?/,
      );
    }
  });

  it('注册表覆盖了上一代 `placeholder: true` 标记的全部对象', () => {
    // 这两处标记是 D6.4 之前唯一的机器可查线索，不能因为有了新表就丢掉它们
    expect(DENSITY.placeholder).toBe(true);
    expect(CONFIDENCE_BANDS.placeholder).toBe(true);

    const sources = PLACEHOLDERS.map((p) => p.source).join('\n');
    expect(sources).toContain('config.ts#DENSITY');
    expect(sources).toContain('schedule.ts#CONFIDENCE_BANDS');
  });
});

describe('占位值注册表 / 文档渲染', () => {
  it('表格行数 = 项数，且每项的值都出现在表里', () => {
    const md = renderPlaceholderTable();
    const bodyRows = md.split('\n').filter((l) => l.startsWith('| `'));
    expect(bodyRows.length).toBe(PLACEHOLDERS.length);

    for (const p of PLACEHOLDERS) {
      expect(md).toContain(`\`${p.id}\``);
      for (const m of p.members) {
        expect(md, `${p.id}.${m.label} 的值未进表`).toContain(`${m.read()}`);
      }
    }
  });

  it('表格里的值就是当前真源值（改常量后文档必须跟着变）', () => {
    const md = renderPlaceholderTable();
    for (const p of PLACEHOLDERS) {
      for (const m of p.members) {
        const re = new RegExp(
          `${m.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` = \\*\\*${m.read()}\\*\\*`,
        );
        expect(md, `${p.id}.${m.label} 渲染不匹配`).toMatch(re);
      }
    }
  });
});
