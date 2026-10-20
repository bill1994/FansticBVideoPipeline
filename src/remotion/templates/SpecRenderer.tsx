/**
 * SpecRenderer —— 消费 `MotionSpec` 出画面（S1b，2026-10-20）。
 *
 * `custom/*` 模板没有手写组件，只有一份 JSON 描述（`templates/specs/*.json`
 * → `TemplateDeclaration.spec`）。本渲染器把 spec 的轨道求值成 CSS
 * （位置 / 缩放 / 旋转 / 不透明度 / 模糊 / 裁剪 / 颜色）并渲染文本图元。
 *
 * 时间轴求值与 CSS 合成在 `spec-style.ts`（纯函数，可单测）。
 *
 * ── 确定性红线（E2）────────────────────────────────────────────
 * **不调 `useCurrentFrame()`**：`frame` 由 `MotionItem` 传入（item 内相对帧）。
 * 纯函数 `frame → JSX`，可直接 `renderToStaticMarkup` 单测。
 * 缓动只从 `tokens.ts` 的 `SPEC_EASE` 取，禁止组件内联曲线。
 */

import type { MotionSpec, SpecElement } from '../../core/spec.ts';
import { getTemplate, hasTemplate } from '../../templates/registry.ts';
import { COLOR, FONT, SHADOW } from '../tokens.ts';
import { fitScaleFor, footprintStyle, str, type TemplateComponent } from './contract.tsx';
import { Placeholder } from './placeholder.tsx';
import { resolveTrack, specStyleOf } from './spec-style.ts';

// 兼容既有测试/调用方的导入路径：求值函数仍可从 SpecRenderer 取到。
export { clipInset, keyFrameOf, parseClipSides, resolveTrack, specStyleOf } from './spec-style.ts';

/** 图元的文本来源：literal 取字面量，excerpt/number 取 params[slot]。 */
function textOf(element: SpecElement, params: Record<string, unknown> | undefined): string {
  if (element.content.startsWith('literal:')) {
    return element.content.slice('literal:'.length);
  }
  return str(params, element.slot);
}

/** 颜色轨的值 → CSS 色值；未知令牌原样返回（校验期已拦，这里是渲染期兜底）。 */
function resolveColor(
  spec: MotionSpec,
  elementIndex: number,
  frame: number,
  durationInFrames: number,
): string | null {
  const track = spec.tracks.find((t) => t.element === elementIndex && t.property === 'color');
  if (!track) return null;
  const token = resolveTrack(track, frame, durationInFrames);
  if (typeof token !== 'string') return null;
  return (COLOR as Record<string, string>)[token] ?? token;
}

/**
 * `custom/*` 的通用渲染器。
 *
 * `getTemplate(item.motion).spec` 缺失时退回 `Placeholder`（诚实留空、不抛错）——
 * 浏览器侧还没 hydrate 到声明、或旧 job 引用了已删除的 spec，都会走到这里。
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
  const main = spec.elements.find((el) => el.slot === 'main');
  const mainText = main ? textOf(main, item.params) : '';
  const fit = mainText ? fitScaleFor(mainText, item.motion, item, canvasWidth) : 1;

  return (
    <div
      data-template="spec"
      data-spec-id={spec.id}
      style={{
        ...footprintStyle(item),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      {spec.elements.map((el, i) => {
        const color = resolveColor(spec, i, frame, durationInFrames);
        const elStyle = specStyleOf(spec, i, frame, durationInFrames);
        return (
          <div
            key={`${el.slot}-${i}`}
            data-slot={el.slot}
            style={{
              ...elStyle,
              // 🔴 盒子必须**贴合文本**，不能默认 stretch 到容器宽：
              //    `clip` 的百分比是相对元素盒子计算的。若盒子被拉满 80% 画布，
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
            {textOf(el, item.params)}
          </div>
        );
      })}
    </div>
  );
};
