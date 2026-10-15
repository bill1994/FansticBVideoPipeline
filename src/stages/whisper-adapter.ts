/**
 * whisper.cpp 适配器 —— M-1（方案 b）的**第一步**：只出时间，不做文本对齐。
 *
 * 来源：M-1 裁决（登记册，2026-10-13）。分两步走：
 * · **第一步（本文件）**：whisper 出逐 token 时间戳 → 落盘。
 *   目的是**先看清中文分词的实际形态**，再据此写第二步的 DP 对齐。
 * · **第二步（待做）**：`text-align.ts`，把这些 token 对齐回 SRT 词序列。
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────
 * `align.ts` 已 190+ 行且职责已满（抽音轨 / 调外部对齐器 / 门控 / 落盘）。
 * whisper 的调用与 token 清洗自成一块，且**需要 import 一个原生包**——
 * 放进 `align.ts` 会让「不装 whisper 也能跑」的适配器路径被迫加载它。
 *
 * ── 两个实测踩到的坑（2026-10-13，纯音调实测）─────────────────
 * **坑1：`t_dtw === -1` 表示「这个 token 没有对齐时间」**，不是"时间为 -1 秒"。
 * 实测 9 个 token 里 2 个是 -1（22%）。`offsets` 字段看起来有值但全是 `00:00:00,000`
 * ——那是 whisper 在无语音时的兜底，**不可信**。
 * ⇒ 必须显式过滤 `-1`，否则会产出 startFrame 为负或全零的词条，
 *   而下游时序校验只查区间，查不出"全是0"这种整体性错误。
 *
 * **坑2：噪声输入会产生噪声 token**。纯音调实测输出 `[_BEG_]`、`(`、
 * 字、幕、`:`、`J` 等无意义片段，且 `p` 高达 0.9996（**很自信地在胡说**）。
 * ⇒ 不能拿 `p` 当可信度闸门——`p` 衡量的是「模型对自身解码有多自信」，
 *   不是「这段是不是真语音」。这与 M-1c 的结论一致：`meanConfidence`
 *   **测不到**「SRT 与音频是否对得上」，同理也测不到「这压根不是语音」。
 *   真正的把关在 `alignedRatio`（第二步）。
 *
 * ── 环境要求 ──────────────────────────────────────────────────
 * · `whisper.cpp/` 目录（由 `installWhisperCpp()` 装，见 tools/setup-whisper.mts）
 * · 模型文件 `whisper.cpp/ggml-<model>.bin`
 * ⚠️ 模型从 HuggingFace 下载，**国内网络需走 hf-mirror**：
 *   `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`
 * · Windows 走预编译二进制（≤1.6.0），**不需要 cmake / Python**
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Language } from '@remotion/install-whisper-cpp';
import { ConfigError } from '../core/exit-code.ts';
import { log } from '../core/log.ts';
import { normalizeToken } from '../core/zh-normalize.ts';
import type { WhisperToken, WhisperTranscription } from './whisper-types.ts';

/** whisper.cpp 版本锚定 —— 1.5.5 是首个支持 `t_dtw`（逐 token 时间戳）的版本。 */
export const WHISPER_CPP_VERSION = '1.5.5';

/**
 * 🔴 `t_dtw` 的单位：**10ms 帧**，不是毫秒。
 *
 * 2026-10-14 真实素材实测（`TestResources/kukini.mp4` 前 30s + 中文 SRT）：
 * · `t_dtw` 值域 `[36, 2996]`，而音频长 30000ms ⇒ 最大值恰为 1/10
 * · `|t_dtw×10 − timestamps.from|`误差：中位 **180ms**、p90 380ms
 * · 而当毫秒直接用：`|t_dtw − timestamps.from|` 中位 **1462ms**、max 2696ms
 *
 * ⚠️ 这个错误极隐蔽：`startMs` 与 `endMs` 量纲不一致，但两者都「看起来像毫秒」，
 * 且下游时序校验比对的是 `fromFrame` 与目标词区间 —— **同源错误会互相抵消，
 * 校验全绿而结果全错**。这与 2026-10-13 记录的「静默假绿」同类。
 *
 * ⚠️ 只有 `t_dtw` 需要换算；`timestamps.to` 本身就是毫秒字符串，直接用。
 */
export const DTW_FRAME_MS = 10;

