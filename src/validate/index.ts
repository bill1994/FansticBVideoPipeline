/**
 * 构建期校验器 —— 纯函数，逐项独立判定。
 *
 * 真源：SPEC §2（来源 F2）。两阶段分层：
 *  - **构建期**（本文件）：纯 JSON→JSON，不渲染，覆盖全部校验项（当前 18 项，
 *    活计数以 `DOCUMENTED_CHECK_ITEMS` 为准）
 *  - **渲染期兜底**：字体未加载 / Canvas 未挂载 / GPU 上下文失败，
 *    只能在真实渲染时暴露，由 stages/render.ts 产出 `stage: "render"` 的条目
 *
 * 有 error 则阻断，不进渲染。warning 不拦。
 */

import { buildReport, type ReportItem, type ValidateReport } from '../core/report.ts';
import { buildContext, type ValidateContext } from './context.ts';
import {
  assertStructuralIntegrity,
  checkFootprintOverlap,
  checkSubjectCutBoundary,
  checkSubjectVisibleRegion,
} from './geometry.ts';
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
import { checkParams } from './params.ts';
import { checkTextOverflow } from './text-metrics.ts';

/**
 * 文档校验项序号。**当前 18 项**（时间轴类 9 + 工程与遮挡类 6 + 参数契约类 1 + 可读性类 1 + 载体可见性类 1）。
 * 第 5 项（主从冲突）不产条目，但**确实执行**。
 * 第 15 项（禁配段相交，E5）于 2026-10-13 增补 —— 原清单成型早于 E5，编表时漏收。
 * 第 16 项（paramsSchema 校验，P1）于 2026-10-13 增补 —— 此前 `paramsSchema`
 * 只被定义与注册、校验器侧零引用。
 * 第 17 项（文本溢出 footprint，D-B）于 2026-10-15 增补。
 * 第 18 项（`W-D2-02` 载体变换后主体可见比）于 2026-10-17 上午增补、当日撤回、
 * **当晚由 P4 重立**（撤回理由已逐条消解，见下）。
 *
 * 🔴 **第 18 项的三段历史（改它之前务必读完）**──────────────
 *   - **增补（上午）**：判据为 `item.footprint ⊇ shot.safeArea`。✗ 判据不成立。
 *   - **撤回（同日上午）**：两条理由 —— ① `carrier/split-frame@1.0` 当时
 *     **只有声明、无 `.tsx`**，footprint 语义未定；② `punch-in` footprint 全屏
 *     ⇒ 对分屏误报、**对放大完全漏报**。
 *   - **重立（P4，当晚）**：判据**换源**为 `visibleRegion(params)`
 *     （认 `window` 裁切与 `scale` 放大两种来源），
 *     `|safeArea ∩ visibleRegion| / |safeArea| ≥ MIN_VISIBLE_RATIO`。
 *     理由①已消解（P2 实现 + 当晚真渲抽帧抓到坐标系 bug 并修）；
 *     理由②已消解（放大裁边由 `scale` 分支覆盖，不再漏报）。
 *
 * 🔴 **教训**：同一码值（`W-D2-02`）一天内「增补→撤回→重立」而不错，
 *   全靠**判据来源可追溯**（`footprint` vs `visibleRegion`）与 **撤回说明留在册**。
 *   「规格写了」≠「我读懂了」——本项目已第三次同款教训。
 *
 * ⚠️ 这是**活清单**：增补须先改 `docs/decisions/OPEN-DECISIONS.md`，不得只在这里加。
 */
export const DOCUMENTED_CHECK_ITEMS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
] as const;

/**
 * 不在 18 项内、但同样会执行并产条目的规则 —— 记入 `summary.extra`。
 *
 * 两条都是**刻意**不进清单的，理由同一条：三条准入判据没全中。
 * - `W-D3-01`：确认记录产在 `06-review`，构建期读不到（判据①不满足，D3-a）
 * - `W-F6-01`：主体未确只是提示，不属「渲染前就该拦」（判据③不满足，F6）
 *
 * 因此 `summary.checked` **不等于**「全部执行的规则数」，两者相加才是全貌。
 */
export const EXTRA_CHECKS = ['W-D3-01', 'W-F6-01'] as const;

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

    // 参数契约类 1 项
    ...checkParams(ctx), // #16（P1：paramsSchema 校验）
    ...checkTextOverflow(ctx), // #17（D-B：文本溢出 footprint，warning 档）
    ...checkSubjectVisibleRegion(ctx), // #18（W-D2-02 载体变换后主体可见比，P4 重立）

    // 起草原生约束
    ...checkNoMotionRanges(ctx), // E-E5-01（SPEC §1.4）
    ...checkFullscreenConfirmation(ctx), // W-D3-01（D3）
    ...checkSubjectUnknown(ctx), // W-F6-01（F6）
  ];

  return buildReport(ctx.jobId, items, DOCUMENTED_CHECK_ITEMS.length, [...EXTRA_CHECKS]);
}

// 注：曾有 `validateJob(jobId)` = `runValidation(buildContext(...))` 的便利包装，
// 2026-10-18 审计发现与 `stages/validate.ts#runValidateStage` 重复且零调用，已删。
// 要「读磁盘 + 校验」请用 `runValidateStage`（它还会落 04 阶段产物并过快照守卫）。

export { buildContext };
export type { ValidateContext };
