/**
 * Stage 5 · render —— C6 映射 + 本地渲染。
 *
 * 铁律（C6 / E2 / E3 / F4）：
 *  1. 每 track 一个外层 `<Sequence>`，内层用**相对偏移**；**禁用 `<Series>`**
 *  2. z 序按 `(layer 升序, trackIndex 升序)` 排序后嵌套；**禁用显式 z-index**
 *  3. **双栈分离**：载体类走背景链（串联），叠加类走叠加栈（并列）
 *  4. 确定性红线：动画推进权必须属于 frame，不属于库自己的 ticker
 *  5. 锁 `remotion@4.0.534`，显式 `--gl=angle`（4.0.x 必填）
 *
 * **启动闸**：`04-validate` 报告 `ok !== true` → 拒绝启动。
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { REMOTION_VERSION, STAGES } from '../core/config.ts';
import { ConfigError, StageBlockedError } from '../core/exit-code.ts';
import { exists, jobDir, readJson, stageDir, writeJson } from '../core/io.ts';
import { log } from '../core/log.ts';
import type { ValidateReport } from '../core/report.ts';
import type { SourceManifest, Storyboard } from '../core/types.ts';
import { buildContext } from '../validate/context.ts';
import { isCarrierScope } from '../templates/types.ts';

export interface RenderOptions {
  jobId: string;
  jobsDir?: string;
  /** 只做映射与启动闸检查，不真正渲染（供 CI / 预览）。 */
  dryRun?: boolean;
}

export interface RenderOutcome {
  propsFile: string;
  /** 两层栈的划分结果，便于自检。 */
  stacks: { background: string[]; overlay: string[] };
}

/**
 * 06-review/confirmed.json —— 人工放行记录（C2-4 审计链落点）。
 *
 * `acknowledgedFullscreen` 为【实现期拟定】：D3 要求 fullscreen 一律人工确认，
 * 但未定义「确认」如何表达。此处约定用 item ref 列表承载。
 */
export interface ConfirmedRecord {
  jobId: string;
  stage: 'alignment' | 'storyboard' | 'validate';
  reason: string;
  confirmedBy: string;
  confirmedAt: string;
  overrides?: { itemId: string; field: string; from: unknown; to: unknown }[];
  acknowledgedFullscreen?: string[];
}

export function readConfirmed(jobId: string, jobsDir?: string): ConfirmedRecord | null {
  const f = path.join(jobDir(jobId, jobsDir), STAGES.review, 'confirmed.json');
  return exists(f) ? readJson<ConfirmedRecord>(f) : null;
}

/** 启动闸。返回 null 表示放行；否则返回阻止原因。 */
export function renderGate(jobId: string, jobsDir?: string): string | null {
  const reportFile = path.join(jobDir(jobId, jobsDir), STAGES.validate, 'validate-report.json');
  if (!exists(reportFile)) {
    return '04-validate/validate-report.json 不存在 —— 未跑校验，不得直接渲染';
  }
  const report = readJson<ValidateReport>(reportFile);
  if (!report.ok) {
    return `校验报告 ok=false（error=${report.summary.error}）—— 拒绝启动，先走人工返修回路`;
  }

  // D3：fullscreen 一律人工确认，不设自动放行规则
  const ctx = buildContext(jobId, jobsDir);
  const fullscreenRefs = ctx.scene.filter((s) => s.tpl.scope === 'fullscreen').map((s) => s.ref);
  if (fullscreenRefs.length > 0) {
    const confirmed = readConfirmed(jobId, jobsDir);
    const acked = new Set(confirmed?.acknowledgedFullscreen ?? []);
    const unacked = fullscreenRefs.filter((r) => !acked.has(r));
    if (unacked.length > 0) {
      return (
        `存在未经人工确认的 fullscreen motion：${unacked.join(', ')}\n` +
        `  D3 规定 fullscreen 必然覆盖全画面，一律人工确认、不设自动放行规则。\n` +
        `  请在 06-review/confirmed.json 的 acknowledgedFullscreen 中列出已确认的 item ref。`
      );
    }
  }
  return null;
}

