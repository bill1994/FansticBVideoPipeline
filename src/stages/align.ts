/**
 * Stage 1 · align —— 抽音轨、强制对齐、置信度门控。
 *
 * 铁律（B2-fix / C2-1 / C2-4 / F5）：
 *  1. **只取 SRT 的文本，不信任其时间戳** —— 时间必须从音频重新推导
 *  2. 强制对齐是 pipeline **启动前置步骤**，不是可选增强
 *  3. 音频处理只做对齐必需（16kHz 单声道 wav）；降噪 / 响度归一 / BGM 分离明确不做
 *  4. **门控不达标必须停**，降级必须阻断
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { ALIGN_GATE, STAGES } from '../core/config.ts';
import { ConfigError } from '../core/exit-code.ts';
import { exists, jobDir, readJson, stageDir, writeJson } from '../core/io.ts';
import { log } from '../core/log.ts';
import type { AlignReport, AlignWords, Cue, SourceManifest, WordTimestamp } from '../core/types.ts';

/** 低置信词判定：低于整体均值的一半与固定下限的较小者，取保守侧。 */
const LOW_CONFIDENCE_ABS = 0.5;

export interface AlignOptions {
  jobId: string;
  jobsDir?: string;
  /** 已有产物时是否强制重跑。默认沿用不可变快照，不重跑。 */
  force?: boolean;
}

/**
 * 抽音轨 → 16kHz 单声道 wav。
 *
 * 需要系统 ffmpeg。这是**范围内**唯一允许的音频处理（F5）。
 */
export function extractAudio(videoPath: string, outWav: string): void {
  try {
    execFileSync(
      'ffmpeg',
      ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outWav],
      { stdio: 'pipe' },
    );
  } catch (e) {
    throw new ConfigError(
      `ffmpeg 抽音轨失败（需要系统安装 ffmpeg）：${(e as Error).message}\n` +
        `目标：16kHz 单声道 wav（F5 范围内唯一允许的音频处理）`,
    );
  }
}

/**
 * 外部强制对齐器适配。
 *
 * 本仓库**不内置** ASR 模型 —— 对齐算法（WhisperX / faster-whisper / MFA …）
 * 属实现期选型，且体积与许可都需另行决定。此处只定义**输入输出契约**：
 *
 *   ALIGNER_CMD 环境变量，支持占位符 {wav} {srt} {out} {fps}
 *   命令须写出 `{out}`：{ fps, words: WordTimestamp[], cues: Cue[] }
 *
 * 未配置时抛 ConfigError（退出码 2），**不伪造对齐结果**。
 */
export function runExternalAligner(
  wavPath: string,
  srtPath: string,
  outJson: string,
  fps: number,
): AlignWords {
  const tpl = process.env.ALIGNER_CMD;
  if (!tpl) {
    throw new ConfigError(
      '未配置 ALIGNER_CMD —— 强制对齐需要一个外部对齐器。\n' +
        '  示例：ALIGNER_CMD="python tools/align.py --wav {wav} --srt {srt} --out {out} --fps {fps}"\n' +
        '  契约：把 {fps, words: WordTimestamp[], cues: Cue[]} 写到 {out}\n' +
        '  提示：仅取 SRT 的**文本**，时间戳必须由音频重新推导（B2-fix）。',
    );
  }
  const cmd = tpl
    .replaceAll('{wav}', wavPath)
    .replaceAll('{srt}', srtPath)
    .replaceAll('{out}', outJson)
    .replaceAll('{fps}', String(fps));
  execFileSync(cmd, { shell: true, stdio: 'inherit' });
  return readJson<AlignWords>(outJson);
}

/** 门控判定结果。 */
export interface GateEvaluation {
  meanConfidence: number;
  lowConfidenceRatio: number;
  lowConfidenceWords: number[];
  gatePassed: boolean;
  thresholds: AlignReport['thresholds'];
}

/** 由词级置信度算出门控判定。纯函数，便于单测。 */
export function evaluateGate(words: WordTimestamp[]): GateEvaluation {
  if (words.length === 0) {
    throw new ConfigError('对齐结果为空 —— 没有词级时间戳，pipeline 无法启动');
  }
  const mean = words.reduce((s, w) => s + w.confidence, 0) / words.length;
  const low = words.filter((w) => w.confidence < LOW_CONFIDENCE_ABS);
  const ratio = low.length / words.length;
  const gatePassed =
    mean >= ALIGN_GATE.meanConfidenceMin && ratio <= ALIGN_GATE.lowConfidenceRatioMax;
  return {
    meanConfidence: mean,
    lowConfidenceRatio: ratio,
    lowConfidenceWords: low.map((w) => w.index),
    gatePassed,
    thresholds: { ...ALIGN_GATE },
  };
}

export interface AlignOutcome {
  report: AlignReport;
  /** 门控未过 → false。调用方必须据此阻断，**不得继续**。 */
  gatePassed: boolean;
}

export function runAlign(opts: AlignOptions): AlignOutcome {
  const base = jobDir(opts.jobId, opts.jobsDir);
  const alignDir = stageDir(opts.jobId, STAGES.align, opts.jobsDir);
  const wordsFile = path.join(alignDir, 'words.json');
  const reportFile = path.join(alignDir, 'align-report.json');

  if (exists(wordsFile) && exists(reportFile) && !opts.force) {
    log.info('01-align 已是不可变快照，沿用（加 --force 可重跑；重跑后 02–06 全部作废）');
    const report = readJson<AlignReport>(reportFile);
    return { report, gatePassed: report.gatePassed };
  }

  const source = readJson<SourceManifest>(path.join(base, STAGES.input, 'source.json'));
  const videoPath = path.join(base, STAGES.input, source.video);
  const srtPath = path.join(base, STAGES.input, source.srt);

  if (!fs.existsSync(videoPath)) {
    throw new ConfigError(`素材不存在：${videoPath}（见 00-input/source.json 的 video 字段）`);
  }
  if (!fs.existsSync(srtPath)) {
    throw new ConfigError(`字幕不存在：${srtPath}（见 00-input/source.json 的 srt 字段）`);
  }

  fs.mkdirSync(alignDir, { recursive: true });
  const wavPath = path.join(alignDir, 'audio.wav');
  log.stage('align', '抽音轨 → 16kHz 单声道 wav');
  extractAudio(videoPath, wavPath);

  log.stage('align', '强制对齐（只取 SRT 文本，时间从音频重新推导）');
  const aligned = runExternalAligner(wavPath, srtPath, path.join(alignDir, 'aligner-raw.json'), source.fps);

  const g = evaluateGate(aligned.words);
  const report: AlignReport = {
    fps: source.fps,
    meanConfidence: g.meanConfidence,
    lowConfidenceRatio: g.lowConfidenceRatio,
    gatePassed: g.gatePassed,
    lowConfidenceWords: g.lowConfidenceWords,
    thresholds: g.thresholds,
  };

  writeJson(wordsFile, { fps: aligned.fps, words: aligned.words, cues: aligned.cues } satisfies AlignWords);
  writeJson(reportFile, report);

  return { report, gatePassed: g.gatePassed };
}

/** 供 storyboard 阶段复用：读 01-align 的词与 cue。 */
export function loadAligned(wordsFile: string): AlignWords {
  const data = readJson<AlignWords>(wordsFile);
  return { fps: data.fps, words: data.words, cues: (data.cues ?? []) as Cue[] };
}
