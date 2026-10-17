/**
 * 镜头切分 —— 用 ffmpeg `scdet` 检测场景变更点，产出 Shot 的帧区间。
 *
 * ── 为什么需要这一步（此前是规划盲区）────────────────────────────
 * `02-perceive` 的 `shots.json` 要求 `fromFrame` / `durationInFrames`，
 * 但检测模型只回答「这一帧有没有人脸」，回答不了「这是第几个镜头」。
 * 没有切分，检测结果**无处安放**：内置 perceive 写不出合法的 shots.json。
 * 选型报告（2026-10-16）只覆盖「检测用哪个模型」，未涉及镜头切分。
 *
 * ── 阈值取值依据（2026-10-17 实测）────────────────────────────────
 * 素材：`TestResources/kukini.mp4`，1920×1080 @ 59.94fps，6667 帧（约 111s），单人口播 + 产品特写。
 *
 *   | 阈值 | 切点数 | 目视抽帧核验 |
 *   |------|--------|--------------|
 *   | 10   | 15     | 逐点抽前后帧确认 **15/15 全为真实镜头切换**，无漏检 |
 *   | 5    | 17     | 多出 2 个（score 6.53 @83.88s、5.83 @105.31s）—— 抽帧显示是**同一机位内的人物抬手/表情变化**，属过检 |
 *
 * ⇒ **默认 10**。换素材类型（快剪、大量转场、频繁运镜）时应重新校准：
 * 阈值越低越敏感，会把「镜头内的剧烈动作」也当成切点。
 *
 * ── 切点时间的语义 ────────────────────────────────────────────────
 * `lavfi.scd.time` 是**新镜头的首帧**显示时间。实测 8.391717s × 59.94 ≈ 503 帧，
 * 抽帧确认第 502 帧仍是旧镜头、第 504 帧已是新镜头。
 */

import { spawnSync } from 'node:child_process';
import { ConfigError } from '../core/exit-code.ts';
import { log } from '../core/log.ts';

/** scdet 默认阈值。依据见文件头实测表。 */
export const DEFAULT_SCDET_THRESHOLD = 10;

export interface ShotCut {
  /** 新镜头首帧的时间（秒），来自 ffmpeg `lavfi.scd.time`。 */
  timeSec: number;
  /** 场景变化分数（0–100），越高越确定。 */
  score: number;
  /** 换算后的帧号（四舍五入）。 */
  frame: number;
}

export interface ShotSpan {
  /** `s0` / `s1` … 与 demo 夹具的命名一致。 */
  id: string;
  fromFrame: number;
  durationInFrames: number;
}

export interface DetectCutOptions {
  /** scdet 阈值，0–100。默认 {@link DEFAULT_SCDET_THRESHOLD}。 */
  threshold?: number;
  /**
   * 最短镜头长度（帧）。短于它的相邻切点会被合并，避免闪白/闪黑造成碎片 shot。
   * 默认 1 —— 即只去掉零长度与重复切点，**不擅自丢弃真实短镜头**。
   */
  minShotFrames?: number;
}

/** 解析 ffmpeg 日志里的 scdet 行。抽成纯函数以便单测。 */
export function parseScdetLog(logText: string, fps: number): ShotCut[] {
  const re = /lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g;
  const out: ShotCut[] = [];
  for (const m of logText.matchAll(re)) {
    const score = Number.parseFloat(m[1]!);
    const timeSec = Number.parseFloat(m[2]!);
    if (!Number.isFinite(score) || !Number.isFinite(timeSec)) continue;
    out.push({ timeSec, score, frame: Math.round(timeSec * fps) });
  }
  return out.sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * 把切点转成首尾相接的 Shot 帧区间。
 *
 * 边界始终包含 0 与 totalFrames；越界切点（<=0 或 >=totalFrames）被丢弃，
 * 重复帧号去重 —— 否则会产出 duration 为 0 的 shot（下游 schedule 会算出空区间）。
 */
export function buildShotSpans(
  cuts: ReadonlyArray<Pick<ShotCut, 'frame'>>,
  totalFrames: number,
  opts: DetectCutOptions = {},
): ShotSpan[] {
  const minShot = Math.max(1, opts.minShotFrames ?? 1);
  if (totalFrames <= 0) return [];

  let frames = [...new Set(cuts.map((c) => c.frame))]
    .filter((f) => Number.isFinite(f) && f > 0 && f < totalFrames)
    .sort((a, b) => a - b);

  if (minShot > 1) {
    // 贪心合并：与上一个保留边界距离不足 minShot 的切点丢弃（保留更早的）
    const kept: number[] = [];
    for (const f of frames) {
      const prev = kept.length > 0 ? kept[kept.length - 1]! : 0;
      if (f - prev >= minShot) kept.push(f);
    }
    // 🔴 尾部同样要卡下限：只检查「切点之间」会留下一个超短尾段
    //    （实测 kukini 的 6651 帧切点，距末尾仅 16 帧 ⇒ 会产出 0.27s 的黑场 shot）。
    while (kept.length > 0 && totalFrames - kept[kept.length - 1]! < minShot) {
      kept.pop();
    }
    frames = kept;
  }

  const bounds = [0, ...frames, totalFrames];
  const spans: ShotSpan[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i]!;
    const to = bounds[i + 1]!;
    if (to <= from) continue;
    spans.push({ id: `s${spans.length}`, fromFrame: from, durationInFrames: to - from });
  }
  return spans;
}

