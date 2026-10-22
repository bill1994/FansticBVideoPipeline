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
import {
  DEFAULT_RENDER_HEIGHT,
  DEFAULT_RENDER_WIDTH,
  probeVideoSize,
  resolveRenderSize,
} from '../core/video-size.ts';
import { log } from '../core/log.ts';
import { runMediaQa } from '../core/media-qa.ts';
import type { ValidateReport } from '../core/report.ts';
import type { SourceManifest } from '../core/types.ts';
import { buildContext } from '../validate/context.ts';
import { resolveScene } from '../validate/occlusion.ts';
import { isCarrierScope } from '../templates/types.ts';
import type { TemplateDeclaration } from '../templates/types.ts';
import { toCaptionData } from '../remotion/caption.ts';
import { SHADOW_TRACK_PREFIX, synthesizeCarrierTracks } from '../remotion/carrier-synth.ts';

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

  // ── 消解重算（通道方案 A，2026-10-17）────────────────────────────
  // 🔴 **为什么必须在这里重跑**：遮挡消解（tier1 平移 / tier2 载体退让）改的是
  //   `buildContext()` 读进来的**内存对象**，而本函数是**独立进程** ——
  //   04-validate 跑完就退出，内存随之销毁。不重算则成片拿到的仍是原始
  //   storyboard.json，退让「算了却没落地」（报告却写着已消解 ⇒ 假绿）。
  //
  //   历史：这一层假绿自 2026-10-13 起残留 —— 那次修掉了「只拼进 detail 字符串」，
  //   但内存改写始终没有跨进程通道，直到本次才补上。
  //
  //   **为什么共用 validate 的几何逻辑**（而非在 remotion 侧重算）：
  //   「校验时判的几何」与「渲染时用的几何」必须逐位一致。分叉两份实现，
  //   报告会开始对成片说谎 —— 那比不同步更难排查。
  //
  //   不落新阶段产物文件（方案 A 的取舍）：`io.ts` 的不可变快照守卫本就禁止
  //   04 阶段回写 03 的 storyboard.json，落一份 resolved 副本需扩展 SPEC §1
  //   的阶段契约与守卫规则，代价大于收益。
  const ctx = buildContext(opts.jobId, opts.jobsDir);
  const resolvedCount = resolveScene(ctx);
  if (resolvedCount > 0) {
    log.info(
      `遮挡消解已重算并应用到渲染输入：${resolvedCount} 个 item 的 footprint / carrier 被改写` +
        `（tier1 平移与 tier2 载体退让现在会真正改变成片）`,
    );
  }
  const storyboard = ctx.storyboard;

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

  // ── 影子载体轨（D4-t3，2026-10-18）────────────────────────────
  // 🔴 为什么必须在这里合成：`validate` 把 tier2 的 `window` 写进**叠加 item** 的
  //   `carrier.params`，而渲染层是按 **track 的 motion scope** 划分载体轨的 ——
  //   没有这一层转换，载体档「算了、写了、报告说生效」，画面却分毫未动。
  //   裁决要点：不新增组件、不改双栈、影子轨恒为最内层、**不落盘**。
  const carrierTracks = synthesizeCarrierTracks(storyboard);
  if (carrierTracks.length > 0) {
    const n = carrierTracks.reduce((acc, t) => acc + t.items.length, 0);
    log.info(
      `影子载体轨：${carrierTracks.length} 条 / ${n} 段 ` +
        `（${carrierTracks.map((t) => t.id.replace(SHADOW_TRACK_PREFIX, '')).join(', ')}）` +
        ` —— 由叠加 item 的 carrier 声明合成，仅进渲染 props，不落 storyboard。`,
    );
  }

  /**
   * 字幕数据通道 —— `01-align/words.json`。
   *
   * 🔴 这是 `caption/karaoke-word` 的**唯一**文本来源：该模板刻意不声明
   *    `text` 参数（P1：字幕文本来自 SRT，模型若也能写就会出现「字幕与语音
   *    对不上」，而时序校验只看帧区间、任何校验项都拦不住）。
   *
   * 因此这里**不读就不给**：文件缺失时 `caption` 字段整个省略，
   * 模板侧降级为空序列。绝不用 storyboard 里的文字凑 ——
   * 那正是 P1 要防的第二个来源。
   */
  const wordsFile = path.join(base, STAGES.align, 'words.json');
  const hasWords = exists(wordsFile);
  if (!hasWords) {
    log.warn(
      `01-align/words.json 不存在 —— 字幕类 motion 将无文本可显示。` +
        `align 未跑或门控未通过时会走到这里。`,
    );
  }
  const caption = hasWords ? toCaptionData(readJson<unknown>(wordsFile)) : undefined;

  /**
   * 模板声明快照（S1b）：供浏览器侧 hydrate `custom/*`。
   * 文件缺失 ⇒ `[]`（旧 job 兼容；内置模板已在模块初始化时注册）。
   */
  const snapshotFile = path.join(base, STAGES.storyboard, 'template-snapshot.json');
  const templates = exists(snapshotFile)
    ? readJson<TemplateDeclaration[]>(snapshotFile)
    : [];

  fs.mkdirSync(outDir, { recursive: true });
  const videoAbs = path.join(base, STAGES.input, source.video);

  /**
   * 画面尺寸（`P4` 裁决，2026-10-19）：**清单 → ffprobe → 兜底**。
   *
   * 此前 `Root.tsx` 把 `Composition` 的宽高硬编码 1920×1080，而 `SourceManifest`
   * 没有 width/height ⇒ **素材分辨率根本不进契约**。实测：640×360 素材渲出 1080p，
   * 竖屏素材无路可走。
   *
   * ffprobe 不可用**不阻断渲染**（它只是「尺寸从哪来」的第二来源）——
   * 但会在日志里说清楚走的是哪一条路。
   */
  const probed = (() => {
    if (source.width !== undefined && source.height !== undefined) return null;
    if (!fs.existsSync(videoAbs)) return null;
    try {
      return probeVideoSize(videoAbs);
    } catch {
      return null;
    }
  })();
  const size = resolveRenderSize(source, probed);

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
  if (size.from === 'default') {
    log.warn(
      `未能确定画面尺寸（source.json 未填 width/height，且读不到视频）→ ` +
        `按 ${DEFAULT_RENDER_WIDTH}×${DEFAULT_RENDER_HEIGHT} 渲染。` +
        `竖屏素材请在 00-input/source.json 填 width/height。`,
    );
  } else if (size.from === 'ffprobe') {
    log.info(`画面尺寸：${size.width}×${size.height}（ffprobe 从素材读得）`);
  }

  // 🔴 落盘走 writeStageJson：不可变快照守卫的唯一执行点（2026-10-18 接线）。
  const propsFile = writeStageJson({
    jobId: opts.jobId,
    self: STAGES.render,
    target: STAGES.render,
    file: 'render-props.json',
    jobsDir: opts.jobsDir,
    data: {
    jobId: opts.jobId,
    fps: source.fps,
    durationInFrames: source.durationInFrames,
    // 画面尺寸（P4）：由 `Root.tsx` 的 calculateMetadata 透传给 Composition
    width: size.width,
    height: size.height,
    // 🔴 2026-10-18 实测修正：**不能传 `../00-input/x.mp4`，也不能只传文件名**。
    //   `<OffthreadVideo src>` 由 Remotion 的静态服务器解析，而该服务器把 URL 路径
    //   映射到 **bundle 目录**（`--public-dir` 的内容被复制进 `bundle/public/`）。
    //   实测三种写法：
    //     `../00-input/kukini.mp4` → 404（`bundle/00-input/...`）
    //     `kukini.mp4`             → 404（`bundle/kukini.mp4`）
    //     `public/kukini.mp4`      → ✅ 命中
    //   demo job 一直是 `hasVideo: false`（走占位底分支），**这条路径从未被走过**，
    //   缺陷直到第一次用真素材渲染才暴露。
    video: `public/${path.basename(source.video)}`,
    // 素材不存在时渲染占位底，而不是让 OffthreadVideo 去解一个空 src。
    // demo job 没有真实视频，靠这条也能把「双栈 / z 序 / 时间映射」结构跑出来。
    hasVideo: fs.existsSync(videoAbs),
    storyboard,
    stacks,
    carrierTracks,
    // S1b：模板声明快照（浏览器侧 hydrate `custom/*` 用）。
    templates,
    ...(caption ? { caption } : {}),
    },
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
  return { propsFile, stacks };
}
