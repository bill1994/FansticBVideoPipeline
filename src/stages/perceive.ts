/**
 * Stage 2 · perceive —— 抽帧、主体检测、安全区与区域预算基线。
 *
 * 铁律（D1 / D2 / D5 / F6）：
 *  1. 遮挡容忍度是**向量**：各级区域预算独立，算的是「各拿了多少额度」
 *  2. 安全区 ≠ 主体 bbox，取 **bbox 上部**；**按 shot 取并集**，不逐帧跟随
 *  3. 主体不在场的 shot → 安全区为空（全画面可行域）
 *  4. 手持物走 **shot 级时间累积**，不做逐帧跟踪
 *  5. B-roll 按 shot 显著性峰值区自动框，**不要求人工标注**
 *
 * **本阶段无硬阻断**：检测低置信走 `lowConfidence: true` + W-F6-01 告警，
 * 交给人工在编辑页兜底。唯一必须停的情况是**前置输入缺失**。
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_FRAME_INTERVAL_SEC, STAGES } from '../core/config.ts';
import { ConfigError } from '../core/exit-code.ts';
import { exists, jobDir, readJson, stageDir, writeJson } from '../core/io.ts';
import { log } from '../core/log.ts';
import type { PerceiveRegion, PerceiveResult, RegionKind, Shot, SourceManifest } from '../core/types.ts';
import { OCCLUSION_BUDGET } from '../core/config.ts';

const REGION_KINDS: RegionKind[] = ['face', 'handheld', 'broll'];

export interface PerceiveOptions {
  jobId: string;
  jobsDir?: string;
  force?: boolean;
  /** 抽帧密度（秒）。默认 1.5s；E4 明确「密度本就是参数，可改密/疏」。 */
  frameIntervalSec?: number;
}

/**
 * 外部感知器适配。
 *
 * 本仓库**不内置**检测模型（人体/关键点/显著性），只定义输入输出契约：
 *
 *   PERCEIVER_CMD 环境变量，占位符 {video} {frames_dir} {out_dir} {fps} {interval}
 *   命令须写出 {out_dir}/shots.json 与 {out_dir}/regions.json
 */
export function runExternalPerceiver(
  videoPath: string,
  framesDir: string,
  outDir: string,
  fps: number,
  interval: number,
): void {
  const tpl = process.env.PERCEIVER_CMD;
  if (!tpl) {
    throw new ConfigError(
      '未配置 PERCEIVER_CMD —— 主体/手持物/B-roll 检测需要外部感知器。\n' +
        '  示例：PERCEIVER_CMD="python tools/perceive.py --video {video} --frames {frames_dir} --out {out_dir} --fps {fps} --interval {interval}"\n' +
        '  契约：写出 {out_dir}/shots.json（Shot[]）与 {out_dir}/regions.json（PerceiveRegion[]）\n' +
        '  提示：安全区取 bbox 上部、按 shot 取并集；手持物走 shot 级累积（D2/D5）。',
    );
  }
  const cmd = tpl
    .replaceAll('{video}', videoPath)
    .replaceAll('{frames_dir}', framesDir)
    .replaceAll('{out_dir}', outDir)
    .replaceAll('{fps}', String(fps))
    .replaceAll('{interval}', String(interval));
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync(cmd, { shell: true, stdio: 'inherit' });
}

/** 校验感知产物的形状；不合规即报错，不替它兜底填值。 */
export function assertPerceiveShape(result: PerceiveResult): void {
  if (!Array.isArray(result.shots) || !Array.isArray(result.regions)) {
    throw new ConfigError('感知产物必须含 shots[] 与 regions[]');
  }
  for (const s of result.shots) {
    if (typeof s.id !== 'string' || typeof s.fromFrame !== 'number') {
      throw new ConfigError(`shot 缺 id/fromFrame：${JSON.stringify(s)}`);
    }
    if (s.safeArea !== null && (!Array.isArray(s.safeArea) || s.safeArea.length !== 4)) {
      throw new ConfigError(`shot ${s.id} 的 safeArea 必须是 [x,y,w,h] 或 null`);
    }
  }
  for (const r of result.regions) {
    if (!REGION_KINDS.includes(r.kind)) {
      throw new ConfigError(
        `region ${r.id} 的 kind "${r.kind}" 非法 —— 必须是 ${REGION_KINDS.join(' / ')}`,
      );
    }
    if (!Array.isArray(r.box) || r.box.length !== 4) {
      throw new ConfigError(`region ${r.id} 的 box 必须是 [x,y,w,h]`);
    }
  }
}

/** 预算表快照 —— 供下游报告引用，避免「预算从哪来」说不清。 */
export function budgetSnapshot(): Record<RegionKind, number> {
  return { ...OCCLUSION_BUDGET };
}

export interface PerceiveOutcome {
  result: PerceiveResult;
  lowConfidenceShots: string[];
}

export function runPerceive(opts: PerceiveOptions): PerceiveOutcome {
  const base = jobDir(opts.jobId, opts.jobsDir);
  const dir = stageDir(opts.jobId, STAGES.perceive, opts.jobsDir);
  const shotsFile = path.join(dir, 'shots.json');
  const regionsFile = path.join(dir, 'regions.json');

  if (exists(shotsFile) && exists(regionsFile) && !opts.force) {
    log.info('02-perceive 已是不可变快照，沿用（加 --force 可重跑）');
    const shots = readJson<Shot[]>(shotsFile);
    const regions = readJson<PerceiveRegion[]>(regionsFile);
    const source = readJson<SourceManifest>(path.join(base, STAGES.input, 'source.json'));
    const result: PerceiveResult = { fps: source.fps, shots, regions };
    assertPerceiveShape(result);
    return {
      result,
      lowConfidenceShots: shots.filter((s) => s.lowConfidence).map((s) => s.id),
    };
  }

  const source = readJson<SourceManifest>(path.join(base, STAGES.input, 'source.json'));
  const videoPath = path.join(base, STAGES.input, source.video);
  if (!fs.existsSync(videoPath)) {
    throw new ConfigError(`素材不存在：${videoPath} —— 阶段前置条件未满足，停。`);
  }

  const interval = opts.frameIntervalSec ?? DEFAULT_FRAME_INTERVAL_SEC;
  log.stage('perceive', `抽帧（每 ${interval}s，可调）+ 主体/手持物/B-roll 检测`);

  const framesDir = path.join(dir, 'frames');
  runExternalPerceiver(videoPath, framesDir, dir, source.fps, interval);

  const shots = readJson<Shot[]>(path.join(dir, 'shots.json'));
  const regions = readJson<PerceiveRegion[]>(path.join(dir, 'regions.json'));
  const result: PerceiveResult = { fps: source.fps, shots, regions };
  assertPerceiveShape(result);

  if (result.fps !== source.fps) {
    throw new ConfigError(`感知产物 fps ${result.fps} 与素材清单 ${source.fps} 不一致`);
  }

  return {
    result,
    lowConfidenceShots: shots.filter((s) => s.lowConfidence).map((s) => s.id),
  };
}