/**
 * 调 ffmpeg 扫描整片，返回场景切点。
 *
 * 用 `spawnSync` 而非 `execFileSync`：ffmpeg 把 scdet 日志写到 **stderr**，
 * 只有 spawnSync 能同时拿到 stdout / stderr 且不抛异常。
 */
export function detectSceneCuts(
  videoPath: string,
  fps: number,
  opts: DetectCutOptions = {},
): ShotCut[] {
  const threshold = opts.threshold ?? DEFAULT_SCDET_THRESHOLD;
  const args = [
    '-hide_banner',
    '-nostats',
    '-i',
    videoPath,
    '-an',
    '-vf',
    `scdet=threshold=${threshold}`,
    '-f',
    'null',
    '-',
  ];

  const r = spawnSync('ffmpeg', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (r.error) {
    throw new ConfigError(
      `镜头切分失败：无法调用 ffmpeg（${r.error.message}）\n` +
        `  需要系统安装 ffmpeg；切分是 perceive 的前置（shots.json 需要 fromFrame）。`,
    );
  }
  if (r.status !== 0) {
    throw new ConfigError(
      `镜头切分失败：ffmpeg 退出码 ${r.status}\n` +
        `  原文（末尾）：${(r.stderr ?? '').trim().split('\n').slice(-3).join(' | ')}`,
    );
  }

  const cuts = parseScdetLog(`${r.stderr ?? ''}\n${r.stdout ?? ''}`, fps);
  log.info(`镜头切分：阈值 ${threshold}，检出 ${cuts.length} 个切点`);
  return cuts;
}

/** 一步到位：视频 → Shot 帧区间。 */
export function detectShotSpans(
  videoPath: string,
  fps: number,
  totalFrames: number,
  opts: DetectCutOptions = {},
): { cuts: ShotCut[]; spans: ShotSpan[] } {
  const cuts = detectSceneCuts(videoPath, fps, opts);

  // 🔴 端到端默认合并 **短于 1 秒** 的碎片 shot。依据（2026-10-17 实测 kukini.mp4）：
  //    片尾有一段 16 帧（0.27s）的**黑场**，scdet 如实把它判为一次场景变更
  //    ⇒ 切出 `s15 fromFrame=6651 duration=16`。这类碎片有两个实际危害：
  //    ① `DEFAULT_FRAME_INTERVAL_SEC = 1.5s` 的抽帧**抽不到任何一帧** ⇒ 该 shot 永远没有检测结果；
  //    ② 下游按 shot 取并集时它是空集，只会制造噪声。
  //    注意 `buildShotSpans` 自身默认仍是 1（纯函数不替调用方做主、不丢真实短镜头），
  //    合并策略只在这里生效，且可由调用方用 `minShotFrames` 覆盖。
  const minShotFrames = opts.minShotFrames ?? Math.max(1, Math.round(fps));
  const spans = buildShotSpans(cuts, totalFrames, { ...opts, minShotFrames });

  if (cuts.length + 1 > spans.length) {
    log.info(
      `镜头切分：合并 ${cuts.length + 1 - spans.length} 个短于 1s 的碎片 shot（原 ${cuts.length + 1} → ${spans.length}）`,
    );
  }
  return { cuts, spans };
}
