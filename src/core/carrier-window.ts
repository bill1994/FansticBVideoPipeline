/**
 * 载体窗口 —— **D4-t2 / Q3「cover 裁切分屏 + 主体锚定窗口」的几何唯一真源**。
 *
 * ── 为什么单独一个模块、且放在 `core/` ────────────────────────────
 * 这套几何**三处都要用**，而它们分属不同层：
 *   · P2 渲染层 `split-frame.tsx` —— 按窗口裁切并把视频摆到一侧
 *   · P3 校验期 —— tier2 触发时**把算好的窗口写进 `item.carrier.params.window`**
 *   · P4 校验期 —— 以 `visibleRegion(params)` 为输入重立 `W-D2-02`
 * 放渲染层会让 `validate/` 反向依赖 `remotion/`；放校验层则渲染期要反向依赖 `validate/`。
 * ⇒ `core/` 是唯一两边都已依赖的层，且本模块是**纯函数、无 IO、无 React**。
 *
 * ── 语义（D4-t2 Q3 原文）──────────────────────────────────────────
 * · 画面被分成两半：视频只显示在**一侧**（`side`），另一侧空出来给 overlay 播放；
 * · 显示区宽度 = `ratio` × 画面宽（钳制 0.3–0.7）；
 * · **裁切窗口以该 shot 的 `safeArea` 中心为锚**，窗口宽定死后两侧均分剩余
 *   ⇒ **主体几乎恒完整**，被切掉的是主体两侧的空白；
 * · `side` 只决定「视频显示在哪一侧」，**与裁哪里无关**。
 *
 * ── 三个刻意的实现取舍 ───────────────────────────────────────────
 * 1. **窗口宽 = 展示条宽 ⇒ 缩放系数恒为 1**。
 *    「cover 填满、无黑边」在本实现里靠「等宽 + 平移 + 裁切」达成，
 *    不做 `scale` —— 放大只会白扔像素（数字变焦的可见劣化线）。
 * 2. **本模块是静态几何，没有帧参与**。
 *    🔴 若将来给分屏加进出场动画，窗口会**随帧变化** ⇒ `W-D2-02` 的判据
 *    就不再能只看一个 `params.window`，必须改为「全动画期**最小**可见主体比 ≥ MIN_VISIBLE_RATIO」
 *    （方向与 `footprint` = 「全动画期**最大**包围盒」相反：越窄越危险）。
 *    这条耦合已记入 D4-t2 施工计划，**P2 不做动画正是为了不踩它**。
 * 3. **`safeArea` 缺失时退回画面居中**，而不是报错。
 *    感知低置信（F6）时 `safeArea` 为 `null`，而载体退让不能因此失效；
 *    居中是最保守的中性选择（主体大概率在中间），且不阻断。
 */

import { ConfigError } from './exit-code.ts';
import type { Footprint } from './types.ts';

/** 展示条宽度占比下界（D4-t2 裁决）。窄于此则 overlay 没有可用空间。 */
export const CARRIER_RATIO_MIN = 0.3;
/** 展示条宽度占比上界（D4-t2 裁决）。宽于此则视频被压得看不出是什么。 */
export const CARRIER_RATIO_MAX = 0.7;
/**
 * 缺省占比 —— 【实现期拟定，裁决只给了钳制区间、未给默认值】。
 * 取区间中值 0.5：两侧均分，是「不需要判断」的默认值（缺省应当安全）。
 * 🔴 待真实素材校准（同 `MIN_VISIBLE_RATIO` 一类的占位值）。
 */
export const CARRIER_RATIO_DEFAULT = 0.5;

/** 视频显示在哪一侧。 */
export type CarrierSide = 'left' | 'right';
/**
 * 缺省侧 —— 【实现期拟定】取 `right`，**与 `builtin.ts` 里本模板的 `footprint`
 * `[0.5, 0, 0.5, 1]`（右半屏）保持一致**。
 * 🔴 这不是随手选的：声明与默认渲染不一致，同款于 #17「字号真源」事故
 * （契约说一套、组件做另一套，判定静默失准）。改这里必须同步改声明。
 */
export const CARRIER_SIDE_DEFAULT: CarrierSide = 'right';

