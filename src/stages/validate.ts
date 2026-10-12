/**
 * Stage 4 · validate —— 跑 14 项构建期校验，产出 validate-report.json。
 *
 * **必须停条件：有 error 必须停，不进渲染**（F2 的两处硬阻断之一）。
 * warning 不阻断。
 */

import path from 'node:path';
import { StageBlockedError } from '../core/exit-code.ts';
import { jobDir, stageDir, writeJson } from '../core/io.ts';
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

  const reportFile = path.join(
    stageDir(opts.jobId, STAGES.validate, opts.jobsDir),
    'validate-report.json',
  );
  writeJson(reportFile, report);

  process.stdout.write(`${formatSummary(report)}\n`);
  if (!report.ok) {
    log.error('有 error → 阻断，不进渲染。走人工返修回路（见 docs/spec 与 validate Skill）。');
  }
  return { report, reportFile };
}

export function reportPath(jobId: string, jobsDir?: string): string {
  return path.join(jobDir(jobId, jobsDir), STAGES.validate, 'validate-report.json');
}
