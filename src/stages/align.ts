/**
 * Stage 1 · align —— 抽音轨、强制对齐、置信度门控。
 *
 * 规则（B2-fix / M-1 / M-1f / C2-1 / C2-4 / F5）：
 *  1. **SRT 是文本与句子时间的双重权威** —— 词级时间按 cue 窗口铺（`M-1f`）
 *  2. 强制对齐是 pipeline **启动前置步骤**，不是可选增强
 *  3. 音频处理只做对齐必需（16kHz 单声道 wav）；降噪 / 响度归一 / BGM 分离明确不做
 *  4. **门控不达标必须停**，降级必须阻断
 *
 * 🔴 **2026-10-19 更正**：本文件此前把第 1 条写成「只取 SRT 的文本，**不信任其时间戳**」，
 *并称其为 B2-fix。该表述**不在 B2-fix 原文中** —— 审核报告（`docs/reviews/2026-10-12-工作流文档审核报告.md` §B-2）
 * 原文是「SRT 已有字幕，Whisper **只需出时间戳**，可强制对齐到 SRT 文本」。
 *「不信任 SRT 时间戳」是登记册转写时添加的过度推断，已撤回（见 `OPEN-DECISIONS.md` B2-fix 更正）。
 * 实测：kukini 的 SRT 边界与音频静音吻合（留白 7.083s vs 实测 6.736s，整体平移 0 即最优），
 * 文本归属也 100% 正确 —— 错的只是 whisper 给的词落点，故按 SRT 窗口铺词即可。
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { ALIGN_GATE, STAGES } from '../core/config.ts';
import { ConfigError } from '../core/exit-code.ts';
import { exists, jobDir, readJson, stageDir, writeStageJson } from '../core/io.ts';
import { log } from '../core/log.ts';
import type { AlignReport, AlignWords, Cue, SourceManifest, WordTimestamp } from '../core/types.ts';
import { runBuiltinAlign } from './builtin-align.ts';
import { detectSilences } from '../core/silence.ts';
import { checkSrtAudioAgreement } from '../core/word-timeline.ts';

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
        '  提示：SRT 是**文本与句子时间**的权威，cues[] 的 from/to 应取自 SRT 时间戳；\n' +
        '        词级时间若与 cue 窗口不符，本项目会按窗口重铺（M-1f）。\n' +
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
  /**
   * 后端选择：
   *   - 配了 `ALIGNER_CMD` → 用外部对齐器（保持既有契约与向后兼容）
   *   - 没配 → 用**内置对齐器**（`builtin-align.ts`）
   *
   * 🔴 为什么要有内置后端：此前只有 `ALIGNER_CMD` 一条路，而**外部脚本
   *    一直没人写** ⇒ `alignedRatio` 永远是 `null`、M-1c 的门控形同虚设。
   *    内置后端用项目里已有的零件（whisper.cpp + SRT + text-align）把它补上，
   *    让 `alignedRatio` 第一次成为**真实测量值**。
   */
  const useBuiltin = !process.env.ALIGNER_CMD;
  let aligned: ExternalAligned;
  /** 内置后端的产物（带 `M-1d`/`M-1f` 字段）；外部后端时为 null。 */
  let builtin: ReturnType<typeof runBuiltinAlign> | null = null;

  /**
   * 🔴 `M-1d` / `M-1f`：探测静音区间。
   *
   * 用 `01-align/audio.wav`（上一步刚抽好，不重复抽）。**这一步是铺词的开关** ——
   * 没有独立音频证据就不改产物（见 `builtin-align.ts` 内的说明）。
   */
  log.stage('align', '探测静音区间（silencedetect）');
  const silences = detectSilences(wavPath);
  log.info(
    silences.length > 0
      ? `静音区间 ${silences.length} 段：${silences
          .map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}s(${(b - a).toFixed(2)}s)`)
          .join(', ')}`
      : '未探测到静音区间 —— 本次**跳过** SRT 一致性校验与词时重铺（缺独立证据不改产物）。',
  );

  if (useBuiltin) {
    const builtinResult = runBuiltinAlign(wavPath, srtPath, alignDir, source.fps, {
      model: process.env.WHISPER_MODEL,
      language: 'zh',
      durationInFrames: source.durationInFrames,
      silences,
    });
    builtin = builtinResult;
    aligned = builtinResult;

    /**
     * 🔴 `M-1f` Q2：SRT 窗口与音频静音的**一致性校验**。
     *
     * ⚠️ 目的**不是**「防范 SRT 不可信」（那条铁律已撤回），
     *    而是捕获用户手编 SRT 时的划错 —— 划歪了要报 warning，
     *    而不是静默产出错高亮。
     *
     * 判据取自**音频**，不是 SRT 自证。
     */
    const mismatch = checkSrtAudioAgreement(builtinResult.cues, silences);
    if (mismatch) {
      log.warn(
        `SRT 时间轴与音频静音段不吻合（M-1f Q2）：\n      ${mismatch}\n` +
          `  判据来自 silencedetect（音频侧）。若确认 SRT 无误，可忽略本条。\n` +
          `  若 SRT 划错了，请修正后重跑：--force`,
      );
    }

    /**
     * 🔴 `M-1d` 判据落报告：词落在静音里的时长占比。
     * ⚠️ 阈值尚未校准（OPEN）⇒ **只报告不阻断**。
     */
    if (builtinResult.silentWordRatio !== null) {
      log.info(
        `silentWordRatio = ${(builtinResult.silentWordRatio * 100).toFixed(2)}%` +
          `（M-1d 判据；正常素材应 ≈0）。重铺 ${builtinResult.reweighedCues} 条 cue 的词时。`,
      );
      if (builtinResult.silentWordRatio > 0.02) {
        log.warn(
          `仍有 ${(builtinResult.silentWordRatio * 100).toFixed(2)}% 的词时落在静音里` +
            `（超过 2% 观察线）。可能原因：whisper 分段错误、或 SRT 与音频整体错位。`,
        );
      }
    }
  } else {
    aligned = runExternalAligner(wavPath, srtPath, path.join(alignDir, 'aligner-raw.json'), source.fps);
  }

  const g = evaluateGate(aligned.words, aligned.alignedRatio);
  const report: AlignReport = {
    fps: source.fps,
    meanConfidence: g.meanConfidence,
    lowConfidenceRatio: g.lowConfidenceRatio,
    gatePassed: g.gatePassed,
    lowConfidenceWords: g.lowConfidenceWords,
    // M-1c：文本权威来源落盘。M-1 已裁决取 'srt'——
    // ALIGNER_CMD 契约里 SRT 是文本与句子时间的权威（B2-fix 原意，
    // 「不信任 SRT 时间戳」的说法已于 2026-10-19 撤回，见本文件顶部注释）。
    textSource: 'srt',
    // 🔴 不伪造：外部对齐器尚未回传该值时写 0 而非 1，
    // 会让「未测量」看起来像「测过了且完美」。此处如实记 0，
    // 并在下方显式告警 —— 见 M-1c 的必填理由。
    alignedRatio: g.alignedRatio ?? 0,
    // 🔴 `M-1d` / `M-1f`：落盘才不是零消费者字段（项目已栽过
    // `occludesSubject` / `handoffIn` / `DUR.exit` 三次「定义了没人读」）。
    // 外部后端（ALIGNER_CMD）不产出这两个字段 ⇒ 如实记 null / 0，不伪造。
    silentWordRatio: builtin?.silentWordRatio ?? null,
    reweighedCues: builtin?.reweighedCues ?? 0,
    thresholds: g.thresholds,
  };
  if (g.alignedRatio === null) {
    log.warn(
      '对齐器未回传 alignedRatio（当前 ALIGNER_CMD 契约未含此项）。' +
        'M-1c 要求它作门控项，实现文本对齐后此项才有意义。' +
        '本次不参与门控，但报告里会如实记为 0 —— 不伪造已测过的值。',
    );
  } else if (useBuiltin) {
    log.info(
      `内置对齐器：alignedRatio = ${g.alignedRatio.toFixed(3)}（M-1c 门控项，已真实测量）。`,
    );
  }

  // 🔴 落盘走 writeStageJson：不可变快照守卫的唯一执行点（2026-10-18 接线）。
  writeStageJson({
    jobId: opts.jobId,
    self: STAGES.align,
    target: STAGES.align,
    file: 'words.json',
    data: { fps: aligned.fps, words: aligned.words, cues: aligned.cues } satisfies AlignWords,
    jobsDir: opts.jobsDir,
  });
  writeStageJson({
    jobId: opts.jobId,
    self: STAGES.align,
    target: STAGES.align,
    file: 'align-report.json',
    data: report,
    jobsDir: opts.jobsDir,
  });

  return { report, gatePassed: g.gatePassed };
}

/** 供 storyboard 阶段复用：读 01-align 的词与 cue。 */
export function loadAligned(wordsFile: string): AlignWords {
  const data = readJson<AlignWords>(wordsFile);
  return { fps: data.fps, words: data.words, cues: (data.cues ?? []) as Cue[] };
}
