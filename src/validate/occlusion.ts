/**
 * 遮挡校验与自动降级：项 #12 / #13 / #14，以及三条起草原生约束。
 *
 * 核心洞察（D2）：**遮挡容忍度不是标量，是向量。**
 * 判别方式不是「有没有相交」，而是「从各级区域各拿了多少遮挡额度，总和超预算才报错」。
 * 优先级：安全区判定（D）**优先于** C4 的 exclusive 组判定 —— 遮挡主体是硬约束。
 *
 * ── 关于两条错误码的分工（本实现的裁决，文档未逐一细化）───────────
 * 文档把「预算超了」(#12) 与「三级退让用尽」(#13) 列为两个校验项、两个码。
 * 为避免同一根因重复报两次，实现按**退让阶段**划分：
 *
 *   E-D4-01  三级退让**无法启动**（tier2 载体档对该 scope 不适用）
 *            —— 根因是「退路不存在」
 *   E-D2-01  载体档已应用，**仍然**超预算（如区域几乎占满画面，没有载体余量）
 *            —— 根因是「退路不够」
 *
 * 两者互斥，合起来覆盖全部失败情形。
 */

import { CODES } from '../core/errors.ts';
import type { ReportItem } from '../core/report.ts';
import { OCCLUSION_BUDGET } from '../core/config.ts';
import {
  CARRIER_RATIO_MIN,
  carrierDisplayRect,
  computeCarrierWindow,
  readCarrierRatio,
  readCarrierSide,
} from '../core/carrier-window.ts';
import type { Footprint, PerceiveRegion, RegionKind } from '../core/types.ts';
import { isOverlayScope } from '../templates/types.ts';
import type { SceneItem, ValidateContext } from './context.ts';
import { clampRect, framesOverlap, rectArea, rectOverlapArea } from './context.ts';
import { mk } from './item.ts';

/** 区域等级的预算。来源：SPEC §2.6 / D2。 */
function budgetOf(kind: RegionKind): number {
  return OCCLUSION_BUDGET[kind];
}

type ResolveStatus = 'nudged' | 'carrier' | 'carrier-insufficient' | 'no-carrier';

export interface Resolution {
  status: ResolveStatus;
  detail: string;
}

/** 平移候选网格 —— 让「挪一下就好」有确定的尝试范围，且结果可复现。 */
const NUDGE_STEPS = [-0.2, -0.1, 0, 0.1, 0.2];

/**
 * D4 三级退让：
 *   ① 同预算内尝试挪动 footprint（不动时间轴、不改文案）
 *   ② 挪不动则自动切 carrier 模式（画面缩进载体框，motion 在框外播放）
 *   ③ 仍冲突才报错
 *
 * ── 2026-10-13 修复：tier1 曾是「假绿」────────────────────────────────
 * 实测证明：tier1 算出的 candidate 矩形**只被拼进 detail 字符串**，从不回写
 * `item.footprint`；调用方对 `status==='nudged'` 直接 `continue`。于是
 * 「挪得开」的真实含义只是「我不报错了」，而非「我把东西挪走了」——
 * 动效仍压在主体区、成片照样拍出来，而报告写着 `ok: true`。
 *
 * 现在 tier1 **真正回写** `item.footprint`（`SceneItem.item` 持有对象引用非拷贝，
 * 故这是内存内改写）。关于「校验器是纯函数」：
 * 该约束（SPEC §2.1 / context.ts 头注释）指的是**不再读磁盘、不写磁盘**，
 * 落盘仍由 render 阶段负责，并未触碰。改内存中的场景对象不破坏阶段快照不可变性。
 *
 * ⚠️ tier2（carrier）的三段历史 —— 值得留档，因为它**两次**都曾是假绿：
 *   1. **P1/P2 阶段**：tier2 只抑制报错、不改任何数据。触发依据已按 D4-t2
 *      （2026-10-17）从「全局 `motion → carrier` 表」改为 `item.carrier` 逐 item 显式声明。
 *   2. **2026-10-17 22:30 通道方案 A**：tier1「真正回写 footprint」是**假的** ——
 *      它只改内存，而 `render` 是独立进程、重读 JSON，没有任何跨进程通道
 *      （实测：validate 前后 storyboard.json 的 sha256 完全一致）。
 *      ⇒ 连 tier1 的「真正回写」也是空操作，报告却写着「已平移消解」。
 *      现由 `resolveScene`（本文件末尾）+ `stages/render.ts` 的重算补上通道。
 *   3. **P3（同日）**：tier2 真正写入 `carrier.params.window`（主体锚定裁切窗，
 *      几何取自 `core/carrier-window.ts` 唯一真源），渲染期 `split-frame.tsx`
 *      经 `visibleRegion(params)` 消费。遮挡率按**施加后**的展示条重算 —— 用施加前的
 *      值做判定就是自欺。
 *
 *   ⚠️ 两层假绿的同源性：**「算了」不等于「落地」**，而报告的措辞容易让人以为落地了。
 *   凡涉及「改变产物」的判定，都必须能回答「成片里哪儿变了」。
 */
