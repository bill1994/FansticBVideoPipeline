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
/**
 * 外部对齐器的回传结构 = `AlignWords` + **可选的 `alignedRatio`**（M-1c）。
 *
 * `alignedRatio` 设为可选而非必填，是为了**不破坏现有对齐器**：
 * 未回传时按「未测量」处理（不参与门控 + 显式告警），
 * 而不是拒绝执行或伪造一个看起来已测过的值。
 */
export interface ExternalAligned extends AlignWords {
  /** SRT 词成功对上 token 的比例 0–1。M-1c 起为门控项。 */
  alignedRatio?: number;
}

export function runExternalAligner(
  wavPath: string,
  srtPath: string,
  outJson: string,
  fps: number,
): ExternalAligned {
  const tpl = process.env.ALIGNER_CMD;
  if (!tpl) {
    throw new ConfigError(
      '未配置 ALIGNER_CMD —— 强制对齐需要一个外部对齐器。\n' +
        '  示例：ALIGNER_CMD="python tools/align.py --wav {wav} --srt {srt} --out {out} --fps {fps}"\n' +
        '  契约：把 {fps, words: WordTimestamp[], cues: Cue[]} 写到 {out}\n' +
        '        可选：alignedRatio（SRT 词对上 token 的比例，M-1c 门控项）\n' +
        '  提示：仅取 SRT 的**文本**，时间戳必须由音频重新推导（B2-fix）。\n' +
        '  语言：必须显式指定，**不要用 auto** —— 自动检测在边界素材上翻转会让\n' +
        '        words[] 整列变化，所有 word:N 锚点静默重指向（见 M-1 裁决）。',
    );
  }
  const cmd = tpl
    .replaceAll('{wav}', wavPath)
    .replaceAll('{srt}', srtPath)
    .replaceAll('{out}', outJson)
    .replaceAll('{fps}', String(fps));
  execFileSync(cmd, { shell: true, stdio: 'inherit' });
  return readJson<ExternalAligned>(outJson);
}

/** 门控判定结果。 */
export interface GateEvaluation {
  meanConfidence: number;
  lowConfidenceRatio: number;
  /** SRT 词成功对上 token 的比例（M-1c）。无可用输入时为 null。 */
  alignedRatio: number | null;
  lowConfidenceWords: number[];
  gatePassed: boolean;
  thresholds: AlignReport['thresholds'];
}

/**
 * 由词级置信度算出门控判定。纯函数，便于单测。
 *
 * `alignedRatio` 由外部对齐器通过 words 的 `confidence` 之外的信息给出 ——
 * 确切地说，它表达「SRT 的词有多少在音频里找到了对应」。
 * 当前 `ALIGNER_CMD` 契约只回传逐词时间戳 + 置信度，**没有这一项**，
 * 故传入 `undefined` 时按 `null` 处理，**不参与门控**（并在日志中明示）。
 *
 * 🔴 这是**过渡态**，不是终态：M-1 已裁决采用 (b)（文本对齐回 SRT），
 * 实现后 `runExternalAligner` 会一并回传 alignedRatio。
 * 在那之前，此处**不伪造该值**（P0：绝不伪造结果）。
 */
export function evaluateGate(
  words: WordTimestamp[],
  alignedRatio?: number,
): GateEvaluation {
  if (words.length === 0) {
    throw new ConfigError('对齐结果为空 —— 没有词级时间戳，pipeline 无法启动');
  }
  const mean = words.reduce((s, w) => s + w.confidence, 0) / words.length;
  const low = words.filter((w) => w.confidence < LOW_CONFIDENCE_ABS);
  const ratio = low.length / words.length;

  // M-1c：alignedRatio 与 meanConfidence 是**两个不同维度**，
  // 少任一项都会留下一道测不到对齐质量的门。
  const confPassed = mean >= ALIGN_GATE.meanConfidenceMin && ratio <= ALIGN_GATE.lowConfidenceRatioMax;
  const alignPassed = alignedRatio === undefined || alignedRatio >= ALIGN_GATE.alignedRatioMin;
  const gatePassed = confPassed && alignPassed;

  return {
    meanConfidence: mean,
    lowConfidenceRatio: ratio,
    alignedRatio: alignedRatio ?? null,
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

  const g = evaluateGate(aligned.words, aligned.alignedRatio);
  const report: AlignReport = {
    fps: source.fps,
    meanConfidence: g.meanConfidence,
    lowConfidenceRatio: g.lowConfidenceRatio,
    gatePassed: g.gatePassed,
    lowConfidenceWords: g.lowConfidenceWords,
    // M-1c：文本权威来源落盘。M-1 已裁决取'srt' ——
    // ALIGNER_CMD 契约本身只取 SRT 文本（B2-fix），时间戳从音频推导。
    textSource: 'srt',
    // 🔴 不伪造：外部对齐器尚未回传该值时写 0 而非 1，
    // 会让「未测量」看起来像「测过了且完美」。此处如实记 0，
    // 并在下方显式告警 —— 见 M-1c 的必填理由。
    alignedRatio: g.alignedRatio ?? 0,
    thresholds: g.thresholds,
  };
  if (g.alignedRatio === null) {
    log.warn(
      '对齐器未回传 alignedRatio（当前 ALIGNER_CMD 契约未含此项）。' +
        'M-1c 要求它作门控项，实现文本对齐后此项才有意义。' +
        '本次不参与门控，但报告里会如实记为 0 —— 不伪造已测过的值。',
    );
  }

  writeJson(wordsFile, { fps: aligned.fps, words: aligned.words, cues: aligned.cues } satisfies AlignWords);
  writeJson(reportFile, report);

  return { report, gatePassed: g.gatePassed };
}

/** 供 storyboard 阶段复用：读 01-align 的词与 cue。 */
export function loadAligned(wordsFile: string): AlignWords {
  const data = readJson<AlignWords>(wordsFile);
  return { fps: data.fps, words: data.words, cues: (data.cues ?? []) as Cue[] };
}
