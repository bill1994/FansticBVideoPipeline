/**
 * 渲染去重回归测试 —— 防「又一个灰框」。
 *
 * 来源：优化计划书 D1 步骤 **1.4**「各模板渲染输出结构必须两两不同
 *（防"又一个灰框"回归）」。
 *
 * ── 为什么这条测试是整个D1 的安全网 ────────────────────────────
 * 病史：**10 个模板声明齐全、实现为零，且 `getTemplate()` 无 id→组件映射**，
 * 于是所有 motion 渲染出**逐像素相同**的灰框。而这类退化
 * **不会触发任何现有校验**：
 *   · 16 项校验全是纯 JSON→JSON 的结构判定，根本不看渲染结果
 *   · `typecheck` 通过（占位块是合法 TSX）
 *   · 单测全过（没人测过渲染输出）
 *   · 成片能正常导出，不报错
 * ⇒ **只有一条直接断言渲染输出的测试能兜住它。**
 *
 * ── 本文件的四组断言 ───────────────────────────────────────────
 * A. 5 个已实现模板的静态输出**两两不同**
 * B. 同一模板在**不同帧**输出不同（动效真的在动，不是静止贴图）
 * C. 映射表与声明表id 逐字对应（抓拼错 id 这类静默退化）
 * D. 未实现模板落占位块且**带缺失标记**（不许伪装成已实现）
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.ts';
import type { StoryboardItem, WordTimestamp } from '../src/core/types.ts';
import { EMPTY_CAPTION, type CaptionData } from '../src/remotion/caption.ts';
import {
  assertRenderMapValid,
  getTemplateComponent,
  isImplemented,
  listImplemented,
  listUnimplemented,
  renderCoverage,
} from '../src/remotion/templates/index.tsx';
import { enterExitProgress } from '../src/remotion/tokens.ts';

/** 一段最小字幕数据：3 个词，各占 20 帧。 */
const SAMPLE_WORDS: WordTimestamp[] = [
  { index: 0, word: '这', startFrame: 100, endFrame: 119, confidence: 0.9 },
  { index: 1, word: '是', startFrame: 120, endFrame: 139, confidence: 0.9 },
  { index: 2, word: '口播', startFrame: 140, endFrame: 159, confidence: 0.9 },
];
const CAPTION: CaptionData = { words: SAMPLE_WORDS, cues: [] };

/** 首批 5 个模板各自的合规 params —— 全部满足 builtin.ts 的 requiredParams。 */
const FIVE: Array<{ id: string; params: Record<string, unknown> }> = [
  { id: 'caption/karaoke-word@1.0', params: { boxed: true } },
  { id: 'typography/kinetic-line@1.0', params: { text: '惊喜' } },
  { id: 'typography/lower-third@1.0', params: { title: '张小澄', subtitle: '动效设计' } },
  { id: 'typography/tag-float@1.0', params: { text: '透气' } },
  { id: 'data/stat-card@1.0', params: { value: '42.5', unit: '码' } },
];

function makeItem(id: string, params: Record<string, unknown>, fromFrame = 100): StoryboardItem {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === id)!;
  return {
    fromFrame,
    durationInFrames: 60,
    motion: id,
    footprint: tpl.footprint,
    params,
  };
}

/** 渲染一个模板在指定帧的静态 HTML。 */
function renderAt(id: string, params: Record<string, unknown>, frame: number, duration = 60): string {
  const Component = getTemplateComponent(id);
  const el: ReactElement = Component({
    frame,
    durationInFrames: duration,
    item: makeItem(id, params),
    caption: CAPTION,
  });
  return renderToStaticMarkup(el);
}

