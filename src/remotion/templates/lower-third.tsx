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
import { footprintStyle, str, type TemplateComponent } from './contract.tsx';

export const LowerThird: TemplateComponent = ({ frame, durationInFrames, item }) => {
  const title = str(item.params, 'title');
  const subtitle = str(item.params, 'subtitle');
  const { enter, exit } = enterExitProgress(frame, durationInFrames);

  return (
    <div
      data-template="lower-third"
      data-has-subtitle={subtitle ? '1' : '0'}
      style={{
        ...footprintStyle(item),
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
          transform: `translateX(${-(1 - enter) * 100 - exit * 100}%)`,
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