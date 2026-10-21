/**
 * `typography/center-emphasis@1.0` —— 居中大字强调（压在主体身上）。
 *
 * 来源：D-A 裁决（A1 方案）—— `docs/proposals/2026-10-15-DA与DB裁决材料.md` §1.4。
 * 它是模板库里**唯一** `occludesSubject: true` 的叠加模板：
 * 大字压在画面中部（主体所在区），让 D2 的遮挡判定链路**第一次真实可触发**
 * （此前 10/10 模板无一能进入判定，见裁决材料 §1.2）。
 *
 * ── 与 `kinetic-line` 的形态区分（两者都是大字，必须肉眼可辨）──
 * · `kinetic-line`：**左对齐裸字** + 左竖条，从左侧推入（有位移）；
 * · 本模板：**居中 + 深色底板**（plate）+ 左侧金色条，**缩放落定**（无位移）。
 *
 * ── 动效：只做一件事 ——「压上去」────────────────────────────────
 * 入场：**不做位移**（它是"压"上去的，不是"滑"进来的）——
 *   `enter` 进度驱动 opacity 0→1 与 scale 1.06→1 的快速落定（expo-out）。
 * 出场：**纯淡出**（连缩放都不做）——
 *   压上去的东西不缩回去、只消失；缩回去会读成"从人身上滑走"。
 *
 * 参数：`text`（必填）。长文本由校验项 #17 兜底（warning 档）——
 * 大字号 + 宽框，实测阈值见 `docs/templates/` 手感表。
 */

import { COLOR, enterExitProgress, FONT, RADIUS, SHADOW } from '../tokens.ts';
import { fitScaleFor, str, type TemplateComponent } from './contract.tsx';

export const CenterEmphasis: TemplateComponent = ({ frame, durationInFrames, item, canvasWidth }) => {
  const text = str(item.params, 'text');
  const { enter, exit } = enterExitProgress(frame, durationInFrames);

  // P6：放不下就等比缩小（下限 0.7）。字号 72px 是全库最大，
  // 最容易溢出 —— 但**只用一套缩放同时管住 text 与它的底板**，
  // 因为缩放作用在底板上（见下方 transform），内部文字随之等比缩。
  const fit = fitScaleFor(text, item.motion, item, canvasWidth);

  return (
    <div
      data-template="center-emphasis"
      style={{
        // MotionItem 外层已按 footprint 定位/定尺寸；这里只占满父容器
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: COLOR.plate,
          // 左侧金色强调条：沿用 kinetic-line 的「竖条」语言（家族感），
          // 但整体布局居中 —— 这是两者最关键的空间差异。
          borderLeft: `6px solid ${COLOR.brand}`,
          borderRadius: RADIUS.sm,
          padding: '10px 32px',
          boxShadow: SHADOW.card,
          opacity: enter * (1 - exit),
          // 「压上去」：从 1.06 快速落定到 1；出场**不缩**（只淡出）。
          // `* fit`（P6）：落定缩放保留，只把最终尺寸压到框内。
          // 居中 ⇒ 从中心缩，不偏心。
          transform: `scale(${(1 + (1 - enter) * 0.06) * fit})`,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            fontFamily: FONT.sans,
            fontSize: 72,
            fontWeight: 800,
            lineHeight: 1.1,
            color: COLOR.ink,
            textShadow: SHADOW.text,
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
};
