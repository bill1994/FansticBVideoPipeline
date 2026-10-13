/**
 * 模板契约 —— 双轴 family × scope + 命名空间版本化。
 *
 * 真源：SPEC §3（来源 B6）；进度文档 §3。
 */

import type { Footprint } from '../core/types.ts';

/** 轴 A｜family（命名空间，可无限扩，12 类）。 */
export const FAMILIES = [
  'caption',
  'typography',
  'data',
  'annotation',
  'carrier',
  'brand',
  'ambience',
  'cinematic',
  'transition',
  'rhythm',
  'sfx',
  'custom',
] as const;
export type Family = (typeof FAMILIES)[number];

/** 轴 B｜scope（枚举，固定 6 值）。 */
export const SCOPES = [
  'under-subject',
  'overlay-safe',
  'anchored',
  'subject-transform',
  'footage-transform',
  'fullscreen',
] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * scope 天然二分 —— C4 主从放行与 C6 双栈分离都依赖这个性质。
 */
export const CARRIER_SCOPES: readonly Scope[] = ['subject-transform', 'footage-transform'];
export const OVERLAY_SCOPES: readonly Scope[] = [
  'overlay-safe',
  'under-subject',
  'anchored',
  'fullscreen',
];

/** 载体类：作用于实拍视频本身（背景链，串联）。 */
export function isCarrierScope(scope: Scope): boolean {
  return CARRIER_SCOPES.includes(scope);
}

/** 叠加类：作用于画面之上（叠加栈，并列）。 */
export function isOverlayScope(scope: Scope): boolean {
  return OVERLAY_SCOPES.includes(scope);
}

/**
 * 主从关系判定：载体类 × 叠加类的跨类组合**天然为主从关系**。
 *
 * 走 scope 枚举自动推导，**不做字符串白名单** —— 白名单会随命名空间
 * 无限膨胀且新模板需手工登记，是校验黑洞。新增模板零维护。
 */
export function isMasterSlavePair(a: Scope, b: Scope): boolean {
  return (isCarrierScope(a) && isOverlayScope(b)) || (isOverlayScope(a) && isCarrierScope(b));
}

export type TemplateStatus = 'core' | 'experimental' | 'custom';

/** 模板声明契约。来源：SPEC §3.2。 */
export interface TemplateDeclaration {
  /** `family/subtype@version`，如 `typography/lower-third@1.0`。 */
  id: string;
  family: Family;
  subtype: string;
  /** semver。版本锁定 → 升级不破坏旧 storyboard。 */
  version: string;
  scope: Scope;
  /** 默认 z 序；track 声明可覆盖（N-1）。 */
  layer: number;
  occludesSubject: boolean;
  /** 参数契约。模型只填表不写代码。 */
  paramsSchema: Record<string, string>;
  /**
   * 必填参数键（P1）。
   *
   * **省略 = 全部可选。** `paramsSchema` 只表达「有哪些键」与「值类型」，
   * 不承担必填语义 —— 它是 `Record<string, string>` 的扁平表，装不下 required。
   *
   * 为什么不把值改成对象 `{ type, required?, default? }`：
   * - `default` 是**渲染期**的事，塞进校验层属职责混淆；
   * - 10 个已声明模板会全部迁移，diff 远大于收益。
   *
   * 因此拆成两个正交字段：键存在性查 `paramsSchema`，
   * 是否必填查本字段。校验项 #16 需要这三个事实：存在 / 必填 / 类型。
   */
  requiredParams?: string[];
  status: TemplateStatus;
  /** 默认占位矩形；item 可覆盖。 */
  footprint: Footprint;
  /** 该 motion 的最小可见时长。校验项 #6 用。 */
  minVisibleInFrames: number;
  /** 模板参数：如何承接入场（接力时由接收方声明，不硬编码）。 */
  handoffIn?: string;
}

/** 解析 `family/subtype@version`。 */
export function parseMotionId(motion: string): { family: string; subtype: string; version: string } {
  const at = motion.lastIndexOf('@');
  const head = at >= 0 ? motion.slice(0, at) : motion;
  const version = at >= 0 ? motion.slice(at + 1) : '';
  const slash = head.indexOf('/');
  if (slash < 0) {
    return { family: head, subtype: '', version };
  }
  return { family: head.slice(0, slash), subtype: head.slice(slash + 1), version };
}
