/**
 * `ambience/noise-grain@1.0` —— 胶片颗粒质感层。
 *
 * ── 它是叠加栈的普通层（fullscreen ≠ 载体类）────────────────────
 * `scope: fullscreen` 只表示"必然覆盖全画面"，它**不改变视频**、
 * 只盖一层质感 —— 与载体类的分界见 C6 双栈。因此本组件走普通叠加路径，
 * **不接收 children**。
 *
 * ── 确定性：颗粒的"跳变"也必须属于 frame ────────────────────────
 * 真实胶片颗粒每一格（帧）都不同，所以颗粒图案必须**每帧重排**。
 * E2 红线禁 `Math.random()`，本实现用**整数哈希**（无浮点、跨平台确定）：
 *   `seed = hash32(item.fromFrame 与 frame 的确定性混合)`
 * 相邻帧的 seed 被哈希彻底打散 —— 视觉上是"重新撒了一次颗粒"，
 * 而不是"同一张纹理在滑动"。同帧重复渲染结果必然一致（可单测断言）。
 *
 * ── 为什么用 SVG feTurbulence 而不是 canvas / 大量 DOM ─────────
 * · canvas：SSR（`renderToStaticMarkup`）下不可用，渲染测试直接崩；
 * · 点阵 DOM：全屏需要数千个元素，结构重量与收益不成比例；
 * · feTurbulence：一行 SVG filter 生成均匀噪声，**由渲染引擎离屏合成**，
 *   DOM 结构极小，且输出完全由参数（含 seed）决定。
 * ⚠️ 已知约束：全屏 feTurbulence 每帧重算有渲染成本（离线出片场景可承受；
 * 若将来某段渲染耗时不可接受，降级路径是"小尺寸噪声 + pattern 平铺"，
 * 此时 `stitchTiles="stitch"` 已预置）。
 *
 * ── 参数 `opacity`（颗粒强度）──────────────────────────────────
 * · 缺省 0.05【实现期拟定，文档未点名】——胶片颗粒的典型量级
 *   （0.03–0.08 区间；再高会读成"雪花屏"而不是"质感"）。
 * · clamp 到 [0, 1]，非有限值回退缺省（`num` 已处理）。
 */

import { clamp01, fadeInOut } from '../tokens.ts';
import { num, type TemplateComponent } from './contract.tsx';

/** 缺省颗粒强度 —— 【实现期拟定，文档未点名】。 */
const DEFAULT_OPACITY = 0.05;
/** 颗粒尺度（feTurbulence baseFrequency）：0.75 在 1080p 上是细颗粒。 */
const BASE_FREQUENCY = 0.75;

/**
 * 32 位整数哈希（xorshift 混合，仅用 `Math.imul` 保证 32 位语义）。
 *
 * 用途：把"item 标识 + 帧号"混合成一个跳变的大整数，作为 feTurbulence 的 seed。
 * 纯整数运算 ⇒ 跨平台 / 跨进程完全确定（浮点运算不敢这么承诺）。
 */
function hash32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

export const NoiseGrain: TemplateComponent = ({ frame, durationInFrames, item }) => {
  const strength = clamp01(num(item.params, 'opacity', DEFAULT_OPACITY));
  // 进出场：质感层只做淡入淡出（不做位移 —— 它没有"方向"）。
  const fade = fadeInOut(frame, durationInFrames);
  // 每帧换 seed ⇒ 颗粒跳变（见文件头）。
  const seed = hash32((item.fromFrame * 131 + frame) | 0);
  // filter id 需要唯一：同一合成里可能同时有多个 noise-grain 实例。
  const filterId = `grain-${item.fromFrame}`;

  return (
    <div
      data-template="noise-grain"
      data-opacity={strength}
      style={{
        position: 'absolute',
        inset: 0,
        // 有效不透明度 = 参数强度 × 进出场淡入淡出。
        opacity: strength * fade,
        // 🔴 `overlay` 混合是「胶片颗粒」能成立的关键 —— 2026-10-16 真渲发现：
        //    feTurbulence 的输出以**中灰为均值**。普通叠加时，这层中灰会
        //    直接混入画面 ⇒ 表现为「加了一层灰雾」（0.6 强度下整屏发灰），
        //    而颗粒的偏离量又被 opacity 稀释到不可见（0.08 下完全看不到颗粒）。
        //    overlay 混合的中性点恰好是 0.5：中灰区域对底层**零影响**，
        //    偏离均值的部分才形成亮/暗颗粒；配合元素 opacity，
        //    颗粒强度由 opacity 线性调制、均值始终中性。
        //    （近黑/近白底上颗粒天然弱 —— 这是 overlay 的数学特性，
        //      与真实胶片颗粒在暗部不明显的规律一致，不是 bug。）
        mixBlendMode: 'overlay',
        // 它只是质感层：不参与交互，也不拦截任何东西。
        pointerEvents: 'none',
      }}
    >
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        <filter id={filterId} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={String(BASE_FREQUENCY)}
            numOctaves="1"
            seed={seed}
            stitchTiles="stitch"
            result="noise"
          />
          {/* 去色 + 固定 alpha=1：输出一层"均匀灰度噪声"，
              整体覆盖度交给外层 opacity 控制（否则 alpha 也是噪声，
              有效强度会在 0–1 间随机抖动，量级不可预期）。 */}
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0.333 0.333 0.333 0 0
                    0.333 0.333 0.333 0 0
                    0.333 0.333 0.333 0 0
                    0 0 0 0 1"
          />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${filterId})`} />
      </svg>
    </div>
  );
};
