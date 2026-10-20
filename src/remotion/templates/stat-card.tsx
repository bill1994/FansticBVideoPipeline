/**
 * `data/stat-card@1.0` —— 数字卡片。
 *
 * 形态：**大号数字 + 小号单位**，右上/右中区域的卡片，带描边。
 *
 * 参数：`value`（必填）、`unit`（可选）。
 *
 * ⚠️ 数字**不做滚动**（digit roll）。理由见下方注释 —— 那是第二轮的事。
 */

import { COLOR, enterExitProgress, FONT, RADIUS, SHADOW } from '../tokens.ts';
import { footprintStyle, fitScale, str, type TemplateComponent } from './contract.tsx';

/**
 * 🔴 **刻意不做 digit roll（数字滚动）** —— 虽然 D3b 把 `DigitRoll.tsx`
 * 列为可借鉴的"实现参考"，第一轮仍不做，原因有三：
 *
 * 1. **第一轮的目标是"证明管线"，不是"数字动得好看"**（计划书 §4.2 R1）。
 *    滚动动画是纯视觉打磨，属于第二轮「打磨到可发布」的范围。
 * 2. **滚动的正确性依赖数值语义**：`"3.2"` 与 `"¥899"` 的滚动位数、
 *    小数点位置、是否补零各不相同。而 `value` 是**字符串**
 *    （`paramsSchema: { value: 'string' }`），校验项 #16 明确「不判语义」
 *    （`value: "999%"` 数值可疑但结构正确，校验器只验结构）。
 *    ⇒ 渲染期无从判断该不该滚、滚几位。**没有语义依据的动画就是猜**，
 *    猜错的表现是「价格牌上的数字滚完变成 00899」。
 * 3. 补这个能力需要先立一条「数字语义」的约定（是否含小数/千分位/前缀货币），
 *    属裁决范畴，不该在实现期顺手定。
 *
 * ⇒ 若后续要做，先立裁决再实现，不要在组件里"顺手解析一下"。
 */
export const StatCard: TemplateComponent = ({ frame, durationInFrames, item, canvasWidth }) => {
  const value = str(item.params, 'value');
  const unit = str(item.params, 'unit');
  const { enter, exit } = enterExitProgress(frame, durationInFrames);

  // P6：`value` 放不下就等比缩小（下限 0.7）。44 = 下方 fontSize；51 = padding 24×2 + border 1.5×2。
  const fit = fitScale(value, 44, item.footprint[2] * (canvasWidth ?? 1920), 51);

  return (
    <div
      data-template="stat-card"
      data-has-unit={unit ? '1' : '0'}
      style={{
        ...footprintStyle(item),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: COLOR.plate,
          border: `1.5px solid ${COLOR.hairline}`,
          borderRadius: RADIUS.md,
          padding: '14px 24px',
          boxShadow: SHADOW.card,
          opacity: enter * (1 - exit),
          // 入场从 0.9 放大到 1（卡片"落定"），出场再缩到 0.96 ——
          // 与 tag-float 的上浮是不同方向的动态，一静一动。
          // `* fit`（P6）：入场「落定」的缩放保留，只把最终尺寸再压到框内。
          transform: `scale(${(0.9 + 0.1 * enter - 0.04 * exit) * fit})`,
          // 卡片居中，从中心缩不会偏心
          transformOrigin: 'center center',
          maxWidth: '100%',
        }}
      >
        <span
          style={{
            fontFamily: FONT.numeric,
            fontSize: 44,
            fontWeight: 800,
            color: COLOR.brand,
            lineHeight: 1.05,
            textShadow: SHADOW.text,
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
        {unit ? (
          <span
            style={{
              fontFamily: FONT.sans,
              fontSize: 15,
              fontWeight: 400,
              color: COLOR.inkDim,
              lineHeight: 1.2,
              marginTop: 3,
              whiteSpace: 'nowrap',
            }}
          >
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
};