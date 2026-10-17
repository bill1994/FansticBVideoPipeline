/**
 * 采样帧规划单测 —— 这块逻辑已经出过两次 bug，必须锁住。
 *
 * 一次是「按时间抽帧」导致帧与 shot 错位；一次是「全片均匀取帧」把短镜头整段跳过，
 * 产出假阴性（`lowConfidence: true` + `safeArea: null`）。下面把两个教训都固化成用例。
 */

import { describe, expect, it } from 'vitest';
import { planSampleFrames } from '../src/stages/builtin-perceive.ts';
import type { ShotSpan } from '../src/stages/shot-detect.ts';

const span = (id: string, fromFrame: number, durationInFrames: number): ShotSpan => ({
  id,
  fromFrame,
  durationInFrames,
});

describe('planSampleFrames', () => {
  it('短于抽帧间隔的 shot 也必须被采样到（s4 假阴性回归）', () => {
    // 实测场景：60fps、step=90（1.5s），s4 只有 75 帧，落在采样点 810 与 900 之间
    const spans = [span('s3', 510, 307), span('s4', 817, 75), span('s5', 892, 710)];
    const frames = planSampleFrames(spans, 90);
    const s4Hits = frames.filter((f) => f >= 817 && f < 892);
    expect(s4Hits.length).toBeGreaterThanOrEqual(1);
  });

  it('每个 shot 至少 1 帧；不跨越 shot 边界', () => {
    const spans = [span('s0', 0, 300), span('s1', 300, 60), span('s2', 360, 45)];
    const frames = planSampleFrames(spans, 90);
    for (const s of spans) {
      const hits = frames.filter((f) => f >= s.fromFrame && f < s.fromFrame + s.durationInFrames);
      expect(hits.length).toBeGreaterThanOrEqual(1);
    }
    // 所有帧号都必须落在某个 shot 内
    for (const f of frames) {
      expect(spans.some((s) => f >= s.fromFrame && f < s.fromFrame + s.durationInFrames)).toBe(true);
    }
  });

  it('长 shot 按间隔取多帧，且帧号升序、无重复', () => {
    const frames = planSampleFrames([span('s0', 0, 540)], 90);
    expect(frames).toHaveLength(6); // 540/90
    expect([...frames].sort((a, b) => a - b)).toEqual(frames);
    expect(new Set(frames).size).toBe(frames.length);
  });

  it('采样点取段中点，不贴 shot 边界', () => {
    // 单帧 shot：唯一采样点必须是该 shot 的第一帧（且不越界）
    const frames = planSampleFrames([span('s0', 100, 1)], 90);
    expect(frames).toEqual([100]);
    // 两段：每段中点应在段内偏中
    const two = planSampleFrames([span('a', 0, 100), span('b', 100, 100)], 100);
    expect(two).toEqual([50, 150]);
  });

  it('不产生越界帧号（shot 末帧不会被算到下一段）', () => {
    const spans = [span('s0', 0, 91), span('s1', 91, 91)];
    const frames = planSampleFrames(spans, 90);
    expect(frames.every((f) => f >= 0 && f < 182)).toBe(true);
  });

  it('空 spans 返回空数组', () => {
    expect(planSampleFrames([], 90)).toEqual([]);
  });
});