export function resolveOcclusion(
  item: SceneItem,
  region: PerceiveRegion,
  ratio: number,
  budget: number,
  /**
   * 裁切窗锚点 —— 该 region 所属 shot 的 `safeArea`（P3 新增参数）。
   *
   * 🔴 **为什么显式传参而不是让本模块自己去查**：`SceneItem` 不携带 perceive 的引用，
   *   而 validate 的纯函数边界不允许校验器反向依赖 `context.ts` 的读盘能力。
   *   显式传入 ⇒ 本函数仍是**纯函数**，且单测可直接喂 `safeArea` 而不必构造整个 job。
   *
   *   传 `null`（找不到 shot / 感知低置信）⇒ `computeCarrierWindow` 退回**画面居中**窗口。
   *   这是刻意选择：主体不在场时退让不能失效，居中是最保守的中性解（见
   *   `core/carrier-window.ts` 文件头第 3 条）。
   */
  safeArea: Footprint | null = null,
): Resolution {
  const box = region.box;

  // ① 同预算内挪动 footprint
  //
  // 🔴 **幂等护栏（2026-10-17，通道方案 A）**：`render` 阶段会**再跑一遍**本函数
  //   （见 `resolveScene`），所以必须保证「已消解过」的 item 不会被二次平移。
  //   理论上 `collectHits` 已过滤掉 ratio ≤ budget 的项（平移后不会再进来），
  //   但那依赖「平移后重算 ratio」这一隐式前提；一旦将来 tier1 改成只挪不重算，
  //   就会退化成「每跑一次多挪一格」的漂移。故显式钉住：已在预算内则不再尝试平移。
  if (occlusionRatio(item.item.footprint, box) <= budget) {
    return {
      status: 'nudged',
      detail: `遮挡率已在预算内（${(occlusionRatio(item.item.footprint, box) * 100).toFixed(1)}% ≤ ${(budget * 100).toFixed(0)}%），无需平移`,
    };
  }

  for (const dy of NUDGE_STEPS) {
    for (const dx of NUDGE_STEPS) {
      if (dx === 0 && dy === 0) continue;
      const [x, y, w, h] = item.item.footprint;
      const candidate = clampRect([x + dx, y + dy, w, h]);
      const r = rectOverlapArea(candidate, box) / rectArea(box);
      if (r <= budget) {
        // 🔴 真正回写 —— 这是「挪得开」的兑现，而非仅消除报错
        item.item.footprint = candidate;
        return {
          status: 'nudged',
          detail: `平移 footprint 至 [${candidate.map((v) => v.toFixed(2)).join(', ')}] 后遮挡率 ${(r * 100).toFixed(1)}% ≤ 预算 ${(budget * 100).toFixed(0)}%`,
        };
      }
    }
  }

  // ② 自动切 carrier 模式
  //    载体档**逐 item 显式声明**（D4-t2 / Q2：已废除全局 `motion → carrier` 映射表）。
  //    未声明即视为「退路不存在」—— 为任意 motion 自动挑载体不安全
  //    （例如 fullscreen 类没有可缩进的余地）。
  const carrierId = item.item.carrier?.template;
  if (!carrierId) {
    return {
      status: 'no-carrier',
      detail: `item 未声明载体档（storyboard item 的 carrier 字段），三级退让无法启动`,
    };
  }
  if (!isOverlayScope(item.tpl.scope)) {
    return {
      status: 'no-carrier',
      detail: `scope "${item.tpl.scope}" 不是叠加类，载体降级不适用`,
    };
  }

  // 载体余量：区域几乎占满画面时，画面没有可缩进的位置
  const regionAreaRatio = rectArea(box);
  if (regionAreaRatio > 0.9) {
    return {
      status: 'carrier-insufficient',
      detail: `区域占画面 ${(regionAreaRatio * 100).toFixed(1)}%，缩进载体框后无可用余量，遮挡率仍为 ${(ratio * 100).toFixed(1)}%`,
    };
  }

  // ── P3（2026-10-17）：**真正写入载体几何** ─────────────────────────
  // 此前此处只 return 一句「尚未实现」，冲突被抑制但画面分毫未动 —— 与 10-13
  // 那次假绿同源的第二层（内存改写无跨进程通道，已由通道方案 A 修好）。
  // 现在把 D4-t2 / Q3 裁决的**主体锚定裁切窗**算好后写进 `carrier.params.window`，
  // 渲染期 `split-frame.tsx` 直接消费 `visibleRegion(params)`。
  //
  // 🔴 **窗口宽取哪个值**：用该 item 已声明的 `params.ratio`（模型可填、已钳制
  //   [0.3,0.7]），缺省走 `CARRIER_RATIO_DEFAULT`。**不用**区域宽 —— 展示条是给
  //   overlay 用的，其宽度由构图决定，与被遮挡区域无关。
  //   几何实现见 `core/carrier-window.ts`（**唯一真源**，别处不得重算）。
  const carrier = item.item.carrier!; // 上面已判 !carrierId，此处必然存在
  const params: Record<string, unknown> = carrier.params;
  const barRatio = readCarrierRatio(params);
  const side = readCarrierSide(params);

  // 锚点 = 调用方传入的 safeArea（D4-t2 / Q3：主体几乎恒完整）
  const window = computeCarrierWindow(safeArea, barRatio);
  params['window'] = window;

  // 载体施加后，画面「视频可见区域」= 展示条所覆盖的那一条。
  // 用它重算遮挡率：**这才是退让是否真的有效的判据**
  // （形参 `ratio` 是未退让时的值，拿它做判定就是自欺）。
  const display = carrierDisplayRect(side, barRatio);
  const after = rectOverlapArea(display, box) / rectArea(box);

  // 🔴 **终判（P3 实测发现，原实现缺此步）**：
  //   施加载体**不等于**退让成功。展示条仍可能压着主体 —— 典型是 face 预算为 0，
  //   而视频只缩到 50% 宽，主体必然还有一半落在展示条内。
  //   若不在这里收口，就会把「施加了但没用」报成 `carrier`（成功），
  //   那是**第三层假绿**：报告说载体生效、几何也真写了，可冲突一点没解。
  //   正确终态是 `carrier-insufficient` → `E-D2-01`（根因是「退路不够」，
  //   与 `E-D4-01`「退路不存在」互斥，见文件头）。
  if (after > budget) {
    return {
      status: 'carrier-insufficient',
      detail:
        `已施加载体档 ${carrierId}（视频缩进 ${side} 侧 ${(barRatio * 100).toFixed(0)}% 展示条），` +
        `但主体仍被遮挡 ${(after * 100).toFixed(1)}% > 预算 ${(budget * 100).toFixed(0)}%。` +
        `预算为 0 的区域（人脸）要求视频**完全让出**主体框，` +
        `而载体最低只能缩到 ${(CARRIER_RATIO_MIN * 100).toFixed(0)}%。`,
    };
  }

  return {
    status: 'carrier',
    detail:
      `已施加载体档 ${carrierId}：视频缩进 ${side} 侧展示条（宽 ${(barRatio * 100).toFixed(0)}%），` +
      `裁切窗 [${window.map((v) => v.toFixed(2)).join(', ')}] 以 safeArea 中心为锚；` +
      `遮挡率 ${(ratio * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%（预算 ${(budget * 100).toFixed(0)}%）`,
  };
}

