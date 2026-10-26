/**
 * 几何校验：项 #3 / #4 / #5 / #8 / #11。
 *
 * 核心原则（C4）：**按 footprint 几何判定，不按组硬判**。
 * 时间重叠是常态（硬约束 3 要求交叉、多轨并行），需要仲裁的只有空间冲突。
 */

import { CODES } from '../core/errors.ts';
import { targetRef, type ReportItem } from '../core/report.ts';
import { ConfigError } from '../core/exit-code.ts';
import {
  MIN_VISIBLE_RATIO,
  carrierParamsOf,
  visibleRegion,
} from '../core/carrier-window.ts';
import { getTemplate, hasTemplate } from '../templates/registry.ts';
import { CARRIER_SCOPES, isCarrierScope, isMasterSlavePair } from '../templates/types.ts';
import type { ValidateContext } from './context.ts';
import { framesOverlap, rectArea, rectOverlapArea } from './context.ts';
import { mk } from './item.ts';

/**
 * 结构前置检查（**结构错误 → ConfigError → 退出码 2**，不产 report 条目）：
 *   1. `handoffTo` 必须指向存在的 track
 *   2. track id 不得重复
 *   3. `item.carrier`（D4-t2）必须是**已注册且属载体类**的模板引用
 *
 * 为什么载体引用也归这里而不是新开一条校验项：它与 `handoffTo` 同属**悬空引用** ——
 * 是配置写错了，不是「内容没做好」。若降级成 report 条目，读者会把「模板 id 打错」
 * 误读成「这条 motion 位置不合适」，返修方向从一开始就是错的。
 */
export function assertStructuralIntegrity(ctx: ValidateContext): void {
  const ids = new Set(ctx.storyboard.tracks.map((t) => t.id));
  for (const t of ctx.storyboard.tracks) {
    if (t.handoffTo && !ids.has(t.handoffTo)) {
      throw new ConfigError(
        `track "${t.id}" 的 handoffTo 指向不存在的 track "${t.handoffTo}"`,
      );
    }
  }
  const trackIds = ctx.storyboard.tracks.map((t) => t.id);
  if (new Set(trackIds).size !== trackIds.length) {
    throw new ConfigError(`track id 重复：${trackIds.join(', ')}`);
  }

  // ── 载体引用（D4-t2 / Q1）────────────────────────────────────────
  // 三条判定，缺一不可：
  //   ① 已注册 —— 未注册则渲染期拿不到 scope / paramsSchema，语义无从谈起
  //   ② 属载体类 scope —— 退让语义是「把**视频**缩进载体、overlay 在框外」；
  //      指向 overlay 模板等于让一条 overlay 去包住视频，是语义倒置
  //   ③ `params` 是普通对象 —— `null` / 数组会让渲染期的键访问静默失效
  for (const t of ctx.storyboard.tracks) {
    for (const [idx, item] of t.items.entries()) {
      const carrier = item.carrier;
      if (carrier === undefined) continue;
      const ref = targetRef(t.id, idx);

      if (typeof carrier.template !== 'string' || carrier.template === '') {
        throw new ConfigError(`item ${ref} 的 carrier.template 必须是非空字符串`);
      }
      if (!hasTemplate(carrier.template)) {
        throw new ConfigError(
          `item ${ref} 的 carrier.template 指向未注册的模板 "${carrier.template}"`,
        );
      }
      const decl = getTemplate(carrier.template);
      if (!isCarrierScope(decl.scope)) {
        throw new ConfigError(
          `item ${ref} 的 carrier.template "${carrier.template}" 的 scope 是 "${decl.scope}"，` +
            `不是载体类（${CARRIER_SCOPES.join(' / ')}）—— 载体退让只能指向背景链模板`,
        );
      }
      const p: unknown = carrier.params;
      if (p === null || typeof p !== 'object' || Array.isArray(p)) {
        throw new ConfigError(`item ${ref} 的 carrier.params 必须是对象`);
      }
    }
  }
}

/**
 * #3 / #4 / #5 / #11 —— footprint 相交仲裁。
 *
 * | 条件                          | 判定                       | 码         |
 * |-------------------------------|----------------------------|------------|
 * | 载体类 × 叠加类（主从）        | **自动放行，不校验**        | —（#5）    |
 * | 相交 + 同 exclusive 组         | error                      | E-C4-01    |
 * | 相交 + 同组但声明 footprintAnimates | error → warning       | W-C3-02    |
 * | 相交 + 不同 exclusive 组       | warning，列出但不拦         | W-C4-01    |
 * | 不相交                         | 通过（即便同组）            | —          |
 */
