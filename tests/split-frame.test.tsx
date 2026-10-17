/**
 * `carrier/split-frame@1.0` 的渲染断言 —— D4-t2 / P2。
 *
 * ── 这个模板的特殊性：它的正确性**不在 DOM 长得像不像**，而在三个几何量 ──
 *   ① `clip-path`：只让展示条那一竖条露出来（且**不缩放**子树）
 *   ② `translateX`：把裁切窗平移到展示条（不是 scale）
 *   ③ `data-window`：实际生效的裁切窗（决定 `W-D2-02` 的判据）
 * 三个都写进 data-* / style，让断言不必去解 React 内部结构。
 *
 * 🔴 特别要钉住「不缩放」：若有人把 clip 换成「缩窄父容器 + overflow」，
 *   children（满画面尺寸的实拍视频）会一起被缩小 —— 那是一次**没人要求的数字变焦**，
 *   且类型检查与现有校验全绿。这里断言 children 的定位基准仍是满画面。
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StoryboardItem } from '../src/core/types.ts';
import { EMPTY_CAPTION } from '../src/remotion/caption.ts';
import { SplitFrame, splitFrameGeometry } from '../src/remotion/templates/split-frame.tsx';
import { PunchIn } from '../src/remotion/templates/punch-in.tsx';

const VIDEO = <div data-video="1" />;

function itemWith(params?: Record<string, unknown>, carrier?: Record<string, unknown>): StoryboardItem {
  const base: StoryboardItem = {
    fromFrame: 100,
    durationInFrames: 60,
    motion: 'carrier/split-frame@1.0',
    footprint: [0.5, 0, 0.5, 1],
    ...(params === undefined ? {} : { params }),
    ...(carrier === undefined ? {} : { carrier: { template: 'carrier/split-frame@1.0', params: carrier } }),
  };
  return base;
}

function render(item: StoryboardItem, frame = 0): string {
  return renderToStaticMarkup(
    <SplitFrame frame={frame} durationInFrames={60} item={item} caption={EMPTY_CAPTION}>
      {VIDEO}
    </SplitFrame>,
  );
}

describe('split-frame · 展示条位置', () => {
  it('缺省 side=right、ratio=0.5 ⇒ 右侧半屏', () => {
    const html = render(itemWith());
    expect(html).toContain('data-side="right"');
    expect(html).toContain('data-ratio="0.5"');
    expect(html).toContain('clip-path:inset(0 0.0000% 0 50.0000%)');
  });

  it('side=left ⇒ 左侧半屏，裁切窗相应右移', () => {
    const g = splitFrameGeometry({ side: 'left', ratio: 0.5 });
    expect(g.display).toEqual([0, 0, 0.5, 1]);
    expect(g.shift).toBeCloseTo(-0.25, 10);
    expect(render(itemWith({ side: 'left' }))).toContain('translateX(-25.0000%)');
  });

  it('ratio 超界被钳：0.9 ⇒ 0.7', () => {
    const g = splitFrameGeometry({ ratio: 0.9 });
    expect(g.ratio).toBeCloseTo(0.7, 10);
    expect(g.display[2]).toBeCloseTo(0.7, 10);
    // right 侧 ⇒ 展示条 [0.3, 0.7]，右边界恰好贴画面右缘
    expect(g.display[0]).toBeCloseTo(0.3, 10);
    expect(g.display[0]! + g.display[2]!).toBeCloseTo(1, 10);
  });
});

describe('split-frame · 主体锚定窗口', () => {
  it('校验期写入的 window 被直接消费（渲染期不再重算）', () => {
    // 主体在左半屏（safeArea 中心 0.2）⇒ 校验期写入的窗口中心也是 0.2
    const window: [number, number, number, number] = [0.0, 0, 0.4, 1];
    const html = render(itemWith(undefined, { window }));
    expect(html).toContain('data-window="0.0000,0.0000,0.4000,1.0000"');
    // 展示条在右（ratio 缺省 0.5）⇒ 平移量 = 0.5 − 0.0 = 0.5
    expect(splitFrameGeometry({ window }).shift).toBeCloseTo(0.5, 10);
    expect(html).toContain('translateX(50.0000%)');
  });

  it('无 window ⇒ 退回居中窗口（不崩、不报错）', () => {
    const html = render(itemWith({ side: 'left', ratio: 0.4 }));
    // 居中窗口 = [0.3, 0, 0.4, 1]；左侧展示条 [0, 0, 0.4, 1] ⇒ 平移 −0.3
    expect(html).toContain('data-window="0.3000,0.0000,0.4000,1.0000"');
    expect(html).toContain('translateX(-30.0000%)');
  });

  it('carrier 声明的参数优先于 item.params（P1 定的两条来源优先级）', () => {
    // item.params 说 right，carrier.params 说 left ⇒ 必须渲染成 left
    const html = render(itemWith({ side: 'right', ratio: 0.5 }, { side: 'left', ratio: 0.5 }));
    expect(html).toContain('data-side="left"');
  });
});

describe('split-frame · 渲染纪律', () => {
  it('🔴 子树不被缩放：位移用 translateX 而非 scale', () => {
    const html = render(itemWith());
    expect(html).toContain('translateX(');
    expect(html).not.toContain('scale(');
  });

  it('children（实拍视频）原样透传', () => {
    expect(render(itemWith())).toContain('data-video="1"');
  });

  it('静态几何 ⇒ 与 frame 无关（本模板不读时钟，这是设计选择）', () => {
    // ⚠️ 与叠加类模板不同：分屏若做进出场动画，裁切窗会随帧变化，
    //   `W-D2-02` 的判据就必须改成「全动画期最小可见比」⇒ 刻意不做动画。
    expect(render(itemWith(), 0)).toBe(render(itemWith(), 30));
  });

  it('与 punch-in 的载体变换形态两两可辨（两个背景链模板不撞车）', () => {
    const punchHtml = renderToStaticMarkup(
      <PunchIn
        frame={0}
        durationInFrames={60}
        item={{ ...itemWith(), motion: 'cinematic/punch-in@1.0' }}
        caption={EMPTY_CAPTION}
      >
        {VIDEO}
      </PunchIn>,
    );
    expect(render(itemWith())).not.toBe(punchHtml);
  });
});
