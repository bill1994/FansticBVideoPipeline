/**
 * 节奏规则（decideMotion）与 caption 豁免（B1）—— P1，2026-10-20。
 *
 * 覆盖规格第五节「模板选型 / 强度规则 / 模板门控」与第六节「校验豁免」，
 * 以及第七节第 9 条「有 --draft 时不生成 pacing.json」。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import { writeJson } from '../src/core/io.ts';
import {
  builtinTemplateLookup,
  decideMotion,
  extractExcerpt,
  extractNumber,
  paramsForMotion,
  parseCnNumber,
} from '../src/core/rhythm-rules.ts';
import { runStoryboard } from '../src/stages/storyboard.ts';
import type { RhythmSignal } from '../src/core/types.ts';

const registry = builtinTemplateLookup();
const decide = (text: string, durationInFrames: number, signals: RhythmSignal[]) =>
  decideMotion({ cueIndex: 0, text, durationInFrames }, signals, registry);

describe('decideMotion —— 强度规则', () => {
  it('无信号 → 不做（无走势信号）', () => {
    const d = decide('这个方法很好用', 90, []);
    expect(d.decide).toBe('none');
    expect(d.reason).toBe('无走势信号');
    expect(d.skipped).toBeUndefined();
  });

  it('单弱信号（turn）→ 不做（信号强度不足）', () => {
    const d = decide('但是这个方法很好用', 90, ['turn']);
    expect(d.decide).toBe('none');
    expect(d.reason).toContain('信号强度不足');
  });

  it('双弱信号（turn + contrast）→ 出 motion（kinetic-line）', () => {
    const d = decide('但不过这个方法要停一下', 90, ['turn', 'contrast']);
    expect(d.decide).toBe('motion');
    expect(d.motion).toBe('typography/kinetic-line@1.0');
    expect(d.params).toMatchObject({ text: expect.any(String) });
  });

  it('definition / number / closing 单信号即可', () => {
    expect(decide('这叫做强制对齐', 60, ['definition']).motion).toBe(
      'typography/center-emphasis@1.0',
    );
    expect(decide('提升3倍', 60, ['number']).motion).toBe('data/stat-card@1.0');
    expect(decide('总之记住', 60, ['closing']).motion).toBe(
      'typography/center-emphasis@1.0',
    );
  });

  it('enum 是弱信号：单独不做；enum + turn 才出 lower-third', () => {
    expect(decide('首先准备素材', 90, ['enum']).decide).toBe('none');
    const d = decide('但是首先准备素材', 90, ['enum', 'turn']);
    expect(d.motion).toBe('typography/lower-third@1.0');
    expect(d.params).toMatchObject({ title: expect.any(String) });
  });
});

describe('decideMotion —— 模板门控与降级链', () => {
  it('number + 45 帧 → stat-card（恰好满足）', () => {
    const d = decide('增长了3.5万元', 45, ['number']);
    expect(d.motion).toBe('data/stat-card@1.0');
    expect(d.params).toEqual({ value: '3.5', unit: '万' });
  });

  it('number + 40 帧 → stat-card 要 45 帧不够 → 降级到 kinetic-line', () => {
    const d = decide('增长了3.5万元', 40, ['number']);
    expect(d.decide).toBe('motion');
    expect(d.motion).toBe('typography/kinetic-line@1.0');
    expect(d.reason).toContain('降级');
  });

  it('number + 29 帧 → 连 kinetic-line（30）也不够 → no-template-fits', () => {
    const d = decide('增长了3.5万元', 29, ['number']);
    expect(d.decide).toBe('none');
    expect(d.skipped).toBe('no-template-fits');
  });

  it('文案提取不出（不足 2 字）→ 不做', () => {
    const d = decide('叫', 90, ['definition']);
    expect(d.decide).toBe('none');
    expect(d.skipped).toBe('no-template-fits');
    expect(d.reason).toContain('文案提取失败');
  });

  it('未注册模板 → ConfigError（不静默跳过）', () => {
    expect(() =>
      decideMotion({ cueIndex: 0, text: '3个', durationInFrames: 90 }, ['number'], {
        get: () => undefined,
      }),
    ).toThrow(ConfigError);
  });
});

describe('文案提取 —— 按信号定位（不是固定取前 N 字）', () => {
  it('turn：取转折词之后的片段', () => {
    expect(extractExcerpt('这个方案成本很高但效果特别好', ['turn'])).toBe('效果特别好');
    // 规格给出的真实句式：前半句是铺垫，重点在「但」之后
    expect(
      extractExcerpt('前面全是铺垫但关键节点必须停下来确认', ['turn']),
    ).toContain('关键节点');
  });

  it('turn：目标段 13 字（关键节点…）→ 上限 14 完整保留', () => {
    const long =
      '主体位置最后渲染出片整个流程接近全自动但关键节点必须停下来让人确认';
    const out = extractExcerpt(long, ['turn'])!;
    expect(out).toBe('关键节点必须停下来让人确认'); // 13 字，未被切掉「关」
    expect([...out].length).toBe(13);
    expect(out).not.toContain('主体位置');
  });

  it('turn：目标段超过 14 字 → 保留尾部 14 字（重心在后）', () => {
    const long = '前面都是铺垫但关键节点必须停下来让人确认然后再继续讲下一段';
    const out = extractExcerpt(long, ['turn'])!;
    expect([...out].length).toBe(14);
    expect(long.endsWith(out)).toBe(true);
  });

  it('closing：取收束词之后的片段；无收束词则取最后一个短句', () => {
    expect(extractExcerpt('记住这一点很重要', ['closing'])).toBe('这一点很重要');
    expect(extractExcerpt('前面很长，重点在于效率', ['closing'])).toBe('重点在于效率');
  });

  it('definition：取定义词之后的片段', () => {
    expect(extractExcerpt('强制对齐是指把文本和音频对齐', ['definition'])).toBe(
      '把文本和音频对齐',
    );
  });

  it('contrast：取否定词所在的短句', () => {
    expect(extractExcerpt('这个方案不便宜，但是效果很好', ['contrast'])).toBe(
      '这个方案不便宜',
    );
  });

  it('enum：取序数词之后到下一个标点之间的片段', () => {
    expect(extractExcerpt('首先要准备素材，然后开始剪辑', ['enum'])).toBe('首先要准备素材');
  });

  it('question：取问句本身', () => {
    expect(extractExcerpt('这样真的好吗？我觉得不行', ['question'])).toBe('这样真的好吗');
  });

  it('兜底：无信号取最后一个短句；不足 2 字返回 null', () => {
    expect(extractExcerpt('一二三，四五')).toBe('四五');
    expect(extractExcerpt('短')).toBeNull();
    expect(extractExcerpt('a1两个')).toBe('a1两个');
  });

  it('长度上限：任何情况下都不超过 14 字', () => {
    const text = '一句话非常非常非常非常非常长没有标点';
    const out = extractExcerpt(text, [])!;
    expect([...out].length).toBe(14);
    expect(text.endsWith(out)).toBe(true); // 保留的是尾部，不是头部
  });

  it('extractNumber：Arabic 优先，取不到再解析中文数量词', () => {
    expect(extractNumber('大概是 3.5 万元')).toEqual({ value: '3.5', unit: '万' });
    expect(extractNumber('共 12 个')).toEqual({ value: '12' });
    expect(extractNumber('销量增长三倍')).toEqual({ value: '3', unit: '倍' });
    expect(extractNumber('没有数字')).toBeNull();
  });

  it('paramsForMotion 与决策结果一致（同一份 signal 决定位置）', () => {
    const d = decide('这个方案成本很高但效果不特别好', 90, ['turn', 'contrast']);
    expect(d.motion).toBe('typography/kinetic-line@1.0');
    expect(d.params).toEqual({ text: '效果不特别好' });
  });
});

describe('parseCnNumber —— 中文数量词最小实现', () => {
  it('三倍 → 3 / 倍', () => {
    expect(parseCnNumber('效率提升三倍')).toEqual({ value: '3', unit: '倍' });
  });

  it('百分之三十 → 30 / %', () => {
    expect(parseCnNumber('增长了百分之三十')).toEqual({ value: '30', unit: '%' });
  });

  it('两万 → 20000', () => {
    expect(parseCnNumber('一共两万')).toEqual({ value: '20000' });
  });

  it('三万五千 → 35000', () => {
    expect(parseCnNumber('花了三万五千')).toEqual({ value: '35000' });
  });

  it('一 → 1', () => {
    expect(parseCnNumber('一')).toEqual({ value: '1' });
  });

  it('无法解析的普通用字「一些」→ null（不把「一」当数量）', () => {
    expect(parseCnNumber('说一些话')).toBeNull();
    expect(parseCnNumber('一起做')).toBeNull();
    expect(parseCnNumber('一定可以')).toBeNull();
  });

  it('五成 → 5 / 成', () => {
    expect(parseCnNumber('成功了五成')).toEqual({ value: '5', unit: '成' });
  });

  it('中文数字能真正喂给 stat-card（歧义④的验收点）', () => {
    const d = decide('效率提升三倍', 45, ['number']);
    expect(d.decide).toBe('motion');
    expect(d.motion).toBe('data/stat-card@1.0');
    expect(d.params).toEqual({ value: '3', unit: '倍' });
  });
});

describe('storyboard 接线：自动生成 vs --draft（向后兼容）', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeJob(): { jobsDir: string; jobId: string; base: string } {
    const jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-rhythm-'));
    tmpDirs.push(jobsDir);
    const jobId = 'j';
    const base = path.join(jobsDir, jobId);
    writeJson(path.join(base, '00-input', 'source.json'), {
      video: 'raw.mp4',
      srt: 'raw.srt',
      fps: 30,
      durationInFrames: 900,
    });
    writeJson(path.join(base, '01-align', 'align-report.json'), {
      fps: 30,
      mode: 'aligned',
      meanConfidence: 0.9,
      lowConfidenceRatio: 0.01,
      gatePassed: true,
      lowConfidenceWords: [],
      textSource: 'srt',
      alignedRatio: 1,
      thresholds: { meanConfidenceMin: 0.6, lowConfidenceRatioMax: 0.3, alignedRatioMin: 0.8 },
    });
    writeJson(path.join(base, '01-align', 'words.json'), {
      fps: 30,
      words: [],
      cues: [
        { index: 0, fromFrame: 60, toFrame: 69, text: '这里有3个要点' },
        { index: 1, fromFrame: 69, toFrame: 189, text: '但这一步必须停下来确认' },
      ],
    });
    writeJson(path.join(base, '02-perceive', 'shots.json'), []);
    writeJson(path.join(base, '02-perceive', 'regions.json'), []);
    return { jobsDir, jobId, base };
  }

  it('无 draft → 生成 pacing.json + draft.synth.json + storyboard（caption 2 / motion 1）', () => {
    const { jobsDir, jobId, base } = makeJob();
    const outcome = runStoryboard({ jobId, jobsDir });

    const pacingFile = path.join(base, '03-storyboard', 'pacing.json');
    expect(fs.existsSync(pacingFile)).toBe(true);
    const pacing = JSON.parse(fs.readFileSync(pacingFile, 'utf8')) as {
      cues: { cueIndex: number; decide: string; skipped?: string }[];
    };
    expect(pacing.cues).toHaveLength(2);
    expect(pacing.cues[0]!.skipped).toBe('too-short');
    expect(pacing.cues[1]!.decide).toBe('motion');

    // 产品缺口修复：synth 结果要落成**可改的文件**，但不能叫 draft.json ——
    // 否则下次就命中「有起草稿 → 走旧路径」，内置生成器再也不会执行。
    const synthFile = path.join(base, '03-storyboard', 'draft.synth.json');
    expect(fs.existsSync(synthFile)).toBe(true);
    const synth = JSON.parse(fs.readFileSync(synthFile, 'utf8')) as {
      tracks: { id: string; items: unknown[] }[];
    };
    expect(synth.tracks.map((t) => t.id)).toEqual(['caption', 'motion']);
    expect(fs.existsSync(path.join(base, '03-storyboard', 'draft.json'))).toBe(false);

    const tracks = outcome.storyboard.tracks;
    expect(tracks.map((t) => t.id)).toEqual(['caption', 'motion']);
    expect(tracks[0]!.items).toHaveLength(2);
    expect(tracks[1]!.items).toHaveLength(1);

    // 幂等：再跑一次仍走内置生成器（draft.json 不存在），结果不变
    const again = runStoryboard({ jobId, jobsDir });
    expect(again.storyboard.tracks.map((t) => t.id)).toEqual(['caption', 'motion']);
    expect(again.storyboard.tracks[0]!.items).toHaveLength(2);
  });

  it('显式 --draft → 走旧路径，且不生成 pacing.json', () => {
    const { jobsDir, jobId, base } = makeJob();
    const draftFile = path.join(base, '03-storyboard', 'draft.json');
    writeJson(draftFile, {
      meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
      tracks: [
        {
          id: 't',
          layer: 60,
          items: [
            {
              _author: { anchor: 'abs:10' },
              motion: 'typography/kinetic-line@1.0',
              footprint: [0.05, 0.72, 0.3, 0.16],
              params: { text: '手写稿' },
              sim_max: 0.9,
              confidence: 0.9,
            },
          ],
        },
      ],
      noMotionRanges: [],
    });

    const outcome = runStoryboard({ jobId, jobsDir });
    expect(fs.existsSync(path.join(base, '03-storyboard', 'pacing.json'))).toBe(false);
    expect(outcome.storyboard.tracks.map((t) => t.id)).toEqual(['t']);
  });

  it('显式 --draft 指向不存在的文件 → ConfigError（不悄悄改用内置生成器）', () => {
    const { jobsDir, jobId, base } = makeJob();
    expect(() =>
      runStoryboard({
        jobId,
        jobsDir,
        draftPath: path.join(base, '03-storyboard', 'nope.json'),
      }),
    ).toThrow(ConfigError);
    expect(fs.existsSync(path.join(base, '03-storyboard', 'pacing.json'))).toBe(false);
  });
});
