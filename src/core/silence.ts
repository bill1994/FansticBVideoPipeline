/**
 * 静音检测 —— `M-1d` 判据与 `M-1f` Q2 校验的**唯一音频证据来源**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须用音频、不能用 SRT
 *
 * 这条判据的作用是「检查 SRT 划得对不对」。若改用 SRT 自己的时间戳当基准，
 * 等于让**被检查者给自己作证** —— 无论 SRT 划得多离谱都会自洽通过。
 * 静音来自音频，是独立于 SRT 的客观证据，���此才有校验价值。
 *
 * 🔴 同理，这**不是**「防范 SRT 不可信」——「不信任 SRT 时间戳」那条铁律
 *    已于 2026-10-19 撤回（见登记册 B2-fix 更正）。本模块的唯一职责是
 *    **捕获用户手编 SRT 时的划错**，以及**度量词落点漂移**（`M-1d`）。
 *
 * ─────────────────────────────────────────────────────────────
 * 口径
 *
 * 静音时长按**秒**计（ffmpeg 的输出单位），与 `srtFromSec`/`srtToSec` 同单位，
 * 可直接比较。帧相关计算由调用方在 `word-timeline.ts` 里做。
 */

import { spawnSync } from 'node:child_process';
import { SILENCE } from './config.ts';

/** 一段静音的起止（秒）。 */
export type SilenceSpan = [number, number];

/** ffmpeg 的一行 stderr 输出，形如：
 *  `[Parsed_silencedetect_0 @ 0x…] silence_start: 8.389875`
 *  `[Parsed_silencedetect_0 @ 0x…] silence_end: 15.125438 | silence_duration: 6.735563`
 */
const RE_START = /silence_start:\s*(-?[\d.]+)/;
const RE_END = /silence_end:\s*(-?[\d.]+)/;

/**
 * 从 ffmpeg 的 stderr 文本解析静音区间。
 *
 * 抽成纯函数是为了能单测 —— 真实 ffmpeg 输出要跑一次 100 秒的视频才有，
 * 放进测试里既慢又脆。同 `doctor.ts` 的 `DoctorDeps` 思路：**依赖注入**。
 *
 * ⚠️ 只认 `silence_start` / `silence_end` 成对出现的行；ffmpeg 对**末尾**静音
 *    只输出 `silence_start` 而没有 `silence_end`（因为它不知道视频何时结束），
 *    那种情况这里会丢弃 —— 宁可漏报也不臆造区间。
 */
export function parseSilences(stderr: string): SilenceSpan[] {
  const out: SilenceSpan[] = [];
  let pending: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const mStart = RE_START.exec(line);
    if (mStart) {
      pending = Number(mStart[1]);
      continue;
    }
    const mEnd = RE_END.exec(line);
    if (mEnd && pending !== null) {
      out.push([pending, Number(mEnd[1])]);
      pending = null;
    }
  }
  return out;
}

/** 探测静音区间的执行体。默认调 ffmpeg；测试可注入。 */
export type SilenceRunner = (wavPath: string) => string;

/** 用 ffmpeg 的 `silencedetect` 滤镜探测静音。 */
export const ffmpegSilenceRunner: SilenceRunner = (wavPath) => {
  const r = spawnSync(
    'ffmpeg',
    [
      '-i', wavPath,
      '-af', `silencedetect=noise=${SILENCE.noiseDb}dB:d=${SILENCE.minDurationSec}`,
      '-f', 'null', '-',
    ],
    { encoding: 'utf8' },
  );
  // 🔴 不因 ffmpeg 退出码非 0 而抛错：silencedetect 的日志走 stderr，
  //    而 ffmpeg 在滤镜正常工作时也可能给非 0。解析不出区间时返回空，
  //    上层据此「不做校验」而非「校验失败」—— 判据缺失不该阻断管线。
  return `${r.stderr ?? ''}\n${r.stdout ?? ''}`;
};

/**
 * 探测并返回静音区间。ffmpeg 不可用时返回空数组（判据缺失，不阻断）。
 */
export function detectSilences(wavPath: string, runner: SilenceRunner = ffmpegSilenceRunner): SilenceSpan[] {
  try {
    return parseSilences(runner(wavPath));
  } catch {
    return [];
  }
}

/**
 * 落在静音段内的**词时长占比** —— `M-1d` 的门控判据。
 *
 * 正常素材应 ≈0；kukini 修复前 ≈5.9%（9 个词被塞进 6.74 秒静音）。
 *
 * ⚠️ 分母是**词的时长总和**而非个数 —— 一个被拉长的词会比一个短词占比更大，
 *    而这正是我们要度量的东西（时间被挪走了多少）。
 */
export { silentWordRatio } from './word-timeline.ts';