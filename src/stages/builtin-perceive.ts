/**
 * 内置感知后端 —— YuNet 逐帧检测 + shot 级并集聚合。
 *
 * 定位：`PERCEIVER_CMD` 未配置时的**默认后端**，用来拆除 02-perceive 的硬阻断
 *      （此前未配外部命令即退出码 2，而缺 02-perceive 产物 validate 会直接拒绝启动
 *      ⇒ 真实素材在 01-align 之后无路可走）。
 *
 * ── 抽帧为什么这么设计（阶段 B 的取舍结论，2026-10-17）────────────────
 * 调研报告 §5.4 阶段 B 原本要在 `@napi-rs/canvas` 与「纯 Buffer 手写」之间做对比实验。
 * 实际取舍是**第三条路**：既然 ffmpeg 已是本阶段的必需依赖（抽音轨、抽帧、镜头切分都用它），
 * 就让 ffmpeg 一次做完「抽帧 + 等比缩放 + 补边」，直接吐 `rgb24` 原始字节；
 * Node 侧只做**通道重排**（RGB 交错 → BGR planar）。
 *
 * 理由：
 *   ① 零新增依赖 —— 不引原生插件（换机风险）也不引图片解码库（生产路径不需要解码器）；
 *   ② 1fps 量级下性能不是瓶颈（单帧推理实测 11.4ms，缩放交给 swscale 更快）；
 *   ③ 补边用 ffmpeg `pad` 补 0（黑），与 OpenCV `BORDER_CONSTANT 0` 语义一致。
 *
 * ⚠️ 与报告 §5.4 阶段 B 的判据差异：**未做像素一致性对比实验**，因为不存在第二个实现。
 *    若将来确有需要（例如 4K 素材缩放质量成为问题），再补该实验并记录依据。
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import * as ort from 'onnxruntime-node';
import { DEFAULT_FRAME_INTERVAL_SEC, PERCEIVE } from '../core/config.ts';
import { ConfigError } from '../core/exit-code.ts';
import { log } from '../core/log.ts';
import type { Footprint, PerceiveRegion, Shot } from '../core/types.ts';
import type { ShotSpan } from './shot-detect.ts';
import { decodeYunet, planInputSize, rgbToBgrPlanar } from './yunet.ts';
import { handheldFromFace, saliencyBox } from './region-derive.ts';

export interface BuiltinPerceiveOptions {
  videoPath: string;
  /** YuNet ONNX 路径（`perceive-models/` 下，不入库）。 */
  modelPath: string;
  fps: number;
  totalFrames: number;
  spans: ShotSpan[];
  /** 抽帧间隔（秒）。默认 {@link DEFAULT_FRAME_INTERVAL_SEC}。 */
  frameIntervalSec?: number;
}

export interface BuiltinPerceiveStats {
  /** 实际扫描的帧数。 */
  framesScanned: number;
  /** 至少检出 1 张脸的帧数。 */
  framesWithFace: number;
  /** 显著性检出明确主体的无脸帧数。 */
  framesWithSaliency: number;
  /** 有 face 区域的 shot 数。 */
  shotsWithFace: number;
  /** 有 handheld 区域的 shot 数。 */
  shotsWithHandheld: number;
  /** 有 broll 区域的 shot 数。 */
  shotsWithBroll: number;
  /** 输入尺寸与耗时，便于排查。 */
  inputSize: [number, number];
  elapsedMs: number;
}

export interface BuiltinPerceiveResult {
  shots: Shot[];
  regions: PerceiveRegion[];
  stats: BuiltinPerceiveStats;
}

/** 用 ffprobe 读视频分辨率。 */
export function probeVideoSize(videoPath: string): { width: number; height: number } {
  const r = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'default=noprint_wrappers=1:nokey=0',
      videoPath,
    ],
    { encoding: 'utf8' },
  );
  if (r.error || r.status !== 0) {
    throw new ConfigError(
      `读取视频尺寸失败（需要系统 ffprobe）：${r.error?.message ?? r.stderr?.trim()}`,
    );
  }
  const kv = Object.fromEntries(
    r.stdout
      .trim()
      .split('\n')
      .map((line) => line.split('=') as [string, string]),
  );
  const width = Number(kv.width);
  const height = Number(kv.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ConfigError(`ffprobe 返回的分辨率非法：${r.stdout.trim()}`);
  }
  return { width, height };
}

/** 按固定帧字节数切分流（ffmpeg rawvideo 的 chunk 边界不对齐帧）。 */
async function* readRawFrames(
  stream: NodeJS.ReadableStream,
  frameBytes: number,
): AsyncGenerator<Buffer> {
  let buf: Buffer = Buffer.alloc(0);
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    while (buf.length >= frameBytes) {
      yield buf.subarray(0, frameBytes);
      buf = buf.subarray(frameBytes);
    }
  }
}

