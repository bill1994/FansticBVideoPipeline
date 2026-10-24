/**
 * `annotation/pointer-callout@1.0` —— 指向画面区域的标注。
 *
 * ── 形态：把 `footprint` 本身当成「目标区域」────────────────────
 * `scope: anchored` 的语义是「锚定到主体 / 物体」：`footprint` 由
 * 感知产物或模型给出，本组件**不再第二次猜测目标在哪**。
 * 因此画的是：
 * · 四角括线 —— 圈住区域但不盖住内容（不像实心框那样挡主体）
 * · 中心锚点 —— 一个小圆点 + 一圈随入场收拢的脉冲
 * · 左上标签 —— `params.target` 的文字说明
 *
 * 🔴 **为什么不做实心底色 / 大箭头**：`occludesSubject: false` 是契约声明，
 *    若组件实际大面积遮挡主体，声明就变成谎话。括线 + 小圆点的覆盖率
 *    与「标注」语义相称，也让遮挡预算判定与画面事实一致。
 *
 * 🔴 **目标位置不来自 perceive 数据**：`TemplateProps` 里没有 `safeArea` /
 *    `subjectBox`（那是 validate 的输入）。`anchored` 的锚定发生在**上游**
 *    （footprint 怎么写），组件只负责把那个区域画出来 —— 这是职责边界，
 *    不是缺陷。若将来要把感知框直接传进渲染层，须先改契约、别在这里偷读。
 *
 * 参数：`target`（必填，标注文字）。长文本由 `fitScaleFor` 压回框内，
 *       与校验项 #17 共用同一份 `textMetrics`。
 */

import type { CSSProperties } from 'react';
import { COLOR, enterExitProgress, FONT, RADIUS, SHADOW } from '../tokens.ts';
import { fitScaleFor, str, type TemplateComponent } from './contract.tsx';

/** 四角括线的臂长（px）。取 26 是「够看见、又不喧宾夺主」的量级。 */
const CORNER_ARM = 26;
/** 括线粗细。 */
const CORNER_WIDTH = 2;

const CORNERS: Array<{ key: string; style: CSSProperties }> = [
  {
    key: 'tl',
    style: { left: 0, top: 0, borderLeft: `${CORNER_WIDTH}px solid ${COLOR.accent}`, borderTop: `${CORNER_WIDTH}px solid ${COLOR.accent}` },
  },
  {
    key: 'tr',
    style: { right: 0, top: 0, borderRight: `${CORNER_WIDTH}px solid ${COLOR.accent}`, borderTop: `${CORNER_WIDTH}px solid ${COLOR.accent}` },
  },
  {
    key: 'bl',
    style: { left: 0, bottom: 0, borderLeft: `${CORNER_WIDTH}px solid ${COLOR.accent}`, borderBottom: `${CORNER_WIDTH}px solid ${COLOR.accent}` },
  },
  {
    key: 'br',
    style: { right: 0, bottom: 0, borderRight: `${CORNER_WIDTH}px solid ${COLOR.accent}`, borderBottom: `${CORNER_WIDTH}px solid ${COLOR.accent}` },
  },
];

export const PointerCallout: TemplateComponent = ({ frame, durationInFrames, item, canvasWidth }) => {
  const target = str(item.params, 'target');
  const { enter, exit } = enterExitProgress(frame, durationInFrames);

  // P6：标签放不下就压回框内（下限 0.7）。字号 / 内边距读契约，不写字面量。
  const fit = fitScaleFor(target, item.motion, item, canvasWidth);

  return (
    <div
      data-template="pointer-callout"
      style={{
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        opacity: enter * (1 - exit),
        // 纯淡出：括线缩回去会读成「撤销标注」，而标注的退场应当是「不看了」。
        pointerEvents: 'none',
      }}
    >
      {/* 四角括线：随入场从 1.08 倍收拢到 1，落定后不再动 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${1 + (1 - enter) * 0.08})`,
          transformOrigin: 'center center',
        }}
      >
        {CORNERS.map(({ key, style }) => (
          <span
            key={key}
            data-corner={key}
            style={{
              position: 'absolute',
              width: CORNER_ARM,
              height: CORNER_ARM,
              boxSizing: 'border-box',
              ...style,
            }}
          />
        ))}
      </div>

      {/* 中心锚点：内点固定，外圈随入场从 1.8 倍收拢到 1（一次脉冲，不循环） */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 28,
          height: 28,
          marginLeft: -14,
          marginTop: -14,
          borderRadius: '50%',
          border: `1.5px solid ${COLOR.accent}`,
          boxSizing: 'border-box',
          transform: `scale(${1 + (1 - enter) * 0.8})`,
          opacity: 0.55 + 0.45 * enter,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 10,
          height: 10,
          marginLeft: -5,
          marginTop: -5,
          borderRadius: '50%',
          background: COLOR.brand,
          boxShadow: SHADOW.text,
        }}
      />

      {/* 左上标签：贴区域内侧，避免遮住中心目标 */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          top: 8,
          maxWidth: 'calc(100% - 16px)',
          boxSizing: 'border-box',
          display: 'inline-flex',
          alignItems: 'center',
          background: COLOR.plate,
          border: `1px solid ${COLOR.hairline}`,
          borderRadius: RADIUS.sm,
          padding: '5px 12px',
          transform: `translateY(${(1 - enter) * -8}px)`,
          // `maxWidth` 只在极端长文案时兜底；正常长度由 fitScale 保证不溢出。
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            fontFamily: FONT.sans,
            fontSize: 20,
            fontWeight: 600,
            lineHeight: 1.2,
            color: COLOR.ink,
            textShadow: SHADOW.text,
            whiteSpace: 'nowrap',
            transform: `scale(${fit})`,
            transformOrigin: 'left center',
          }}
        >
          {target}
        </span>
      </div>
    </div>
  );
};
