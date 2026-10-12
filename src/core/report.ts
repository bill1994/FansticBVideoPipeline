/**
 * 校验报告契约。
 *
 * 真源：SPEC §2.9（Spec 自定 —— 进度文档与登记册均未定义字段结构）。
 * 硬要求：同一输入必须产出**逐字节一致**的报告，可直接入 git diff。
 */

import type { Level } from './errors.ts';

export type Stage = 'build' | 'render';

export interface ReportItem {
  code: string;
  level: Level;
  /** 稳定的机器可读标识，来自 CodeSpec.check。 */
  check: string;
  /** 决策编号，可回溯 OPEN-DECISIONS.md。 */
  source: string;
  stage: Stage;
  /** `trackId/itemIndex`，itemIndex 补零到 3 位。 */
  targets: string[];
  /** 相关帧区间 [start, end]；不适用时为空数组。 */
  frames: number[];
  message: string;
  /** 给人看的修法提示。**不参与机器判定**。 */
  hint: string;
}

export interface ValidateReport {
  jobId: string;
  /** 无 error 才为 true。warning 不影响。 */
  ok: boolean;
  summary: {
    error: number;
    warning: number;
    /** 实际执行的**文档 14 项**校验数。全跑时为 14。 */
    checked: number;
    /**
     * 14 项之外、但仍会执行的起草原生约束（各自的码）。
     *
     * 来源：SPEC §1.4（禁配段 → error）、D3（fullscreen 人工确认）、F6（主体未确告警）。
     * 这三条在进度文档里各有明文，**却未进 F2 的 14 项表** —— 两份清单存在缺口，
     * 此处显式列出，避免「checked=14 就以为全跑完了」的误读。
     */
    extra: string[];
  };
  items: ReportItem[];
}

/** itemIndex 补零到 3 位，与 SPEC §2.9 示例的 `typo-a/000` 一致。 */
export function targetRef(trackId: string, itemIndex: number): string {
  return `${trackId}/${String(itemIndex).padStart(3, '0')}`;
}

/**
 * 确定性排序：level（error 在前）→ code → targets → frames。
 * 末尾三项是为了让「同码多条命中」也有稳定顺序。
 */
export function sortItems(items: ReportItem[]): ReportItem[] {
  return [...items].sort((a, b) => {
    if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const ta = a.targets.join(',');
    const tb = b.targets.join(',');
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.frames[0] ?? -1) - (b.frames[0] ?? -1);
  });
}

export function buildReport(
  jobId: string,
  items: ReportItem[],
  checked: number,
  extra: string[] = [],
): ValidateReport {
  const sorted = sortItems(items);
  const error = sorted.filter((i) => i.level === 'error').length;
  const warning = sorted.filter((i) => i.level === 'warning').length;
  return {
    jobId,
    ok: error === 0,
    summary: { error, warning, checked, extra: [...extra].sort() },
    items: sorted,
  };
}

/** 供 CLI 打印的人读摘要。 */
export function formatSummary(report: ValidateReport): string {
  const { error, warning, checked, extra } = report.summary;
  const head = report.ok
    ? `✅ 校验通过（checked=${checked} 项 + ${extra.length} 条起草原生约束, warning=${warning}）`
    : `⛔ 校验未过（checked=${checked} 项 + ${extra.length} 条起草原生约束, error=${error}, warning=${warning}）`;
  const lines = [head];
  for (const i of report.items) {
    const t = i.targets.length ? ` [${i.targets.join(', ')}]` : '';
    lines.push(`   ${i.level === 'error' ? '✗' : '!'} ${i.code}${t} ${i.message}`);
    if (i.hint) lines.push(`     ↳ ${i.hint}`);
  }
  return lines.join('\n');
}