/** 版本锚定自检：主包与官方扩展包必须严格同版本（E3）。 */
export function assertVersionPinned(): void {
  const pkgFile = path.resolve('package.json');
  if (!fs.existsSync(pkgFile)) {
    throw new ConfigError('找不到 package.json —— 无法校验 Remotion 版本锚定');
  }
  const pkg = readJson<{ dependencies?: Record<string, string> }>(pkgFile);
  const deps = pkg.dependencies ?? {};
  for (const [name, range] of Object.entries(deps)) {
    if (name !== 'remotion' && !name.startsWith('@remotion/')) continue;
    if (range.startsWith('^') || range.startsWith('~')) {
      throw new ConfigError(
        `${name} 使用了浮动版本 "${range}" —— E3 要求 --save-exact 锁死精确版，禁 ^（4.0.x patch 每 2–3 天一版，不锁必然漂移）`,
      );
    }
    if (range !== REMOTION_VERSION) {
      throw new ConfigError(
        `${name} 版本为 ${range}，锚定值应为 ${REMOTION_VERSION} —— 官方扩展包必须与主包严格同版本`,
      );
    }
  }
}

/** 把 storyboard 切成两层栈（C6 ③：最易出错处）。 */
export function splitStacks(jobId: string, jobsDir?: string): { background: string[]; overlay: string[] } {
  const ctx = buildContext(jobId, jobsDir);
  const background = ctx.scene.filter((s) => isCarrierScope(s.tpl.scope)).map((s) => s.ref);
  const overlay = ctx.scene.filter((s) => !isCarrierScope(s.tpl.scope)).map((s) => s.ref);
  return { background, overlay };
}

export function runRender(opts: RenderOptions): RenderOutcome {
  const base = jobDir(opts.jobId, opts.jobsDir);
  const outDir = stageDir(opts.jobId, STAGES.render, opts.jobsDir);

  // ── 启动闸 ─────────────────────────────────────────────────
  const blocked = renderGate(opts.jobId, opts.jobsDir);
  if (blocked) throw new StageBlockedError(blocked);

  // ── 版本锚定自检 ───────────────────────────────────────────
  assertVersionPinned();

  const source = readJson<SourceManifest>(path.join(base, STAGES.input, 'source.json'));
  const storyboard = readJson<Storyboard>(path.join(base, STAGES.storyboard, 'storyboard.json'));
  if (storyboard.meta.fps !== source.fps) {
    throw new ConfigError(
      `storyboard.meta.fps (${storyboard.meta.fps}) 与素材 (${source.fps}) 不一致 —— fps 与烘焙绑定，必须重新烘焙`,
    );
  }

  const stacks = splitStacks(opts.jobId, opts.jobsDir);
  log.stage(
    'render',
    `双栈分离：背景链 ${stacks.background.length} 项（串联） / 叠加栈 ${stacks.overlay.length} 项（并列）`,
  );

  fs.mkdirSync(outDir, { recursive: true });
  const propsFile = path.join(outDir, 'render-props.json');
  const videoAbs = path.join(base, STAGES.input, source.video);
  writeJson(propsFile, {
    jobId: opts.jobId,
    fps: source.fps,
    durationInFrames: source.durationInFrames,
    video: path.relative(outDir, videoAbs).replaceAll('\\', '/'),
    // 素材不存在时渲染占位底，而不是让 OffthreadVideo 去解一个空 src。
    // demo job 没有真实视频，靠这条也能把「双栈 / z 序 / 时间映射」结构跑出来。
    hasVideo: fs.existsSync(videoAbs),
    storyboard,
    stacks,
  });

  if (opts.dryRun) {
    log.info(`dry-run：已生成 ${propsFile}，跳过实际渲染`);
    return { propsFile, stacks };
  }

  // ── 实际渲染（必须显式 --gl=angle）─────────────────────────
  const outVideo = path.join(outDir, 'out.mp4');
  const args = [
    'remotion',
    'render',
    'src/remotion/index.ts',
    'Overlay',
    outVideo,
    `--props=${propsFile}`,
    '--gl=angle',
    '--log=verbose',
  ];
  log.info(`npx ${args.join(' ')}`);
  try {
    execFileSync('npx', args, { stdio: 'inherit', shell: true });
  } catch (e) {
    throw new ConfigError(`渲染失败（退出码 4）：${(e as Error).message}`);
  }

  log.done(`成片：${outVideo}。请记录墙钟时长与 CPU 峰值（F4 基准量化）。`);
  return { propsFile, stacks };
}
