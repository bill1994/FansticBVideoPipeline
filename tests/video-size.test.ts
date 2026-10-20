/**
 * 渲染尺寸解析（`P4` 裁决，2026-10-19）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它
 * ─────────────────────────────────────────────────────────────
 * 此前 `Root.tsx` 把 `<Composition width={1920} height={1080}>` **写死**，
 * 而 `SourceManifest` 里没有 width/height ⇒ 素材分辨率**根本不进契约**。
 * 实测：640×360 的占位素材渲出 1920×1080；竖屏素材完全无路可走。
 *
 * 优先级：`source.json` 填了 → 用它；否则 ffprobe 读视频；都没有 → 兜底 1920×1080。
 * 纯函数部分（`resolveRenderSize`）不碰磁盘，便于单测。
 */

import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import {
  DEFAULT_RENDER_HEIGHT,
  DEFAULT_RENDER_WIDTH,
  resolveRenderSize,
} from '../src/core/video-size.ts';

describe('resolveRenderSize —— 清单 → ffprobe → 兜底', () => {
  it('清单填了 → 用清单（from=manifest）', () => {
    expect(resolveRenderSize({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })).toEqual({
      width: 1080,
      height: 1920,
      from: 'manifest',
    });
  });

  it('清单没填 + 探测到 → 用探测值（from=ffprobe）', () => {
    expect(resolveRenderSize({}, { width: 640, height: 360 })).toEqual({
      width: 640,
      height: 360,
      from: 'ffprobe',
    });
  });

  it('清单没填 + 探测失败 → 兜底 1920×1080（from=default）', () => {
    expect(resolveRenderSize({}, null)).toEqual({
      width: DEFAULT_RENDER_WIDTH,
      height: DEFAULT_RENDER_HEIGHT,
      from: 'default',
    });
  });

  it('🔴 只填一个 → ConfigError（半填是明显配置错误，不静默取默认）', () => {
    expect(() => resolveRenderSize({ width: 1080 }, null)).toThrow(ConfigError);
    expect(() => resolveRenderSize({ width: 1080 }, null)).toThrow(/同时填/);
    expect(() => resolveRenderSize({ height: 1080 }, null)).toThrow(/同时填/);
  });

  it('填了非正整数 → ConfigError', () => {
    expect(() => resolveRenderSize({ width: 0, height: 1080 }, null)).toThrow(/正整数/);
    expect(() => resolveRenderSize({ width: 1920.5, height: 1080 }, null)).toThrow(/正整数/);
    expect(() => resolveRenderSize({ width: Number.NaN, height: 1080 }, null)).toThrow(/正整数/);
  });

  it('清单填了就不用探测（竖屏不被 16:9 覆盖）', () => {
    const r = resolveRenderSize({ width: 1080, height: 1920 }, { width: 1920, height: 1080 });
    expect(r.width).toBe(1080);
    expect(r.from).toBe('manifest');
  });
});
