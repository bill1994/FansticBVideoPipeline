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
import { ConfigError, RenderFailedError, StageBlockedError } from '../core/exit-code.ts';
import { exists, jobDir, readJson, stageDir, writeStageJson } from '../core/io.ts';
import { lookupConfirmed, readConfirmedRecords } from '../core/confirmed.ts';
import { log } from '../core/log.ts';
import { runMediaQa } from '../core/media-qa.ts';
import type { ValidateReport } from '../core/report.ts';
import { buildContext } from '../validate/context.ts';
import { composeRenderProps } from './render-props.ts';

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
 * 06-review/confirmed.json 的**唯一入口在 `core/confirmed.ts`**（2026-10-19 上提）。
 *
 * 为什么不再定义在本文件：`storyboard` 也需要读同一份记录（alignment 放行），
 * 若它从 `stages/render` 导入，会形成「03 依赖 05」的跨级依赖。
 * 放 `core/` 后两边共用同一份解析与结构校验，且 `stage` 字段真正参与判定。
 */

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
    const { record: confirmed, available } = lookupConfirmed(jobId, 'render', jobsDir);

    // 🔴 `stage` 必须匹配（2026-10-19 实测缺口）：此前只取 `acknowledgedFullscreen`，
    //    于是 `stage: "alignment"` 的文件也能放行 render 闸 —— 一张旧凭据通吃所有关卡。
    if (!confirmed && available.length > 0) {
      return (
        `06-review/confirmed.json 里没有 stage:"render" 的记录（现有：${available.join(', ')}）。\n` +
        `  该文件支持多条记录，请**追加**一条 render 记录，不要覆盖已有的：\n` +
        `    { "jobId": "${jobId}", "stage": "render", "reason": "...",\n` +
        `      "confirmedBy": "...", "confirmedAt": "...", "acknowledgedFullscreen": [...] }\n` +
        `  ↳ 写在 \`{"records": [...]}\` 数组里（顶层单条记录的旧写法仍兼容）。`
      );
    }

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