/** 归一化并裁到 [0,1] —— 检测框可能落在补边的黑区里（坐标超出有效画面）。 */
function normalizeBox(
  box: { x1: number; y1: number; w: number; h: number },
  scaledW: number,
  scaledH: number,
): Footprint {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const x = clamp01(box.x1 / scaledW);
  const y = clamp01(box.y1 / scaledH);
  const w = clamp01(box.w / scaledW);
  const h = clamp01(box.h / scaledH);
  return [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)];
}

/** 多个框的并集（D2 原则二：按 shot 取并集，不逐帧跟随）。 */
function unionBoxes(boxes: Footprint[]): Footprint | null {
  if (boxes.length === 0) return null;
  let x1 = 1;
  let y1 = 1;
  let x2 = 0;
  let y2 = 0;
  for (const [x, y, w, h] of boxes) {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x + w);
    y2 = Math.max(y2, y + h);
  }
  return [x1, y1, x2 - x1, y2 - y1];
}

/**
 * 取**面积中位数**的那个框，而不是并集。
 *
 * 🔴 为什么 broll 不能用并集（2026-10-17 实测）：产品特写镜头里镜头会推拉/平移，
 *    逐帧显著性框的位置一直在变，并集后三个 broll 框面积分别达到 0.63 / 0.89 / 0.72
 *    —— 全都超过单帧上限（0.6），等于「保护区域=整个画面」，region 形同虚设。
 *    对「某一帧里产品在哪儿」这类问题，中位数框比并集更能代表典型位置。
 *
 * ⚠️ face / handheld 仍用并集 —— 人在镜头内会移动，安全区必须覆盖**整个活动范围**
 *    （D2 原则二的原意），这与 broll 的语义不同。
 */
