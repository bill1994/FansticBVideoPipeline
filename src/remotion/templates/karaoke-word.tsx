/**
 * `caption/karaoke-word@1.0` —— 逐词高亮字幕。
 *
 * 形态：屏幕下方字幕带，**说到哪个字哪个字变亮**。
 *
 * 🔴 **文本只来自 SRT 对齐结果**（`caption.ts` 通道），不来自 `params` ——
 *    该模板的 `paramsSchema` 刻意不含 `text`（P1）。模型若能写 text，
 *    字幕就有了第二个来源，会与语音对不上，而时序校验只看帧区间、拦不住。
 *
 * 🔴 **2026-10-18（C2-6 补正）：文字取 `cue.text`，不再用「窗口内的词」拼**。
 *
 *    起因是用户反馈「字幕拆开后看着不连贯」—— 实测那条 cue 的字幕**早了 7 秒**，
 *    出现在一段静音空镜上。根因有两层：
 *      ① 时间：cue 的帧区间原本取**词落点**，而 whisper 把 7 秒静音并进一个分段，
 *         DP 只能把词平摊在里面 ⇒ 整条 cue 前移；
 *      ② 文字：本组件原本把「窗口内落进的词」拼起来当字幕 ⇒ 时间一旦对齐到 SRT，
 *         拼出来的就是**别的句子**。
 *    ⇒ 现在：**时间用 SRT（用户编辑过的那份）、文字用 cue.text、词只负责高亮。**
 *      词漂移时高亮会缺席（`highlightSpan` 返回 null），但**字幕内容永远是对的**。
 *      宁可某句不高亮，也不能显示错句子。
 *
 * 参数：`boxed`（boolean，可选，有天然默认值）—— 是否加深色底板。
 * 不标必填的理由：强制模型写 `boxed:false` 是纯噪音。
 */

import type { CSSProperties } from 'react';
import {
  activeWordIndex,
  cueInWindow,
  highlightSpan,
  highlightWords,
  wordsInWindow,
} from '../caption.ts';
import { COLOR, enterExitProgress, FONT, RADIUS, SHADOW } from '../tokens.ts';
import { bool, type TemplateComponent } from './contract.tsx';

const TEXT: CSSProperties = {
  fontFamily: FONT.sans,
  fontSize: 30,
  fontWeight: 400,
  color: COLOR.ink,
  textShadow: SHADOW.text,
  whiteSpace: 'nowrap',
};

const ACTIVE: CSSProperties = {
  ...TEXT,
  fontWeight: 700,
  color: COLOR.brand,
  // 🔴 高亮词用 scale 强调；幅度刻意压小（1.0 → 1.06）——
  //    字幕放大过多会挤动相邻词的排版，晃得厉害反而难读。
  transform: 'scale(1.06)',
  display: 'inline-block',
};

export const KaraokeWord: TemplateComponent = ({ frame, durationInFrames, item, caption }) => {
  // item 自身在成片里的绝对区间 —— 字幕数据与之同坐标系。
  const cue = cueInWindow(caption, item.fromFrame, durationInFrames);
  // 🔴 高亮用的词：有 cue 时按 **cue 归属 + SRT 窗口**取（词落点漂了就按字数权重重铺），
  //    没有 cue（旧数据）才退回「窗口内的词」。见 `caption.ts` 的 `highlightWords`。
  const words = cue
    ? highlightWords(cue, caption.words, caption.fps)
    : wordsInWindow(caption, item.fromFrame, durationInFrames);
  const active = activeWordIndex(words, item.fromFrame + frame);
  const boxed = bool(item.params, 'boxed');

  // 与其余 4 个模板共用同一套进出场（2026-10-15 统一，见 tokens.ts 补记）
  const { enter, exit } = enterExitProgress(frame, durationInFrames);
  const opacity = enter * (1 - exit);

  // 底板比文字晚一点淡入 —— 纯 CSS 做不到的先后顺序，这里用帧显式排。
  const plateOpacity = Math.min(1, opacity * 1.2);

  /**
   * 文字主体：**优先用 cue 原文**（SRT 权威），词只在原文里定位高亮。
   * 没有可用 cue（旧数据 / 外部对齐器）时退回「窗口内词拼句」的旧行为。
   */
  const span = cue ? highlightSpan(cue.text, words, active) : null;
  const body = cue ? (
    <div data-cue-index={cue.index} style={{ ...TEXT, display: 'inline-block' }}>
      {span ? (
        <>
          <span data-word-part="before">{cue.text.slice(0, span.start)}</span>
          <span data-active="1" style={ACTIVE}>
            {cue.text.slice(span.start, span.end)}
          </span>
          <span data-word-part="after">{cue.text.slice(span.end)}</span>
        </>
      ) : (
        // 词与原文对不上（通常是对齐漂移）⇒ 整句不高亮，但**内容仍是 SRT 的这一句**
        <span>{cue.text}</span>
      )}
    </div>
  ) : (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
      {words.map((w, i) => (
        <span
          key={w.index}
          data-word={w.index}
          data-active={i === active ? '1' : '0'}
          style={{ ...(i === active ? ACTIVE : TEXT), margin: '0 3px', display: 'inline-block' }}
        >
          {w.word}
        </span>
      ))}
    </div>
  );

  return (
    <div
      data-template="karaoke-word"
      data-active-word={active}
      style={{
        // MotionItem 外层已按 footprint 定位/定尺寸；这里只占满父容器
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
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
          {body}
        </div>
      ) : (
        body
      )}
    </div>
  );
};