export function runRender(opts: RenderOptions): RenderOutcome {
  const base = jobDir(opts.jobId, opts.jobsDir);
  const outDir = stageDir(opts.jobId, STAGES.render, opts.jobsDir);

  // ── 启动闸 ─────────────────────────────────────────────────
  const blocked = renderGate(opts.jobId, opts.jobsDir);
  if (blocked) throw new StageBlockedError(blocked);

  // ── 版本锚定自检 ───────────────────────────────────────────
  assertVersionPinned();

  // ── C6 映射（2026-10-22 抽取为 composeRenderProps，与 review 共用同一真源）──
  // 🔴 消解重算 / 影子载体轨 / 字幕通道 / 模板快照 / 尺寸判定的全部理由与注释
  //    见 `render-props.ts` —— 预览与成片必须走同一份映射，禁第二真源。
  const composed = composeRenderProps(opts.jobId, opts.jobsDir);
  const { props: data, size, source } = composed;

  /**
   * 人工改动留痕（`P3` 裁决，2026-10-19）。
   *
   * `ConfirmedRecord.overrides` 此前**零消费者**：人工签字说「我把 fromFrame
   * 从 120 改到 135」，而没有任何代码读它 —— 签字只进了文件，没进任何流程。
   *
   * ⚠️ 这里**只做告警 + 留档，不做回放校验**：`overrides.field` 的路径格式
   *    还没有契约（`fromFrame`？`footprint.0`？），贸然做值比对会引入新的猜谜。
   *    先把「本次有 N 处人工改动」变成可见事实，值校验等字段路径定下来再说。
   */
  const overrides = readConfirmedRecords(opts.jobId, opts.jobsDir).flatMap((r) =>
    (r.overrides ?? []).map((o) => ({ stage: r.stage, ...o })),
  );
  if (overrides.length > 0) {
    log.warn(
      `本 job 有 ${overrides.length} 处人工改动（06-review/confirmed.json 的 overrides）—— ` +
        `这是「签字说改了什么」，**未自动校验是否与产物一致**。`,
    );
  }

  fs.mkdirSync(outDir, { recursive: true });

  // 🔴 落盘走 writeStageJson：不可变快照守卫的唯一执行点（2026-10-18 接线）。
  const propsFile = writeStageJson({
    jobId: opts.jobId,
    self: STAGES.render,
    target: STAGES.render,
    file: 'render-props.json',
    jobsDir: opts.jobsDir,
    data,
  });

  if (opts.dryRun) {
    log.info(`dry-run：已生成 ${propsFile}，跳过实际渲染`);
    return { propsFile, stacks: data.stacks };
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
    // 素材目录作为静态根：props 里 `video` 只写文件名，Remotion 按 publicDir 解析。
    `--public-dir=${path.join(base, STAGES.input)}`,
    '--gl=angle',
    '--log=verbose',
  ];
  log.info(`npx ${args.join(' ')}`);
  const startedAt = Date.now();
  try {
    execFileSync('npx', args, { stdio: 'inherit', shell: true });
  } catch (e) {
    // 🔴 渲染失败是**独立语义**（退出码 4），不能混进「参数错(2)」。
    //    此前抛 ConfigError ⇒ CLI 一律映射成 2，而文案还写着「退出码 4」。
    throw new RenderFailedError(
      `渲染失败：${(e as Error).message}\n` +
        `  成片目标：${outVideo}\n` +
        `  命令：npx ${args.join(' ')}`,
    );
  }
  const wallMs = Date.now() - startedAt;
  const bytes = fs.existsSync(outVideo) ? fs.statSync(outVideo).size : 0;

  /**
   * 成片媒体 QA（P0-2）：解码 / 时长 / 黑场 / 静帧 / 音频 / 联系表。
   *
   * 🔴 **不阻断**：成片已经产出，QA 是「事后报告」不是「门」。
   *    ffmpeg / ffprobe 不可用时只进 `unavailable`，绝不伪装成通过；
   *    黑场/静帧/音频异常进 warning，解码/时长不符进 error，
   *    由用户决定是否作废这次成片。
   *
   * ⚠️ 这会**多解码一遍成片**：1080p60 的 2 分钟片约几十秒，
   *    相对 20 分钟的渲染墙钟可接受；长片若明显拖慢，再考虑降采样。
   */
  const qa = runMediaQa({
    file: outVideo,
    expectedDurationSec: source.durationInFrames / source.fps,
    fps: source.fps,
    durationInFrames: source.durationInFrames,
    contactSheetPath: path.join(outDir, 'contact-sheet.jpg'),
  });
  if (qa.unavailable.length > 0) {
    log.warn(`媒体 QA 判据缺失（不阻断）：${qa.unavailable.join('; ')}`);
  }
  if (qa.errors.length > 0) {
    log.warn(
      `媒体 QA 发现 ${qa.errors.length} 个 error（成片已保留，请人工复核）：` +
        qa.errors.join('; '),
    );
  }
  if (qa.warnings.length > 0) {
    log.warn(`媒体 QA warning：${qa.warnings.join('; ')}`);
  }
  if (qa.contactSheet !== null) {
    log.info(`联系表：${qa.contactSheet}`);
  }

  /**
   * F4 基准量化 —— 墙钟与产物大小落盘，供多次取样取中位数。
   *
   * ⚠️ `cpuPeakPercent` 写 `null` 而不是 0：`execFileSync` 不暴露子进程 rusage，
   *    本项目拿不到真实 CPU 峰值。`null` = 没测，`0` = 测了且为空闲 —— 同
   *    `silentWordRatio` 的口径（写 0 会让「没测过」看起来像「测过且完美」）。
   */
  writeStageJson({
    jobId: opts.jobId,
    self: STAGES.render,
    target: STAGES.render,
    file: 'render-report.json',
    jobsDir: opts.jobsDir,
    data: {
      jobId: opts.jobId,
      outFile: path.basename(outVideo),
      bytes,
      durationInFrames: source.durationInFrames,
      fps: source.fps,
      // 尺寸及其来源（P4）：`manifest` / `ffprobe` / `default` 三选一，便于事后追溯
      width: size.width,
      height: size.height,
      sizeFrom: size.from,
      wallMs,
      wallHuman: `${Math.floor(wallMs / 60000)}m${Math.round((wallMs % 60000) / 1000)}s`,
      command: `npx ${args.join(' ')}`,
      gl: 'angle',
      cpuPeakPercent: null,
      note: 'cpuPeakPercent=null 表示未采集：execFileSync 不暴露子进程 rusage',
      // P3：人工改动清单（空数组 = 读了且没有；不像 null 那样含混）
      manualOverrides: overrides,
      // P0-2：成片媒体 QA。联系表只记文件名，便于随 job 目录整体搬移。
      qa: {
        ...qa,
        contactSheet: qa.contactSheet === null ? null : path.basename(qa.contactSheet),
      },
    },
  });

  log.done(
    `成片：${outVideo}（${(bytes / 1024 / 1024).toFixed(1)} MB，墙钟 ${(wallMs / 1000).toFixed(1)}s）` +
      `。F4 基准已写入 05-render/render-report.json。`,
  );
  return { propsFile, stacks: data.stacks };
}
