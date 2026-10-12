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
