import type { CodeSpec } from '../core/errors.ts';
import type { ReportItem, Stage } from '../core/report.ts';

/** 构造一条报告条目。字段顺序固定，配合 sortKeys 保证逐字节可复现。 */
export function mk(
  spec: CodeSpec,
  stage: Stage,
  targets: string[],
  frames: number[],
  message: string,
  hint = '',
): ReportItem {
  return {
    code: spec.code,
    level: spec.level,
    check: spec.check,
    source: spec.source,
    stage,
    targets: [...targets].sort(),
    frames,
    message,
    hint,
  };
}