function medianAreaBox(boxes: Footprint[]): Footprint | null {
  if (boxes.length === 0) return null;
  const sorted = [...boxes].sort((a, b) => a[2] * a[3] - b[2] * b[3]);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * 安全区 = 主体 bbox 的**上部**（SPEC §2.7 原则一）。
 * 比例取自 {@link PERCEIVE.safeAreaTopRatio}（PLACEHOLDER，待校准）。
 */
export function safeAreaFromSubject(subject: Footprint): Footprint {
  const [x, y, w, h] = subject;
  const ratio = PERCEIVE.safeAreaTopRatio;
  return [x, y, w, h * ratio];
}

/**
 * 生成采样帧号：每个 shot 内均匀取 `ceil(duration/step)` 帧，**至少 1 帧**。
 *
 * 「至少 1 帧」是硬要求，不是优化 —— 短于抽帧间隔的镜头若被整段跳过，
 * 会产出 `lowConfidence: true` + `safeArea: null` 的**假阴性**
 * （实测 `3月22日` 的 s4：75 帧的镜头落在采样点之间，画面明明有人脸却判无主体，
 * 而 `safeArea: null` 意味着全画面可行域 ⇒ overlay 压到脸上也不会被拦）。
 *
 * 取每段的中点作为样本，避免贴 shot 边界（边界帧可能属于转场）。
 */
export function planSampleFrames(spans: readonly ShotSpan[], step: number): number[] {
  const set = new Set<number>();
  for (const span of spans) {
    const count = Math.max(1, Math.ceil(span.durationInFrames / step));
    for (let i = 0; i < count; i++) {
      const offset = Math.floor(((i + 0.5) * span.durationInFrames) / count);
      set.add(span.fromFrame + Math.min(offset, span.durationInFrames - 1));
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 跑内置感知：ffmpeg 抽帧 → YuNet 检测 → shot 级并集 → Shot[] + PerceiveRegion[]。
 */
export async function runBuiltinPerceive(
  opts: BuiltinPerceiveOptions,
): Promise<BuiltinPerceiveResult> {
  const t0 = Date.now();

  if (!fs.existsSync(opts.modelPath)) {
    throw new ConfigError(
      `找不到 YuNet 模型：${opts.modelPath}\n` +
        `  模型不入库（.gitignore 忽略 perceive-models/），需单独下载：\n` +
        `  face_detection_yunet_2026may.onnx （229,738 B，sha256 前缀 ebafce4e…）\n` +
        `  来源：https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet`,
    );
  }

  const { width, height } = probeVideoSize(opts.videoPath);
  const { scaledW, scaledH, padW, padH } = planInputSize(width, height, PERCEIVE.detectMaxSide);
  log.info(
    `内置 perceiver：YuNet ${pathBase(opts.modelPath)}；` +
      `画面 ${width}×${height} → 输入 ${padW}×${padH}（等比 ${scaledW}×${scaledH} + 补边）`,
  );

  const interval = opts.frameIntervalSec ?? DEFAULT_FRAME_INTERVAL_SEC;
  const session = await ort.InferenceSession.create(opts.modelPath, {
    executionProviders: ['cpu'],
  });
  const inputName = session.inputNames[0]!;
  const frameBytes = padW * padH * 3;

  // 🔴 **按帧号抽帧，且每个 shot 至少抽 1 帧**（2026-10-17 两次实测踩坑，别改回去）
  //
  //    坑一：曾用 `fps=1/interval` 滤镜并假设「第 i 个输出帧 = i × interval 秒」。
  //    实测证伪：标称 4.5s 的那帧，实际画面是 4.87s 之后的人物镜头
  //    （该滤镜按时间桶采样，桶内取哪一帧不受控）⇒ 检测结果被归到错误的 shot。
  //
  //    坑二：改成全片均匀取帧（`not(mod(n,step))`）后，短于抽帧间隔的镜头会被**整段跳过**。
  //    实测 `3月22日` 的 s4（13.62–14.87s，75 帧）落在采样点 810 与 900 之间，
  //    一帧都没被看到 ⇒ 画面里明明有人脸，却被判 `lowConfidence: true` + `safeArea: null`
  //    （全画面可行域）⇒ overlay 压到脸上也不会被拦。这是**假阴性**，比漏检更危险。
  //
  //    ⇒ 现在按 shot 生成采样帧号：每个 shot 内均匀取 ceil(duration/step) 帧，**至少 1 帧**。
  const step = Math.max(1, Math.round(interval * opts.fps));
  const sampleFrames = planSampleFrames(opts.spans, step);
  log.info(`采样帧：${sampleFrames.length} 帧 / ${opts.spans.length} 个 shot（每 shot 至少 1 帧）`);

  const selectExpr = sampleFrames.map((f) => `eq(n,${f})`).join('+');
  const vf =
    `select='${selectExpr}',` +
    `scale=${scaledW}:${scaledH}:flags=bilinear,` +
    `pad=${padW}:${padH}:0:0:black`;

  const proc = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-nostats', '-i', opts.videoPath, '-an', '-vf', vf,
     // 🔴 `-fps_mode passthrough` 不可省：select 选出的是稀疏帧（时间戳不连续），
     //    默认的 cfr 同步会按输入帧率把它们**补回**到 60fps，
     //    实测 20 秒素材从 14 帧被补成 1259 帧 ⇒ 帧号与内容彻底错位。
     '-fps_mode', 'passthrough',
     '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderrTail = '';
  proc.stderr?.on('data', (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });

  const perShotFace: Footprint[][] = opts.spans.map(() => []);
  const perShotHandheld: Footprint[][] = opts.spans.map(() => []);
  const perShotBroll: Footprint[][] = opts.spans.map(() => []);
  let framesScanned = 0;
  let framesWithFace = 0;
  let framesWithSaliency = 0;

  try {
    for await (const frame of readRawFrames(proc.stdout!, frameBytes)) {
      const frameNo = sampleFrames[framesScanned];
      if (frameNo === undefined) break; // 输出帧数多于采样表（不应发生）
      const timeSec = frameNo / opts.fps;

      const data = rgbToBgrPlanar(frame, padW, padH);
      const tensor = new ort.Tensor('float32', data, [1, 3, padH, padW]);
      const out = await session.run({ [inputName]: tensor });
      const faces = decodeYunet(
        out as unknown as Record<string, { data: Float32Array }>,
        padW,
        padH,
        { scoreThreshold: PERCEIVE.scoreThreshold, nmsThreshold: PERCEIVE.nmsThreshold },
      );

      framesScanned++;
      const shotIdx = opts.spans.findIndex(
        (s) => frameNo >= s.fromFrame && frameNo < s.fromFrame + s.durationInFrames,
      );

      if (faces.length > 0) {
        framesWithFace++;
        if (shotIdx >= 0) {
          // 同一帧多张脸时取最高分的那张（项目素材是单人口播；多人场景需重新设计）
          const faceBox = normalizeBox(faces[0]!, scaledW, scaledH);
          perShotFace[shotIdx]!.push(faceBox);
          // handheld 不靠物体检测：由人脸框外扩出「上半身＋手部」区域（见 region-derive 文件头）
          perShotHandheld[shotIdx]!.push(handheldFromFace(faceBox));
          if (process.env.PERCEIVE_DEBUG === '1') {
            log.info(
              `  [dbg] t=${timeSec.toFixed(2)}s f=${frameNo} shot=${opts.spans[shotIdx]!.id} ` +
                `score=${faces[0]!.score.toFixed(3)} box=[${faceBox.map((v) => v.toFixed(3)).join(', ')}]`,
            );
          }
        }
      } else if (shotIdx >= 0) {
        // 无脸帧 ⇒ 可能是产品特写 / B-roll：用显著性找主体。
        // **只用在这个分支**：有脸的镜头里主体是人，再框背景就是噪声。
        const sal = saliencyBox(frame, padW, padH);
        if (sal) {
          framesWithSaliency++;
          perShotBroll[shotIdx]!.push(sal.box);
        }
      }

      if (framesScanned % 60 === 0) {
        log.info(`  已扫描 ${framesScanned} 帧（含脸 ${framesWithFace} / 显著主体 ${framesWithSaliency}）`);
      }
    }
  } catch (e) {
    throw new ConfigError(
      `内置 perceiver 抽帧/推理失败：${(e as Error).message}\n` +
        `  ffmpeg stderr（末尾）：${stderrTail.trim() || '(空)'}`,
    );
  }

  const exitCode = await new Promise<number>((resolve) => {
    if (proc.exitCode !== null) return resolve(proc.exitCode);
    proc.on('close', (code) => resolve(code ?? -1));
  });
  if (exitCode !== 0) {
    throw new ConfigError(
      `ffmpeg 抽帧退出码 ${exitCode}\n  stderr（末尾）：${stderrTail.trim() || '(空)'}`,
    );
  }

  // ---- 聚合：每 shot 每通道各一个 region（时间跨整个 shot，box 是该通道的并集）----
  const shots: Shot[] = [];
  const regions: PerceiveRegion[] = [];
  let shotsWithFace = 0;
  let shotsWithHandheld = 0;
  let shotsWithBroll = 0;

  for (const [i, span] of opts.spans.entries()) {
    const face = unionBoxes(perShotFace[i]!);
    const handheld = unionBoxes(perShotHandheld[i]!);
    const rawBroll = medianAreaBox(perShotBroll[i]!);

    // 🔴 有脸的 shot 一律丢弃 broll。实测依据：逐帧判「无脸就算显著性」时，
    //    口播镜头里人物低头/转身的那几帧会框到背景（装饰画、家具），
    //    并集进 region 后变成纯噪声（首版 broll 从 3 个 shot 膨胀到 11 个）。
    //    语义上也不该有：有脸的镜头主体是人，背景不是 B-roll 主体。
    // 另加面积兜底：中位数框仍超过上限 ⇒ 主体位置不可靠，退让。
    const broll =
      face || !rawBroll || rawBroll[2] * rawBroll[3] > 0.6 ? null : rawBroll;

    if (face) shotsWithFace++;
    if (handheld) shotsWithHandheld++;
    if (broll) shotsWithBroll++;

    // D2 原则三：主体不在场的 shot → 安全区为空（全画面可行域）。
    // 只有 face 参与 safeArea 推导 —— B-roll 里没有「人」，它的遮挡约束由 broll region 自身承担。
    const shot: Shot = {
      id: span.id,
      fromFrame: span.fromFrame,
      durationInFrames: span.durationInFrames,
      safeArea: face ? safeAreaFromSubject(face) : null,
      // 三通道全空才算「主体未确」（此前的判据只看 face，会把纯产品特写误标低置信）
      lowConfidence: !(face || broll),
    };
    if (face) shot.subjectBox = face;
    shots.push(shot);

    const base = {
      shotId: span.id,
      fromFrame: span.fromFrame,
      durationInFrames: span.durationInFrames,
    };
    if (face) regions.push({ id: `r-face-${span.id}`, kind: 'face', box: face, ...base });
    if (handheld) {
      regions.push({ id: `r-handheld-${span.id}`, kind: 'handheld', box: handheld, ...base });
    }
    if (broll) regions.push({ id: `r-broll-${span.id}`, kind: 'broll', box: broll, ...base });
  }

  const elapsedMs = Date.now() - t0;
  log.info(
    `内置 perceiver 完成：扫描 ${framesScanned} 帧（含脸 ${framesWithFace} / 显著主体 ${framesWithSaliency}）；` +
      `face ${shotsWithFace} · handheld ${shotsWithHandheld} · broll ${shotsWithBroll}` +
      `（共 ${opts.spans.length} shot）；耗时 ${elapsedMs}ms`,
  );

  return {
    shots,
    regions,
    stats: {
      framesScanned,
      framesWithFace,
      framesWithSaliency,
      shotsWithFace,
      shotsWithHandheld,
      shotsWithBroll,
      inputSize: [padW, padH],
      elapsedMs,
    },
  };
}

function pathBase(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}