/**
 * 一个 item 对某个区域的遮挡率（该 item 覆盖面占区域面积的比例）。 */
function occlusionRatio(item: Footprint, box: Footprint): number {
  const area = rectArea(box);
  if (area <= 0) return 0;
  return rectOverlapArea(item, box) / area;
}

interface Hit {
  scene: SceneItem;
  region: PerceiveRegion;
  ratio: number;
}

export { collectHits };

/**
 * 取某个 region 所属 shot 的 `safeArea`（P3：载体裁切窗的锚点）。
 *
 * 找不到对应 shot 时返回 `null` ⇒ 退化为画面居中窗口（刻意，见参数注释）。
 */
function safeAreaOfRegion(ctx: ValidateContext, region: PerceiveRegion): Footprint | null {
  const shot = ctx.perceive.shots.find((s) => s.id === region.shotId);
  return shot?.safeArea ?? null;
}

function collectHits(ctx: ValidateContext): Hit[] {
  const hits: Hit[] = [];
  for (const region of ctx.perceive.regions) {
    for (const s of ctx.scene) {
      // 只有叠加类才遮挡画面；载体类改变的是视频本身的呈现（D 分支的解法，不是遮挡）
      if (!isOverlayScope(s.tpl.scope)) continue;
      if (s.tpl.scope === 'fullscreen') continue; // 归 D3 人工确认，不进预算

      // 🔴 2026-10-15 补上 `occludesSubject` 的消费（问题 9 / 计划书 D1 步骤 1.6）。
      //
      //   此前该字段**零消费** —— 登记册明写「D 的判定结果会以 `occludesSubject`
      //   参与本章的 error 判定」，而实现直接 `occlusionRatio()` 求交，
      //   谁也没读它。后果：模板声明「我遮挡主体」与「我不遮挡主体」对判定毫无区别。
      //
      //   **为什么不能从 scope 推导**（实测，见下表）：`fullscreen` 下
      //   `transition/whip-pan` 是 true 而 `ambience/noise-grain` 是 false
      //   —— 同 scope 不同值 ⇒ 该字段承载的是**独立信息**，删掉即丢信息。
      //
      //   | scope | 声明值 |
      //   |---|---|
      //   | subject-transform / footage-transform | true |
      //   | overlay-safe / anchored | false |
      //   | fullscreen | **true 与 false 并存** ← 不可推导
      //
      //   判定放在**进预算之前**（而非之后降级）：声明不遮挡主体的模板
      //   本就不该消耗遮挡额度，让它进 `hits` 等于先制造冲突再假装无事发生。
      if (!s.tpl.occludesSubject) continue;

      if (!framesOverlap(s.start, s.end, region.fromFrame, region.fromFrame + region.durationInFrames)) {
        continue;
      }
      const ratio = occlusionRatio(s.item.footprint, region.box);
      if (ratio <= budgetOf(region.kind)) continue;
      hits.push({ scene: s, region, ratio });
    }
  }
  return hits;
}

