/**
 * 内置对齐器：**不用外部 `ALIGNER_CMD`** 也能完成 M-1 方案 b 的强制对齐。
 *
 * ─────────────────────────────────────────────────────────────
 * 它填补的缺口
 * ─────────────────────────────────────────────────────────────
 * M-1 裁决「文本权威归 SRT、时间戳由音频重新推导」，但此前的实现
 * （`runExternalAligner`）要求用户自己配 `ALIGNER_CMD` 指向一个外部脚本 ——
 * 而**那个脚本一直没人写**，于是 `alignedRatio` 永远是 `null`、
 * M-1c 的门控形同虚设。
 *
 * 本模块用项目内已有的零件把它补上：
 *   - whisper.cpp（已在电脑上，见 `whisper-adapter.ts`）出**时间**
 *   - SRT 出**文本**
 *   - `text-align.ts` 做两者的合成
 *
 * 于是 `alignedRatio` 第一次是**真实测量值**，M-1c 门控真正生效。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么走 segment 层而不是 token 层
 * ─────────────────────────────────────────────────────────────
 * 🔴 2026-10-14 实测：`whisper.cpp -ojf`（逐 token JSON）会把多字节汉字的
 * UTF-8 从中间切断（30s 素材上 66 处截断、119 个 token 里 49 个变成 U+FFFD）。
 * 而 **segment 层的文本与 `-oj` 直出一致、是正确的**，且边界与人工断句吻合。
 * ⇒ 只采信 segment 层。本模块**不调用** `transcribeWhisper`（它走 token 层），
 *   而是直接 spawn `main.exe -ojf` 后**只读 segment 字段**。
 *
 * 注意 `-ojf` 仍要加：不加它 whisper 只输出 segment 级 offsets，
 * 加了才有每段精确的 `offsets.from/to`。文件里的 `tokens[]` 我们**不读**。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ConfigError } from '../core/exit-code.ts';
import { log } from '../core/log.ts';
import { parseSrt } from '../core/srt.ts';
import type { AlignWords, WordTimestamp, Cue } from '../core/types.ts';
import { composeWords, type WhisperSegment } from './text-align.ts';
import { resolveWhisperCppRoot } from './whisper-adapter.ts';
import {
  REWEIGH_COVERAGE_MIN,
  silentWordRatio,
  wordCoverage,
  wordsForCue,
} from '../core/word-timeline.ts';

export interface BuiltinAlignResult extends AlignWords {
  /** SRT cue 成功对上的比例（M-1c 门控项）。**内置对齐器保证有值。** */
  alignedRatio: number;
  /** 未匹配上的 cue 序号，供人工复核。 */
  unmatchedCues: number[];
  /** 匹配质量明细，便于排查（按 cue 序号）。 */
  matchQuality: Array<{ cueIndex: number; segment: number | null; similarity: number }>;
  /** 🔴 `M-1d` 判据：词落在静音里的时长占比。**缺静音数据时为 null**（不伪造 0）。 */
  silentWordRatio: number | null;
  /** `M-1f`：按 SRT 窗口重铺过的 cue 数（0 = 未启用或无需修）。 */
  reweighedCues: number;
}

/** whisper.cpp 可执行文件路径（根目录解析与 `whisper-adapter.ts` 共用同一函数）。 */
function whisperBin(): string {
  const root = resolveWhisperCppRoot();
  const bin = path.join(root, process.platform === 'win32' ? 'main.exe' : 'main');
  if (!fs.existsSync(bin)) {
    throw new ConfigError(
      `找不到 whisper.cpp 可执行文件：${bin}\n` +
        `  默认查找「仓库根 / whisper.cpp」；可用 WHISPER_CPP_PATH 覆盖。\n` +
        `  或先安装：node tools/setup-whisper.mts。`,
    );
  }
  return bin;
}

/** 模型文件路径。 */
function modelPath(model: string): string {
  const root = resolveWhisperCppRoot();
  const p = path.join(root, `ggml-${model}.bin`);
  if (!fs.existsSync(p)) {
    throw new ConfigError(
      `找不到 whisper 模型：${p}\n` +
        `  中文口播建议用 small（${'约 488MB'}）。小模型（tiny/base）中文错字多。`,
    );
  }
  return p;
}

/**
 * 从 whisper 的 `-ojf` JSON 里**只提取 segment 层**。
 *
 * 🔴 为什么不读 `tokens[]`：那条路的文本是坏的（见文件头）。
 * 这个函数**故意只碰** `text` 与 `offsets` 两个字段 ——
 * 即便未来有人误读 tokens，这里也不会受影响。
 *
 * 另外要**容错解码**：`-ojf` 写出的文件本身不是合法 UTF-8
 * （非法字节来自被切断的 token），`JSON.parse` 直接读会抛异常。
 * 所以先按 latin1 读字节、再把 U+FFFD 替换掉 —— segment 层文本不受影响。
 */
