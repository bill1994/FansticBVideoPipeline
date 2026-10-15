/**
 * `cinematic/punch-in@1.0` —— 全画面缓慢推近。
 *
 * ── 它就是"包裹视频"的那一类（背景链 / footage-transform）──────
 * 本组件**不画任何自己的内容**，而是把 children（实拍视频）放进一个
 * `scale` 变换容器里原样透传 —— 这正是 C6 双栈对载体类的语义要求：
 * 「改变视频的呈现」，而不是「在视频上盖一层」。
 * children 的注入机制见 `src/remotion/carrier.tsx`。
 *
 * ── 节奏设计：不是"进/停/出"，是"一次呼吸" ─────────────────────
 * 叠加类模板的 `enterExitProgress`（快进 → 停 → 快出）**不适用**于镜头运动：
 * 推近的感觉来自**持续运动**，19 帧推完再静止 3 秒会读成"放大了一下"。
 * 因此本组件用独立的双段节奏：
 *   · 推进段（0 → duration − exitFrames）：scale 1 → 目标值，in-out 缓动
 *   · 回退段（最后 exitFrames 帧）：scale 目标值 → 1，同样 in-out
 * 对称的 in-out 让"推近 → 归位"读起来像摄影机的"缓起缓停"，
 * 而不是动画元素的"弹入弹出"。
 *
 * ⚠️ 回退段为什么必须有：无剪辑的场景里（demo 就是），区间结束时
 * 没有回退会**瞬间跳回全景**——那是肉眼可见的"跳变"，比"多一段回退"
 * 糟糕得多。有剪辑时这段回退会被剪点覆盖，零代价。
 *
 * ── 参数 `scale`（目标倍数）────────────────────────────────────
 * · 缺省 1.06【实现期拟定，文档未点名】——与 demo 的 1.08 同量级，
 *   取略保守值（缺省应当安全）。
 * · 钳制到 [1.0, 1.6]【实现期拟定】：
 *   - 上界 1.6：1080p 素材放大 160% 以上时细节劣化已肉眼可见
 *     （数字变焦的可见损失线），且"缓慢推近"的语境下不会需要更大；
 *   - 下界 1.0："punch-in"的语义是推近。<1 是拉远（pull-out），
 *     不是本模板语义；clamp 到 1.0 即"无运动"，确定性且不崩。
 *   ⚠️ 校验项 #16 只验类型不判语义（`scale: -1` 结构合法），
 *   `scale: 0` / 负数若直接透传会静默产出坏画面 —— clamp 是渲染期的
 *   确定性降级，与既有"参数降级不崩"的约定一致。
 */

import { Easing } from 'remotion';
import { num, type TemplateComponent } from './contract.tsx';

/** 缺省推近量 —— 【实现期拟定，文档未点名】。 */
const DEFAULT_SCALE = 1.06;
/** 推近倍数下界：1.0 = 无运动（见文件头）。 */
const SCALE_MIN = 1.0;
/** 推近倍数上界：1.6 = 数字变焦的可见劣化线（见文件头）。 */
const SCALE_MAX = 1.6;
/** 回退段占整条 motion 的比例（与 `DUR.exit` 同值，刻意对齐全项目出场配比）。 */
const EXIT_RATIO = 0.22;
/** 回退段的帧数下限（极短 motion 时按比例会得到 0 帧，读成"跳变"）。 */
const MIN_EXIT_FRAMES = 4;

/**
 * 镜头运动的缓动 —— in-out quad：缓起、中段匀速感、缓停。
 *
 * 实测推进量（供选型复核）：t=0.1→0.02、t=0.3→0.18、t=0.5→0.50、t=0.7→0.82、t=0.9→0.98。
 * 与同项目其他曲线的分野：`ENTER_EASE`(expo-out) 前 2 帧就推进 49%，那是
 * "弹出"的手感，用在镜头推近上会像"画面猛地一缩"。
 */
const PUNCH_EASE = Easing.inOut(Easing.quad);

/**
 * 当前帧的 scale。纯函数，可单测。
 *
 * 分段（设 `pushEnd = duration − exitFrames`）：
 *   · `frame ≤ pushEnd`：推进段，1 → target
 *   · `frame > pushEnd`：回退段，target → 1（最后一帧恰好回到 1，
 *     与区间外的"无变换"无缝衔接）
 */
export function punchInScale(frame: number, durationInFrames: number, target: number): number {
  const d = Math.max(1, durationInFrames);
  const exitFrames = Math.max(MIN_EXIT_FRAMES, Math.round(d * EXIT_RATIO));
  const pushEnd = Math.max(1, d - exitFrames);
  const f = Math.min(Math.max(frame, 0), d - 1);

  if (f <= pushEnd) {
    const p = Math.min(1, f / pushEnd);
    return 1 + (target - 1) * PUNCH_EASE(p);
  }
  const p = Math.min(1, (f - pushEnd) / Math.max(1, d - 1 - pushEnd));
  return target - (target - 1) * PUNCH_EASE(p);
}

export const PunchIn: TemplateComponent = ({ frame, durationInFrames, item, children }) => {
  const raw = num(item.params, 'scale', DEFAULT_SCALE);
  const target = Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw));
  const s = punchInScale(frame, durationInFrames, target);

  return (
    <div
      data-template="punch-in"
      data-scale={target}
      style={{
        position: 'absolute',
        inset: 0,
        // 推近锚点 = 画面几何中心（transform-origin 默认值，显式写出以固定语义）。
        transformOrigin: 'center',
        transform: `scale(${s})`,
        // 放大后超出合成画布的部分由画布裁掉；overflow: hidden 保证
        // 组件容器自身的边界行为也一致（与合成边界重合，无视觉差异）。
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
};
