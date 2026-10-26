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

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { REMOTION_VERSION, STAGES } from '../core/config.ts';
import { ConfigError, RenderFailedError, StageBlockedError } from '../core/exit-code.ts';
import { CODES, type CodeSpec } from '../core/errors.ts';
import { exists, jobDir, readJson, stageDir, writeStageJson } from '../core/io.ts';
import { lookupConfirmed, readConfirmedRecords } from '../core/confirmed.ts';
import { log } from '../core/log.ts';
import { runMediaQa } from '../core/media-qa.ts';
import type { ValidateReport } from '../core/report.ts';
import type { SourceManifest } from '../core/types.ts';
import { decodeChildOutput } from '../core/child-output.ts';
import { buildContext } from '../validate/context.ts';
import { mk } from '../validate/item.ts';
import { composeRenderProps, hashStoryboardFile } from './render-props.ts';

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

  // ── must_review 硬闸（P1-a，2026-10-22）─────────────────────────
  // 闸2/产路地板把 custom 产路抬到 must_review，但此前它的唯一消费者是
  // validate 报告里的一行清单 —— 「建议看片」不拦任何东西。渲染一次 20 分钟，
  // 这道闸必须在渲染前：不看片不给渲（用户裁决）。
  const reviewRefs = ctx.scene
    .filter((s) => s.item.decision?.review === 'must_review')
    .map((s) => s.ref);
  if (reviewRefs.length > 0) {
    // ① 先跑过 review（产出 preview-props 且 hash 对得上当前 storyboard）——
    //    hash 防漂移：review 之后 storyboard 再被改，当时的看片确认作废。
    const previewFile = path.join(jobDir(jobId, jobsDir), STAGES.review, 'preview-props.json');
    if (!exists(previewFile)) {
      return (
        `存在 ${reviewRefs.length} 条 must_review 条目（${reviewRefs.join(', ')}），` +
        `但 06-review/preview-props.json 不存在 —— 尚未人工审核。\n` +
        `  先执行：npm run pipeline -- review --job ${jobId}\n` +
        `  在 Remotion Studio 里看片确认后，把确认写进 confirmed.json 再渲染。`
      );
    }
    const preview = readJson<{ storyboardHash?: string }>(previewFile);
    if (preview.storyboardHash !== hashStoryboardFile(jobId, jobsDir)) {
      return (
        `06-review/preview-props.json 的 storyboardHash 与当前 storyboard.json 不一致 —— ` +
        `review 之后 storyboard 被改过，当时的看片确认作废。\n` +
        `  请重跑 review（npm run pipeline -- review --job ${jobId}）并重新确认。`
      );
    }

    // ② 确认凭据：render 记录的 acknowledgedReview 必须覆盖全部 must_review refs。
    const { record: confirmed, available } = lookupConfirmed(jobId, 'render', jobsDir);
    if (!confirmed && available.length > 0) {
      return (
        `06-review/confirmed.json 里没有 stage:"render" 的记录（现有：${available.join(', ')}）。\n` +
        `  该文件支持多条记录，请**追加**一条 render 记录（含 acknowledgedReview），不要覆盖已有的：\n` +
        `    { "jobId": "${jobId}", "stage": "render", "reason": "...",\n` +
        `      "confirmedBy": "...", "confirmedAt": "...",\n` +
        `      "acknowledgedReview": [${reviewRefs.map((r) => `"${r}"`).join(', ')}] }\n` +
        `  ↳ 写在 \`{"records": [...]}\` 数组里（顶层单条记录的旧写法仍兼容）。`
      );
    }
    const ackedReview = new Set(confirmed?.acknowledgedReview ?? []);
    const unackedReview = reviewRefs.filter((r) => !ackedReview.has(r));
    if (unackedReview.length > 0) {
      return (
        `存在未经人工看片确认的 must_review 条目：${unackedReview.join(', ')}\n` +
        `  P1-a：must_review 条目必须逐条过目（先跑 review 在 Studio 里看片）。\n` +
        `  请在 06-review/confirmed.json 的 render 记录 acknowledgedReview 中补齐这些 item ref。`
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

/**
 * 渲染失败的分类器 —— `E-RT-01/02/03`（F2「渲染期兜底三类」）的**唯一构造点**。
 *
 * 🔴 2026-10-26 接线：这三条码自 2026-10-12 就定义在 `core/errors.ts`，但**从未被构造过一次**。
 *   根因是实现用了 `stdio:'inherit'` —— 子进程输出直接甩给终端，父进程**拿不到文本**，
 *   失败时只能抛一句「渲染失败」。而 wiki 05 / PROGRESS / SPEC 都写着
 *   「由 render 阶段产出 `stage:"render"` 条目」，属典型的「定义了 ≠ 生效」。
 *
 * ⚠️ 判据是**子串匹配**，因为 Remotion 不给结构化错误码。三条判据刻意写窄：
 *   裸 `angle` / `gpu` 不参与匹配（`--gl=angle` 的启动日志里全是这词，会误判全场）；
 *   **匹配不上就返回 null，不猜** —— 报告如实写「失败但未归类」，
 *   比塞一个像模像样的错码更诚实（同 `cpuPeakPercent=null` 的口径）。
 */
export function classifyRenderFailure(text: string): CodeSpec | null {
  // GPU / WebGL：上下文创建失败、进程崩溃、SwiftShader 回退失败
  if (/webgl|swiftshader|gpu process|context lost|failed to create.{0,20}context/i.test(text)) {
    return CODES.RT_GPU;
  }
  // Canvas：delayRender 未清理（组件没渲染出来）、getContext 拿不到
  if (/delayrender|getcontext|canvas (is )?null|renderToCanvas/i.test(text)) {
    return CODES.RT_CANVAS;
  }
  // 字体：@font-face 加载失败、字形缺失
  if (/failed to load.{0,20}font|font.{0,20}(not|failed)|woff2?|\.ttf|\.otf|字体/i.test(text)) {
    return CODES.RT_FONT;
  }
  return null;
}

/** 累积输出的上限：verbose 日志跑 20 分钟能到几十 MB，只留尾部够分类与排查。 */
const RENDER_OUTPUT_KEEP_BYTES = 200 * 1024;

// 解码实现已上提到 `core/child-output.ts`（2026-10-26）：
// 同一套 GBK 回退逻辑在 `cancel` 的 taskkill 回执上又需要一次，
// 留在这里就会变成第二份实现。

/**
 * 跑 Remotion 子进程：**流式转发**到终端，同时累积尾部字节供失败分类。
 *
 * 用 `spawn` 而非 `execFileSync` 的理由：需要同时保住两件事 ——
 *   ① 实时进度（20 分钟渲染，不能等结束才吐日志）⇒ 排除 `stdio:'pipe'` 静默；
 *   ② 失败时的输出文本（供 `classifyRenderFailure` 分类）⇒ 排除 `stdio:'inherit'`。
 * 手动转发是唯一能同时满足两者的做法。
 *
 * ⚠️ 累积的是**原始 Buffer 而非字符串**：编码要到使用处才断定（见 `decodeOutput`），
 *   中途 toString 会把 GBK 字节烤成乱码且不可逆。
 */
function runRemotion(args: string[]): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let kept = 0;
    const collect = (chunk: Buffer): void => {
      chunks.push(chunk);
      kept += chunk.length;
      // 只留尾部：verbose 日志跑 20 分钟能到几十 MB
      while (kept > RENDER_OUTPUT_KEEP_BYTES && chunks.length > 1) {
        const dropped = chunks.shift();
        kept -= dropped?.length ?? 0;
      }
    };
    child.stdout?.on('data', (c: Buffer) => {
      process.stdout.write(c);
      collect(c);
    });
    child.stderr?.on('data', (c: Buffer) => {
      process.stderr.write(c);
      collect(c);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ exitCode: code ?? 1, output: decodeChildOutput(Buffer.concat(chunks)) }),
    );
  });
}

