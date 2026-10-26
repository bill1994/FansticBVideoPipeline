/**
 * 渲染期兜底三类（`E-RT-01/02/03`）的分类判据。
 *
 * 背景：这三条码自 2026-10-12 就定义在 `core/errors.ts`，但**从未被构造过一次** ——
 * `runRender` 用 `stdio:'inherit'` 导致父进程拿不到子进程输出，失败只会抛一句「渲染失败」。
 * 2026-10-26 改为 `spawn` + 累积尾部文本后，本文件锁住分类判据的两条性质：
 *   ① 三类各自可命中；
 *   ② **不误判 / 不硬猜** —— 尤其是 `--gl=angle` 的启动日志不能被当成 GPU 崩溃，
 *      未命中时返回 `null` 而不是塞一个"看起来合理"的码。
 */

import { describe, expect, it } from 'vitest';
import { classifyRenderFailure } from '../src/stages/render.ts';
import { decodeChildOutput } from '../src/core/child-output.ts';

describe('渲染失败分类：三类各自可命中', () => {
  it('WebGL 上下文创建失败 → E-RT-03（GPU）', () => {
    const spec = classifyRenderFailure(
      'Error: Failed to create WebGL context for composition "Overlay"',
    );
    expect(spec?.code).toBe('E-RT-03');
  });

  it('GPU 进程崩溃 → E-RT-03', () => {
    expect(classifyRenderFailure('The GPU process has crashed. Renderer shutting down.')?.code).toBe(
      'E-RT-03',
    );
  });

  it('delayRender 未清理 → E-RT-02（Canvas）', () => {
    const spec = classifyRenderFailure(
      'A delayRender() was called but not cleared after 30000ms',
    );
    expect(spec?.code).toBe('E-RT-02');
  });

  it('getContext 拿到 null → E-RT-02', () => {
    expect(
      classifyRenderFailure("TypeError: Cannot read properties of null (reading 'getContext')")?.code,
    ).toBe('E-RT-02');
  });

  it('字体文件加载失败 → E-RT-01（字体）', () => {
    const spec = classifyRenderFailure('Failed to load font: /fonts/NotoSansSC.woff2 (404)');
    expect(spec?.code).toBe('E-RT-01');
  });
});

describe('渲染失败分类：不误判、不硬猜', () => {
  it('🔴 `--gl=angle` 的正常启动日志不算 GPU 崩溃（裸 angle/gpu 不参与匹配）', () => {
    const startup =
      'Bundling...\nUsing ANGLE renderer\nGL: angle\nRendering 6667 frames...\n' +
      'Encoded 1200/6667';
    expect(classifyRenderFailure(startup)).toBeNull();
  });

  it('完全无关的失败 → null（如实标「未归类」，不塞一个像模像样的码）', () => {
    expect(classifyRenderFailure('Error: ENOENT: no such file or directory, open out.mp4')).toBeNull();
  });

  it('空输出 → null', () => {
    expect(classifyRenderFailure('')).toBeNull();
  });
});

describe('子进程输出解码（Windows GBK 陷阱）', () => {
  it('正常 utf8 按 utf8 解', () => {
    expect(decodeChildOutput(Buffer.from('Rendered 30/30', 'utf8'))).toBe('Rendered 30/30');
  });

  it('🔴 GBK(cp936) 输出不会被烤成乱码（cmd 的「不是内部或外部命令」是 GBK）', () => {
    // 「字体」的 GBK 字节 = D7D6 CCE5；按 utf8 硬解会得到替换字符
    const gbk = Buffer.from([0xd7, 0xd6, 0xcc, 0xe5]);
    expect(decodeChildOutput(gbk)).toBe('字体');
  });

  it('中英混排的 GBK 也能解（分类器要能用中文关键词「字体」）', () => {
    // "font 字体 failed" 里只把中文段用 GBK 编码
    const mixed = Buffer.concat([Buffer.from('font ', 'utf8'), Buffer.from([0xd7, 0xd6, 0xcc, 0xe5])]);
    const decoded = decodeChildOutput(mixed);
    expect(decoded).toContain('字体');
    expect(classifyRenderFailure(`${decoded} not loaded`)?.code).toBe('E-RT-01');
  });
});