/** #12 遮挡分级预算（人脸 / 手持物）+ #13 载体三级退让。 */
export function checkOcclusionBudget(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const hit of collectHits(ctx)) {
    if (hit.region.kind === 'broll') continue; // 归 #14
    const budget = budgetOf(hit.region.kind);
    const res = resolveOcclusion(hit.scene, hit.region, hit.ratio, budget, safeAreaOfRegion(ctx, hit.region));
    const frames = [Math.max(hit.scene.start, hit.region.fromFrame), Math.min(hit.scene.end, hit.region.fromFrame + hit.region.durationInFrames)];
    const head =
      `区域 ${hit.region.id}（${hit.region.kind}）被遮挡 ${(hit.ratio * 100).toFixed(1)}%，` +
      `超预算 ${(budget * 100).toFixed(0)}%`;

    // 🔴 2026-10-13：退让成功不再静默continue，而是**留下可对账的告警**。
    //   修复前这两个分支直接跳过，导致「校验通过」与「产物真的变了」无法对账。
    if (res.status === 'nudged') {
      out.push(
        mk(
          CODES.OCCLUSION_NUDGED,
          'build',
          [hit.scene.ref, hit.region.id],
          frames,
          `${head}；已平移消解 —— ${res.detail}`,
          'footprint 已就地改写并重算遮挡率至预算内。改的是内存场景对象，落盘由 render 阶段负责。',
        ),
      );
      continue;
    }
    if (res.status === 'carrier') {
      out.push(
        mk(
          // 🔴 P3（2026-10-17）：码字符串仍是 `W-D4-01`，但**语义已变**。
          //   它原为「载体档已登记但未实际施加」的诚实告警；P3 让 tier2 真正写入
          //   `carrier.params.window` 之后，这条码降级为「**退让已生效**」的记录。
          //   ⚠️ 码名与描述文本（`errors.ts` 的 `carrier-not-applied`）此时已名不副实，
          //   保留字符串是为保登记册可追溯（P1 同款决策）；**语义以本文件为准**。
          CODES.CARRIER_NOT_APPLIED,
          'build',
          [hit.scene.ref, hit.region.id],
          frames,
          `${head}；${res.detail}`,
          'D4 的 ② 号载体档已生效：画面裁切为分屏，主体锚定窗口保证主体完整，' +
            '视频移出 overlay 所在区域。成片会真正改变（通道已由 render 侧重算打通）。',
        ),
      );
      continue;
    }

    if (res.status === 'no-carrier') {
      out.push(
        mk(
          CODES.CARRIER_NO_ROUTE,
          'build',
          [hit.scene.ref, hit.region.id],
          frames,
          `${head}；三级退让用尽 —— ${res.detail}`,
          '同一预算内挪不动，且该 scope 没有载体档可退。换模板、改锚点让动效落在安全区，或调低 footprint 尺寸。',
        ),
      );
      continue;
    }

    out.push(
      mk(
        CODES.OCCLUSION_BUDGET,
        'build',
        [hit.scene.ref, hit.region.id],
        frames,
        `${head}；载体档已应用但仍不足 —— ${res.detail}`,
        '缩小 footprint，或把该 motion 移到主体不在场的 shot。',
      ),
    );
  }
  return out;
}

