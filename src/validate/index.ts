/**
 * 构建期校验器 —— 纯函数，逐项独立判定。
 *
 * 真源：SPEC §2（来源 F2）。两阶段分层：
 *  - **构建期**（本文件）：纯 JSON→JSON，不渲染，覆盖 14 项全部
 *  - **渲染期兜底**：字体未加载 / Canvas 未挂载 / GPU 上下文失败，
 *    只能在真实渲染时暴露，由 stages/render.ts 产出 `stage: "render"` 的条目
 *
 * 有 error 则阻断，不进渲染。warning 不拦。
 */

import { buildReport, type ReportItem, type ValidateReport } from '../core/report.ts';
import { buildContext, type ValidateContext } from './context.ts';
import { assertStructuralIntegrity, checkFootprintOverlap, checkSubjectCutBoundary } from './geometry.ts';
import {
  checkDensity,
  checkHandoffGap,
  checkMinVisible,
  checkTailTruncation,
  checkTiming,
  checkWordBoundary,
} from './timeline.ts';
import {
  checkBrollOcclusion,
  checkFullscreenConfirmation,
  checkNoMotionRanges,
  checkOcclusionBudget,
  checkSubjectUnknown,
} from './occlusion.ts';

/** 文档明示的 14 个校验项序号。第 5 项（主从冲突）不产条目，但**确实执行**。 */
export const DOCUMENTED_CHECK_ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

/** 14 项之外的起草原生约束 —— 文档有明文，却未进 F2 的 14 项表。 */
export const EXTRA_CHECKS = ['E-E5-01', 'W-D3-01', 'W-F6-01'] as const;

export function runValidation(ctx: ValidateContext): ValidateReport {
  // 结构错误（如 handoffTo 指向不存在的 track）应抛 ConfigError → 退出码 2，
  // 不降级成 report 条目 —— 那会让「配置错」看起来像「内容没做好」。
  assertStructuralIntegrity(ctx);

  const items: ReportItem[] = [
    // 时间轴类 9 项
    ...checkTiming(ctx), // #1
    ...checkDensity(ctx), // #2
    ...checkFootprintOverlap(ctx), // #3 / #4 / #5 / #11
    ...checkMinVisible(ctx), // #6
    ...checkWordBoundary(ctx), // #7
    ...checkSubjectCutBoundary(ctx), // #8
    ...checkHandoffGap(ctx), // #9

    // 工程与遮挡类 5 项
    ...checkTailTruncation(ctx), // #10
    ...checkOcclusionBudget(ctx), // #12 / #13
    ...checkBrollOcclusion(ctx), // #14

    // 起草原生约束
    ...checkNoMotionRanges(ctx), // E-E5-01（SPEC §1.4）
    ...checkFullscreenConfirmation(ctx), // W-D3-01（D3）
    ...checkSubjectUnknown(ctx), // W-F6-01（F6）
  ];

  return buildReport(ctx.jobId, items, DOCUMENTED_CHECK_ITEMS.length, [...EXTRA_CHECKS]);
}

/** 从 job 目录直接跑一遍（读磁盘 → 纯函数）。 */
export function validateJob(jobId: string, jobsDir?: string): ValidateReport {
  return runValidation(buildContext(jobId, jobsDir));
}

export { buildContext };
export type { ValidateContext };
