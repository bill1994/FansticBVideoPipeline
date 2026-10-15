/**
 * `typography/tag-float@1.0` —— 右上角关键词气泡。
 *
 * 形态：**圆角胶囊 + 小尖角**，像对话气泡贴在画面角落。
 *
 * 与 `lower-third` 的形态区分（两者都吃 text，但必须肉眼可辨）：
 * · `lower-third` 是**左下贴边横条**、斜角、双行、方角
 * · `tag-float`是**右上胶囊**、圆角、带尖角指向画面中心、单行
 *
 * 参数：`text`（必填）。
 */

import { COLOR, enterExitProgress, FONT, RADIUS, SHADOW } from '../tokens.ts';
import { footprintStyle, str, type TemplateComponent } from './contract.tsx';

export const TagFloat: TemplateComponent = ({ frame, durationInFrames, item }) => {
  const text = str(item.params, 'text');
  const { enter, exit } = enterExitProgress(frame, durationInFrames);

  return (
    <div
      data-template="tag-float"
      style={{
        ...footprintStyle(item),
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          position: 'relative',
          fontFamily: FONT.sans,
          fontSize: 24,
          fontWeight: 600,
          color: COLOR.ink,
          background: COLOR.plate,
          border: `1.5px solid ${COLOR.accent}`,
          borderRadius: RADIUS.lg,
          padding: '8px 20px',
          boxShadow: SHADOW.card,
          textShadow: SHADOW.text,
          whiteSpace: 'nowrap',
          // 入场上浮（+24px），出场**下沉**（-16px）——
          // 气泡是"浮"着的，下沉比原地淡出更符合它的物理直觉。
          opacity: enter * (1 - exit),
          transform: `translateY(${(1 - enter) * 24 - exit * 16}px) scale(${1 - exit * 0.06})`,
        }}
      >
        {text}
        {/* 小尖角：指向画面内侧，暗示「这是在标注你正在看的东西」 */}
        <span
          data-tail="1"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -7,
            width: 0,
            height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: `7px solid ${COLOR.accent}`,
            transform: 'translateX(-50%)',
          }}
        />
      </div>
    </div>
  );
};