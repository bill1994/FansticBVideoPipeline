/**
 * SRT 解析 —— M-1（方案 b）的输入侧。
 *
 * 来源：M-1 裁决（登记册，2026-10-13）「align 的文本权威归 SRT」。
 * 实现分两步走：**本文件只解决「读出 SRT 原文」**，不做时间对齐
 * （对齐是 `text-align.ts` 的活，属第二步）。
 *
 * ── 为什么不把 SRT 时间戳用上（B2-fix）─────────────────────────
 * SRT 的时间戳**一律不用**。素材是已粗剪拼接的，SRT 的时间轴可能与视频
 * 整体偏移。本文件只取 `text`，时间全部由音频重新推导。
 *
 * ⚠️ 这也意味着：**SRT 文本必须与口播内容相符**。若用户给了份对不上的
 * SRT，后果由 `alignedRatio` 门控暴露（M-1c），而不是在这里悄悄修。
 *
 * ── 格式容错 ──────────────────────────────────────────────────
 * 实际遇到的 SRT 变体很多，故刻意宽松：
 * · BOM、CRLF、末尾空行
 * · 序号可缺省或与文件顺序不符（不依赖序号，只依赖块序）
 * · 时间戳用 `,` 或 `.` 作毫秒分隔符（两者都收）
 * · 单行 cue（`00:00:01,000 --> 00:00:03,000 文本`）
 * · 多行 cue（文本跨行）
 * · 文本里的**非台词内容**（见 `NON_SPEECH_RE`）会被剥掉 —— 它们不是口播内容，
 *   却会污染后续的文本对齐。
 *
 * 解析失败一律抛 `ConfigError`（退出码 2），**不返回空数组** ——
 * 空数组会让下游以为「这段没有台词」，把配置错当成内容没做好。
 */

import fs from 'node:fs';
import { ConfigError } from './exit-code.ts';
import type { SrtCue } from './types.ts';

/**
 * 非台词行的识别特征。
 *
 * 🔴 这些过滤规则是**实现期拟定**（M-1 裁决 §4.8 遗留的待确认项）：
 * 「SRT 是否允许含非台词行（说话人标签、方括号注音、注释行）」当时列为
 * **需用户确认**的问题，尚未拍板。此处先按通用字幕惯例实现，
 * 并把规则集中在此便于按实际素材调整。
 *
 * 调整时须同步更新 `tests/srt.test.ts` 的对应用例。
 */
const NON_SPEECH_RE =
  /^\s*(?:\[[^\]]*\]|（[^）]*）|<[^>]*>|【[^】]*】|(?:说话人|旁白|画外音|音效|音乐|掌声|镜头)\s*[:：].*)$/u;

/** `00:01:02,500 --> 00:01:05,000`（逗号或点作毫秒分隔符均可） */
const TIME_LINE =
  /^\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*$/u;

/** 秒 → 帧。向上不取整：`fromFrame` 用 floor，`toFrame` 用 ceil，保证不丢时长。 */
function toFrame(seconds: number, fps: number, mode: 'floor' | 'ceil'): number {
  const f = seconds * fps;
  return mode === 'floor' ? Math.floor(f) : Math.ceil(f);
}

/** 把 `HH:MM:SS,mmm` 形式的组转成秒。 */
function groupsToSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/**
 * 剥掉单条 cue 文本里的非台词内容。
 *
 * 逐行处理而非整块正则 —— 整块正则会误伤「他说的那句话里有括号」这类正常台词。
 */
