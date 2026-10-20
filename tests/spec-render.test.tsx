/**
 * SpecRenderer + custom/* 通配分发（S1b，2026-10-20）。
 *
 * 钉两件事：
 *  ① **派生的声明真能跑校验**（S1a 只验了派生字段，没验「校验链认得它」）
 *  ② 时间轴求值是纯函数，可逐帧断言（不依赖 Remotion context）
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSpecsFromDisk } from '../src/core/spec-loader.ts';
import { runValidation } from '../src/validate/index.ts';
import type { StoryboardItem } from '../src/core/types.ts';
import type { SpecTrack } from '../src/core/spec.ts';
import { EMPTY_CAPTION } from '../src/remotion/caption.ts';
import {
  SpecRenderer,
  clipInset,
  resolveTrack,
  specStyleOf,
} from '../src/remotion/templates/SpecRenderer.tsx';
import {
  getTemplateComponent,
  isImplemented,
} from '../src/remotion/templates/index.tsx';
import { getTemplate, hydrateTemplates } from '../src/templates/registry.ts';
import { makeCtx, makeTrack } from './_ctx.ts';

beforeAll(() => {
  loadSpecsFromDisk();
});

const FADE = 'custom/fade-up@1.0';

function item(over: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    fromFrame: 105,
    durationInFrames: 30,
    motion: FADE,
    footprint: [0.15, 0.62, 0.7, 0.18],
    params: { main: '这是一条测试文案' },
    ...over,
  };
}

const track = (property: SpecTrack['property'], keys: SpecTrack['keys']): SpecTrack => ({
  element: 0,
  property,
  keys,
});

describe('custom/* 能走完 18 项校验', () => {
  it('fade-up item（30 帧、有 main 文案）→ 无 error', () => {
    const r = runValidation(makeCtx({ tracks: [makeTrack('a', 60, [item()])] }));
    expect(r.summary.checked).toBe(18);
    expect(r.items.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('声明与 spec 一致：scope/status/minVisible 来自派生', () => {
    const tpl = getTemplate(FADE);
    expect(tpl.scope).toBe('overlay-safe');
    expect(tpl.status).toBe('custom');
    expect(tpl.minVisibleInFrames).toBe(24);
    expect(tpl.spec?.id).toBe(FADE);
  });
});

describe('resolveTrack —— 绝对帧与比例帧统一换算', () => {
  it('"8f"：frame 0 初值、frame 8 终值、frame 4 中途', () => {
    const t = track('opacity', [
      { t: 0, v: 0, ease: 'linear' },
      { t: '8f', v: 1, ease: 'linear' },
    ]);
    expect(resolveTrack(t, 0, 100)).toBe(0);
    expect(resolveTrack(t, 8, 100)).toBe(1);
    expect(resolveTrack(t, 4, 100)).toBeCloseTo(0.5, 5);
  });

  it('0.1 在 100 帧 item 上等于第 10 帧', () => {
    const t = track('scale', [
      { t: 0, v: 1, ease: 'linear' },
      { t: 0.1, v: 2, ease: 'linear' },
    ]);
    expect(resolveTrack(t, 10, 100)).toBe(2);
    expect(resolveTrack(t, 5, 100)).toBeCloseTo(1.5, 5);
    // 早于首帧 / 晚于末帧 → 取端点值
    expect(resolveTrack(t, -5, 100)).toBe(1);
    expect(resolveTrack(t, 50, 100)).toBe(2);
  });
});

describe('color 轨是阶跃，不插值', () => {
  it('跨 key 时前半段旧色、后半段新色，中间无渐变', () => {
    const t = track('color', [
      { t: 0, v: 'ink' },
      { t: '10f', v: 'brand' },
    ]);
    expect(resolveTrack(t, 0, 100)).toBe('ink');
    expect(resolveTrack(t, 9, 100)).toBe('ink');
    expect(resolveTrack(t, 10, 100)).toBe('brand');
    expect(resolveTrack(t, 20, 100)).toBe('brand');
  });
});

describe('clip 解析', () => {
  it('"10,0,10,0" → inset(10% 0% 10% 0%)', () => {
    expect(clipInset('10,0,10,0')).toBe('inset(10% 0% 10% 0%)');
    expect(clipInset('10 0 10 0')).toBe('inset(10% 0% 10% 0%)');
    expect(clipInset(5)).toBe('inset(5% 5% 5% 5%)');
  });

  it('specStyleOf 按 element 过滤并合成 transform / filter / clipPath', () => {
    const decl = getTemplate(FADE);
    const spec = decl.spec!;
    const style = specStyleOf(spec, 0, 10, 30);
    // y: 10f 20 → 18f 0，frame 10 恰在起点
    expect(style.transform).toContain('translate(0%, 20%)');
    expect(style.opacity).toBeGreaterThanOrEqual(0);
    expect(style.opacity).toBeLessThanOrEqual(1);
  });

  it('多图元：每条轨只作用于自己的 element（不合并到容器）', () => {
    const base = getTemplate(FADE).spec!;
    const spec = {
      ...base,
      elements: [
        { ...base.elements[0]!, slot: 'main' as const },
        { ...base.elements[0]!, slot: 'sub' as const },
      ],
      tracks: [
        { element: 0, property: 'opacity' as const, keys: [{ t: 0, v: 0 }, { t: 1, v: 0 }] },
        { element: 1, property: 'opacity' as const, keys: [{ t: 0, v: 1 }, { t: 1, v: 1 }] },
      ],
    };
    expect(specStyleOf(spec, 0, 5, 30).opacity).toBe(0);
    expect(specStyleOf(spec, 1, 5, 30).opacity).toBe(1);
  });
});

describe('渲染与分发', () => {
  it('custom/* 分发到 SpecRenderer', () => {
    expect(getTemplateComponent(FADE)).toBe(SpecRenderer);
    expect(isImplemented(FADE)).toBe(true);
  });

  it('缺 spec 的 custom/* → Placeholder，不抛错', () => {
    const ghost = item({ motion: 'custom/does-not-exist@1.0' });
    expect(() =>
      renderToStaticMarkup(
        <SpecRenderer frame={0} durationInFrames={30} item={ghost} caption={EMPTY_CAPTION} />,
      ),
    ).not.toThrow();
    const html = renderToStaticMarkup(
      <SpecRenderer frame={0} durationInFrames={30} item={ghost} caption={EMPTY_CAPTION} />,
    );
    expect(html).toContain('data-template-missing="1"');
    expect(isImplemented('custom/does-not-exist@1.0')).toBe(false);
  });

  it('fade-up 真渲染出文字（不是灰框）且随帧变化', () => {
    const html0 = renderToStaticMarkup(
      <SpecRenderer frame={0} durationInFrames={30} item={item()} caption={EMPTY_CAPTION} />,
    );
    const html14 = renderToStaticMarkup(
      <SpecRenderer frame={14} durationInFrames={30} item={item()} caption={EMPTY_CAPTION} />,
    );
    expect(html0).toContain('这是一条测试文案');
    expect(html0).not.toContain('data-template-missing');
    expect(html0).toContain('opacity:0');
    expect(html14).toContain('opacity:1');
  });

  it('hydrateTemplates 幂等：重复注册不抛错', () => {
    const decl = getTemplate(FADE);
    expect(() => hydrateTemplates([decl])).not.toThrow();
    expect(() => hydrateTemplates([decl])).not.toThrow();
    expect(getTemplate(FADE).spec?.id).toBe(FADE);
  });
});
