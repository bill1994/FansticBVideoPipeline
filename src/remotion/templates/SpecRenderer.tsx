/**
 * SpecRenderer —— 消费 `MotionSpec` 出画面（S2：5 类图元 + 逐字揭示）。
 *
 * `custom/*` 模板没有手写组件，只有一份 JSON 描述（`templates/specs/*.json`
 * → `TemplateDeclaration.spec`）。本渲染器把 spec 的轨道求值成 CSS，
 * 并渲染 1 个文本图元 + 4 个装饰图元（panel / bar / rule / triangle）。
 *
 * 时间轴求值与 CSS 合成在 `spec-style.ts`（纯函数，可单测）。
 *
 * ── 确定性红线（E2）────────────────────────────────────────────
 * **不调 `useCurrentFrame()`**：`frame` 由 `MotionItem` 传入（item 内相对帧）。
 * 纯函数 `frame → JSX`，可直接 `renderToStaticMarkup` 单测。
 */

import type { CSSProperties } from 'react';
import type {
  MotionSpec,
  SpecElement,
  SpecTextElement,
} from '../../core/spec.ts';
import { getTemplate, hasTemplate } from '../../templates/registry.ts';
import { COLOR, FONT, RADIUS, SHADOW } from '../tokens.ts';
import { fitScaleFor, str, type TemplateComponent } from './contract.tsx';
import { Placeholder } from './placeholder.tsx';
import {
  elementLocalFrame,
  elementOffsetOf,
  resolveTrack,
  specStyleOf,
  visibleCharCount,
} from './spec-style.ts';

export {
  clipInset,
  effectivePerUnit,
  elementOffsetOf,
  keyFrameOf,
  parseClipSides,
  resolveTrack,
  specStyleOf,
  visibleCharCount,
} from './spec-style.ts';

/** 图元的文本来源：literal 取字面量，excerpt/number 取 params[slot]。 */
function textOf(element: SpecTextElement, params: Record<string, unknown> | undefined): string {
  if (element.content.startsWith('literal:')) {
    return element.content.slice('literal:'.length);
  }
  return str(params, element.slot);
}

/** 令牌 → CSS 值；未知令牌原样返回（校验期已拦，这里是渲染期兜底）。 */
function colorOf(token: string | undefined, fallback: string): string {
  if (token === undefined) return fallback;
  return (COLOR as Record<string, string>)[token] ?? token;
}

function radiusOf(token: string | undefined): string | undefined {
  return token === undefined ? undefined : (RADIUS as Record<string, string>)[token];
}

function shadowOf(token: string | undefined): string | undefined {
  return token === undefined ? undefined : (SHADOW as Record<string, string>)[token];
}

/** 颜色轨的值 → CSS 色值（用图元本地帧，stagger 已生效）。 */
function resolveColor(
  spec: MotionSpec,
  elementIndex: number,
  localFrame: number,
  durationInFrames: number,
): string | null {
  const track = spec.tracks.find((t) => t.element === elementIndex && t.property === 'color');
  if (!track) return null;
  const token = resolveTrack(track, localFrame, durationInFrames);
  if (typeof token !== 'string') return null;
  return colorOf(token, COLOR.ink);
}

/** 装饰图元（4 类）的几何样式。 */
function decorationStyle(el: Exclude<SpecElement, SpecTextElement>): CSSProperties {
  if (el.type === 'panel') {
    return {
      position: 'absolute',
      inset: 0, // 占满 footprint —— 卡底不能缩成文字宽
      background: colorOf(el.fill, COLOR.plate),
      border: el.border === undefined ? undefined : `1px solid ${colorOf(el.border, COLOR.hairline)}`,
      borderRadius: radiusOf(el.radius),
      boxShadow: shadowOf(el.shadow),
    };
  }

  if (el.type === 'bar') {
    const t = el.thicknessPx;
    const inset = el.insetPx ?? 0;
    const base: CSSProperties = { position: 'absolute', background: colorOf(el.fill, COLOR.brand) };
    if (el.edge === 'left') return { ...base, left: inset, top: 0, bottom: 0, width: t };
    if (el.edge === 'right') return { ...base, right: inset, top: 0, bottom: 0, width: t };
    if (el.edge === 'top') return { ...base, top: inset, left: 0, right: 0, height: t };
    return { ...base, bottom: inset, left: 0, right: 0, height: t };
  }

  if (el.type === 'rule') {
    const t = el.thicknessPx;
    const inset = el.insetPx ?? 0;
    const base: CSSProperties = { position: 'absolute', background: colorOf(el.fill, COLOR.accent) };
    if (el.axis === 'h') {
      // `at` 是**线的位置**（从起边算）；线绘制在该线内侧，故 at=100 完全在框内。
      return { ...base, left: inset, right: inset, top: `calc(${el.at}% - ${t}px)`, height: t };
    }
    return { ...base, top: inset, bottom: inset, left: `calc(${el.at}% - ${t}px)`, width: t };
  }

  // triangle：border 技巧（同 tag-float.tsx 的小尖角），底宽 = 1.15 × sizePx
  const s = el.sizePx;
  const half = (1.15 * s) / 2;
  const color = colorOf(el.fill, COLOR.brand);
  const base: CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
    left: `calc(50% - ${half}px)`,
    top: `calc(50% - ${s / 2}px)`,
  };
  if (el.dir === 'up') {
    return {
      ...base,
      borderLeft: `${half}px solid transparent`,
      borderRight: `${half}px solid transparent`,
      borderBottom: `${s}px solid ${color}`,
    };
  }
  if (el.dir === 'down') {
    return {
      ...base,
      borderLeft: `${half}px solid transparent`,
      borderRight: `${half}px solid transparent`,
      borderTop: `${s}px solid ${color}`,
    };
  }
  if (el.dir === 'left') {
    return {
      ...base,
      borderTop: `${half}px solid transparent`,
      borderBottom: `${half}px solid transparent`,
      borderRight: `${s}px solid ${color}`,
    };
  }
  return {
    ...base,
    borderTop: `${half}px solid transparent`,
    borderBottom: `${half}px solid transparent`,
    borderLeft: `${s}px solid ${color}`,
  };
}