export function checkFootprintOverlap(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  const n = ctx.scene.length;

  for (let i = 0; i < n; i += 1) {
    const a = ctx.scene[i];
    if (!a) continue;
    for (let j = i + 1; j < n; j += 1) {
      const b = ctx.scene[j];
      if (!b) continue;

      // 时间不重叠 → 谈不上空间冲突
      if (!framesOverlap(a.start, a.end, b.start, b.end)) continue;

      // #5 主从冲突：由 scope 枚举自动推导，**不做字符串白名单**，新增模板零维护
      if (isMasterSlavePair(a.tpl.scope, b.tpl.scope)) continue;

      // 几何不相交 → 通过，即便同组（规则不应误伤）
      const overlap = rectOverlapArea(a.item.footprint, b.item.footprint);
      if (overlap <= 0) continue;

      const sameGroup =
        a.item.exclusive !== undefined &&
        b.item.exclusive !== undefined &&
        a.item.exclusive === b.item.exclusive;

      const frames = [Math.max(a.start, b.start), Math.min(a.end, b.end)];
      const animates = a.item.footprintAnimates === true || b.item.footprintAnimates === true;

      if (!sameGroup) {
        out.push(
          mk(
            CODES.OVERLAP_CROSS_GROUP,
            'build',
            [a.ref, b.ref],
            frames,
            `footprint 相交（重叠面积 ${(overlap * 100).toFixed(2)}% 画面），但两者不在同一 exclusive 组`,
            '几何相交 ≠ 视觉打架（两层半透明叠加可能是好的）。列出来供人工过一眼，不拦。',
          ),
        );
        continue;
      }

      if (animates) {
        // #11 footprintAnimates 降级：error → warning
        out.push(
          mk(
            CODES.FOOTPRINT_ANIMATES_WARN,
            'build',
            [a.ref, b.ref],
            frames,
            `同 exclusive 组 "${a.item.exclusive}" 内 footprint 相交，但声明了 footprintAnimates → 降级为 warning`,
            'footprint 取的是全动画期最大包围盒，会偏保守。确认实际动画轨迹不撞即可放行。',
          ),
        );
        continue;
      }

      out.push(
        mk(
          CODES.OVERLAP_SAME_GROUP,
          'build',
          [a.ref, b.ref],
          frames,
          `同 exclusive 组 "${a.item.exclusive}" 内 footprint 相交（重叠面积 ${(overlap * 100).toFixed(2)}% 画面）`,
          '同类抢位，同一位置只能留一个。错开 fromFrame、缩短时长，或把其中一个挪到别的 exclusive 组。',
        ),
      );
    }
  }
  return out;
}

/** 半开区间 [aStart,aEnd) 是否「骑跨」了 b 的某个端点。 */
function straddles(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const crossesStart = aStart < bStart && bStart < aEnd;
  const crossesEnd = aStart < bEnd && bEnd < aEnd;
  return crossesStart || crossesEnd;
}

/**
 * #8 跨越 `subject-transform` 的裁切边界 → error。
 *
 * 裁切区域在 segment 中途突变，画面会跳。**跨端点**才算，完全包含或完全落入都不算。
 */
export function checkSubjectCutBoundary(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  const carriers = ctx.scene.filter((s) => s.tpl.scope === 'subject-transform');

  for (const c of carriers) {
    for (const s of ctx.scene) {
      if (s.ref === c.ref) continue;
      if (s.tpl.scope === 'subject-transform') continue; // 载体之间归 #3/#4 管
      if (!straddles(s.start, s.end, c.start, c.end)) continue;
      out.push(
        mk(
          CODES.SUBJECT_CUT,
          'build',
          [s.ref, c.ref],
          [Math.max(s.start, c.start), Math.min(s.end, c.end)],
          `item 时间区间 [${s.start}, ${s.end}] 骑跨 subject-transform "${c.ref}" 的裁切边界 [${c.start}, ${c.end}]`,
          '裁切区域会在 item 中途突变。要么把 item 完整移进裁切段内、要么完整移出。',
        ),
      );
    }
  }
  return out;
}