/**
 * 素材存在性闸（2026-10-26）。
 *
 * 🔴 为什么需要：`render-props.ts` 对「视频不存在」的处理是**走占位底**
 *   （`hasVideo: fs.existsSync(...)`），这是 demo 用的合法路径。但它同时掩盖了一个
 *   几乎必然的人为错误 —— **素材忘拷 / `video` 路径写错**，也会得到一个没有实拍画面的
 *   成片，而报告看起来全绿。实测证据：把 `video` 指向不存在的文件，
 *   Remotion 照样渲完 30 帧并 exit 0（`ok:true`）。
 *
 * 三档：
 *   - 文件存在 → 放行（true）
 *   - 不存在且未声明 `allowNoVideo` → `StageBlockedError` 阻断（退出码 1）
 *   - 不存在且 `allowNoVideo: true` → 放行并告警（false），供 demo / 结构验证
 *
 * 返回「素材是否真的存在」，供 `render-report.json` 如实记录 `videoMissing`。
 */
function assertSourceVideoPresent(videoAbs: string, source: SourceManifest): boolean {
  if (fs.existsSync(videoAbs)) return true;
  if (source.allowNoVideo === true) {
    log.warn(
      `素材不存在（${source.video}），但 source.json 已声明 allowNoVideo —— 走占位底渲染。\n` +
        `  成片将**没有实拍画面**，仅用于结构验证。render-report.json 会记 videoMissing: true。`,
    );
    return false;
  }
  throw new StageBlockedError(
    `00-input/${source.video} 不存在 —— 素材没拷进来，或 source.json 的 video 写错了。\n` +
      `  继续渲染会得到一个**没有实拍画面**的成片（走占位底），而报告看起来全绿。\n` +
      `  ↳ 要么把视频放进 00-input/，要么在 source.json 里显式声明 "allowNoVideo": true（仅用于结构验证）。`,
  );
}

