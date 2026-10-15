/**
 * `caption/karaoke-word@1.0` —— 逐词高亮字幕。
 *
 * 形态：屏幕下方字幕带，**说到哪个字哪个字变亮**。
 *
 * 🔴 **文本只来自 SRT 对齐结果**（`caption.ts` 通道），不来自 `params` ——
 *    该模板的 `paramsSchema` 刻意不含 `text`（P1）。模型若能写 text，
 *    字幕就有了第二个来源，会与语音对不上，而时序校验只看帧区间、拦不住。
 *
 * 参数：`boxed`（boolean，可选，有天然默认值）—— 是否加深色底板。
 * 不标必填的理由：强制模型写 `boxed:false` 是纯噪音。
 */

import { activeWordIndex, wordsInWindow } from '../caption.ts';
import { COLOR, enterExitProgress, FONT, RADIUS, SHADOW } from '../tokens.ts';
import { bool, footprintStyle, type TemplateComponent } from './contract.tsx';

export const KaraokeWord: TemplateComponent = ({ frame, durationInFrames, item, caption }) => {
  // item 自身在成片里的绝对区间 —— 字幕数据与之同坐标系。
  const words = wordsInWindow(caption, item.fromFrame, durationInFrames);
  const active = activeWordIndex(words, item.fromFrame + frame);
  const boxed = bool(item.params, 'boxed');

  // 与其余 4 个模板共用同一套进出场（2026-10-15 统一，见 tokens.ts 补记）
  const { enter, exit } = enterExitProgress(frame, durationInFrames);
  const opacity = enter * (1 - exit);

  // 底板比文字晚一点淡入 —— 纯 CSS 做不到的先后顺序，这里用帧显式排。
  const plateOpacity = Math.min(1, opacity * 1.2);

  return (
    <div
      data-template="karaoke-word"
      data-active-word={active}
      style={{
        ...footprintStyle(item),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
      }}
    >
      {boxed ? (
        <div
          data-plate="1"
          style={{
            background: COLOR.plate,
            borderRadius: RADIUS.sm,
            padding: '6px 18px',
            opacity: plateOpacity,
            maxWidth: '100%',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
            {words.map((w, i) => {
              const isActive = i === active;
              return (
                <span
                  key={w.index}
                  data-word={w.index}
                  data-active={isActive ? '1' : '0'}
                  style={{
                    fontFamily: FONT.sans,
                    fontSize: 30,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? COLOR.brand : COLOR.ink,
                    textShadow: SHADOW.text,
                    margin: '0 3px',
                    whiteSpace: 'nowrap',
                    // 🔴 高亮词用 scale 强调；幅度刻意压小（1.0 → 1.06）——
                    //    字幕放大过多会挤动相邻词的排版，晃得厉害反而难读。
                    transform: isActive ? 'scale(1.06)' : 'scale(1)',
                    display: 'inline-block',
                  }}
                >
                  {w.word}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
          {words.map((w, i) => {
            const isActive = i === active;
            return (
              <span
                key={w.index}
                data-word={w.index}
                data-active={isActive ? '1' : '0'}
                style={{
                  fontFamily: FONT.sans,
                  fontSize: 30,
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? COLOR.brand : COLOR.ink,
                  textShadow: SHADOW.text,
                  margin: '0 3px',
                  whiteSpace: 'nowrap',
                  transform: isActive ? 'scale(1.06)' : 'scale(1)',
                  display: 'inline-block',
                }}
              >
                {w.word}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};