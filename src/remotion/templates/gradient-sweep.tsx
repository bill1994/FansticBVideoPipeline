/**
 * `typography/gradient-sweep@1.0` —— 关键词被渐变彩光从左到右扫过"充能"。
 *
 * ── 手法来源（P1-3「借手法不抄代码」，2026-10-27）─────────────────
 * 参考 `video-shotcraft` @ `43bd349` 的 `gradient-word-sweep`（Apache-2.0）。
 * **未复制源码**：渐变档位、闪电形状、动画曲线都是我自己定的。
 * 借的是那条最贵的判例集合：
 *
 * | 参数 | 借来的值 | 原文依据（被裁判例） |
 * |---|---|---|
 * | 扫充时长 | **15–20f** | 「>28f 读作进度条」；取了 18f 中值 |
 * | 波前增亮带 | **~34% 词宽**，波前最亮向后衰减 | 「**无梯度 = 静态渐变裁切**」——没有这条就只是把字涂成彩色 |
 * | 稳态泛光 | 4 层，最强档 0.72 | 「**0.75+ 被裁"泛光感有点强"**」；层数 <3 读作纯色 |
 * | 闪电 | 同屏 ≤1 道、间歇 >8f、持续 ~6f | 「频率高读作电弧故障」 |
 * | 禁用 | 填充过程**不带跟随移动的光点** | 「实测判例：跟随白色光点读作廉价装饰，**删**」 |
 *
 * ── 为什么这条比另外两个难 ─────────────────────────────────────
 * 它是**三层叠**：① 渐变彩层被 mask 揭开；② 波前有一条独立的高光带；
 * ③ 填满后叠闪电。任何一层弱了，整张卡就退化成"彩色字"或"故障画面"。
 *
 * ── 三条实现纪律 ─────────────────────────────────────────────
 * 1. **渐变走 `background-clip: text`**，不是 SVG text：文字排版（换行、字距、CJK 度量）
 *    全部交给浏览器，不用自己算字形。
 * 2. **闪电位置由 index 派生，不用随机数**：`(i * 37) % 100` 已足够"看着不规则"，
 *    而且完全确定 —— 不需要 mulberry32，也不违反红线。
 * 3. **呼吸用 `Math.sin(frame)`**：正弦是确定函数，不是 `Math.random()`
 *    （红线禁的是随机，不是三角函数）。
 *
 * 参数：`text`、`onLight`（可选）。
 */

import { enterExitProgress, FONT, SHADOW, toneOf } from '../tokens.ts';
import { bool, fitScaleFor, str, type TemplateComponent } from './contract.tsx';

const ramp = (f: number, from: number, to: number): number => {
  if (to <= from) return f >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (f - from) / (to - from)));
};

// ── 借来的节拍 ──────────────────────────────────────────────
/** 扫充窗：18f（原文 15–20f；>28f 读作进度条）。 */
const SWEEP_START = 6;
const SWEEP_LEN = 18;
/** 波前带半宽（占词宽的百分比）—— 原文 34% 全宽 ⇒ 半宽 17%。 */
const FRONT_HALF = 17;
/** 扫完后波前残留淡出（原文「~10f 淡出到稳态」）。 */
const FRONT_FADE = 10;
/** 填满后开始跳闪电（比扫完略晚，给"充能完成"留一拍）。 */
const FLASH_START = SWEEP_START + SWEEP_LEN + 4;
const FLASH_LEN = 6;
const FLASH_GAP = 11;
const FLASH_COUNT = 3;

const FONT_SIZE = 84;
/** 渐变档位（自己定的冷暖走向：品红 → 金 → 青 → 蓝）。 */
const GRADIENT =
  'linear-gradient(100deg, #FF3D81 0%, #FF7A45 22%, #FFC53D 44%, #4DFFC4 68%, #4DA3FF 100%)';