/** #14 B-roll 主体遮挡 ≤ 30% 预算。 */
export function checkBrollOcclusion(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  const budget = budgetOf('broll');
  for (const hit of collectHits(ctx)) {
    if (hit.region.kind !== 'broll') continue;
    const res = resolveOcclusion(hit.scene, hit.region, hit.ratio, budget, safeAreaOfRegion(ctx, hit.region));
    const frames = [Math.max(hit.scene.start, hit.region.fromFrame), Math.min(hit.scene.end, hit.region.fromFrame + hit.region.durationInFrames)];
    // 同上：退让成功同样要留下可对账的告警，而不是静默跳过
    if (res.status === 'nudged' || res.status === 'carrier') {
      out.push(
        mk(
          res.status === 'nudged' ? CODES.OCCLUSION_NUDGED : CODES.CARRIER_NOT_APPLIED,
          'build',
          [hit.scene.ref, hit.region.id],
          frames,
          `B-roll 主体 ${hit.region.id} 被遮挡 ${(hit.ratio * 100).toFixed(1)}% > 预算 ${(budget * 100).toFixed(0)}%；${res.detail}`,
          res.status === 'nudged'
            ? 'footprint 已就地改写并重算遮挡率至预算内。'
            : 'D4 的 ② 号载体档已生效：画面裁切为分屏，视频移出 overlay 所在区域。',
        ),
      );
      continue;
    }
    out.push(
      mk(
        CODES.BROLL_OCCLUSION,
        'build',
        [hit.scene.ref, hit.region.id],
        frames,
        `B-roll 主体 ${hit.region.id} 被遮挡 ${(hit.ratio * 100).toFixed(1)}% > 预算 ${(budget * 100).toFixed(0)}%（${res.detail}）`,
        'B-roll 用来展示产品特点，被遮挡就失去意义。把动效挪出峰值区，或缩短其在该 shot 内的时长。',
      ),
    );
  }
  return out;
}