describe('D1 · 渲染映射表自洽', () => {
  it('映射表里的 id 与 builtin.ts 声明逐字对应（抓拼错 id 的静默退化）', () => {
    expect(() => assertRenderMapValid()).not.toThrow();
  });

  it('首批 5 个模板均已实现', () => {
    for (const { id } of FIVE) {
      expect(isImplemented(id), `${id} 应有真实实现`).toBe(true);
    }
    expect(listImplemented()).toHaveLength(5);
  });

  it('覆盖率：已实现 5 / 声明 10', () => {
    expect(renderCoverage()).toEqual({ implemented: 5, declared: 10 });
  });

  it('未实现的 5 个落占位块，且带缺失标记（不许伪装成已实现）', () => {
    const missing = listUnimplemented();
    expect(missing).toHaveLength(5);
    for (const id of missing) {
      const html = renderAt(id, {}, 10);
      expect(html, `${id} 未实现，应打 data-template-missing`).toContain('data-template-missing="1"');
      //占位块必须显式写出是哪个模板，便于审片时定位
      expect(html).toContain(id);
    }
  });
});

describe('D1 · 渲染输出两两不同（防灰框回归 · 计划书 1.4）', () => {
  it('5 个模板在同一帧的输出两两不同', () => {
    const htmls = new Map<string, string>();
    for (const { id, params } of FIVE) {
      htmls.set(id, renderAt(id, params, 30));
    }
    // 逐对比较：报错时要指出是哪两个撞了
    const ids = [...htmls.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        expect(
          htmls.get(ids[i]),
          `模板 ${ids[i]} 与 ${ids[j]} 的渲染输出完全相同 —— 这是灰框回归`,
        ).not.toBe(htmls.get(ids[j]));
      }
    }
    // 五份输出互不相同（去重后应为 5）
    expect(new Set(htmls.values()).size).toBe(5);
  });

  it('每个模板都输出自己的 data-template 标识', () => {
    const expected: Record<string, string> = {
      'caption/karaoke-word@1.0': 'karaoke-word',
      'typography/kinetic-line@1.0': 'kinetic-line',
      'typography/lower-third@1.0': 'lower-third',
      'typography/tag-float@1.0': 'tag-float',
      'data/stat-card@1.0': 'stat-card',
    };
    for (const { id, params } of FIVE) {
      expect(renderAt(id, params, 30)).toContain(`data-template="${expected[id]}"`);
    }
  });
});

