/**
 * `typography/outline-fill@1.0` —— 空心大字急缩落位 → 虚线环锁定 → **一帧硬切**点亮。
 *
 * ── 手法来源（P1-3「借手法不抄代码」，2026-10-27）─────────────────
 * 参考 `video-shotcraft` @ `43bd349` 的 `outline-word-fill`（Apache-2.0）。
 * **未复制源码**：圆环、刻度、套准线都是我自己按几何画的，缓动自己写。
 * 借的是时值配比与那条最关键的判例：
 *
 * | 参数 | 借来的值 | 原文依据（被裁判例） |
 * |---|---|---|
 * | 字的收缩窗 | **11f**，`scale 3.2 → 1` | <2× 读作普通缩放；>20f 就成了缓慢 zoom，冲击全失 |
 * | 空心字字重 | **500**（不是 700+） | 「空心字上 700+ 会让细描边包住一大块空白，读作气球字」 |
 * | 描边 | **2px** 暖灰 | 细描边是「制图」语汇；>4px 变涂鸦 |
 * | 圆环收缩 | `scale 2.8 → 1` 用 **44f** | 全片最慢曲线，与 11f 的字形成快慢对比；压到 20f 两者撞一起 |
 * | 点亮 | **第 54 帧硬切** | 「这一下是全卡的目的」；任何 >3f 的慢扫都把钉子降级成美化动画 |
 * | 辉光 | **8f 衰完** | 持续辉光读作发光字体，质感立刻廉价 |
 *
 * ── 为什么这里的「硬切」正好合我们的红线 ────────────────────────
 * `frame >= 54 ? 1 : 0` 不是插值，是**按帧判断**——没有中间态。
 * 项目红线要求「帧是真相」，多数模板用 `interpolate` 做入场；
 * 而这一张卡的核心恰恰是「不存在中间帧」，比缓动更硬，天然合规。
 *
 * ── 与本仓库其它大字模板的区分 ──────────────────────────────────
 * · `center-emphasis`：**实心**白字 + 底板 + 金条，静态压上去
 * · `outline-fill`：**先空心后实心**，靠"点亮"这一下制造冲击 —— 两者语义不同
 *
 * 参数：`text`（必填）。
 */

import { COLOR, enterExitProgress, FONT, SHADOW } from '../tokens.ts';
import { fitScaleFor, str, type TemplateComponent } from './contract.tsx';

/** 线性进度（帧 → 0..1）。 */
const ramp = (f: number, from: number, to: number): number => {
  if (to <= from) return f >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (f - from) / (to - from)));
};
/** 快进慢出 —— 用于 11f 的急缩（越短越需要"瞬间到位"）。 */
const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
/** 慢收 —— 用于 44f 的圆环呼吸。 */
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** 基准时长：原文 90f @30fps。 */
const TOTAL = 90;
// ── 关键帧（原文节拍，见文件头表格）────────────────────────────
const T_TEXT_IN = 2; // 字开始缩进
const T_TEXT_LAND = 11; // 字落定
const T_RING_IN = 8; // 圆开始收
const T_RING_LAND = 52; // 圆收完（44f 慢收）
const T_LIT = 54; // 🔴 硬切点亮
const T_FLASH_END = 62; // 辉光 8f 衰完

const FONT_SIZE = 84;
/** 空心字描边：2px 暖灰（原文值）-> 预热到亮橙。 */
const STROKE_DIM = 'rgb(138,118,104)';
const STROKE_HOT = 'rgb(255,176,112)';

