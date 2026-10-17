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

/**
 * 主体最低可见比 —— **`W-D2-02` 的判据阈值**（D4-t2 / Q3 派生判据）。
 *
 * 判据：`|safeArea ∩ visibleRegion| / |safeArea| ≥ MIN_VISIBLE_RATIO`
 * —— 变换后主体仍有这么比例留在可见区内，就算「主体没被切走」。
 *
 * 🔴 **PLACEHOLDER（0.5，裁决原文的默认值）**：待真实素材校准。
 *   - 为什么需要它：窗口以 `safeArea` 中心为锚、宽度由 `ratio` 定（钳 0.3–0.7），
 *     当**主体本身比窗口还宽**时（宽脸特写 + `ratio=0.3`），锚定也保不住主体 ——
 *     这个极端情形只能靠比例阈值兜底，锚定救不了。
 *   - 为什么是 0.5：裁决未给经验值，取「主体至少一半还在」作为「未被明显切走」的中性线。
 *   ⚠️ 与 `CARRIER_RATIO_DEFAULT` / `safeAreaTopRatio` 等同属 🔴 占位值族，
 *   校准须一并进行（同 `ALIGN_GATE` 的教训：相关阈值一起改，别单个调）。
 */
export const MIN_VISIBLE_RATIO = 0.5;

// ─────────────────────────────────────────────────────────────
// punch-in 的 scale 钳制区间（P4 从 `remotion/templates/punch-in.tsx` 上提）
// ─────────────────────────────────────────────────────────────
// 🔴 **为什么上提到 `core/`**（2026-10-17，P4 复核时发现）：
//   渲染期 `punch-in.tsx` 把 scale 钳到 `[1.0, 1.6]`，而 `visibleRegion` 原先
//   **直接用原始值**。于是 `params.scale = 3.0` 时：
//     · 渲染期实际用 **1.6**；
//     · 判据以为按 **3.0** 算，可见区 `[0.33, 0.33, 0.33, 0.33]`（裁得更狠）；
//   ⇒ **判据比渲染更保守 ⇒ 误报**。
//
//   这与 P2→P3 那次「CSS 坐标系」是同一款病：**两处各写一套算法 ⇒ 判定与画面脱节**。
//   根治办法只有一个 —— 让两边从**同一个常量**取值。
//
//   为什么放 `core/` 而不留在组件：判据在 `validate/`，若常量留在 `remotion/`
//   就成了「core 反向依赖渲染层」，违反分层（与 `core/carrier-window.ts` 文件头
//   「放 `core/` 是因为它是两边都已依赖的层」同源理由）。
//
//   ⚠️ 迁移时**保留组件内的名字做再导出**，避免改动其余调用点的可读性。

/**
 * 推近倍数下界：1.0 = 无运动。
 *
 * 🔴 **语义边界**：`scale < 1` 是拉远（pull-out），不是本模板语义；
 * clamp 到 1.0 即「无运动」，确定性且不崩。
 * 对 `visibleRegion` 而言 ≤ 1.0 意味着**不裁切** ⇒ 返回 `null`（全画面可见）。
 */
export const SCALE_MIN = 1.0;

/**
 * 推近倍数上界：1.6 —— 1080p 素材放大 160% 以上时细节劣化已肉眼可见
 * （数字变焦的可见损失线），且「缓慢推近」的语境下不会需要更大。
 */
export const SCALE_MAX = 1.6;

/** 缺省推近量 —— 【实现期拟定，文档未点名】。取略保守值（缺省应当安全）。 */
export const DEFAULT_SCALE = 1.06;

