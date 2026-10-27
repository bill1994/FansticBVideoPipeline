/**
 * `typography/marker-underline@1.0` —— 标题落定后，关键词下方一笔手绘马克笔划过。
 *
 * ── 手法来源（P1-3「借手法不抄代码」，2026-10-27）─────────────────
 * 参考 `video-shotcraft` @ `43bd349` 的 `marker-underline-title` **手法文档**
 * （`gallery/source/marker-underline-title.md`，Apache-2.0）。
 * **未复制任何源码**；下列数值是借来的"手感"，实现完全按本仓库契约重写：
 *
 * | 参数 | 借来的值 | 原文依据（被裁判例） |
 * |---|---|---|
 * | 划线时长 | **10f** | 「14f 版**被裁**偏慢」；>14f 读作进度条，<6f 看不出方向 |
 * | 起笔时机 | 标题落定后 **+4~8f** | 与标题同动会抢戏 |
 * | 字底距离 | **-0.1em** | 原片从 -40 收到 -20(@1080p) 才贴住字势 |
 * | 笔宽 | 中段 ≈0.12em、首尾收细 | 等宽读作机器线；首尾差异 >2× 读作书法 |
 * | 斜向 | **左低右高** | 「画反一眼假——返工判例」 |
 *
 * ── 与 `rule-underline`（spec 驱动）的区分 ──────────────────────
 * 两者都是"文字下划线"，但**质感与语义不同**，可并存：
 * · `rule-underline`：**直线**、等宽、纯色、无倾斜 —— 制图/排版语汇
 * · `marker-underline`：**手绘**、变宽、边缘柔化、微上斜 —— 人手/马克笔语汇
 *
 * ── 三条实现纪律 ─────────────────────────────────────────────
 * 1. **不用 SVG + `preserveAspectRatio="none"`**：横向拉伸会把笔宽压变形（0-100 的
 *    viewBox 映射到任意像素宽），线就不再是"笔"了。改用 div + `scaleX`，
 *    笔宽恒为 px。
 * 2. **不用 `feTurbulence` 做毛糙**：项目已有裁决 —— SSR 量不到的路径不可测
 *    （同 `D-B` 否掉渲染期自适应的理由）。毛糙改为「双线叠 + 上下边缘渐变柔化」，
 *    纯几何、可断言。
 * 3. **禁 `Math.random()`**：这里根本不需要随机 —— 笔形是确定的弧线与柔化，
 *    确定性红线对它零成本。
 *
 * 参数：`text`（必填）。
 */

import { COLOR, enterExitProgress, FONT, SHADOW } from '../tokens.ts';
import { fitScaleFor, str, type TemplateComponent } from './contract.tsx';

/** 线性进度（帧 → 0..1）。比 `interpolate` 直白，且模板内不引 remotion 依赖。 */
const ramp = (f: number, from: number, to: number): number => {
  if (to <= from) return f >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (f - from) / (to - from)));
};

// ── 借来的时间轴（见文件头表格）────────────────────────────────
/** 标题自身落定：0–6f。 */
const TEXT_IN = 6;
/** 起笔：落定后 +4f（原文区间 +4~8f 的下沿，画面上更"接得住"标题）。 */
const STROKE_START = TEXT_IN + 4;
/** 划线：10f（原文实测节奏；14f 被裁偏慢）。 */
const STROKE_LEN = 10;

const FONT_SIZE = 54; // 与 kinetic-line 同字号 ⇒ 可直接复用其 D-B2 实测度量
const MARKER_HEIGHT = 6;
/** 微上斜：左低右高。**画反（左高右低）是返工判例**，符号别改。 */
const TILT_DEG = -1.4;

export const MarkerUnderline: TemplateComponent = ({
  frame,
  durationInFrames,
  item,
  canvasWidth,
}) => {
  const text = str(item.params, 'text');
  const { exit } = enterExitProgress(frame, durationInFrames);
  const fit = fitScaleFor(text, item.motion, item, canvasWidth);

  const textIn = ramp(frame, 0, TEXT_IN);
  const stroke = ramp(frame, STROKE_START, STROKE_START + STROKE_LEN);
  /** 线在出场时比文字先退半步 —— 划线是"补充"，不该最后消失。 */
  const lineFade = 1 - Math.min(1, exit * 1.6);

  return (
    <div
      data-template="marker-underline"
      style={{
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-start',
      }}
    >
      <div
        style={{
          position: 'relative',
          fontFamily: FONT.sans,
          fontSize: FONT_SIZE,
          fontWeight: 700,
          lineHeight: 1.15,
          color: COLOR.ink,
          textShadow: SHADOW.text,
          whiteSpace: 'nowrap',
          opacity: textIn * (1 - exit),
          // 落定时轻微上移 8px（借来的"落位感"），压到框内靠 fit。
          transform: `translateY(${(1 - textIn) * 8}px) scale(${fit})`,
          transformOrigin: 'left bottom',
        }}
      >
        {text}
        {/*
          墨水渗开层：比主线宽、更透明、稍长一点 —— 模拟"墨在纸上洇开"。
          刻意**不做随机抖动**：笔触的不规则来自这层与主线的位移差，而不是噪声。
        */}
        <span
          data-marker="bleed"
          style={{
            position: 'absolute',
            left: -5,
            right: -5,
            bottom: -FONT_SIZE * 0.1 - 1.5,
            height: MARKER_HEIGHT + 3,
            borderRadius: (MARKER_HEIGHT + 3) / 2,
            background: `linear-gradient(180deg, transparent 0%, ${COLOR.brand} 30%, ${COLOR.brand} 70%, transparent 100%)`,
            opacity: 0.28 * lineFade,
            transform: `rotate(${TILT_DEG}deg) scaleX(${Math.min(1, stroke * 1.04)})`,
            transformOrigin: 'left center',
          }}
        />
        {/* 主线：上下边缘渐变柔化 = 笔刷边缘，不是硬色块。 */}
        <span
          data-marker="main"
          style={{
            position: 'absolute',
            left: -4,
            right: -4,
            // 字底 -0.1em：贴住字身、不压到降部
            bottom: -FONT_SIZE * 0.1,
            height: MARKER_HEIGHT,
            borderRadius: MARKER_HEIGHT / 2,
            background: `linear-gradient(180deg, transparent 0%, ${COLOR.brand} 22%, ${COLOR.brand} 78%, transparent 100%)`,
            opacity: 0.92 * lineFade,
            transform: `rotate(${TILT_DEG}deg) scaleX(${stroke})`,
            transformOrigin: 'left center',
          }}
        />
      </div>
    </div>
  );
};