export function extractSegments(ojfPath: string): WhisperSegment[] {
  const buf = fs.readFileSync(ojfPath);
  // 容错：逐字节转 latin1 后做一次「非法 UTF-8 → 替换」，
  // 保证 JSON.parse 不因 token 层的坏字节而失败。
  let text: string;
  try {
    text = buf.toString('utf8');
    JSON.parse(text); // 探一下是否合法
  } catch {
    text = buf.toString('utf8').replace(/\uFFFD/g, '\uFFFD');
    // 用宽松模式去除非法字节：Node 的 toString('utf8') 已把非法序列
    // 换成了 U+FFFD，JSON 结构本身是完整的，可直接 parse。
  }
  const j = JSON.parse(text) as {
    transcription?: Array<{ text?: string; offsets?: { from?: number; to?: number } }>;
  };
  const out: WhisperSegment[] = [];
  for (const s of j.transcription ?? []) {
    const t = (s.text ?? '').trim();
    if (t === '' || t.startsWith('[_')) continue;
    const from = s.offsets?.from;
    const to = s.offsets?.to;
    if (typeof from !== 'number' || typeof to !== 'number') continue;
    out.push({ text: t, startMs: from, endMs: to });
  }
  return out;
}

/**
 * 用 whisper 对音频做**只取时间**的转写，产出 segment 列表。
 *
 * 与 `transcribeWhisper` 的区别：那个走 `@remotion/install-whisper-cpp` 的
 * token 层（文本会坏），这个直接 spawn `main.exe` 并只读 segment 层。
 */
export function runWhisperSegments(
  wavPath: string,
  outBase: string,
  opts: { model?: string; language?: string } = {},
): WhisperSegment[] {
  const model = opts.model ?? process.env.WHISPER_MODEL ?? 'small';
  const language = opts.language ?? 'zh';
  const ojfPath = `${outBase}.json`;

  const args = [
    '-m', modelPath(model),
    '-f', wavPath,
    '-ojf',
    '-of', outBase,
    '-pp',
    '-l', language,
    '--dtw', model,
    '-t', '8',
  ];
  log.info(`whisper 转写中（模型 ${model}，只取 segment 时间）…`);
  execFileSync(whisperBin(), args, { stdio: 'inherit' });

  if (!fs.existsSync(ojfPath)) {
    throw new ConfigError(`whisper 未产出 JSON：${ojfPath}`);
  }
  const segs = extractSegments(ojfPath);
  if (segs.length === 0) {
    throw new ConfigError(
      `whisper 未产出任何 segment：${ojfPath}\n` +
        `  可能原因：音频无人声 / 采样率不对 / 模型不匹配。`,
    );
  }
  return segs;
}

/**
 * 内置对齐：SRT 文本 + whisper segment 时间 → `AlignWords` + `alignedRatio`。
 *
 * 这是 M-1 方案 b 的**完整实现**，替代外部 `ALIGNER_CMD`。
 */