export async function runRender(opts: RenderOptions): Promise<RenderOutcome> {  const base = jobDir(opts.jobId, opts.jobsDir);
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

  // ── 素材存在性闸（2026-10-26）────────────────────────────────
  // 放在 dry-run 之后：dry-run 只验结构，不需要素材落地。
  const videoAbs = path.join(base, STAGES.input, source.video);
  const videoPresent = assertSourceVideoPresent(videoAbs, source);

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
  const { exitCode, output } = await runRemotion(args);
  if (exitCode !== 0) {
    /**
     * 🔴 渲染失败是**独立语义**（退出码 4），不能混进「参数错(2)」。
     *    此前抛 ConfigError ⇒ CLI 一律映射成 2，而文案还写着「退出码 4」。
     *
     * 2026-10-26 起失败也**落盘**：此前只在终端抛一行字，`05-render/` 什么都不留，
     * 「渲染崩了」这件事在产物里完全不存在 —— 与「报告说通过、实际没测」同源。
     * 现在写 `render-report.json`（`ok:false` + `items` + `outputTail`），
     * 让失败可对账、可分类、可复查。
     */
    const spec = classifyRenderFailure(output);
    const tail = output.split('\n').slice(-40).join('\n');
    writeStageJson({
      jobId: opts.jobId,
      self: STAGES.render,
      target: STAGES.render,
      file: 'render-report.json',
      jobsDir: opts.jobsDir,
      data: {
        jobId: opts.jobId,
        outFile: path.basename(outVideo),
        ok: false,
        failed: true,
        // 与成功路径同口径：失败时也要能看出「这版本来就没有实拍画面」
        videoMissing: !videoPresent,
        failure: {
          exitCode,
          classified: spec?.code ?? null,
          note: spec
            ? '已按渲染期兜底三类分类（判据 = 子进程输出子串匹配，见 classifyRenderFailure）'
            : '未能归类：三条判据均未命中，如实记 null 而不猜一个码',
        },
        command: `npx ${args.join(' ')}`,
        gl: 'angle',
        // 空数组 = 「跑了且渲染期没出条目」；失败未归类时同样是空数组 + failure.classified=null
        items: spec
          ? [
              mk(
                spec,
                'render',
                [],
                [],
                `${spec.title}（渲染失败，退出码 ${exitCode}）`,
                `命令：npx ${args.join(' ')}。完整输出尾部见本报告 outputTail。`,
              ),
            ]
          : [],
        outputTail: tail,
      },
    });
    throw new RenderFailedError(
      `渲染失败（退出码 ${exitCode}）` +
        (spec ? ` · 已归类 ${spec.code}（${spec.title}）` : ' · 未能归类（输出未命中三条判据）') +
        `\n  成片目标：${outVideo}` +
        `\n  命令：npx ${args.join(' ')}` +
        `\n  报告：05-render/render-report.json（含 outputTail 最后 40 行）`,
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
      ok: true,
      failed: false,
      // 素材是否真的存在（2026-10-26）：allowNoVideo 放行时为 true，如实记录「这版没有实拍画面」
      videoMissing: !videoPresent,
      // 渲染期兜底条目（F2）：成功路径恒为空数组 —— 「跑了且无渲染期问题」，
      // 与失败路径的 `ok:false` 形成对称契约，便于事后区分「没条目」与「没跑」。
      items: [],
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
