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
  effectivePerUnit,
  resolveTrack,
  specStyleOf,
  splitUnits,
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

describe('clip 解析与插值', () => {
  it('"10,0,10,0" → inset(10% 0% 10% 0%)', () => {
    expect(clipInset('10,0,10,0')).toBe('inset(10% 0% 10% 0%)');
    expect(clipInset('10 0 10 0')).toBe('inset(10% 0% 10% 0%)');
    expect(clipInset(5)).toBe('inset(5% 5% 5% 5%)');
  });

  it('🔴 clip 轨四边分别插值（不能退化成 NaN → inset(0%) 静默无裁切）', () => {
    const t = track('clip', [
      { t: '1f', v: '0,0,100,0', ease: 'linear' },
      { t: '16f', v: '0,0,0,0', ease: 'linear' },
    ]);
    const mid = resolveTrack(t, 8, 100);
    expect(String(mid)).not.toContain('NaN');
    const sides = String(mid).split(',').map(Number);
    expect(sides).toHaveLength(4);
    // p = (8-1)/(16-1) = 0.4667 ⇒ bottom = 100 × (1-0.4667) ≈ 53.3
    expect(sides[2]).toBeGreaterThan(45);
    expect(sides[2]).toBeLessThan(60);
    expect([sides[0], sides[1], sides[3]]).toEqual([0, 0, 0]);
  });

  it('单 number 的 clip：中间帧返回四边同值', () => {
    const t = track('clip', [
      { t: '0f', v: 10, ease: 'linear' },
      { t: '10f', v: 0, ease: 'linear' },
    ]);
    expect(resolveTrack(t, 5, 100)).toBe('5,5,5,5');
  });

  it('反向断言：clip 求值结果经 clipInset 后必须含非零数值', () => {
    const t = track('clip', [
      { t: '1f', v: '0,0,100,0', ease: 'linear' },
      { t: '16f', v: '0,0,0,0', ease: 'linear' },
    ]);
    const inset = clipInset(resolveTrack(t, 8, 100));
    // 若又踩回 NaN 兜底，会得到 inset(0% 0% 0% 0%) —— 静默失效
    expect(inset).not.toBe('inset(0% 0% 0% 0%)');
    const nums = inset.replace(/[^\d.]/g, ' ').trim().split(/\s+/).map(Number);
    expect(nums.some((n) => n > 0)).toBe(true);
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

describe('S2：装饰图元 / 逐字 / stagger', () => {
  function renderAt(id: string, text: string, frame: number, duration = 60): string {
    const tpl = getTemplate(id);
    const spec = tpl.spec!;
    const it: StoryboardItem = {
      fromFrame: 20,
      durationInFrames: duration,
      motion: id,
      footprint: [...spec.footprint] as StoryboardItem['footprint'],
      params: { main: text },
    };
    return renderToStaticMarkup(
      <SpecRenderer
        frame={frame}
        durationInFrames={duration}
        item={it}
        caption={EMPTY_CAPTION}
        canvasWidth={1920}
      />,
    );
  }

  it('panel 占满 footprint（inset:0），不是缩成文字宽', () => {
    const html = renderAt('custom/card-stack@1.0', '卡底测试', 20);
    expect(html).toContain('data-element="panel"');
    expect(html).toContain('inset:0');
    expect(html).toContain('border-radius:12px'); // RADIUS.md
    expect(html).toContain('data-slot="main"');
  });

  it('bar 贴左边、厚度定宽', () => {
    const html = renderAt('custom/bar-accent@1.0', '竖条测试', 20);
    expect(html).toContain('data-element="bar"');
    expect(html).toContain('width:6px');
    expect(html).toContain('left:0');
  });

  it('rule 下划线贴底（at:100 完全在框内）', () => {
    const html = renderAt('custom/rule-underline@1.0', '下划线测试', 20);
    expect(html).toContain('data-element="rule"');
    expect(html).toContain('height:4px');
    expect(html).toContain('top:calc(100% - 4px)');
  });

  it('triangle 用 border 技巧绘制（底宽 1.15×heightPx，默认 bottom/center）', () => {
    const spec = getTemplate('custom/bar-accent@1.0').spec!;
    // 复用合法 spec 的壳，临时替换 elements 仅用于渲染断言
    const probe = {
      ...spec,
      elements: [
        { type: 'triangle' as const, dir: 'up' as const, heightPx: 20, fill: 'brand' as const },
      ],
      tracks: [],
    };
    hydrateTemplates([{ ...getTemplate('custom/bar-accent@1.0'), id: 'custom/tri-probe@1.0', spec: probe }]);
    const html = renderAt('custom/tri-probe@1.0', '', 0, 30);
    expect(html).toContain('data-element="triangle"');
    // half = 1.15 × 20 / 2 = 11.5
    expect(html).toContain('border-left:11.5px solid transparent');
    expect(html).toContain('border-bottom:20px solid #FFC53D');
    // 默认 at = bottom/center ⇒ 贴底、水平居中
    expect(html).toContain('top:calc(100% - 20px)');
    expect(html).toContain('left:calc(50% - 11.5px)');
  });

  it('emoji 不拒、不拆：ZWJ 序列算一个显示单元', () => {
    expect(splitUnits('A👍B')).toEqual(['A', '👍', 'B']);
    expect(splitUnits('家👨‍👩‍👧人')).toEqual(['家', '👨‍👩‍👧', '人']);
    // params 里的 emoji 不触发 spec 校验错误（SRT 是文本权威）
    const html = renderAt('custom/typewriter-cn@1.0', '好👍', 2);
    expect(html).toContain('data-chars-visible="2"');
  });

  it('逐字累计揭示：第 12 帧 7 字、第 24 帧 13 字', () => {
    const text = '这不是逐字输出而是累计揭示'; // 13 个字
    const html12 = renderAt('custom/typewriter-cn@1.0', text, 12);
    const html24 = renderAt('custom/typewriter-cn@1.0', text, 24);
    expect(html12).toContain('data-chars-visible="7"');
    expect(html24).toContain('data-chars-visible="13"');
    // 累计揭示：第 24 帧可见全部 13 字
    expect(html24).toContain(text);
    expect(html12).not.toContain(text);
  });

  it('渲染期自适应：perUnit 被压到能容纳全部字符', () => {
    const text = '一二三四五六七八九十';
    const spec = getTemplate('custom/typewriter-cn@1.0').spec!;
    const el = spec.elements[0] as { perUnit?: string; holdFrames?: number };
    // duration 12、hold 6、10 字 ⇒ max(1, 6/9)=1 < 2 ⇒ 有效间隔 1 帧
    expect(effectivePerUnit(el, 10, 12)).toBe(1);
  });

  it('stagger：text 的动画时钟比 panel 晚 4 帧', () => {
    const spec = getTemplate('custom/card-stack@1.0').spec!;
    const panel = specStyleOf(spec, 0, 6, 30).opacity;
    const text = specStyleOf(spec, 1, 6, 30).opacity;
    expect(panel).toBe(1); // panel 本地帧 6 = 动画末
    expect(text).toBeLessThan(1); // text 本地帧 2，仍在淡入
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

  it('文本图元的盒子贴合内容 —— clip 的百分比才有意义', () => {
    const html = renderToStaticMarkup(
      <SpecRenderer frame={14} durationInFrames={30} item={item()} caption={EMPTY_CAPTION} />,
    );
    // flex 子项默认 stretch 到容器宽时，inset(0% 52% 0% 0%) 的切点会落在文本右侧之外，
    // 看起来就像「裁切没生效」。盒子必须 max-content + 按 align 自对齐。
    expect(html).toContain('width:max-content');
    expect(html).toContain('align-self:flex-start');
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
