/**
 * `typography/lower-third@1.0` —— 左下角姓名/ 职务条。
 *
 * 形态：**贴左的深色条 + 上下双行文字**（上粗下细），斜切右端。
 *
 * 与 `kinetic-line` 的分工见该文件注释：一个是瞬时强调，一个是身份条。
 *
 * 参数：`title`（必填）、`subtitle`（可选）。
 */

import { COLOR, enterExitProgress, FONT, RADIUS, SHADOW } from '../tokens.ts';
import { fitScaleFor, str, type TemplateComponent } from './contract.tsx';

export const LowerThird: TemplateComponent = ({ frame, durationInFrames, item, canvasWidth }) => {
  const title = str(item.params, 'title');
  const subtitle = str(item.params, 'subtitle');
  const { enter, exit } = enterExitProgress(frame, durationInFrames);

  // P6：放不下就等比缩小（下限 0.7）。🔴 **按主文本 `title` 判定** ——
  //    副标题 17px 更小，不是最宽的那行；这与校验器 `widthKeysOf` 的
  //    「取 title / value / text 第一个命中键」是同口径。
  //    契约 `textMetrics` 声明的正是 title 的字号 26px。
  const fit = fitScaleFor(title, item.motion, item, canvasWidth);

  return (
    <div
      data-template="lower-third"
      data-has-subtitle={subtitle ? '1' : '0'}
      style={{
        // MotionItem 外层已按 footprint 定位/定尺寸；这里只占满父容器
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
          display: 'flex',
          flexDirection: 'column',
          background: COLOR.plate,
          borderLeft: `4px solid ${COLOR.brand}`,
          borderRadius: `0 ${RADIUS.md} ${RADIUS.md} 0`,
          padding: '10px 26px 10px 20px',
          boxShadow: SHADOW.card,
          // 入场横向推入；出场**向左推出** —— 与入场同轴，
          // 条形信息「从哪来回哪去」才符合直觉。
          // `* fit`（P6）：推移与淡出保留，只把最终尺寸压到框内。
          transform: `translateX(${-(1 - enter) * 100 - exit * 100}%) scale(${fit})`,
          // 条形内容从左贴边 ⇒从左边缩，否则缩完左侧凭空多出留白
          transformOrigin: 'left center',
          opacity: enter * (1 - exit),
          maxWidth: '100%',
        }}
      >
        <span
          style={{
            fontFamily: FONT.sans,
            fontSize: 26,
            fontWeight: 700,
            color: COLOR.ink,
            textShadow: SHADOW.text,
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        {subtitle ? (
          <span
            style={{
              fontFamily: FONT.sans,
              fontSize: 17,
              fontWeight: 400,
              // 次级文字降不透明度而非降亮度 —— 亮背景上降亮度会看不清
              color: COLOR.inkDim,
              lineHeight: 1.35,
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  );
};