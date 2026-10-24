/**
 * motion:accept 六道验收门槛（P1-b Task 2，提案 §4）。
 *
 * 被测对象：`acceptMotionSpec(raw, fileName)`（src/core/motion-accept.ts）——
 * 创作期生成器产出 spec 后的唯一入库通道。六道门顺序即报因顺序：
 * structure → registration → frames → animates → lint → 签章。
 *
 * 夹具风格沿 `tests/_ctx.ts`：**自包含、不读磁盘**——合法 spec 夹具从
 * `templates/specs/fade-up.json` 复制改 id，以字面量内嵌在本文件里。
 *
 * 🔴 夹具对 fade-up 的一处刻意改动：fade-up 原样在画廊帧位 6/45/72 只有
 *    **两种** DOM（f45 与 f72 都是「入场完成后的保持态」，绝对帧轨全部
 *    ≤ minVisibleInFrames=24，之后恒定）——过不了 animates 门。夹具补一条
 *    `rotate` 比例轨（t:0.5→0.9，比例 t 不受 minVisibleInFrames 上界约束），
 *    让动效贯穿整个 item，三帧两两不等。
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { acceptMotionSpec } from '../src/core/motion-accept.ts';
import { getTemplateComponent } from '../src/remotion/templates/index.tsx';
import { EMPTY_CAPTION } from '../src/remotion/caption.ts';
import { __resetRegistryForTests } from '../src/templates/registry.ts';
import type { StoryboardItem } from '../src/core/types.ts';

const FILE = 'accept-fixture.json';
const ID = 'custom/accept-fixture@0.1';

/** 合法夹具（fade-up.json 复制改 id + 补 rotate 比例轨，理由见文件头）。 */
const FIXTURE = {
  specVersion: 1,
  id: ID,
  layer: 60,
  footprint: [0.15, 0.62, 0.7, 0.18],
  minVisibleInFrames: 24,
  occludesSubject: false,
  _note: 'motion:accept 验收夹具（自包含，不读磁盘）',
  elements: [
    {
      type: 'text',
      slot: 'main',
      content: 'excerpt',
      sizePx: 48,
      weight: 700,
      align: 'left',
      paddingPx: 24,
    },
  ],
  tracks: [
    {
      element: 0,
      property: 'opacity',
      keys: [
        { t: '8f', v: 0, ease: 'out' },
        { t: '14f', v: 1, ease: 'out' },
      ],
    },
    {
      element: 0,
      property: 'y',
      keys: [
        { t: '10f', v: 20, ease: 'out' },
        { t: '18f', v: 0, ease: 'out' },
      ],
    },
    {
      element: 0,
      property: 'rotate',
      keys: [
        { t: 0.5, v: 0, ease: 'out' },
        { t: 0.9, v: 4, ease: 'out' },
      ],
    },
  ],
};

/** 每个用例从干净深拷贝派生（避免互相污染，同 _ctx.ts 的构造方式）。 */
function fixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(FIXTURE)) as Record<string, unknown>, ...over };
}

const rawOf = (over: Record<string, unknown> = {}): string =>
  JSON.stringify(fixture(over), null, 2);

afterEach(() => {
  __resetRegistryForTests();
});

describe('motion:accept · 六道门槛', () => {
  it('① 合法 custom spec → ok:true，返回的 spec.id 逐字一致', () => {
    const r = acceptMotionSpec(rawOf(), FILE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.id).toBe(ID);
  });

  it('② 图元超限（第 5 个 element）→ ok:false，failures[0] 提到 structure', () => {
    const f = fixture();
    // fade-up 夹具本身只有 1 个 text 图元：补 4 个 bar 才到「第 5 个」超限
    f['elements'] = [
      ...(f['elements'] as unknown[]),
      { type: 'bar', edge: 'left', thicknessPx: 6 },
      { type: 'bar', edge: 'right', thicknessPx: 6 },
      { type: 'bar', edge: 'top', thicknessPx: 6 },
      { type: 'bar', edge: 'bottom', thicknessPx: 6 },
    ];
    const r = acceptMotionSpec(JSON.stringify(f, null, 2), FILE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0]).toContain('structure');
  });

  it('③ 三帧全同（tracks 置空使 DOM 恒定）→ ok:false，failures 提到 animates', () => {
    const r = acceptMotionSpec(rawOf({ tracks: [] }), FILE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.some((s) => s.includes('animates'))).toBe(true);
  });

  it('④ 原文含 Date.now → ok:false，failures 提到 lint', () => {
    const f = fixture();
    f['_note'] = `${f['_note'] as string}（示例禁词：Date.now）`;
    const r = acceptMotionSpec(JSON.stringify(f, null, 2), FILE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.some((s) => s.includes('lint'))).toBe(true);
  });

  it('⑤ 验收签章：specHash === sha256(原始字节)；重跑同输入逐字节一致', () => {
    const raw = rawOf();
    const r1 = acceptMotionSpec(raw, FILE);
    const r2 = acceptMotionSpec(raw, FILE);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.acceptance.specHash).toBe(
        createHash('sha256').update(raw, 'utf8').digest('hex'),
      );
      expect(r1.acceptance.specHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r1.acceptance.gates).toEqual([
        'structure',
        'registration',
        'frames',
        'animates',
        'lint',
      ]);
      // 同输入重跑（第二次走 hasTemplate 跳过重复注册）：结果逐字节一致
      expect(JSON.stringify(r1.acceptance)).toBe(JSON.stringify(r2.acceptance));
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    }
  });

  it('⑥ id 非 custom/ 前缀 → ok:false，failures 提到 registration', () => {
    const r = acceptMotionSpec(rawOf({ id: 'builtin/accept-fixture@0.1' }), FILE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.some((s) => s.includes('registration'))).toBe(true);
  });

  it('⑦ 确定性回归（AC-8）：任一帧渲染两次，markup 逐字节相等', () => {
    const r = acceptMotionSpec(rawOf(), FILE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const render = (frame: number): string => {
      const item: StoryboardItem = {
        fromFrame: 0,
        durationInFrames: 90,
        motion: ID,
        footprint: [0.15, 0.62, 0.7, 0.18],
        params: { main: '动效验收文本' },
      };
      return renderToStaticMarkup(
        getTemplateComponent(ID)({
          frame,
          durationInFrames: 90,
          item,
          caption: EMPTY_CAPTION,
        }),
      );
    };
    for (const frame of [6, 45, 72]) {
      expect(render(frame), `帧 ${frame} 两次渲染必须逐字节相等`).toBe(render(frame));
    }
  });
});
