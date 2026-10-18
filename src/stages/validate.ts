/**
 * Stage 4 · validate —— 跑构建期校验项（当前 18 项），产出 validate-report.json。
 *
 * **必须停条件：有 error 必须停，不进渲染**（F2 的两处硬阻断之一）。
 * warning 不阻断。
 */

import { StageBlockedError } from '../core/exit-code.ts';
import { writeStageJson } from '../core/io.ts';
import { log } from '../core/log.ts';
import { formatSummary, type ValidateReport } from '../core/report.ts';
import { buildContext, runValidation } from '../validate/index.ts';
import { STAGES } from '../core/config.ts';

export interface ValidateOptions {
  jobId: string;
  jobsDir?: string;
}

export interface ValidateOutcome {
  report: ValidateReport;
  reportFile: string;
}

export function runValidateStage(opts: ValidateOptions): ValidateOutcome {
  if (!opts.jobId) throw new StageBlockedError('缺少 jobId');

  log.stage('validate', '构建期校验（纯 JSON→JSON，不渲染）');
  const ctx = buildContext(opts.jobId, opts.jobsDir);
  const report = runValidation(ctx);

  // 🔴 落盘走 writeStageJson：不可变快照守卫的唯一执行点（2026-10-18 接线）。
  //   04 阶段写 03 会在**落盘之前**被拦下（见 tests/stage-io.test.ts）。
  const reportFile = writeStageJson({
    jobId: opts.jobId,
    self: STAGES.validate,
    target: STAGES.validate,
    file: 'validate-report.json',
    data: report,
    jobsDir: opts.jobsDir,
  });

  process.stdout.write(`${formatSummary(report)}\n`);
  if (!report.ok) {
    log.error('有 error → 阻断，不进渲染。走人工返修回路（见 docs/spec 与 validate Skill）。');
  }
  return { report, reportFile };
}
