/**
 * 镜头切分 —— 纯函数部分必须有单测（不依赖 ffmpeg 也能验证）。
 *
 * 覆盖点：
 *  1. 解析真实 ffmpeg scdet 日志（含实测那 15 行）
 *  2. 切点 → Shot 区间：首尾相接、总长守恒、越界/重复被丢弃
 *  3. minShotFrames 合并行为
 *  4. 边界：无切点、totalFrames<=0、切点恰等于总帧数
 */

import { describe, expect, it } from 'vitest';
import {
  buildShotSpans,
  DEFAULT_SCDET_THRESHOLD,
  parseScdetLog,
} from '../src/stages/shot-detect.ts';

/** 实测日志片段（TestResources/kukini.mp4，阈值 10，截取前 4 + 末尾 1 行）。 */
const REAL_LOG = `
[Parsed_scdet_0 @ 0000008001529700] lavfi.scd.score: 22.498, lavfi.scd.time: 8.391717
[Parsed_scdet_0 @ 0000008001529700] lavfi.scd.score: 27.276, lavfi.scd.time: 15.1151
[Parsed_scdet_0 @ 0000008001529700] lavfi.scd.score: 23.538, lavfi.scd.time: 20.453767
[Parsed_scdet_0 @ 0000008001529700] lavfi.scd.score: 24.855, lavfi.scd.time: 23.27325
[Parsed_scdet_0 @ 0000008001529700] lavfi.scd.score: 45.201, lavfi.scd.time: 110.96085
`;

describe('parseScdetLog', () => {
  it('解析真实日志，按时间升序，并按帧率换算帧号', () => {
    const cuts = parseScdetLog(REAL_LOG, 59.94);
    expect(cuts).toHaveLength(5);
    expect(cuts[0]!.timeSec).toBeCloseTo(8.391717, 5);
    expect(cuts[0]!.score).toBeCloseTo(22.498, 3);
    // 8.391717 × 59.94 ≈ 502.99 → 503（实测该帧已是新镜头）
    expect(cuts[0]!.frame).toBe(503);
    expect(cuts[4]!.frame).toBe(Math.round(110.96085 * 59.94));
  });

  it('忽略不含 scdet 的日志行', () => {
    const cuts = parseScdetLog('frame= 100 fps=0.0 q=-0.0 size=N/A time=00:00:04.10', 30);
    expect(cuts).toEqual([]);
  });

  it('乱序日志输入也保证升序输出', () => {
    const shuffled = `
      lavfi.scd.score: 30.0, lavfi.scd.time: 9.0
      lavfi.scd.score: 20.0, lavfi.scd.time: 3.0
    `;
    expect(parseScdetLog(shuffled, 30).map((c) => c.timeSec)).toEqual([3, 9]);
  });
});