/**
 * 词条结束时间的下界（毫秒）。
 *
 * 🔴 坑4（2026-10-14 真实素材实测）：`timestamps.to` 与 `t_dtw` 是两套独立估计，
 * 会出现 `endMs < startMs`（实测 119 个 token 中 56 个，占 47%，最大负值 −360ms）。
 * 夹取时用它。取 40ms = 30fps 下约 1.2 帧，够短，不掩盖真实时长。
 */
const MIN_DURATION_MS = 40;

/** whisper.cpp 支持的模型名。刻意窄化，让编译器替我们守住取值域。 */
export type WhisperModelName =
  | 'tiny' | 'tiny.en'
  | 'base' | 'base.en'
  | 'small' | 'small.en'
  | 'medium' | 'medium.en'
  | 'large-v1' | 'large-v2' | 'large-v3' | 'large-v3-turbo';

/**
 * 🔴 **必须显式传，禁 `auto`** —— 这是 M-1 裁决明写的一条：
 * 自动检测一旦在边界素材上翻转，`words[]` 整列变化，
 * 所有已归档 storyboard 的 `word:N` **静默重指向**，而报告照样全绿。
 * 与确定性红线同级。
 *
 * 写法说明：从官方 `Language` union **Exclude 掉 `'auto'`**，
 * 而不是自己抄一份枚举——官方类型随版本更新，抄一份必然漂移。
 * 好处是 `'auto'` 在**编译期就通不过**，不靠注释提醒。**类型即纪律**。
 */
export type WhisperLanguage = Exclude<Language, 'auto'>;

/**
 * 默认模型。`base` 是精度/体积折中的起点（148MB）。
 *
 * 🔴 **取值待实测**（与 C2-2 一并校准）：中文口语的实际 WER 未测过。
 * `small`（488MB）通常中文明显更准 —— 若首次实测发现识别错字多，
 * 换 small 是第一优先级的调整（只改这一个常量）。
 */
export const WHISPER_MODEL: WhisperModelName = 'base';

/** 本项目素材为中文口播，语言锚定中文（见 `WhisperLanguage` 的说明）。 */
export const WHISPER_LANGUAGE: WhisperLanguage = 'Chinese';

/** 无效 token：whisper 的结构性标记，不是口播内容。 */
const STRUCTURAL = /^\[_(BEG|END|TT_?\d*|SOT|EOT|NO_SPEECH|TRANSLATE|NOT_STAMPED)_\]$/u;

/**
 * 清洗后的词条目 —— **注意这是 token 级，不是 SRT 词级**。
 *
 * ⚠️ `word` 字段在中文下常是 **1–2 个字**（子词），
 *  第二步的 DP 对齐就是要把这些子词映射回 SRT 的完整词。
 * 这个「粒度不一致」是方案 (b) 的核心难点，不是 bug。
 */
export interface WhisperWord {
  /** 该 token 在 whisper 序列中的序号（仅本阶段内有序）。 */
  index: number;
  /** token 文本（子词级）。 */
  word: string;
  /** 起始毫秒。已剔除 `t_dtw === -1` 的无效 token。 */
  startMs: number;
  /** 结束毫秒。 */
  endMs: number;
  /** 解码概率 0–1。**不是「这段是否可信」的指标**（见文件头坑2）。 */
  probability: number;
}

export interface WhisperResult {
  words: WhisperWord[];
  /** 检测到的语言。 */
  language: string;
  /** 原始 token 总数（含被过滤的）。 */
  rawTokenCount: number;
  /** 因 `t_dtw < 0` 被剔除的数量。 */
  droppedNoTime: number;
}

/**
 * whisper.cpp 目录的解析 —— **换机可移植是硬要求**（D7）。
 *
 * 优先级：`WHISPER_CPP_PATH` 环境变量 → **仓库根 / whisper.cpp**。
 *
 * 🔴 为什么默认值不能是「开发机上的盘符绝对路径」（旧实现正是如此）：
 *    用户会换电脑使用（优化计划书 C2 / 问题 8）—— 绝对路径换机即崩，
 *    且崩法只是一句「找不到可执行文件」，看不出是路径被写死了。
 *    仓库根由**本文件位置**推导（`src/stages/` 上溯两级），
 *    不依赖 `process.cwd()`（从任意 cwd 调用结果一致）。
 *
 * ⚠️ 推导依据是「本文件位于 `src/stages/` 第 2 层」—— 若未来调整本文件的
 *    目录层级，必须同步修改 `../../` 的级数。
 */
