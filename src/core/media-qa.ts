/**
 * 成片媒体 QA —— 解码、时长、黑场、静帧、音频电平、联系表。
 *
 * ── 为什么放在「渲染之后」而不是校验期 ─────────────────────────
 * `04-validate` 是纯 JSON→JSON，读不到成片；这些判据只能在**成片真实存在后**
 * 才能测量。因此本模块是 render 阶段的**事后报告**，不占 18 项名额。
 *
 * ── 阻断语义 ────────────────────────────────────────────────
 * · `errors`：解码失败、时长明显不符 —— 诚实记录为 error，但**不抛错**。
 *   成片已经产出，直接丢掉它比保留 + 明确告警更糟；是否作废由人决定。
 * · `warnings`：黑场 / 静帧 / 音频异常 / 联系表失败 —— 只提醒，不阻断。
 * · `unavailable`：ffmpeg / ffprobe 不可用 —— 判据缺失，不伪装成通过。
 *
 * ── 确定性 ─────────────────────────────────────────────────
 * 本模块不读时钟、不写随机数；输出只由成片与固定阈值决定。
 * 联系表帧号是纯函数（首帧 → 末帧等距 9 点），同一成片必然选同一组帧。
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export interface MediaSegment {
  start: number;
  end: number;
  duration: number;
}

export interface MediaDetection {
  segments: MediaSegment[];
  /** 末尾未闭合的起点（ffmpeg 对片尾黑场可能只给 start）。 */
  openStart: number | null;
}

export interface AudioStats {
  meanDb: number;
  maxDb: number;
}

export interface MediaQaCommandResult {
  stdout?: string;
  stderr?: string;
  status?: number | null;
  error?: string;
}

export interface MediaQaRunner {
  run(command: string, args: string[]): MediaQaCommandResult;
}

export interface MediaQaOptions {
  /** 成片绝对路径。 */
  file: string;
  /** 由 `durationInFrames / fps` 算出的期望时长。 */
  expectedDurationSec: number;
  fps: number;
  durationInFrames: number;
  /** 联系表输出路径；省略则不生成。 */
  contactSheetPath?: string;
  runner?: MediaQaRunner;
}

export interface MediaQaResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** 判据缺失（工具不在 PATH / spawn 失败），不是「测了且通过」。 */
  unavailable: string[];
  actualDurationSec: number | null;
  expectedDurationSec: number;
  durationDeltaSec: number | null;
  toleranceSec: number;
  black: MediaDetection;
  freeze: MediaDetection;
  audio: AudioStats | null;
  contactSheet: string | null;
}

const EMPTY_DETECTION: MediaDetection = { segments: [], openStart: null };

/** 默认执行体：与 `silence.ts` 一样用 spawnSync，拿得到 stdout / stderr。 */
export const spawnMediaQaRunner: MediaQaRunner = {
  run(command, args) {
    // 全片解码 + 逐帧滤镜，stderr 可能很长；16MB 足够容纳 blackdetect/freeze 日志。
    // 15 分钟上限防挂死；超时按 unavailable 记录，不伪装成通过。
    const r = spawnSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    return {
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
      status: r.status,
      error: r.error?.message,
    };
  },
};