/** 把任意输入钳到渲染期真正会用的 scale —— **校验期与渲染期必须共用本函数**。 */
export function clampScale(raw: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw));
}

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
 * ── 两种裁切来源（P4 补齐）────────────────────────────────────
 * | 来源 | 载体模板 | 语义 |
 * |---|---|---|
 * | `params.window` | `carrier/split-frame` | 竖条裁切：只留该窗内的画面 |
 * | `params.scale`  | `cinematic/punch-in`  | 放大裁边：以中心为基准，可见区 = `1/s` |
 *
 * 🔴 **为什么必须两者都认**：D2-2 当日撤回 `W-D2-02` 的理由原文是
 *   「对分屏可能误报、**对放大完全漏报**」。只实现 window 那一支，
 *   等于把「漏报」那一半原样留着 —— 撤回理由没被真正消解。
 *
 * ⚠️ **scale 的可见区推导**：放大 s 倍时，画面以中心为基准缩放，
 *   合成画布只显示源画面的中央 `1/s` ⇒ 可见区 `[ (1-1/s)/2, (1-1/s)/2, 1/s, 1/s ]`。
 *   🔴 这是**纯几何推导**，非真渲实测：占位底（`AbsoluteFill`）本身铺满画面，
 *     scale 后仍铺满，量不到黑边（2026-10-17 抽帧实测确认）。真实素材下应复核。
 *
 * 🔴 **scale 分支按「目标值」算，而非「当前帧的实际值」——这是刻意的保守偏差**：
 *   `cinematic/punch-in` 有进出场（`punchInScale`：scale 从 1 缓动推到目标值再退回），
 *   所以**同一 item 在不同帧的可见区不同**：目标 1.6、时长 60 时，
 *   首帧与末帧 scale=1（完全不裁切）、中段帧（frame 30）仅 1.443。
 *
 *   本函数只读 `params`、**不读帧**（校验期无帧概念），故只能取目标值 = **最坏帧**。
 *   方向是**偏严**：判据说「裁得更狠」，实际中段帧比这宽松 ⇒ **可能误报，不会漏报**。
 *   这与本文件头第 2 条「窗口随帧变化时，`W-D2-02` 须取**最小**可见比」是同一推理：
 *   **越窄越危险，取最严**。
 *   ⚠️ 若将来给 `punch-in` 也加静态窗（无进出场），此偏差自动消失。
 *
 * ⚠️ 另一个刻意的偏差：首尾帧 scale=1 ⇒ **完全不裁切**。但判据仍按目标值报，
 *   即「动画有两端是不裁的」这一事实**不参与判定**。这是保守方向的代价，
 *   属已知取舍，非缺陷。
 *
 * ── 语义 ──────────────────────────────────────────────────────
 * - **两个裁切源都无（或都不裁切）** ⇒ `null` = 全画面可见；
 * - **只有一个生效** ⇒ 返回它的可见区；
 * - **两个同时生效** ⇒ 返回两者的**交集**（见下「为什么取交集」）；
 * - `window` 形状非法 ⇒ **抛 `ConfigError`（退出码 2）**。
 *
 * 🔴 **为什么两个源并存时取交集，而不是「window 优先」**：
 *   现实中它们分属不同模板（`split-frame` 用 window、`punch-in` 用 scale），
 *   但**校验期写入 window + 模型手填 scale** 会撞上。
 *   原实现「window 优先」⇒ `scale` 的裁边被**静默忽略、且一声不吭** ——
 *   那会让判据以为可见区比实际大 ⇒ 漏报，与「静默当全画面可见」是同一类病。
 *   取交集在几何上也最诚实：两个变换叠加，可见区就是两者之交。
 *
 * 🔴 **为什么 scale 分支要过 `clampScale`**：
 *   渲染期 `punch-in.tsx` 用钳制后的值（与 `SCALE_MIN/MAX` 同源）。
 *   判据若用原始值，极端输入下会算出比渲染更狠的裁切 ⇒ 误报。
 */
export function visibleRegion(params: Record<string, unknown> | undefined): Footprint | null {
  // ── 来源 1：window（分屏竖条裁切）───────────────────────────
  let fromWindow: Footprint | null = null;
  const w = params?.['window'];
  if (w !== undefined && w !== null) {
    if (!isRect(w)) {
      throw new ConfigError(
        `carrier.params.window 必须是 4 个有限数构成的归一化矩形，实得 ${JSON.stringify(w)}`,
      );
    }
    fromWindow = [w[0], w[1], w[2], w[3]];
  }

  // ── 来源 2：scale（放大裁边）──────────────────────────────────
  // ⚠️ **非法 `scale` 为何不抛错（与 `window` 的策略不一致，此处是刻意的取舍）**：
  //   · `window` 是**校验期写入的系统字段**，写坏了 = 系统 bug ⇒ 该早失败（抛 ConfigError）；
  //   · `scale` 是**模型可填的参数**，且渲染期 `num()` 本就做确定性降级
  //     （非有限值 → 走缺省 1.06；超界 → 钳到 [1.0, 1.6]）。
  //   ⇒ 判据**不应比渲染更严**：若这里抛错，一个渲染层能正常出片的 storyboard
  //     会被校验拦下，而那不是配置写错，是模型填了个没意义的值。
  //   静默的代价是「算不出裁切 ⇒ 当作不裁切」，方向是**漏报**而非误报 ——
  //   与 `window` 静默的代价正好相反，这里选了更安全的那一侧。
  //   ⚠️ 代价是：本函数对坏 `scale` 的检出能力为零，该由渲染期的参数降级自行处理。
  const raw = params?.['scale'];
  let fromScale: Footprint | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const s = clampScale(raw);
    if (s > 1) {
      const inv = 1 / s;
      const off = (1 - inv) / 2;
      fromScale = [off, off, inv, inv];
    }
  }

  if (fromWindow === null) return fromScale;
  if (fromScale === null) return fromWindow;
  return intersectRects(fromWindow, fromScale);
}

/**
 * 两个矩形的交集（null = 无交集）。
 *
 * 🔴 取交集而非并集/择一：两个裁切**叠加**生效时，画面上同时是「被 window 裁过」
 *   和「被 scale 裁过」的 ⇒ 可见 = 两者都保留的部分。
 */
function intersectRects(a: Footprint, b: Footprint): Footprint | null {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  const right = Math.min(a[0] + a[2], b[0] + b[2]);
  const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  if (right <= x || bottom <= y) return null;
  return [x, y, right - x, bottom - y];
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