describe('D1 · 动效真的在动（不同帧输出不同）', () => {
  it('kinetic-line：入场帧与保持帧的 opacity/transform 不同', () => {
    const p = { text: '惊喜' };
    const entering = renderAt('typography/kinetic-line@1.0', p, 0);
    const holding = renderAt('typography/kinetic-line@1.0', p, 30);
    expect(entering).not.toBe(holding);
    expect(entering).toContain('opacity:0');
  });

  it('lower-third：入场帧带位移，保持帧不带', () => {
    const p = { title: '张小澄', subtitle: '动效设计' };
    const entering = renderAt('typography/lower-third@1.0', p, 0);
    const holding = renderAt('typography/lower-third@1.0', p, 40);
    expect(entering).toContain('translateX(-100%)');
    expect(holding).not.toContain('translateX(-100%)');
  });

  it('stat-card：入场帧 scale<1，保持帧 scale=1', () => {
    const p = { value: '42.5', unit: '码' };
    expect(renderAt('data/stat-card@1.0', p, 0)).toContain('scale(0.9)');
    expect(renderAt('data/stat-card@1.0', p, 40)).toContain('scale(1)');
  });

  /**
   * 🔴 防「定义了exit 却没人用」的回归（2026-10-15 实际发生过）。
   *
   * 病史：4 个模板**只做入场，出场完全缺失**（`DUR.exit` / `enterExitFrames().exit`
   * 只有字幕模板在用）。逐帧差异实测 f12–f59 恒为 0 ——
   * 表现为「弹一下 → 画面静止几十帧 → 突然消失」，成片里是廉价感最直接的来源。
   *
   * 这与登记册问题 9（`occludesSubject` 零消费）**同款病**：
   * 定义了但没人用⇒ 等于没做。故固化为测试。
   *
   * 判据：**末尾必须有帧与「中段静止帧」不同** —— 只验「入场在动」
   * 会漏掉「出场没做」这个方向。
   */
  /**
   * 🔴 缓动的单调性与边界（第二轮打磨，2026-10-15）。
   *
   * 为什么这两条要有测试：
   * · **单调递增** —— 若入场曲线不是单调的（比如中段回落），
   *   观众会看到元素"先进后退"，那是最刺眼的动效错误之一。
   * · **值域 [0,1] 无超调** —— `Easing.back` 系列在 t=0.5 处达1.087，
   *   元素会短暂越出 `footprint`。而 `footprint` 语义是
   *   「取全动画期最大包围盒」⇒ **超调属契约违反**，不是视觉细节。
   *   故此处显式断言上界为 1。
   */
  it('入场缓动单调递增且不超调（越框即契约违反）', () => {
    let prev = -1;
    for (let f = 0; f <= 12; f += 1) {
      const { enter } = enterExitProgress(f, 60);
      expect(enter, `入场进度必须单调不减（第 ${f} 帧）`).toBeGreaterThanOrEqual(prev);
      expect(enter, `入场进度不得超调（t=${enter}），否则元素会越出 footprint`).toBeLessThanOrEqual(1);
      prev = enter;
    }
  });

  it('出场缓动单调递增且终点恰好为 1', () => {
    let prev = -1;
    for (let f = 48; f <= 60; f += 1) {
      const { exit } = enterExitProgress(f, 60);
      expect(exit, `出场进度必须单调不减（第 ${f} 帧）`).toBeGreaterThanOrEqual(prev);
      expect(exit).toBeLessThanOrEqual(1);
      prev = exit;
    }
    expect(enterExitProgress(60, 60).exit).toBe(1);
  });

  it('出场与入场之间留有静止段（不能首尾相接）', () => {
    // 60 帧 motion：0.16 入场 + 0.22 出场 = 38 帧，中间必须有静止段
    expect(enterExitProgress(30, 60).enter).toBe(1);
    expect(enterExitProgress(30, 60).exit).toBe(0);
  });

  /**
   * 🔴 防「定义了 exit 却没人用」的回归（2026-10-15 实际发生过）。
   *
   * 病史：4 个模板**只做入场，出场完全缺失**。逐帧差异实测f12–f59 恒为 0 ——
   * 表现为「弹一下 → 画面静止几十帧 → 突然消失」，成片里是廉价感最直接的来源。
   *
   * 判据：**末尾帧必须与「中段静止帧」不同** —— 只验「入场在动」
   * 会漏掉「出场没做」这个方向。
   */
  it('每个已实现模板的**出场**都有变化（不只入场）', () => {
    const params: Record<string, Record<string, unknown>> = {
      'caption/karaoke-word@1.0': { boxed: true },
      'typography/kinetic-line@1.0': { text: '惊喜' },
      'typography/lower-third@1.0': { title: '张小澄', subtitle: '动效设计师' },
      'typography/tag-float@1.0': { text: '透气' },
      'data/stat-card@1.0': { value: '42.5', unit: '码' },
    };
    // 中段静止属**预期**（motion 停住让人读），出场帧必须与之不同
    for (const { id } of FIVE) {
      const p = params[id];
      const holding = renderAt(id, p, 30, 60);
      const exiting = renderAt(id, p, 58, 60);
      expect(exiting, `${id} 的出场帧与中段静止帧相同 —— 出场可能没实现`).not.toBe(holding);
    }
    // 占位块也必须动（它代表「还没做」而不是「坏了」）
    expect(renderAt('transition/whip-pan@1.0', {}, 10)).not.toBe(
      renderAt('transition/whip-pan@1.0', {}, 30),
    );
  });

  it('karaoke-word：高亮词随帧推进（读到哪个字哪个字亮）', () => {
    const p = { boxed: true };
    // fromFrame=100，词0 占 100–119、词1 占 120–139、词2 占 140–159
    const at0 = renderAt('caption/karaoke-word@1.0', p, 10, 60);
    const at1 = renderAt('caption/karaoke-word@1.0', p, 30, 60);
    const at2 = renderAt('caption/karaoke-word@1.0', p, 50, 60);
    expect(at0).toContain('data-active-word="0"');
    expect(at1).toContain('data-active-word="1"');
    expect(at2).toContain('data-active-word="2"');
    // 三帧的高亮位置互不相同
    expect(new Set([at0, at1, at2]).size).toBe(3);
  });

  it('karaoke-word：字幕文本取自 SRT 对齐结果，不取 params（P1）', () => {
    const html = renderAt('caption/karaoke-word@1.0', { boxed: false }, 10);
    // 三个词都在
    expect(html).toContain('这');
    expect(html).toContain('是');
    expect(html).toContain('口播');
    // ⚠️ 即便有人硬塞 text（校验项 #16 会报E-P1-01），组件也不读它
    const hacked = renderAt('caption/karaoke-word@1.0', { boxed: false, text: '伪造字幕' }, 10);
    expect(hacked).not.toContain('伪造字幕');
  });

  it('karaoke-word：无字幕数据时优雅降级，不崩溃', () => {
    const Component = getTemplateComponent('caption/karaoke-word@1.0');
    const el: ReactElement = Component({
      frame: 5,
      durationInFrames: 60,
      item: makeItem('caption/karaoke-word@1.0', { boxed: false }),
      caption: EMPTY_CAPTION,
    });
    expect(() => renderToStaticMarkup(el)).not.toThrow();
    expect(renderToStaticMarkup(el)).toContain('data-active-word="-1"');
  });
});