/**
 * ── 通道方案 A（2026-10-17）：消解结果的跨进程传递 ──────────────
 *
 * **要解决的问题**：`resolveOcclusion` 改的是 `buildContext()` 读进来的**内存对象**，
 * 而 `05-render` 是**另一个进程**（`render.ts` 里 `readJson(storyboard.json)` 重新读盘）。
 * 两进程之间没有任何通道 ⇒ tier1 的平移与 tier2 的载体退让**从未真正改变过成片**，
 * 而报告却写着「已平移消解」、退出码 0、`ok: true`。这是自 2026-10-13 修掉
 * 「只拼进 detail 字符串」那版假绿之后，**残留的第二层假绿**。
 *
 * **为什么选 render 侧重算（A）而不是落一份 resolved storyboard（B）**：
 *   - 不新增阶段产物文件 ⇒ 不必改 SPEC §1 的阶段契约，也不必让 04 阶段回写 03 目录
 *     （那是被禁的）。⚠️ **2026-10-18 更正**：本行原写「`io.ts` 的不可变快照守卫
 *     （`guardSnapshot` 会直接拒绝 04 阶段回写 03）」，两处都不实 ——
 *     `guardSnapshot` 这个函数**从来不存在**，真正同作用的 `assertNotWritingUpstream`
 *     当时**零调用**（结论侥幸成立，但论证的前提是假的）。
 *     现守卫已接进 `writeStageJson()`，04 写 03 会在**落盘之前**抛 `ConfigError`，
 *     见 `tests/stage-io.test.ts`；
 *   - 消解逻辑仍是**唯一一份**（就是本文件），render 不复制几何代码；
 *   - 代价：render 依赖 validate 的几何模块 —— 这是**有意的依赖**，
 *     因为「校验时判的几何」与「渲染时用的几何」必须逐位一致，
 *     一旦分叉，报告会开始对成片说谎（比不同步更危险）。
 *
 * **幂等性是硬要求**：validate 与 render 各跑一次本函数，故 `resolveOcclusion`
 * 内置了「已在预算内则不再平移」的护栏（见其 tier1 开头）。
 *
 * ⚠️ **本函数只负责「让改写生效到内存」**；它不产出报告条目。
 *   报告由 `checkOcclusionBudget` / `checkBrollOcclusion` 负责，两者共用同一份
 *   `resolveOcclusion`，因此**校验侧与渲染侧的消解结果必然一致**（同输入同输出）。
 *
 * @returns 实际发生了改写的 item 数（供 render 侧日志对账，非控制流）。
 */
export function resolveScene(ctx: ValidateContext): number {
  let changed = 0;
  // 与 checkOcclusionBudget / checkBrollOcclusion 同样按 kind 分派预算，
  // 保证 render 侧重算时用的预算与校验期完全一致。
  for (const hit of collectHits(ctx)) {
    const before = hit.scene.item.footprint;
    const beforeCarrier = hit.scene.item.carrier?.params?.['window'];
    const res = resolveOcclusion(hit.scene, hit.region, hit.ratio, budgetOf(hit.region.kind), safeAreaOfRegion(ctx, hit.region));
    if (res.status === 'nudged' || res.status === 'carrier') {
      const after = hit.scene.item.footprint;
      const afterCarrier = hit.scene.item.carrier?.params?.['window'];
      if (
        before[0] !== after[0] ||
        before[1] !== after[1] ||
        before[2] !== after[2] ||
        before[3] !== after[3] ||
        beforeCarrier !== afterCarrier
      ) {
        changed += 1;
      }
    }
  }
  return changed;
}

/**
 * D3 fullscreen 需人工确认。
 *
 * 校验期只提示；**硬停**在 render 的启动闸（见 stages/render.ts）。
 * 原因：SPEC §2.1 限定构建期只读 03/01/02，而人工确认落在 06-review。
 */
export function checkFullscreenConfirmation(ctx: ValidateContext): ReportItem[] {
  return ctx.scene
    .filter((s) => s.tpl.scope === 'fullscreen')
    .map((s) =>
      mk(
        CODES.FULLSCREEN_CONFIRM,
        'build',
        [s.ref],
        [s.start, s.end],
        `fullscreen 类 motion（${s.tpl.id}）必然覆盖全画面`,
        'D3 规定一律人工确认、不设自动放行规则。渲染前须在 06-review/confirmed.json 留下放行记录。',
      ),
    );
}