/** 钳制占比到 [0.3, 0.7]；非有限值回退缺省。 */
export function clampCarrierRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return CARRIER_RATIO_DEFAULT;
  return Math.min(CARRIER_RATIO_MAX, Math.max(CARRIER_RATIO_MIN, ratio));
}

/**
 * **主体锚定的裁切窗口**（全高的竖条）。
 *
 * ```
 * 窗口中心 = safeArea 的中心（缺 `safeArea` 则画面中心 0.5）
 * 窗口宽   = clamp(ratio)
 * 左边界   = clamp(中心 − 窗口宽/2, 0, 1 − 窗口宽)
 * ```
 *
 * ⚠️ 左边界必须钳制：主体贴边时若不钳，窗口会有一部分落在画面外 ——
 * 那不是「被切掉」，是「有一部分根本没显示」。
 */
export function computeCarrierWindow(
  safeArea: Footprint | null | undefined,
  ratio: number,
): Footprint {
  const w = clampCarrierRatio(ratio);
  const cx = safeArea ? safeArea[0] + safeArea[2] / 2 : 0.5;
  const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  return [x, 0, w, 1];
}

/** 展示条（视频在画面里占的那一块）：宽同窗口、高满屏。 */
export function carrierDisplayRect(side: CarrierSide, ratio: number): Footprint {
  const w = clampCarrierRatio(ratio);
  return side === 'left' ? [0, 0, w, 1] : [1 - w, 0, w, 1];
}

/** 读 `side`；非 `left`/`right` 一律回退缺省（**不报错**，见下）。 */
export function readCarrierSide(params: Record<string, unknown> | undefined): CarrierSide {
  return params?.['side'] === 'left' ? 'left' : CARRIER_SIDE_DEFAULT;
}

/** 读 `ratio` 并钳制；缺省 / 非有限值回退缺省。 */
export function readCarrierRatio(params: Record<string, unknown> | undefined): number {
  const v = params?.['ratio'];
  return clampCarrierRatio(typeof v === 'number' ? v : CARRIER_RATIO_DEFAULT);
}

/** 一个 4 元组是否是合法的归一化矩形。 */
function isRect(v: unknown): v is Footprint {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (v[2] as number) > 0
  );
}

/**
 * `visibleRegion(params)` —— **变换后画面上「视频还看得见」的区域**（归一化）。
 *
 * 载体类 `footprint` 是**视频位置**、不是 overlay 位置，且裁切量由 `params` 决定、
 * **根本不体现在 `footprint` 上** ⇒ 判「安全区有没有被切走」只能看本函数。
 * 这正是 `W-D2-02` 在 2026-10-17 被增补又撤回、改为由 D4-t2 重建的原因。
 *
 * 语义：
 * - 无 `window` 键 ⇒ `null` = **全画面可见**（无裁切）；
 * - 有 `window` 且合法 ⇒ 返回该窗口；
 * - 有 `window` 但**形状非法** ⇒ **抛 `ConfigError`（退出码 2）**。
 *   🔴 为什么不静默当「全画面可见」：那会让 `W-D2-02` **漏报**
 *   （判据以为没裁切，实际坏数据在别处），而「窗口被写了但写坏了」
 *     与 P1 的「引用了不存在的模板」同类 —— 都是**配置写错**，该早失败。
 */
export function visibleRegion(params: Record<string, unknown> | undefined): Footprint | null {
  const w = params?.['window'];
  if (w === undefined || w === null) return null;
  if (!isRect(w)) {
    throw new ConfigError(
      `carrier.params.window 必须是 4 个有限数构成的归一化矩形，实得 ${JSON.stringify(w)}`,
    );
  }
  return [w[0], w[1], w[2], w[3]];
}

/**
 * 取一个 item 的载体参数。
 *
 * 两条来源（P1 起并存）：
 * - `item.carrier.params` —— 逐 item 声明（D4-t2 新路径，校验期或人工写入）；
 * - `item.params` —— 该 item **本身就是**载体模板时的常规参数路径
 *   （如 storyboard 里直接放一条 `motion: carrier/split-frame@1.0` 的 item）。
 * 前者优先：载体档被声明挂在别的 item 上时，它才是这份几何的真正来源。
 */
export function carrierParamsOf(
  item: { carrier?: { params: Record<string, unknown> } | undefined; params?: Record<string, unknown> | undefined },
): Record<string, unknown> {
  return item.carrier?.params ?? item.params ?? {};
}