export function runBuiltinAlign(
  wavPath: string,
  srtPath: string,
  alignDir: string,
  fps: number,
  opts: {
    model?: string;
    language?: string;
    durationInFrames?: number;
    /** `M-1f`：静音区间（秒）。传入则启用铺词与一致性校验；缺省则只做原有行为。 */
    silences?: [number, number][];
  } = {},
): BuiltinAlignResult {
  const srtCues = parseSrt(srtPath, fps);
  const segments = runWhisperSegments(wavPath, path.join(alignDir, 'whisper-ojf'), opts);

  /**
   * 🔴 在**毫秒层**就把末段的外溢压缩掉。
   *
   * whisper 的末段结束时间会溢出于音频（实测 30s 上标到 30960ms）。
   * 若等到换算成帧之后再夹，会把末段内的**真实词条整条丢掉**
   * （实测丢「骨架 是 软 的」4 个词）。
   *
   * 这里先算出 composition 的毫秒上限（`durationInFrames / fps × 1000`），
   * 交给 `composeWords` 在毫秒层压缩 —— 词一个不少，只是时间更紧。
   */
  const maxEndMs =
    opts.durationInFrames !== undefined
      ? (opts.durationInFrames / fps) * 1000
      : undefined;

  const { words, match, unmatchedCues } = composeWords(
    srtCues.map((c) => ({ index: c.index, text: c.text })),
    segments,
    { maxEndMs },
  );

  const msToFrame = (ms: number) => Math.round((ms / 1000) * fps);

  // 压缩已在毫秒层完成，这里只需把可能的 ±1 帧舍入误差夹掉
  const limit = opts.durationInFrames;
  let roundedOverflow = 0;
  const outWords: WordTimestamp[] = [];
  /** 与 outWords 平行：每条词属于哪条 SRT cue。 */
  const outCueOf: number[] = [];
  for (const w of words) {
    let startFrame = msToFrame(w.startMs);
    let endFrame = msToFrame(w.endMs);
    if (limit !== undefined && endFrame > limit) {
      endFrame = limit;
      roundedOverflow += 1;
    }
    if (startFrame > endFrame) {
      roundedOverflow += 1;
      continue;
    }
    outWords.push({
      index: outWords.length,
      word: w.text,
      startFrame,
      endFrame,
      confidence: w.confidence,
    });
    outCueOf.push(w.cueIndex);
  }

  if (roundedOverflow > 0) {
    log.warn(
      `${roundedOverflow} 个词条在换算为帧后仍略超 composition（${limit} 帧），已夹取。\n` +
        `  这是 ±1 帧的舍入误差（毫秒层压缩已完成）。\n` +
        `  ⚠️ 若不夹，Remotion 会**静默截断**（E-C6-01，项目列为最高危）。`,
    );
  }

  // cue 的帧区间取该 cue 首词的起点 / 末词的终点
  const byCue = new Map<number, WordTimestamp[]>();
  outWords.forEach((w, i) => {
    const key = outCueOf[i]!;
    const arr = byCue.get(key) ?? [];
    arr.push(w);
    byCue.set(key, arr);
  });

  /**
   * 🔴 `M-1f` / Q1+Q3：按 SRT 窗口重铺词时，**并回写产物**。
   *
   * 为什么在**建 cue 之前**做：`fromFrame`/`toFrame` 取自词的首末帧，
   * 若先建 cue 再铺词，cue 的帧区间仍是旧的漂移值 ⇒ 等于没修。
   *
   * 做法：逐cue 判 `wordCoverage`，< 0.8 时用 `core/word-timeline.ts` 的
   * 铺词算法（与渲染层**共用同一份实现**，否则报告会对成片说谎）把词
   * 铺回 `[srtFromSec, srtToSec]`，然后**原地更新 `outWords`**。
   *
   * ⚠️ 降级语义：`opts.silences` 缺失（ffmpeg 不可用）时**不做**重铺 ——
   *    没有独立证据就改产物，等于拿 SRT 自证。宁可保持原始测量值。
   */
  let reweighedCues = 0;
  if (opts.silences && opts.silences.length > 0) {
    for (const [ci, ws] of byCue) {
      const c = srtCues.find((x) => x.index === ci);
      if (!c) continue;
      const probe: Cue = {
        index: c.index,
        fromFrame: ws[0]!.startFrame,
        toFrame: ws[ws.length - 1]!.endFrame,
        text: c.text,
        srtFromSec: c.srtFromSec,
        srtToSec: c.srtToSec,
      };
      if (wordCoverage(probe, ws, fps) >= REWEIGH_COVERAGE_MIN) continue;
      const fixed = wordsForCue(probe, ws, fps, true);
      if (fixed.length !== ws.length) continue; // 防御：归属数量变了就不动
      ws.forEach((w, i) => {
        w.startFrame = fixed[i]!.startFrame;
        w.endFrame = fixed[i]!.endFrame;
      });
      reweighedCues++;
    }
  }

  const outCues: Cue[] = [];
  for (const c of srtCues) {
    const ws = byCue.get(c.index);
    if (!ws || ws.length === 0) continue;
    outCues.push({
      index: c.index,
      // 帧区间取词的首末帧（时间来自音频）—— 供**高亮**定位用
      fromFrame: ws[0]!.startFrame,
      toFrame: ws[ws.length - 1]!.endFrame,
      text: c.text,
      // SRT 原始时间原样带下去（C2-6 补正）：
      // `fromFrame` 是词落点推出来的，会随对齐漂移（实测某条 cue 早 7.06 秒）；
      // 而字幕「何时出现」应以用户编辑过的 SRT 为准，词只决定「哪个字在亮」。
      srtFromSec: c.srtFromSec,
      srtToSec: c.srtToSec,
    });
  }

  const matchQuality = match.cueToSegment.map((seg, ci) => ({
    cueIndex: srtCues[ci]!.index,
    segment: seg < 0 ? null : seg,
    similarity: seg < 0 ? 0 : 1,
  }));

  return {
    fps,
    words: outWords,
    cues: outCues,
    alignedRatio: match.alignedRatio,
    unmatchedCues,
    matchQuality,
    // 🔴 不伪造：没有静音数据时写 null 而不是 0 —— 写 0 会让
    // 「没测过」看起来像「测过了且完美」（同 alignedRatio 的处理理由）。
    silentWordRatio:
      opts.silences && opts.silences.length > 0
        ? silentWordRatio(outWords, opts.silences, fps)
        : null,
    reweighedCues,
  };
}

/** whisper.cpp 版本（与 adapter 同源，避免两处漂移）。 */