/**
 * `W-D2-02` —— **载体变换后主体被切走太多**（P4 重立，2026-10-17）。
 *
 * ── 判据（D4-t2 / Q3 派生判据）───────────────────────────────
 * ```
 * 对每个载体类 item:
 *   vr = visibleRegion(carrierParamsOf(item))   // null = 无裁切
 *   if (vr === null) continue                    // 不裁 ⇒ 无从切走主体
 *   ratio = |safeArea ∩ vr| / |safeArea|
 *   if (ratio < MIN_VISIBLE_RATIO) → warning
 * ```
 *
 * ── 为什么判据不能挂在 `footprint` 上 ────────────────────────
 * 载体类 `footprint` 是**视频位置**、不是 overlay 位置，而裁切量由变换参数决定、
 * **根本不体现在 footprint 上**：
 *   · `carrier/split-frame` footprint `[0.5,0,0.5,1]` = 视频显在右半屏，
 *     但**裁掉多少**由 `window` 决定（`ratio` 从 0.3 到 0.7 画面完全不同）；
 *   · `cinematic/punch-in` footprint 全屏 `[0,0,1,1]`，但 `scale=1.4` 时**四周确实被裁**。
 * 这正是 D2-2 当日撤回本条的两条理由；判据换源为 `visibleRegion` 后才成立。
 *
 * ── 与 #8（`E-C3-02`）的分工 ──────────────────────────────────
 * #8 管**时间**：item 是否骑跨裁切边界（画面会跳）。
 * 本条管**空间**：主体在变换后还剩多少留在画面里。两者正交，不可互相替代。
 *
 * 🔴 **降级为 warning 的理由**：判据含 🔴 占位阈值 `MIN_VISIBLE_RATIO = 0.5`，
 *   未在真实素材上校准 ⇒ 阻断会误伤合规成片。校准后可升 error。
 */
export function checkSubjectVisibleRegion(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];

  for (const s of ctx.scene) {
    if (!isCarrierScope(s.tpl.scope)) continue;

    // 主体锚定窗口以 shot.safeArea 为锚 —— 找不到该 shot 或 safeArea 为 null
    // （主体不在场 / 感知低置信）时**无从判断**，跳过而非误报。
    const vr = visibleRegion(carrierParamsOf(s.item));
    if (vr === null) continue; // 无裁切 ⇒ 主体不会被切走

    const shot = ctx.perceive.shots.find(
      (sh) => sh.fromFrame <= s.start && s.start < sh.fromFrame + sh.durationInFrames,
    );
    const safeArea = shot?.safeArea ?? null;
    if (!safeArea) continue; // 🔴 主体不在场 ⇒ #18 不判，**归 W-F6-01 的地盘**
    // ✅ 2026-10-26 起这个地盘真的有人管了：`occlusion.ts#checkSubjectUnknown` 第三段
    //    会对「shot 无任何 region 且该段叠了 overlay」出 W-F6-01。
    //    此前那句注释是空头支票（W-F6-01 只认 lowConfidence 标记，
    //    而「框不到 ⇒ 不产 region」连标记的机会都没有），遮挡校验静默空跑。

    const safeAreaArea = rectArea(safeArea);
    if (safeAreaArea <= 0) continue;

    // ⚠️ 必须按**时间相交**而非「item 起始帧落在 shot 内」找 shot ——
    //   item 可能横跨两个 shot，而 safeArea 是按 shot 取并集的（不逐帧跟随）。
    const visible = rectOverlapArea(safeArea, vr);
    const ratio = visible / safeAreaArea;

    if (ratio >= MIN_VISIBLE_RATIO) continue;

    out.push(
      mk(
        CODES.SUBJECT_CUT_VISIBLE,
        'build',
        [s.ref],
        [s.start, s.end],
        `载体 ${s.tpl.id} 变换后，主体（${shot!.id} 安全区）只剩 ${(ratio * 100).toFixed(1)}% 留在可见区内，` +
          `< ${(MIN_VISIBLE_RATIO * 100).toFixed(0)}%。可见区 [${vr.map((v) => v.toFixed(2)).join(', ')}]，` +
          `安全区 [${safeArea.map((v) => v.toFixed(2)).join(', ')}]`,
        `把 ${s.tpl.id} 的裁切调小（split-frame 调 ratio 往 0.7 靠、punch-in 调 scale 往 1.0 靠），` +
          `或换到主体不在该画面区的 shot。` +
          `⚠️ 本判据阈值 ${MIN_VISIBLE_RATIO} 仍是占位值（未在真实素材校准），暂不阻断。`,
      ),
    );
  }
  return out;
}
