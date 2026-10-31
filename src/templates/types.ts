/**
 * 模板契约 —— 双轴 family × scope + 命名空间版本化。
 *
 * 真源：SPEC §3（来源 B6）；进度文档 §3。
 */

import type { Footprint } from '../core/types.ts';
import type { MotionSpec } from '../core/spec.ts';

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

/**
 * 模板成熟度标记。
 *
 * 🔴 **如实说明消费面（2026-10-26 核查）**：
 *   - 唯一代码消费者是 `gallery.ts` 的**画廊展示**（卡片上的「状态」一行）；
 *   - **调度 / 校验 / 渲染链一律不读它** —— `validate`、`motionboard` 绑定、
 *     `render` 都不因某模板是 `experimental` 而改变行为；
 *   - skill 文档（`.workbuddy/skills/*` 与根 `SKILL.md`）也不读它。
 *
 * 也就是说：「未验证的模板不得标 core」是一条**人工评审纪律**，不是代码强制。
 * 改这一点的正确做法是走登记册开一条裁决（例如「引用 experimental 模板时产 warning」），
 * 而不是在某个调用点偷偷 `if (status === 'experimental')` 埋一个隐形规则。
 */
export type TemplateStatus = 'core' | 'experimental' | 'custom';

/**
 * 模板「配方卡」—— 让人和模型**不用渲染成片**就知道这个模板长什么样、什么时候该用。
 *
 * 来源：EAC 对比方案 P0-3（借 Shotcraft 的镜头卡片结构：
 * 一句话 / 适用 / 时长 / 能量 / 参数表 / 已知坑）。
 *
 * 🔴 **纯元数据，不参与任何判定**：不进 footprint 计算、不进 #16/#17 校验、
 *   也不进签章 hash 的语义部分 —— `canonicalSpecHash` 显式剥离 `_doc`
 *   （见 `motion-accept.ts`）。它唯一的消费者是 gallery 卡片与 skill 选型说明。
 *
 * ⚠️ 键名用英文：整个 spec/declaration 契约都是英文键，中文只出现在**值**里。
 */
export interface SpecDoc {
  /** 一句话：这个模板是干什么的。 */
  summary: string;
  /** 适用场景 —— 模型选型时按这个匹配。 */
  fits: string[];
  /** 能量档：决定配在强句还是弱句上（`mid-high` = 强调但不抢镜）。 */
  energy: 'low' | 'mid' | 'mid-high' | 'high';
  /**
   * 设计意图：这个动效**解释什么**——强调 / 状态变化 / 空间关系 / 注意力引导，
   * 四者居其一（借自 impeccable `animate.md` 的焦点论，见
   * `docs/templates/2026-10-31-模板设计验收单.md` 维度 A）。
   * 说不出这一句的动效是装饰，装饰是动画债。
   */
  designIntent?: string;
  /** 参数手感：键 / 典型值 / 调大调小各会怎样。 */
  params?: { key: string; typical: string; feel: string }[];
  /** 已知坑 —— 前人踩过的，避免重复。 */
  pitfalls?: string[];
}

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
  /**
   * 配方卡（P0-3，2026-10-26）。
   *
   * 省略 = **尚未撰写**，不是「这个模板没有特点」。内置 11 个逐一写过；
   * `custom/*` 由 spec 的 `_doc` 经 `deriveDeclaration` 透传而来。
   */
  doc?: SpecDoc;
  /** 默认占位矩形；item 可覆盖。 */
  footprint: Footprint;
  /** 该 motion 的最小可见时长。校验项 #6 用。 */
  minVisibleInFrames: number;
  /**
   * 文本度量 —— **校验项 #17（溢出判定）的唯一真源**。来源：D-B 裁决 2026-10-15。
   *
   * 🔴 **为什么必须进契约，而不是让校验器自己写一份字号表**：
   *    字号原本硬编码在组件的 `style` 里（如 `kinetic-line.tsx` 的 `fontSize: 54`），
   *    校验器在 `src/validate/` 下拿不到。若在校验器里另写
   *    `{ 'kinetic-line@1.0': 54 }`，则**改组件字号时校验器不会跟着变**
   *    ⇒ 溢出判定静默失准、报告照样全绿。
   *    这与本日 `DUR.exit` 事故**同款病**（定义了没人用 / 静默漂移），
   *    故此次先把真源收进契约，再让组件从契约读。
   *
   * ⚠️ 省略 = **该模板无可测文本**（如 `caption/karaoke-word` 刻意不收 `text`、
   *    载体类 / fullscreen 类不画文字）⇒ 校验项 #17 跳过，不误报。
   */
  textMetrics?: TextMetrics;
  /**
   * 该模板的 MotionSpec（仅 `custom/*` 由 spec 派生时存在）。
   *
   * S1a 只负责契约与装载；渲染消费（`SpecRenderer`）属于 S1b。
   * 省略不影响任何既有逻辑 —— 内置模板没有 spec。
   */
  spec?: MotionSpec;
}

/**
 * 文本度量 —— 供构建期估算文本渲染宽度。
 *
 * ⚠️ **这是「渲染期事实」而非「模型可填参数」**：
 *    它不进 `paramsSchema`，模型**不能也不该**填（P1：模型只填表，
 *    不写实现细节；字号是设计决策，由模板作者定）。
 *
 * ⚠️ `charWidthEm` 是**估算系数**不是精确度量 —— 真实字宽随字体、
 *    字重、平台而变。故判定须留余量（`slackRatio`），见 D-B 裁决。
 */
export interface TextMetrics {
  /** 主文本字号（px）。对应画面 1920×1080。 */
  fontSizePx: number;
  /**
   * **CJK** 字符宽度估算系数（em 倍数）。
   * 🔴 **本项目素材为纯中文口播**（双语字幕对齐已明确不做），
   *    故默认值按 CJK 全角 1.0em 给。
   */
  charWidthEm?: number;
  /**
   * **拉丁字母 / 数字**的宽度系数（em 倍数），缺省 **0.5**。
   *
   * 🔴 **为什么必须与 `charWidthEm` 分开（D-B2，2026-10-24）**：
   *    `data/stat-card` 用 `FONT.numeric` 800 粗体，实测数字前进宽 **0.667em**；
   *    而同一模板若把 `charWidthEm` 调到 0.667 以修正数字，CJK 会被**低估一半**。
   *    一个系数乘以两个不同的基准（1.0 / 0.5）表达不了这件事 ——
   *    这正是「一套通用系数套不住差异巨大的字重」的根因。
   *
   * ⇒ 逐类系数：`charWidthEm` 只管 CJK，本字段只管拉丁 / 数字。
   */
  latinWidthEm?: number;
  /**
   * 容器内边距合计（px）。会让「框内可用宽」变小，
   * 漏算它 ⇒ **系统性低估溢出** ⇒ 漏报。
   */
  paddingPx?: number;
  /**
   * 阈值余量（相对比例）。判定式：`估算宽 ≤ 可用宽 × (1 + slackRatio)`。
   * D-B 裁决取 **0.15** —— 字体实际度量可能略宽于估算，留一档防误伤。
   */
  slackRatio?: number;
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
