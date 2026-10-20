/**
 * 视频尺寸 —— 探测与「渲染尺寸从哪来」的**唯一真源**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么单独成文件（2026-10-19 `P4` 裁决）
 * ─────────────────────────────────────────────────────────────
 * 此前 `Composition` 的宽高**硬编码 1920×1080**（`Root.tsx`），而 `SourceManifest`
 * 里没有 width/height 字段 ⇒ 素材分辨率**根本不进契约**。
 *
 * 实测后果：640×360 的占位素材渲出 1920×1080；**竖屏素材完全无路可走**。
 *
 * `probeVideoSize` 原本在 `stages/builtin-perceive.ts` 里 —— `render` 要用它就得
 * 「05 依赖 02」，属跨级依赖。上提到 `core/` 后两个阶段共用同一份探测实现
 * （同 `confirmed.ts` / `carrier-window.ts` 的先例：同一概念只允许一个真源）。
 */

import { spawnSync } from 'node:child_process';
import { ConfigError } from './exit-code.ts';

/** 尺寸缺省值 —— 只在「清单没填且读不到视频」时使用，属**兜底**不是默认值。 */
export const DEFAULT_RENDER_WIDTH = 1920;
export const DEFAULT_RENDER_HEIGHT = 1080;

export interface Size {
  width: number;
  height: number;
}

/** 渲染实际采用的尺寸，以及它的**来源**（供 render-report 追溯）。 */
export interface RenderSize extends Size {
  /** `manifest` = source.json 填的；`ffprobe` = 从视频读的；`default` = 兜底。 */
  from: 'manifest' | 'ffprobe' | 'default';
}

/**
 * 用 ffprobe 读视频真实分辨率。失败即抛（不猜）。
 *
 * 注意：ffprobe 不在 PATH 时会抛 —— 调用方若允许降级，应自己 try/catch，
 * 见 `render.ts` 的 `tryProbeVideoSize`。
 */
export function probeVideoSize(videoPath: string): Size {
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

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/**
 * 决定本次渲染用多大画面。**纯函数**（探测结果由调用方传入），便于单测。
 *
 * 优先级：`source.json` 填了 → 用它；否则用探测值；都没有 → 兜底 1920×1080。
 *
 * 🔴 **只填一半当作配置错误**：只写 `width` 不写 `height` 是明显的半成品，
 * 静默取默认值会让「我明明填了」变成最难查的那类问题。
 */
export function resolveRenderSize(
  manifest: { width?: number; height?: number },
  probed: Size | null,
): RenderSize {
  const hasW = manifest.width !== undefined;
  const hasH = manifest.height !== undefined;

  if (hasW !== hasH) {
    throw new ConfigError(
      `source.json 的 width / height 只填了一个（width=${JSON.stringify(manifest.width)}, ` +
        `height=${JSON.stringify(manifest.height)}）。\n` +
        `  两个要么同时填，要么同时省略 —— 省略时会用 ffprobe 读视频、读不到才兜底 1920×1080。`,
    );
  }

  if (hasW && hasH) {
    if (!isPositiveInt(manifest.width) || !isPositiveInt(manifest.height)) {
      throw new ConfigError(
        `source.json 的 width/height 必须是正整数（实际：${JSON.stringify(manifest.width)}×` +
          `${JSON.stringify(manifest.height)}）。`,
      );
    }
    return { width: manifest.width, height: manifest.height, from: 'manifest' };
  }

  if (probed) return { ...probed, from: 'ffprobe' };

  return { width: DEFAULT_RENDER_WIDTH, height: DEFAULT_RENDER_HEIGHT, from: 'default' };
}
