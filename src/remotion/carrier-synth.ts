/**
 * 影子载体轨（shadow carrier track）—— D4-t3 裁决的实现。
 *
 * ── 为什么需要这一层 ───────────────────────────────────────────
 * D4-t2 把载体退让的承载字段定为「逐 item 的 `carrier?: {template, params}`」，
 * 且明确**不改渲染架构**（`carrier.tsx` 的分段包裹已就绪）。但真素材首跑实测发现
 * 两条路径**根本不相交**：
 *
 *   · `validate/occlusion.ts` 把 `window` 写进**叠加 item** 的 `carrier.params`
 *     （且显式 `if (!isOverlayScope(...)) return no-carrier`）；
 *   · 渲染层的 `Overlay.tsx` 按 **track 的 `motion` scope** 划分载体轨；
 *     `MotionItem` **完全不读 `item.carrier`**；
 *   · 唯一读 `carrierParamsOf` 的 `split-frame.tsx`，只在 motion 本身是
 *     `carrier/split-frame@1.0` 时才运行 —— 而那种 item 校验侧永远不会写 window。
 *
 *   ⇒ 载体档「算了、写了、报告说生效了，画面分毫未动」。这是**第四层假绿**的候选，
 *     由 `docs/changelog/2026-10-18-真素材端到端首跑.md` §5 记录。
 *
 * ── D4-t3 的裁决要点（照抄，改前先改册）────────────────────────
 *   ① 不新增组件、不改双栈：把「带 `carrier` 的**叠加** item」折成一条**影子载体轨**，
 *      交给既有 `CarrierChain` 去包视频；
 *   ② 影子轨恒为**最内层**（紧贴视频），真实载体轨（`punch-in` 等）在其外层；
 *   ③ 影子轨**不落盘** —— 只进 `05-render/render-props.json`，`03-storyboard/storyboard.json`
 *      保持模型产物原貌（与「通道方案 A 不落新阶段产物」同源）。
 *
 * ── 为什么单独放在一个纯函数里 ─────────────────────────────────
 * 「渲染层有没有把 carrier 折成轨」这件事，必须能被**单测**断言。
 * 上一轮的两个 bug 都是「组件单测全绿、画面全错」，所以这次的合成逻辑做成
 * 纯函数 `synthesizeCarrierTracks(storyboard)`：同样输入必得同样输出，可直接断言。
 */

import type { Storyboard, StoryboardItem, StoryboardTrack } from '../core/types.ts';
import { getTemplate } from '../templates/registry.ts';
import { isCarrierScope } from '../templates/types.ts';

/** 影子轨 id 前缀 —— 用它区分「模型声明过的轨」与「渲染期合成的轨」。 */
export const SHADOW_TRACK_PREFIX = 'shadow-carrier/';

/**
 * 把「叠加 item 上的 `carrier` 声明」折成载体轨。
 *
 * 分组规则：**按载体模板 id 分组**。同一 track 内的 item 必须同 scope
 * （`scope.ts` 的 `getScopeOf` 会直接抛错），而 `scope` 由 `motion` 决定 ⇒
 * 一个模板一条轨是唯一安全的组织方式。
 *
 * 顺序规则：**返回顺序 = 由内到外**。`Overlay.tsx` 用 reduce 依次包裹，
 * 第一个元素最贴近视频 ⇒ 影子轨排在前即「最内层」（D4-t3 ②）。
 */
export function synthesizeCarrierTracks(storyboard: Storyboard): StoryboardTrack[] {
  const groups = new Map<string, StoryboardItem[]>();

  for (const track of storyboard.tracks) {
    for (const item of track.items) {
      const ref = item.carrier;
      if (!ref || typeof ref.template !== 'string' || ref.template === '') continue;

      // 只对**叠加类** item 合成：载体类 item 自己就是载体轨，再合成一层会双重施加。
      // 这与校验侧 `isOverlayScope` 的门保持同一条判据。
      const srcScope = getTemplate(item.motion).scope;
      if (isCarrierScope(srcScope)) continue;

      // 🔴 只在载体**真的生效过**时才合成：`params.window` 是 tier2 成功路径
      //    （`occlusion.ts` 终判通过后才写）与人工返修的共同痕迹。
      //    缺它意味着「声明了 carrier，但 tier1 平移就把遮挡解决了」——
      //    此时再切画面是**无中生有**：观众会看到一段没来由的分屏。
      //    ⇒ 声明 ≠ 生效；carrier 是退路，不是装饰。
      const params = (ref.params ?? {}) as Record<string, unknown>;
      if (!('window' in params)) continue;

      // 模板必须已注册（校验期的结构检查已拦过，这里再取一次是为了拿 footprint/layer；
      // 未注册会由 registry 抛 ConfigError → 退出码 2，与既有行为一致）。
      const tpl = getTemplate(ref.template);

      const shadow: StoryboardItem = {
        fromFrame: item.fromFrame,
        durationInFrames: item.durationInFrames,
        motion: ref.template,
        // 用**载体模板自己声明的 footprint**，不是被让位 item 的 ——
        // 载体要占的是「给视频用的那一条」，与 overlay 摆哪儿无关。
        footprint: [...tpl.footprint] as StoryboardItem['footprint'],
        // 🔴 深拷一份 params：validate 写入的 `window` 在这里被固化下来，
        //    不得与源 item 共享引用（共享会让后续任何一处改写同时污染两边）。
        params: { ...params },
      };

      const list = groups.get(ref.template);
      if (list) list.push(shadow);
      else groups.set(ref.template, [shadow]);
    }
  }

  const out: StoryboardTrack[] = [];
  for (const [template, items] of groups) {
    const tpl = getTemplate(template);
    out.push({
      // id 带模板名便于在 `data-carrier` 属性里一眼看出是哪条影子轨
      id: `${SHADOW_TRACK_PREFIX}${template}`,
      layer: tpl.layer,
      // 同轨 items 按 fromFrame 升序：`splitCarrierSegments` 的 first-wins 降级
      // 依赖「开始最早者接管」，源数组顺序会影响其确定性，这里固定成升序。
      items: [...items].sort((a, b) => a.fromFrame - b.fromFrame),
    });
  }
  // 组间顺序固定成「按模板 id 字典序」，避免 Map 插入序随 storyboard 顺序漂移
  // （确定性红线：同一输入必须得到同一渲染结果）。
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
