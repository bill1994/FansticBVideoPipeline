/**
 * C6 映射段 —— render 与 review 的**单一真源**（2026-10-22 自 `render.ts` 抽取）。
 *
 * 为什么必须共用一份映射（Option A 的核心理由）：预览与成片若各持一套映射，
 * 漂移只是时间问题 —— 项目已三次踩过「两套实现漂移」的坑（intent 词表 /
 * 字幕轨 / D-B 字号表）。review 在 Studio 里给用户看的，必须就是 render
 * 会渲出来的。
 *
 * 本模块只做映射与输入消解，**不落盘**：`05-render/render-props.json` 与
 * `06-review/preview-props.json` 分别由 render / review 各自经 `writeStageJson`
 * 写出（两份产物互不触碰对方的不可变快照语义）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { STAGES } from '../core/config.ts';
import { ConfigError } from '../core/exit-code.ts';
import { exists, jobDir, readJson } from '../core/io.ts';
import {
  DEFAULT_RENDER_HEIGHT,
  DEFAULT_RENDER_WIDTH,
  probeVideoSize,
  resolveRenderSize,
} from '../core/video-size.ts';
import { log } from '../core/log.ts';
import type { SourceManifest } from '../core/types.ts';
import { buildContext } from '../validate/context.ts';
import { resolveScene } from '../validate/occlusion.ts';
import type { TemplateDeclaration } from '../templates/types.ts';
import { isCarrierScope } from '../templates/types.ts';
import { toCaptionData } from '../remotion/caption.ts';
import { SHADOW_TRACK_PREFIX, synthesizeCarrierTracks } from '../remotion/carrier-synth.ts';
import type { RenderProps } from '../remotion/Overlay.tsx';

/** composeRenderProps 的产物：props 之外的旁路信息供 render 落报告、review 启 Studio。 */
export interface ComposedRenderProps {
  /** 渲染 props —— render 写 render-props.json、review 写 preview-props.json 的数据体。 */
  props: RenderProps;
  /** 画面尺寸及其来源（render-report 记录 sizeFrom 用）。 */
  size: ReturnType<typeof resolveRenderSize>;
  /** 素材清单原样（render 的媒体 QA 与报告用）。 */
  source: SourceManifest;
  /** 00-input 绝对路径（review 启 Studio 时作 --public-dir）。 */
  inputDir: string;
  /**
   * must_review 条目的 item ref 队列 —— 🔴 只在这里算一份（与 renderGate 同一
   * ctx.scene 表达式），review 打印与 render 闸比对共用。此前 review.ts 手抄过
   * 第三份 ref 格式，评审指出正是本项目「禁第二真源」要防的潜伏分叉。
   */
  mustReviewRefs: string[];
}

/** 把 storyboard 切成两层栈（C6 ③：最易出错处）。 */
export function splitStacks(jobId: string, jobsDir?: string): { background: string[]; overlay: string[] } {
  const ctx = buildContext(jobId, jobsDir);
  const background = ctx.scene.filter((s) => isCarrierScope(s.tpl.scope)).map((s) => s.ref);
  const overlay = ctx.scene.filter((s) => !isCarrierScope(s.tpl.scope)).map((s) => s.ref);
  return { background, overlay };
}

/**
 * `03-storyboard/storyboard.json` **文件字节**的 sha256 —— P1-a 防漂移锚。
 *
 * review 写进 `preview-props.json#storyboardHash`，renderGate 复算比对：
 * review 之后 storyboard 再被改动（哪怕一个字节），当时的看片确认即作废。
 * 用内容字节而非 mTime：git checkout / touch 不吃冤枉，改了内容才失效。
 */
export function hashStoryboardFile(jobId: string, jobsDir?: string): string {
  const file = path.join(jobDir(jobId, jobsDir), STAGES.storyboard, 'storyboard.json');
  if (!exists(file)) {
    // 导出函数可能被未来的调用方直接使用（当前两个调用点都先经 buildContext
    // 的 readJson 挡住了缺失）；裸 ENOENT 会以 exit 6 + 堆栈吓人，按项目惯例
    // 报 ConfigError（exit 2，人话 + 指引）。
    throw new ConfigError(
      `缺少前置产物：${file}\n` +
        `（阶段目录是不可变快照，缺失即为前置阶段未跑 —— 不要跳过上游直接跑下游）`,
    );
  }
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * C6 双栈映射：storyboard（含消解重算）→ 渲染 props。
 *
 * render 与 review 都从这里拿 props —— 抽取自 `runRender`，行为逐字节保持
 * （抽取判据：同一 storyboard 重跑 `render --dry-run`，render-props.json 不变）。
 */
export function composeRenderProps(jobId: string, jobsDir?: string): ComposedRenderProps {
  const base = jobDir(jobId, jobsDir);

  const source = readJson<SourceManifest>(path.join(base, STAGES.input, 'source.json'));

  // ── 消解重算（通道方案 A，2026-10-17）────────────────────────────
  // 🔴 **为什么必须在这里重跑**：遮挡消解（tier1 平移 / tier2 载体退让）改的是
  //   `buildContext()` 读进来的**内存对象**，而消费方是**独立进程** ——
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
  const ctx = buildContext(jobId, jobsDir);
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

  const stacks = splitStacks(jobId, jobsDir);
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

  if (size.from === 'default') {
    log.warn(
      `未能确定画面尺寸（source.json 未填 width/height，且读不到视频）→ ` +
        `按 ${DEFAULT_RENDER_WIDTH}×${DEFAULT_RENDER_HEIGHT} 渲染。` +
        `竖屏素材请在 00-input/source.json 填 width/height。`,
    );
  } else if (size.from === 'ffprobe') {
    log.info(`画面尺寸：${size.width}×${size.height}（ffprobe 从素材读得）`);
  }

  const props: RenderProps = {
    jobId,
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
  };

  // must_review 队列：与 renderGate 用同一份 ctx.scene 算（含 resolveScene 后的顺序与 ref 格式）。
  const mustReviewRefs = ctx.scene
    .filter((s) => s.item.decision?.review === 'must_review')
    .map((s) => s.ref);

  return { props, size, source, inputDir: path.join(base, STAGES.input), mustReviewRefs };
}
