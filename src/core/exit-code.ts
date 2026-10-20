/**
 * 进程级语义化退出码。
 *
 * 真源：进度文档 §5.3「八个可直接抄的机制」之三。
 * ⚠️ 与项级错误码（src/core/errors.ts）**两套并存，不混用**：
 *    项级说的是「哪条规则没过、为什么」，进程级说的是「这一步整体是什么结局」。
 *    有 error ⇒ 退出码必为 1；退出码 1 必伴随 ≥1 条 `E-*`。
 */
export const EXIT = {
  /** 0 可交付 */
  OK: 0,
  /** 1 校验没过 */
  VALIDATION_FAILED: 1,
  /** 2 参数错（含前置输入缺失、配置非法） */
  BAD_ARGS: 2,
  /** 3 版式✗ */
  LAYOUT_INVALID: 3,
  /** 4 渲染失败 */
  RENDER_FAILED: 4,
  /** 5 排队超时 */
  QUEUE_TIMEOUT: 5,
  /** 6 内部错误 */
  INTERNAL: 6,
  /** 130 中断 */
  INTERRUPTED: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * 前置输入缺失 / 配置非法。
 * 抛出后由 CLI 统一转成退出码 2 —— **不静默降级、不猜默认值**。
 */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** 阶段前置条件未满足（如上一步未跑、有 error 却想进渲染）。 */
export class StageBlockedError extends Error {
  override readonly name = 'StageBlockedError';
}

/**
 * 渲染执行失败（Remotion 进程非零退出 / 产出为空）。
 *
 * 🔴 2026-10-19 端到端审计：此前 `render.ts` 在失败时抛的是 `ConfigError`，
 * 而 CLI 把 `ConfigError` 一律映射成 **退出码 2**（参数错）——
 * 于是错误文案写着「渲染失败（退出码 4）」，实际进程退出码是 2。
 * **报错信息自己报错了自己的退出码**，按文档写的监控逻辑永远对不上。
 *
 * 这个类型存在的唯一意义，就是让「4 = 渲染失败」这条约定真的成立。
 */
export class RenderFailedError extends Error {
  override readonly name = 'RenderFailedError';
}

/**
 * 异常 → 进程退出码的**唯一映射**。
 *
 * 抽成函数是为了可单测：映射逻辑原先内联在 `cli.ts` 的 `catch` 里，
 * 而它是「文档承诺 `$? == 4` 就渲失败」这条约定的**唯一实现点** ——
 * 不可测的约定等于没有约定。
 */
export function exitCodeFor(e: unknown): ExitCode {
  if (e instanceof ConfigError) return EXIT.BAD_ARGS;
  if (e instanceof StageBlockedError) return EXIT.VALIDATION_FAILED;
  if (e instanceof RenderFailedError) return EXIT.RENDER_FAILED;
  return EXIT.INTERNAL;
}