/** F6 判不出主体区 → warning，**不阻断**（这是唯一语义为「不阻断」的码）。 */
export function checkSubjectUnknown(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const shot of ctx.perceive.shots) {
    if (!shot.lowConfidence) continue;
    out.push(
      mk(
        CODES.SUBJECT_UNKNOWN,
        'build',
        [shot.id],
        [shot.fromFrame, shot.fromFrame + shot.durationInFrames],
        `shot ${shot.id} 的主体归属为低置信，安全区未确`,
        '不阻断。人工核验后改 02-perceive/shots.json 的 subjectBox / safeArea —— ' +
          '改完须重跑 storyboard（下游依赖 02）。confirmed.json 没有这个字段。',
      ),
    );
  }
  const lowRegions = ctx.perceive.regions.filter((r) => r.lowConfidence);
  for (const r of lowRegions) {
    out.push(
      mk(
        CODES.SUBJECT_UNKNOWN,
        'build',
        [r.id],
        [r.fromFrame, r.fromFrame + r.durationInFrames],
        `区域 ${r.id}（${r.kind}）为低置信检测结果`,
        '不阻断。人工核验后改 02-perceive/regions.json 的 box（或 shots.json 的 subjectBox），' +
          '改完须重跑 storyboard。',
      ),
    );
  }

  // 🔴 2026-10-26 补漏：**shot 没有任何 region** 此前完全静默。
  //
  //   `geometry.ts` 的 `if (!safeArea) continue` 处写着「主体不在场 ⇒ 不判
  //   （归 W-F6-01 的地盘）」，但那个地盘原先只认两件事：`shot.lowConfidence`
  //   与 `region.lowConfidence`。而 `region-derive.ts` 的策略恰恰是
  //   「框不到就**退让（不产 region）**」—— 连 region 都没有，哪来的 lowConfidence 可标？
  //   ⇒ 该 shot 的遮挡校验空跑，报告照样 `0 error`，且**没有任何字段记下「这段没测」**。
  //   与 M-1f 修的「对齐结构盲区」（alignedRatio=1.0 却词落进真静音）同源：
  //   指标只衡量「测到的部分」，测不到的部分没人记账。
  //
  //   两处收窄，避免噪音：
  //   ① 已在 `lowConfidence` 段报过的不重复报；
  //   ② 只报**该 shot 内确实叠了 overlay** 的 —— 没配动效就不存在遮挡问题，
  //      纯空镜不该被要求人工确认主体。
  for (const shot of ctx.perceive.shots) {
    if (shot.lowConfidence) continue;
    const shotEnd = shot.fromFrame + shot.durationInFrames;
    const covered = ctx.perceive.regions.some(
      (r) => r.fromFrame < shotEnd && shot.fromFrame < r.fromFrame + r.durationInFrames,
    );
    if (covered) continue;
    const hasOverlay = ctx.scene.some(
      (s) => isOverlayScope(s.tpl.scope) && s.start < shotEnd && shot.fromFrame < s.end,
    );
    if (!hasOverlay) continue;
    out.push(
      mk(
        CODES.SUBJECT_UNKNOWN,
        'build',
        [shot.id],
        [shot.fromFrame, shotEnd],
        `shot ${shot.id} 没有任何主体区域（检测退让），该段的遮挡校验为空跑`,
        '不阻断。若该镜头确实无人/无主物，可忽略；否则人工在 02-perceive/shots.json ' +
          '补 subjectBox（或 regions.json 补 box）后重跑 storyboard。',
      ),
    );
  }

  return out;
}

/**
 * 禁配段：任何 motion 与 `noMotionRanges` 相交 → error —— 校验项 #15。
 *
 * 来源：SPEC §1.4（E5 裁决）。
 * 2026-10-13 正式纳入构建期清单：它的三条准入判据（输入可读 / 纯结构化判定 /
 * 渲染前就该拦）全中，原清单成型早于 E5，编表时**纯漏收**，非设计分歧。
 */
export function checkNoMotionRanges(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const range of ctx.storyboard.noMotionRanges) {
    const end = range.fromFrame + range.durationInFrames;
    for (const s of ctx.scene) {
      if (!framesOverlap(s.start, s.end, range.fromFrame, end)) continue;
      out.push(
        mk(
          CODES.NO_MOTION_RANGE,
          'build',
          [s.ref],
          [Math.max(s.start, range.fromFrame), Math.min(s.end, end)],
          `motion 与禁配段 [${range.fromFrame}, ${end}]（${range.reason}）相交`,
          '模型起草时应跳过这些区间。把 item 移出禁配段，或调整 noMotionRanges。',
        ),
      );
    }
  }
  return out;
}