export function resolveWhisperCppRoot(): string {
  const env = process.env.WHISPER_CPP_PATH;
  if (env !== undefined && env.trim() !== '') return env;
  return fileURLToPath(new URL('../../whisper.cpp', import.meta.url));
}

/** 解析目录并检查存在（`transcribeWhisper` 用；内置对齐器用 `resolveWhisperCppRoot` + 各自的文件级检查）。 */
function resolveWhisperPath(): string {
  const p = resolveWhisperCppRoot();
  if (!fs.existsSync(p)) {
    throw new ConfigError(
      `找不到 whisper.cpp 目录：${p}\n` +
        `  装它：node tools/setup-whisper.mts（装到仓库根 whisper.cpp/）\n` +
        `  或设置 WHISPER_CPP_PATH 指向已有目录。\n` +
        `  Windows 走预编译二进制，不需要 cmake / Python。`,
    );
  }
  return p;
}

function assertModelPresent(whisperPath: string, model: string): void {
  const bin = path.join(whisperPath, `ggml-${model}.bin`);
  if (!fs.existsSync(bin)) {
    throw new ConfigError(
      `找不到模型文件：${bin}\n` +
        `  模型从 HuggingFace 下载，**国内网络须走 hf-mirror**：\n` +
        `    https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin\n` +
        `  或跑 node tools/setup-whisper.mts（会自动处理镜像）。`,
    );
  }
}

/**
 * 调 whisper.cpp 转写，返回清洗后的 token 序列。
 *
 * ⚠️ 本函数**不做文本对齐**（那是第二步）。它产出的是 whisper 听写出来的
 * token + 时间戳 —— 仅供「看清中文分词形态」与校准阈值用。
 * 在第二步落地前，**这些 token 不得直接进storyboard**：
 * 那等于方案 (a)（文本权威归 whisper），已被 M-1 明确否决。
 */