describe('D1 · 参数降级不崩（渲染期不做校验，但也不能崩）', () => {
  it('kinetic-line：未知 enter 预设静默回退默认，不抛错', () => {
    const html = renderAt('typography/kinetic-line@1.0', { text: 'x', enter: '不存在的预设' }, 2);
    // data-enter 保留**作者写的原值** —— 它是排查线索，不能被回退逻辑覆盖掉
    expect(html).toContain('data-enter="不存在的预设"');
    // 验的是**行为**：未知预设回退 from-left ⇒ 横向左移（translate 的 X 为负）。
    // 不去断言 DOM 里出现 'from-left' 字样 —— 那是日志字段，不是行为。
    //
    // ⚠️ 取 frame=2（60 帧 motion 的入场期内）而非写死 10：
    //    第二轮把入场配比从 0.18 调到 0.16 后，入场只占 10 帧，
    //    frame=10 恰好已入场完毕、位移归零 ⇒ 断言会假失败。
    //    **测试不该硬编码一个会随调参漂移的帧号。**
    expect(html).toMatch(/translate\(-[\d.]+px, 0px\)/);
  });

  it('kinetic-line：合法预设各走各的位移方向', () => {
    // pop 预设无位移，只有 scale；from-bottom 是纵向
    const pop = renderAt('typography/kinetic-line@1.0', { text: 'x', enter: 'pop' }, 2);
    expect(pop).toMatch(/scale\(1\.[0-9]+\)/);
    const bottom = renderAt('typography/kinetic-line@1.0', { text: 'x', enter: 'from-bottom' }, 2);
    expect(bottom).toMatch(/translate\(0px, [\d.]+px\)/);
    const right = renderAt('typography/kinetic-line@1.0', { text: 'x', enter: 'from-right' }, 2);
    expect(right).toMatch(/translate\([\d.]+px, 0px\)/);
  });

  it('缺失可选参数时降级而非抛错', () => {
    // lower-third 无 subtitle / stat-card 无 unit / tag-float 只有必填 text
    expect(() => renderAt('typography/lower-third@1.0', { title: 'x' }, 10)).not.toThrow();
    expect(renderAt('typography/lower-third@1.0', { title: 'x' }, 10)).toContain(
      'data-has-subtitle="0"',
    );
    expect(() => renderAt('data/stat-card@1.0', { value: '1' }, 10)).not.toThrow();
    expect(renderAt('data/stat-card@1.0', { value: '1' }, 10)).toContain('data-has-unit="0"');
  });

  it('params 整体缺失时模板不崩', () => {
    const tpl = BUILTIN_TEMPLATES.find((t) => t.id === 'typography/tag-float@1.0')!;
    const Component = getTemplateComponent('typography/tag-float@1.0');
    const el: ReactElement = Component({
      frame: 5,
      durationInFrames: 60,
      item: {
        fromFrame: 0,
        durationInFrames: 60,
        motion: 'typography/tag-float@1.0',
        footprint: tpl.footprint,
      },
      caption: EMPTY_CAPTION,
    });
    expect(() => renderToStaticMarkup(el)).not.toThrow();
  });
});