/**
 * `custom/*` 的通用渲染器。
 *
 * `getTemplate(item.motion).spec` 缺失时退回 `Placeholder`（诚实留空、不抛错）。
 */
export const SpecRenderer: TemplateComponent = ({
  frame,
  durationInFrames,
  item,
  caption,
  canvasWidth,
}) => {
  const spec = hasTemplate(item.motion) ? getTemplate(item.motion).spec : undefined;
  if (!spec) {
    return (
      <Placeholder
        frame={frame}
        durationInFrames={durationInFrames}
        item={item}
        caption={caption}
        canvasWidth={canvasWidth}
        reason="spec 缺失（custom/* 需要随声明一起 hydrate）"
      />
    );
  }

  // 主文本决定缩放：与校验项 #17 / 其它模板同一口径（footprint 宽度 × 画布宽）。
  const main = spec.elements.find(
    (el): el is SpecTextElement => el.type === 'text' && el.slot === 'main',
  );
  const mainText = main ? textOf(main, item.params) : '';
  const fit = mainText ? fitScaleFor(mainText, item.motion, item, canvasWidth) : 1;

  return (
    <div
      data-template="spec"
      data-spec-id={spec.id}
      style={{
        // 🔴 **inset:0，不是 footprintStyle**：`MotionItem` 的外层 div 已经按
        //    footprint 定位/定尺寸，模板组件拿到的是那个盒子；再叠一次
        //    footprintStyle 会把 footprint 当相对坐标二次缩进（宽高变成 w²/h²），
        //    panel 就永远铺不满 footprint。自定义 spec 以「填满父盒」为准。
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      {spec.elements.map((el, i) => {
        const style = specStyleOf(spec, i, frame, durationInFrames);

        if (el.type !== 'text') {
          return (
            <div
              key={`${el.type}-${i}`}
              data-element={el.type}
              style={{ ...decorationStyle(el), ...style }}
            />
          );
        }

        const localFrame = elementLocalFrame(spec, i, frame, durationInFrames);
        const color = resolveColor(spec, i, localFrame, durationInFrames);
        const full = textOf(el, item.params);
        const chars = [...full];
        const visible = visibleCharCount(
          el,
          full,
          frame,
          elementOffsetOf(spec, i, durationInFrames),
          durationInFrames,
        );

        return (
          <div
            key={`${el.slot}-${i}`}
            data-slot={el.slot}
            data-chars-visible={el.split === 'chars' ? visible : undefined}
            style={{
              ...style,
              // 🔴 盒子必须**贴合文本**，不能默认 stretch 到容器宽：
              //    `clip` 的百分比是相对元素盒子计算的。若盒子被拉满画布，
              //    `inset(0% 52% 0% 0%)` 的切点在文本右侧之外 ⇒ 看起来「裁切没生效」。
              width: 'max-content',
              maxWidth: '100%',
              alignSelf:
                el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
              fontFamily: FONT.sans,
              fontSize: el.sizePx * fit,
              fontWeight: el.weight,
              textAlign: el.align,
              lineHeight: el.lineHeight,
              letterSpacing: el.trackingEm === undefined ? undefined : `${el.trackingEm}em`,
              padding: el.paddingPx,
              boxSizing: 'border-box',
              color: color ?? COLOR.ink,
              textShadow: SHADOW.text,
              whiteSpace: 'nowrap',
            }}
          >
            {el.split === 'chars' ? chars.slice(0, visible).join('') : full}
          </div>
        );
      })}
    </div>
  );
};