export async function transcribeWhisper(
  wavPath: string,
  opts: { model?: WhisperModelName; language?: WhisperLanguage } = {},
): Promise<WhisperResult> {
  const whisperPath = resolveWhisperPath();
  const model = opts.model ?? WHISPER_MODEL;
  const language = opts.language ?? WHISPER_LANGUAGE;
  assertModelPresent(whisperPath, model);

  if (!fs.existsSync(wavPath)) {
    throw new ConfigError(
      `找不到待转写的音频：${wavPath}\n` +
        `  应为 align 阶段抽出的 16kHz 单声道 wav。`,
    );
  }

  // 动态 import：不装 whisper 也能跑纯 JSON→JSON 的校验链路
  const { transcribe } = await import('@remotion/install-whisper-cpp');

  log.info(`whisper 转写中（模型 ${model}，语言 ${language}）…`);

  const res = (await transcribe({
    inputPath: wavPath,
    whisperPath,
    whisperCppVersion: WHISPER_CPP_VERSION,
    model,
    tokenLevelTimestamps: true,
    language,
    printOutput: false,
  })) as WhisperTranscription;

  const all: WhisperToken[] = (res.transcription ?? []).flatMap((it) => it.tokens ?? []);

  const words: WhisperWord[] = [];
  let droppedNoTime = 0;
  let clampedNegative = 0;
  let normalizedChars = 0;

  for (const t of all) {
    const raw = (t.text ?? '').trim();
    // 结构性标记（[_BEG_] 等）与纯空白不是口播内容
    if (raw === '' || STRUCTURAL.test(raw)) continue;
    // 🔴 坑5（2026-10-14 实测）：small/base 输出**繁体中文字形**（令/整/雙…），
    // 而 SRT 台本是简体。若不归一，第二步 DP 会在这些字上全部错位，
    // alignedRatio 趋近 0，M-1c 门控就会把「编码不一致」误报成「数据质量差」。
    // normalizeToken 保证 **1 字符 ↔ 1 字符**，不改变长度 ⇒ 不破坏 index 对位。
    const text = normalizeToken(raw);
    if (text !== raw) normalizedChars += 1;
    // 🔴 坑1：t_dtw === -1 = 无对齐时间。必须过滤，不能当 0 用。
    // 🔴 坑3（2026-10-14 真实素材实测）：t_dtw 单位是 10ms 帧，须乘 DTW_FRAME_MS。
    const rawStart = t.t_dtw;
    if (typeof rawStart !== 'number' || rawStart < 0) {
      droppedNoTime += 1;
      continue;
    }
    const start = rawStart * DTW_FRAME_MS;
    // 🔴 坑4（2026-10-14 实测）：`timestamps.to` 与 `t_dtw` 是**两套独立估计**，
    // 前者是 token 级边界、后者是 DTW 帧对齐点，精度不同 ⇒ 会出现 endMs < startMs。
    // 实测 119 个 token 中有 56 个（47%）如此，最大负值 −360ms。
    // 不能把负时长带进下游：烘焙器会算出负的 durationInFrames。
    //
    // 处置：以 DTW 起点为准（它才是我们信任的那个，见 DTW_FRAME_MS 的说明），
    // 结束时间取 max(上游值, start + 保守下界)。**记入告警**，不静默吞掉。
    const upstreamEnd = parseTimestamp(t.timestamps?.to);
    let end = upstreamEnd ?? start + 200;
    if (end < start) {
      end = start + MIN_DURATION_MS;
      clampedNegative += 1;
    }
    words.push({
      index: words.length,
      word: text,
      startMs: start,
      endMs: end,
      probability: typeof t.p === 'number' ? t.p : 0,
    });
  }

  if (words.length === 0) {
    // 🔴 不返回空数组 —— 空会让下游以为「这段没有台词」。
    // 实测纯音调输入时 whisper 也会输出噪声 token，所以这里通常是
    // 「音频里确实没有可识别的语音」，必须显式失败。
    throw new ConfigError(
      `whisper 未产出任何有效 token（原始 ${all.length} 个，其中 ${droppedNoTime} 个无对齐时间）。\n` +
        `  可能原因：音频无人声 / 音调纯 / 采样率不对 / 模型不匹配。\n` +
        `  注意：**不要**用 p（解码概率）来判断可信度 —— 纯音调实测里噪声 token\n` +
        `  的 p 高达 0.9996。真正的把关是 M-1c 的 alignedRatio（第二步）。`,
    );
  }

  // 🔴 坑5 可见化：归一化改了多少 token 要说出来。
  // 实测比例很高（中文内容下通常 20%~50%），因为 whisper 中文输出默认繁体字形。
  // 若某次突然降到 0，说明模型/参数变了（例如换了已做简体后处理的模型），
  // 那时 `normalizeToken` 的映射表应重新评估，而不是当作「本来就不需要」。
  if (normalizedChars > 0) {
    const pct = ((normalizedChars / words.length) * 100).toFixed(0);
    log.info(
      `已对 ${normalizedChars}/${words.length} 个 token（${pct}%）做繁简/全角归一。\n` +
        `  原因：whisper 中文输出为繁体字形，SRT 台本为简体，不归一会导致第二步 DP 全部错位。`,
    );
  }

  // 🔴 不静默：负时长被夹取过就要说出来。
  // 实测比例高达 47%，若某次突然变成 0 或100%，说明 whisper 版本变了，
  // 两套时间戳的精度关系已改变，须重新评估。
  if (clampedNegative > 0) {
    const pct = ((clampedNegative / words.length) * 100).toFixed(0);
    log.warn(
      `${clampedNegative}/${words.length} 个 token（${pct}%）的 timestamps.to 早于 DTW 起点，` +
        `已按 start + ${MIN_DURATION_MS}ms夹取。\n` +
        `  原因：timestamps.to 是 token 级边界、t_dtw 是 DTW 帧对齐点，两套独立估计精度不同。\n` +
        `  影响：仅影响单token 的 durationInFrames 精度，不影响起点位置。`,
    );
  }

  // 时间必须单调前进，否则后续的 C2 时序校验无从谈起
  for (let i = 1; i < words.length; i += 1) {
    if (words[i]!.startMs < words[i - 1]!.startMs) {
      log.warn(
        `whisper 时间戳非单调（第 ${i} 个 token：${words[i - 1]!.startMs}ms → ` +
          `${words[i]!.startMs}ms）。已保留原值，交由第二步对齐或门控处理。`,
      );
      break;
    }
  }

  return {
    words,
    language: res.result?.language ?? language,
    rawTokenCount: all.length,
    droppedNoTime,
  };
}

/** `"00:00:12,340"` → 毫秒。解析失败返回 null。 */
function parseTimestamp(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\d{1,2}:(\d{2}):(\d{2})[,.](\d{1,3})$/u.exec(v.trim());
  if (!m) return null;
  const [, mm, ss, ms] = m;
  return Number(mm) * 60_000 + Number(ss) * 1000 + Number((ms ?? '0').padEnd(3, '0'));
}