describe('buildShotSpans', () => {
  it('无切点时整片是一个 shot', () => {
    expect(buildShotSpans([], 300)).toEqual([
      { id: 's0', fromFrame: 0, durationInFrames: 300 },
    ]);
  });

  it('3 个切点 → 4 个 shot，首尾相接且总长守恒', () => {
    const spans = buildShotSpans([{ frame: 100 }, { frame: 200 }, { frame: 250 }], 300);
    expect(spans).toHaveLength(4);
    expect(spans.map((s) => [s.fromFrame, s.durationInFrames])).toEqual([
      [0, 100],
      [100, 100],
      [200, 50],
      [250, 50],
    ]);
    const total = spans.reduce((a, s) => a + s.durationInFrames, 0);
    expect(total).toBe(300);
    expect(spans.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('丢弃越界切点（负值 / 超出总帧 / 恰等于总帧）', () => {
    const spans = buildShotSpans([{ frame: -5 }, { frame: 150 }, { frame: 300 }, { frame: 999 }], 300);
    expect(spans).toHaveLength(2);
    expect(spans[1]).toMatchObject({ fromFrame: 150, durationInFrames: 150 });
  });

  it('重复帧号去重，不产生零长度 shot', () => {
    const spans = buildShotSpans([{ frame: 120 }, { frame: 120 }, { frame: 120 }], 240);
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.durationInFrames > 0)).toBe(true);
  });

  it('minShotFrames 合并过近切点（保留更早的边界）', () => {
    // 100 与 105 相距 5 帧，minShot=10 时后者被丢弃
    const spans = buildShotSpans([{ frame: 100 }, { frame: 105 }, { frame: 200 }], 300, {
      minShotFrames: 10,
    });
    expect(spans.map((s) => s.fromFrame)).toEqual([0, 100, 200]);
  });

  it('默认 minShotFrames=1 不合并真实短镜头', () => {
    const spans = buildShotSpans([{ frame: 100 }, { frame: 102 }], 200);
    expect(spans.map((s) => s.fromFrame)).toEqual([0, 100, 102]);
  });

  it('minShotFrames 也卡尾段 —— 片尾黑场碎片不得留成独立 shot（kukini 实测复现）', () => {
    // 实测：最后一个切点 frame=6651，总 6667 帧 ⇒ 尾段仅 16 帧（0.27s）的黑场
    const spans = buildShotSpans([{ frame: 4740 }, { frame: 6651 }], 6667, { minShotFrames: 60 });
    expect(spans).toHaveLength(2);
    expect(spans[1]).toMatchObject({ fromFrame: 4740, durationInFrames: 6667 - 4740 });
  });

  it('minShotFrames 也卡首段 —— 开头极短镜头并入第一个完整 shot', () => {
    const spans = buildShotSpans([{ frame: 10 }, { frame: 400 }], 800, { minShotFrames: 60 });
    expect(spans.map((s) => s.fromFrame)).toEqual([0, 400]);
  });

  it('totalFrames<=0 返回空数组', () => {
    expect(buildShotSpans([{ frame: 10 }], 0)).toEqual([]);
    expect(buildShotSpans([], -1)).toEqual([]);
  });

  it('实测 15 切点 / 6667 帧 → 16 个 shot，总长守恒', () => {
    const cuts = parseScdetLog(
      `
      lavfi.scd.score: 22.498, lavfi.scd.time: 8.391717
      lavfi.scd.score: 27.276, lavfi.scd.time: 15.1151
      lavfi.scd.score: 23.538, lavfi.scd.time: 20.453767
      lavfi.scd.score: 24.855, lavfi.scd.time: 23.27325
      lavfi.scd.score: 19.296, lavfi.scd.time: 30.246883
      lavfi.scd.score: 29.276, lavfi.scd.time: 34.501133
      lavfi.scd.score: 28.883, lavfi.scd.time: 40.790750
      lavfi.scd.score: 24.696, lavfi.scd.time: 44.177467
      lavfi.scd.score: 15.491, lavfi.scd.time: 46.880167
      lavfi.scd.score: 25.213, lavfi.scd.time: 49.999950
      lavfi.scd.score: 32.469, lavfi.scd.time: 52.569183
      lavfi.scd.score: 21.792, lavfi.scd.time: 59.526133
      lavfi.scd.score: 29.146, lavfi.scd.time: 73.823750
      lavfi.scd.score: 28.720, lavfi.scd.time: 79.079000
      lavfi.scd.score: 45.201, lavfi.scd.time: 110.960850
    `,
      59.94,
    );
    expect(cuts).toHaveLength(15);
    const spans = buildShotSpans(cuts, 6667);
    expect(spans).toHaveLength(16);
    expect(spans.reduce((a, s) => a + s.durationInFrames, 0)).toBe(6667);
    expect(spans[0]!.fromFrame).toBe(0);
    expect(spans[0]!.durationInFrames).toBe(cuts[0]!.frame);
  });
});

describe('默认阈值', () => {
  it('固化为 10（依据见模块头实测表：5 会过检，10 无漏检）', () => {
    expect(DEFAULT_SCDET_THRESHOLD).toBe(10);
  });
});