export const GradientSweep: TemplateComponent = ({
  frame,
  durationInFrames,
  item,
  canvasWidth,
}) => {
  const text = str(item.params, 'text');
  const onLight = bool(item.params, 'onLight', false);
  const tone = toneOf(onLight);
  const { exit } = enterExitProgress(frame, durationInFrames);
  const fit = fitScaleFor(text, item.motion, item, canvasWidth);

  const sweep = ramp(frame, SWEEP_START, SWEEP_START + SWEEP_LEN);
  /** 波前位置（0–100）：只在扫充期间前进，之后定在 100。 */
  const frontPct = sweep * 100;
  /** 波前高光强度：扫充期间恒 1，扫完后 10f 内淡出。 */
  const frontGlow =
    sweep > 0 && sweep < 1
      ? 1
      : 1 - ramp(frame, SWEEP_START + SWEEP_LEN, SWEEP_START + SWEEP_LEN + FRONT_FADE);
  /** 泛光随扫充增强，稳态封顶 0.72（>0.75 被原文裁"泛光感有点强"）。 */
  const glowBase = 0.72 * sweep;
  /** 呼吸：扫完后轻微起伏（正弦是确定函数，不违反"禁随机"）。 */
  const breathe = sweep >= 1 ? 1 + 0.06 * Math.sin((frame - SWEEP_START - SWEEP_LEN) * 0.32) : 1;
  const glow = glowBase * breathe;

  return (
    <div
      data-template="gradient-sweep"
      style={{
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        opacity: 1 - exit,
      }}
    >
      <div
        style={{
          position: 'relative',
          fontFamily: FONT.sans,
          fontSize: FONT_SIZE,
          fontWeight: 900,
          lineHeight: 1.15,
          whiteSpace: 'nowrap',
          transform: `scale(${fit})`,
          transformOrigin: 'left center',
        }}
      >
        {/* ① 白字底层：保证在任何背景上"先能读"，也是辉光载体 */}
        <span
          style={{
            color: tone.ink,
            textShadow:
              glow > 0.01
                ? `0 0 12px rgba(255,61,129,${(0.55 * glow).toFixed(3)}), 0 0 28px rgba(255,61,129,${(
                    0.55 * glow
                  ).toFixed(3)}), 0 0 48px rgba(255,197,61,${(0.62 * glow).toFixed(3)}), 0 0 80px rgba(255,197,61,${(
                    0.72 * glow
                  ).toFixed(3)})`
                : onLight
                  ? SHADOW.textOnLight
                  : SHADOW.text,
          }}
        >
          {text}
        </span>

        {/* ② 渐变彩层：被 clip-path 从左往右揭开 */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: GRADIENT,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            // 按进度裁掉右半边 ⇒ "彩光从左扫过"
            clipPath: `inset(0 ${((1 - sweep) * 100).toFixed(2)}% 0 0)`,
          }}
        >
          {text}
        </span>

        {/* ③ 波前高光带：**这一层是「充能感」的全部来源**，缺了就只是静态渐变裁切 */}
        {frontGlow > 0.01 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(90deg, transparent 0%, transparent ${(
                frontPct - FRONT_HALF
              ).toFixed(2)}%, rgba(255,255,255,0.92) ${frontPct.toFixed(2)}%, transparent ${(
                frontPct + FRONT_HALF
              ).toFixed(2)}%, transparent 100%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              opacity: frontGlow,
            }}
          >
            {text}
          </span>
        )}

        {/* ④ 闪电：填满后字符间跳的细电弧（同屏 ≤1 道、间歇 >8f） */}
        {Array.from({ length: FLASH_COUNT }, (_, i) => {
          const start = FLASH_START + i * (FLASH_LEN + FLASH_GAP);
          const on = frame >= start && frame < start + FLASH_LEN;
          if (!on) return null;
          /** 位置由 index 派生（确定，不用随机数）；错开在字与字之间。 */
          const x = 18 + ((i * 37) % 60);
          return (
            <svg
              key={i}
              aria-hidden="true"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                overflow: 'visible',
                pointerEvents: 'none',
              }}
            >
              {/* 外晕 */}
              <path
                d={`M ${x} 8 L ${x + 3} 34 L ${x - 3} 58 L ${x + 2} 92`}
                fill="none"
                stroke="rgba(216,60,190,0.55)"
                strokeWidth={1.6}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {/* 亮核 */}
              <path
                d={`M ${x} 8 L ${x + 3} 34 L ${x - 3} 58 L ${x + 2} 92`}
                fill="none"
                stroke="rgba(255,235,255,0.95)"
                strokeWidth={0.7}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          );
        })}
      </div>
    </div>
  );
};