function matchNumber(line: string, key: string): number | null {
  const m = line.match(new RegExp(`${key}:\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseDetection(
  text: string,
  startKey: string,
  endKey: string,
  durationKey: string,
): MediaDetection {
  const segments: MediaSegment[] = [];
  let pendingStart: number | null = null;
  let pendingDuration: number | null = null;

  for (const line of text.split(/\r?\n/)) {
    const start = matchNumber(line, startKey);
    const end = matchNumber(line, endKey);
    const duration = matchNumber(line, durationKey);

    if (start !== null) {
      pendingStart = start;
      pendingDuration = null;
    }
    if (duration !== null) pendingDuration = duration;
    if (end !== null && pendingStart !== null) {
      segments.push({
        start: pendingStart,
        end,
        duration: duration ?? pendingDuration ?? Math.max(0, end - pendingStart),
      });
      pendingStart = null;
      pendingDuration = null;
    }
  }

  return { segments, openStart: pendingStart };
}

/** 解析 ffmpeg `blackdetect` 的 stderr。 */
export function parseBlackdetect(text: string): MediaDetection {
  return parseDetection(text, 'black_start', 'black_end', 'black_duration');
}

/** 解析 ffmpeg `freezedetect` 的 stderr。 */
export function parseFreezedetect(text: string): MediaDetection {
  return parseDetection(text, 'freeze_start', 'freeze_end', 'freeze_duration');
}

function parseDb(text: string, key: string): number | null {
  const m = text.match(new RegExp(`${key}:\\s*(-?(?:inf|\\d+(?:\\.\\d+)?))\\s*dB`));
  if (!m) return null;
  return m[1] === '-inf' ? -Infinity : Number(m[1]);
}

/** 解析 ffmpeg `volumedetect` 的 mean / max；缺任一项返回 null（不猜）。 */
export function parseVolumedetect(text: string): AudioStats | null {
  const meanDb = parseDb(text, 'mean_volume');
  const maxDb = parseDb(text, 'max_volume');
  if (meanDb === null || maxDb === null) return null;
  return { meanDb, maxDb };
}

/**
 * 联系表帧号：首帧 → 末帧等距 N 点（默认 9）。
 *
 * 纯函数；结果去重且递增。总帧数少于 N 时返回全部帧。
 */
export function contactSheetFrameIndices(totalFrames: number, count = 9): number[] {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) return [];
  const n = Math.min(Math.max(1, Math.floor(count)), totalFrames);
  if (n === 1) return [0];
  const last = totalFrames - 1;
  const out = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    out.add(i === 0 ? 0 : i === n - 1 ? last : Math.round((i * last) / (n - 1)));
  }
  return [...out].sort((a, b) => a - b);
}

function tail(text: string | undefined, max = 400): string {
  const value = (text ?? '').trim();
  return value.length <= max ? value : `…${value.slice(-max)}`;
}

/**
 * 黑场 / 静帧的统一告警文案。
 *
 * `openStart` 是 ffmpeg 对「直到片尾还没闭合」的区间只给 start 的情况。
 * 它和成对区间一样是**一段**，不能按 0 段报 —— 否则日志会出现
 * 「检测到 0 段静帧……从 0.00s 开始」这种自相矛盾的话。
 */
function detectionWarning(
  label: string,
  detection: MediaDetection,
  durationSec: number,
): string | null {
  if (detection.segments.length === 0 && detection.openStart === null) return null;
  const openDuration =
    detection.openStart === null ? 0 : Math.max(0, durationSec - detection.openStart);
  const total = detection.segments.reduce((sum, segment) => sum + segment.duration, 0) + openDuration;
  const count = detection.segments.length + (detection.openStart === null ? 0 : 1);
  return (
    `检测到 ${count} 段${label}（合计 ${total.toFixed(2)}s）` +
    (detection.openStart === null
      ? ''
      : `；最后一段从 ${detection.openStart.toFixed(2)}s 开始（未闭合，可能持续到片尾）`)
  );
}

function contactSheetArgs(file: string, output: string, frames: number[]): string[] {
  // `select` 里的逗号属于 eq(n\,x) 的参数分隔，必须转义；spawn 不经过 shell，
  // 因此这里只做 ffmpeg filter 层的转义（`\\,` → `\,`）。
  const select = frames.map((frame) => `eq(n\\,${frame})`).join('+');
  return [
    '-hide_banner',
    '-y',
    '-i',
    file,
    '-vf',
    `select=${select},scale=640:-1,tile=3x3:margin=8:padding=8`,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-an',
    output,
  ];
}

/**
 * 跑完整媒体 QA。同步执行（与 render 阶段的同步流程一致）。
 *
 * 🔴 不抛错：任何测量失败都进 `errors` / `warnings` / `unavailable`，
 *    由调用方决定是否阻断。这是「报告层」不是「门」。
 */
export function runMediaQa(opts: MediaQaOptions): MediaQaResult {
  const runner = opts.runner ?? spawnMediaQaRunner;
  // Windows 上 WinGet/Scoop 的 ffmpeg shim 可能不是 Node 能直接 spawn 的，
  // 允许用绝对路径覆盖（同 WHISPER_CPP_PATH 的处理方式）。
  const ffmpegBin = process.env.FFMPEG_BIN ?? 'ffmpeg';
  const ffprobeBin = process.env.FFPROBE_BIN ?? 'ffprobe';
  const errors: string[] = [];
  const warnings: string[] = [];
  const unavailable: string[] = [];

  const expectedDurationSec = opts.expectedDurationSec;
  const toleranceSec = Math.max(0.15, 2 / Math.max(1, opts.fps));
  const addUnavailable = (message: string): void => {
    if (!unavailable.includes(message)) unavailable.push(message);
  };

  // ── 1. 时长 ────────────────────────────────────────────────
  let actualDurationSec: number | null = null;
  const durationRun = runner.run(ffprobeBin, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    opts.file,
  ]);
  if (durationRun.error) {
    addUnavailable(`ffprobe 不可用：${durationRun.error}`);
  } else if (durationRun.status !== 0) {
    errors.push(`读取成片时长失败（ffprobe 退出码 ${durationRun.status}）：${tail(durationRun.stderr)}`);
  } else {
    const parsed = Number(durationRun.stdout?.trim());
    if (Number.isFinite(parsed) && parsed > 0) actualDurationSec = parsed;
    else errors.push(`ffprobe 返回的时长非法：${JSON.stringify(durationRun.stdout?.trim())}`);
  }
  const durationDeltaSec =
    actualDurationSec === null ? null : actualDurationSec - expectedDurationSec;
  if (durationDeltaSec !== null && Math.abs(durationDeltaSec) > toleranceSec) {
    errors.push(
      `成片时长 ${actualDurationSec!.toFixed(2)}s 与预期 ${expectedDurationSec.toFixed(2)}s 不符` +
        `（差 ${durationDeltaSec.toFixed(2)}s，容差 ${toleranceSec.toFixed(2)}s）`,
    );
  }

  // ── 2. 黑场 / 静帧（全片解码）─────────────────────────────
  let black = EMPTY_DETECTION;
  let freeze = EMPTY_DETECTION;
  const videoRun = runner.run(ffmpegBin, [
    '-hide_banner',
    '-nostats',
    '-i',
    opts.file,
    '-map',
    '0:v:0',
    '-vf',
    'blackdetect=d=0.25:pix_th=0.10,freezedetect=n=-50dB:d=1',
    '-an',
    '-f',
    'null',
    '-',
  ]);
  if (videoRun.error) {
    addUnavailable(`ffmpeg 不可用：${videoRun.error}`);
  } else {
    black = parseBlackdetect(videoRun.stderr ?? '');
    freeze = parseFreezedetect(videoRun.stderr ?? '');
    if (videoRun.status !== 0) {
      errors.push(`视频解码/内容分析失败（ffmpeg 退出码 ${videoRun.status}）：${tail(videoRun.stderr)}`);
    }
  }
  const durationForOpen = actualDurationSec ?? expectedDurationSec;
  const blackWarning = detectionWarning('黑场', black, durationForOpen);
  if (blackWarning !== null) warnings.push(blackWarning);
  const freezeWarning = detectionWarning('静帧', freeze, durationForOpen);
  if (freezeWarning !== null) warnings.push(freezeWarning);

  // ── 3. 音频电平 ────────────────────────────────────────────
  let audio: AudioStats | null = null;
  const audioProbe = runner.run(ffprobeBin, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    opts.file,
  ]);
  if (audioProbe.error) {
    addUnavailable(`ffprobe 不可用：${audioProbe.error}`);
  } else if (audioProbe.status !== 0) {
    warnings.push(`音频流探测失败（ffprobe 退出码 ${audioProbe.status}）`);
  } else if ((audioProbe.stdout ?? '').trim() !== '') {
    const audioRun = runner.run(ffmpegBin, [
      '-hide_banner',
      '-nostats',
      '-i',
      opts.file,
      '-map',
      '0:a:0',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ]);
    if (audioRun.error) {
      addUnavailable(`ffmpeg 不可用：${audioRun.error}`);
    } else if (audioRun.status !== 0) {
      warnings.push(`音频分析失败（ffmpeg 退出码 ${audioRun.status}）`);
    } else {
      audio = parseVolumedetect(audioRun.stderr ?? '');
      if (audio === null) {
        warnings.push('音频分析未产出可解析的 mean/max 电平');
      } else {
        if (audio.maxDb <= -60) {
          warnings.push(`音频静音或接近静音（max ${audio.maxDb.toFixed(1)} dB）`);
        }
        if (audio.maxDb >= -0.1) {
          warnings.push(`音频接近满刻度（max ${audio.maxDb.toFixed(1)} dB）`);
        }
      }
    }
  }

  // ── 4. 联系表 ──────────────────────────────────────────────
  let contactSheet: string | null = null;
  if (opts.contactSheetPath !== undefined) {
    const frames = contactSheetFrameIndices(opts.durationInFrames, 9);
    if (frames.length === 0) {
      warnings.push('联系表跳过：成片帧数为 0');
    } else {
      // 先删旧图：否则本次生成失败时会看到上一次的残留，误判为成功。
      try {
        fs.rmSync(opts.contactSheetPath, { force: true });
      } catch {
        // 删不掉不影响后续生成；生成失败会进 warning。
      }
      const sheetRun = runner.run(
        ffmpegBin,
        contactSheetArgs(opts.file, opts.contactSheetPath, frames),
      );
      if (sheetRun.error) {
        addUnavailable(`ffmpeg 不可用：${sheetRun.error}`);
      } else if (sheetRun.status !== 0) {
        warnings.push(`联系表生成失败（ffmpeg 退出码 ${sheetRun.status}）：${tail(sheetRun.stderr)}`);
      } else if (!fs.existsSync(opts.contactSheetPath)) {
        warnings.push(`联系表命令成功但文件不存在：${opts.contactSheetPath}`);
      } else {
        contactSheet = opts.contactSheetPath;
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    unavailable,
    actualDurationSec,
    expectedDurationSec,
    durationDeltaSec,
    toleranceSec,
    black,
    freeze,
    audio,
    contactSheet,
  };
}
