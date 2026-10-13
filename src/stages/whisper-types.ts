/**
 * `@remotion/install-whisper-cpp` 的最小类型声明。
 *
 * 只声明本项目实际用到的字段 —— **刻意不 import 该包的类型**：
 * 那个包的类型会随版本变动，而本项目的产物契约必须稳定
 * （E3「版本锚定」的精神：类型也是契约的一部分）。
 *
 * 来源：官方文档 `transcribe()` 的 `TranscriptionJson`（v4.0.131+），
 * 实测于 whisper.cpp 1.5.5 + model `base` + `tokenLevelTimestamps: true`。
 */

/** 逐 token 条目。 */
export interface WhisperToken {
  /** token 文本。结构性标记形如 `[_BEG_]`。 */
  text: string;
  /** 字符串形式的时间戳，形如 `"00:00:12,340"`。 */
  timestamps?: { from: string; to: string };
  /** 毫秒偏移。⚠️ 实测发现无语音时会兜底成全 0，**不可信**。 */
  offsets?: { from: number; to: number };
  /** token id。 */
  id?: number;
  /** 解码概率 0–1。⚠️ 不是「这段是否可信」的指标。 */
  p?: number;
  /**
   * `--dtw` 对齐得到的起始毫秒。
   * 🔴 **`-1` 表示「无对齐时间」**，不是「负时间」。
   */
  t_dtw?: number;
}

export interface WhisperTranscriptionItem {
  timestamps?: { from: string; to: string };
  offsets?: { from: number; to: number };
  text?: string;
  /** 仅当 `tokenLevelTimestamps: true` 时存在。 */
  tokens?: WhisperToken[];
}

export interface WhisperTranscription {
  systeminfo?: string;
  /** 本项目不用（音频特征张量），仅记录形状。 */
  model?: unknown;
  params?: { model?: string; language?: string; translate?: boolean };
  result?: { language?: string };
  transcription: WhisperTranscriptionItem[];
}