function stripNonSpeech(text: string): string {
  return text
    .split(/\r?\n/u)
    .filter((line) => {
      const t = line.trim();
      if (t === '') return false; // 丢空行
      // 形如 `张三：` 的说话人前缀（冒号前不超过 8 个字符）
      if (/^[^:：]{1,8}[:：]\s*$/u.test(t)) return false;
      if (NON_SPEECH_RE.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

/**
 * 解析 SRT 文件。
 *
 * @param file   SRT 路径
 * @param fps    帧率（用于把秒转帧）
 * @returns 按出现顺序排列的 cue；`text` 已剥离非台词内容
 */
export function parseSrt(file: string, fps: number): SrtCue[] {
  let raw: string;
  try {
    // 'utf8' 会保留 BOM，故显式剥掉
    raw = fs.readFileSync(file, 'utf8').replace(/^﻿/u, '');
  } catch (e) {
    throw new ConfigError(
      `读不到 SRT 文件：${file}\n${(e as Error).message}\n` +
        `提示：SRT 是强制对齐的**文本权威**（B2-fix / M-1），必须提供。`,
    );
  }

  const lines = raw.split(/\r?\n/u);
  const cues: SrtCue[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 跳过空行与纯序号行，直到找到时间戳行
    if (line.trim() === '' || /^\d+$/u.test(line.trim())) {
      i += 1;
      continue;
    }

    const m = TIME_LINE.exec(line);
    if (!m) {
      throw new ConfigError(
        `SRT 第 ${i + 1} 行既不是序号也不是时间戳：${JSON.stringify(line)}\n` +
          `期望形如：00:00:01,500 --> 00:00:03,000\n` +
          `提示：SRT 是「文本权威」（M-1），格式错误必须显式失败，不能当成空字幕继续。`,
      );
    }

    const fromSec = groupsToSeconds(m[1]!, m[2]!, m[3]!, m[4]!);
    const toSec = groupsToSeconds(m[5]!, m[6]!, m[7]!, m[8]!);
    if (toSec < fromSec) {
      throw new ConfigError(
        `SRT 第 ${i + 1} 行的结束时间早于开始时间：${line.trim()}\n` +
          `提示：本项目**不使用 SRT 的时间戳**（B2-fix），但格式错误说明文件不可信，须修。`,
      );
    }

    // 时间戳行之后：可能有一行文本，也可能是多行
    i += 1;
    const body: string[] = [];
    while (i < lines.length) {
      const t = lines[i] ?? '';
      if (t.trim() === '' || TIME_LINE.test(t)) break;
      body.push(t);
      i += 1;
    }

    const text = stripNonSpeech(body.join('\n'));
    // 剥完没内容 → 不是台词 cue，直接丢弃（不占cue 序号）
    if (text === '') continue;

    cues.push({
      index: cues.length,
      fromFrame: toFrame(fromSec, fps, 'floor'),
      toFrame: toFrame(toSec, fps, 'ceil'),
      text,
      /** 原始时间（秒）。仅供人工对账用，**不参与任何下游判定**。 */
      srtFromSec: Number(fromSec.toFixed(3)),
      srtToSec: Number(toSec.toFixed(3)),
    });
  }

  if (cues.length === 0) {
    throw new ConfigError(
      `SRT 解析结果为空：${file}\n` +
        `可能原因：文件为空 / 全是说话人标签与注释行 / 格式不是 SRT。\n` +
        `提示：SRT 是「文本权威」（M-1），空文本会导致后续文本对齐无据可依。`,
    );
  }

  // 帧区间必须单调且非空，否则时序校验会误报
  for (let k = 1; k < cues.length; k += 1) {
    const prev = cues[k - 1]!;
    const cur = cues[k]!;
    if (cur.fromFrame <= prev.fromFrame) {
      throw new ConfigError(
        `SRT 第 ${cur.index + 1} 条（${prev.index + 1}→${cur.index + 1}）的时间未前进：` +
          `[${prev.fromFrame}, ${prev.toFrame}] → [${cur.fromFrame}, ${cur.toFrame}]。\n` +
          `提示：SRT 时间戳虽不参与判定，但**顺序错乱通常意味着文件损坏**，须修。`,
      );
    }
  }

  return cues;
}

/** 剥掉单条 cue 里的非台词内容（供单测直接调用）。 */
export const __test__ = { stripNonSpeech };
