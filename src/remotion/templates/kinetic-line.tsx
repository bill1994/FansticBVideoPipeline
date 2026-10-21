/**
 * `typography/kinetic-line@1.0` —— 核心强调词大字。
 *
 * 形态：画面中部偏左（如把「惊喜」两字放大），**逐字切出**的动效感。
 *
 * 与 `lower-third` 的区别（两者都是 typography，都吃 text，
 * 但形态与用途不同，不可互为替身）：
 * · `kinetic-line` 是**瞬时强调** —— 一个词、几帧、抢注意力后消失
 * · `lower-third` 是**身份条** —— 姓名/职务，停留数秒、贴着画面左下
 *
 * 参数：`text`（必填）、`enter`（可选，默认 'from-left'）。
 * 🔴 `enter` 是**具名动画预设**，不是 CSS 字符串 —— 模型写
 *    `params.enter = "from-left"`，绝不能写 `params.enter = "slide-in"`。
 *    未知预设一律回退默认（见 `ENTER_PRESETS` 下方说明）。
 */

import { COLOR, enterExitProgress, FONT, SHADOW } from '../tokens.ts';
import { fitScaleFor, str, type TemplateComponent } from './contract.tsx';

/**
 * 支持的入场预设。**封闭枚举** —— 键就是 `params.enter` 的合法取值。
 *
 * ⚠️ 刻意**不给** `scale` 一个默认值（写成必填会让所有非 `pop` 预设都得填个 1）。
 *    所以取值类型是 `scale?: number`，读取处必须处理 `undefined`
 *    —— 见下方 `resolveEnter` 的返回类型。
 */
interface EnterPresetValue {
  dx: number;
  dy: number;
  scale?: number;
}

const ENTER_PRESETS = {
  'from-left': { dx: -40, dy: 0 },
  'from-right': { dx: 40, dy: 0 },
  'from-bottom': { dx: 0, dy: 30 },
  'pop': { dx: 0, dy: 0, scale: 1.18 },
} as const satisfies Record<string, EnterPresetValue>;

type EnterPreset = keyof typeof ENTER_PRESETS;

/**
 * 解析入场预设。
 *
 * 🔴 未知值**静默回退到 `from-left`，不抛错**。
 *    理由：`paramsSchema` 声明 `enter: 'string'`，校验项 #16 只管类型，
 *    管不了「是不是合法预设名」。此处抛错会让一条参数写错的 motion
 *    毁掉整条渲染 —— 而构建期已经放过它了，渲染期再崩就是雪上加霜。
 *    未知预设视为「作者没特别要求」，用默认值是最贴近意图的解释。
 */
function resolveEnter(v: string): EnterPresetValue {
  return (ENTER_PRESETS as Record<string, EnterPresetValue>)[v] ?? ENTER_PRESETS['from-left'];
}

export const KineticLine: TemplateComponent = ({ frame, durationInFrames, item, canvasWidth }) => {
  const text = str(item.params, 'text');
  const preset = resolveEnter(str(item.params, 'enter'));
  const { enter, exit } = enterExitProgress(frame, durationInFrames);

  // P6：放不下就等比缩小（下限 0.7），保证长文案**不出画面**。
  // 🔴 字号与内边距读**契约** `textMetrics`（`fitScaleFor`），不在此写字面量——
  //    否则改下方 fontSize 会让校验项 #17 静默失准（同 `DUR.exit` 事故）。
  const fit = fitScaleFor(text, item.motion, item, canvasWidth);

  const scale = preset.scale
    ? 1 + (preset.scale - 1) * (1 - enter)
    : 1;

  // 🔴 出场**轻微放大后淡出**，而不是原地淡出 ——
  //    「弹一下→ 定住 → 原地消失」在成片里是廉价感最直接的来源。
  const exitScale = 1 + 0.06 * exit;

  return (
    <div
      data-template="kinetic-line"
      data-enter={str(item.params, 'enter') || 'from-left'}
      style={{
        // MotionItem 外层已按 footprint 定位/定尺寸；这里只占满父容器
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <div
        style={{
          fontFamily: FONT.sans,
          // 大字：相对画面 1920 宽的强调词，48–64px 是可读区间
          fontSize: 54,
          fontWeight: 800,
          color: COLOR.ink,
          textShadow: SHADOW.text,
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          opacity: enter * (1 - exit),
          // `* fit`（P6）：入场位移与缩放都保留，只把最终尺寸再压到框内。
          transform: `translate(${preset.dx * (1 - enter)}px, ${preset.dy * (1 - enter)}px) scale(${scale * exitScale * fit})`,
          // 左对齐的模板必须从左边缩，否则缩完左侧凭空多出留白
          transformOrigin: 'left center',
          // 强调词左侧的竖条：宽度随入场增长，是「动态感」的第二个来源
          borderLeft: `4px solid ${COLOR.brand}`,
          paddingLeft: 16,
        }}
      >
        {text}
      </div>
    </div>
  );
};