export const OutlineFill: TemplateComponent = ({
  frame,
  durationInFrames,
  item,
  canvasWidth,
}) => {
  const text = str(item.params, 'text');
  const { exit } = enterExitProgress(frame, durationInFrames);
  const fit = fitScaleFor(text, item.motion, item, canvasWidth);

  /**
   * 时间轴压缩系数：item 短于 90f 时把整条节拍等比压缩（保住"快慢对比"的相对关系），
   * 长于 90f 则不拉伸 —— 后半段留给 hold，观众来得及读。
   */
  const k = Math.min(1, durationInFrames / TOTAL);
  const at = (f: number): number => f * k;

  const textT = ramp(frame, at(T_TEXT_IN), at(T_TEXT_LAND));
  const textScale = 3.2 + (1 - 3.2) * easeOutExpo(textT);

  const ringT = ramp(frame, at(T_RING_IN), at(T_RING_LAND));
  const ringScale = 2.8 + (1 - 2.8) * easeOutCubic(ringT);

  /** 🔴 点亮：**按帧硬切**，没有中间态（见文件头）。 */
  const lit = frame >= at(T_LIT) ? 1 : 0;
  /** 一闪即逝的辉光：点亮后 8f 线性衰完。 */
  const flash = lit * (1 - ramp(frame, at(T_LIT), at(T_FLASH_END)));

  /** 主圈自转 0.22°/f，**点亮那一刻刹停**（"锁定"感）。 */
  const mainRot = Math.min(frame, at(T_LIT)) * 0.22;
  /** 内圈刻度继续慢转 —— 锁定后画面仍在呼吸。 */
  const innerRot = -frame * 0.35;

  const ringColor = lit === 1 ? 'rgba(255,150,80,0.9)' : 'rgba(255,255,255,0.55)';
  const glow = flash > 0 ? `0 0 ${14 * flash}px #fff, 0 0 ${60 * flash}px rgba(255,140,60,0.9)` : 'none';

  return (
    <div
      data-template="outline-fill"
      style={{
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 1 - exit,
      }}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
        }}
      >
        {/* ── 圆环层（在文字之下）────────────────────────────── */}
        {/*
          坐标系 0..100 正方形 + 默认 `xMidYMid meet` ⇒ 圆恒为正圆，
          直径取 footprint 的**短边**（所以 footprint 高度必须够，否则圆会比字小）。
        */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            transform: `scale(${ringScale})`,
            opacity: ramp(frame, at(T_RING_IN), at(T_RING_IN) + 10 * k),
            pointerEvents: 'none',
          }}
        >
          {/* 主圈：虚线 + 自转（点亮时刹停） */}
          <g transform={`rotate(${mainRot} 50 50)`}>
            <circle
              cx={50}
              cy={50}
              r={47}
              fill="none"
              stroke={ringColor}
              strokeWidth={0.55}
              strokeDasharray="2.4 1.9"
            />
          </g>
          {/* 内圈：72 格刻度，反向慢转（每 6 格一根长刻度 = 每 30°） */}
          <g transform={`rotate(${innerRot} 50 50)`}>
            {Array.from({ length: 72 }, (_, i) => {
              const isLong = i % 6 === 0;
              return (
                <line
                  key={i}
                  x1={50}
                  y1={12}
                  x2={50}
                  y2={isLong ? 4.5 : 7.5}
                  stroke={ringColor}
                  strokeWidth={isLong ? 0.7 : 0.35}
                  transform={`rotate(${i * 5} 50 50)`}
                />
              );
            })}
          </g>
          {/* 四个套准刻度（圆外四向），点亮时同步变色 */}
          {[0, 90, 180, 270].map((deg) => (
            <line
              key={deg}
              x1={50}
              y1={0.5}
              x2={50}
              y2={3.5}
              stroke={ringColor}
              strokeWidth={0.9}
              transform={`rotate(${deg} 50 50)`}
            />
          ))}
        </svg>

        {/* ── 文字层：空心 → 硬切点亮 ─────────────────────────── */}
        <div
          style={{
            position: 'relative',
            fontFamily: FONT.sans,
            fontSize: FONT_SIZE,
            // 原文判例：空心字 700+ 会糊成"气球字"，500 是甜点
            fontWeight: 500,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            // 硬切：点睛前后只有两个值
            color: lit === 1 ? '#fff5ee' : 'transparent',
            WebkitTextStroke: `2px ${lit === 1 ? STROKE_HOT : STROKE_DIM}`,
            textShadow: lit === 1 ? `${glow}${glow === 'none' ? '' : ', '}${SHADOW.text}` : 'none',
            transform: `scale(${textScale * fit})`,
            transformOrigin: 'center center',
            opacity: ramp(frame, at(T_TEXT_IN), at(T_TEXT_IN) + 2 * k),
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};
