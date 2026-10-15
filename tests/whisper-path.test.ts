/**
 * D7 · whisper 路径解析（换机可移植）的回归测试。
 *
 * 病史（优化计划书「问题 8」）：内置对齐器曾把 whisper 目录**硬编码**
 * 为 `G:/VideoPipeline/whisper.cpp` —— 换电脑即崩，且崩法只是一句
 * 「找不到可执行文件」，看不出是路径被写死了。
 *
 * 本文件钉住两条判据：
 * 1. 默认解析 = 「仓库根 / whisper.cpp」，不依赖 cwd、不写死盘符；
 * 2. `src/` 生产代码**零盘符绝对路径**（文档给 D7 定的验收标准）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { resolveWhisperCppRoot } from '../src/stages/whisper-adapter.ts';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('D7 · whisper 目录解析', () => {
  it('默认 = 仓库根 / whisper.cpp（不依赖 cwd）', () => {
    const saved = process.env.WHISPER_CPP_PATH;
    delete process.env.WHISPER_CPP_PATH;
    // 把 cwd 指到别处 —— 解析结果必须不变（旧实现就是栽在 cwd / 盘符上）
    const spy = vi.spyOn(process, 'cwd').mockReturnValue('X:/totally/elsewhere');
    try {
      const root = resolveWhisperCppRoot();
      expect(path.isAbsolute(root)).toBe(true);
      expect(root).toBe(path.join(repoRoot, 'whisper.cpp'));
    } finally {
      spy.mockRestore();
      if (saved === undefined) delete process.env.WHISPER_CPP_PATH;
      else process.env.WHISPER_CPP_PATH = saved;
    }
  });

  it('WHISPER_CPP_PATH 优先（显式配置覆盖默认）', () => {
    const saved = process.env.WHISPER_CPP_PATH;
    const custom = path.join('D:', 'custom', 'whisper.cpp');
    process.env.WHISPER_CPP_PATH = custom;
    try {
      expect(resolveWhisperCppRoot()).toBe(custom);
    } finally {
      if (saved === undefined) delete process.env.WHISPER_CPP_PATH;
      else process.env.WHISPER_CPP_PATH = saved;
    }
  });

  it('src/ 生产代码零盘符绝对路径（D7 验收判据，防回归）', () => {
    const srcDir = path.join(repoRoot, 'src');
    const files = fs
      .readdirSync(srcDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
      .map((f) => path.join(srcDir, f));

    // 盘符绝对路径：形如 `G:/` 或 `C:\`。
    // 前置字符负类用于排除 `https://`（其 `s:/` 的 s 前是词字符 p，不构成盘符）。
    const pattern = /(?:[^A-Za-z0-9_]|^)[A-Za-z]:[\\/]/;
    const violations: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const hit = text.match(pattern);
      if (hit) violations.push(`${path.relative(repoRoot, file)} → "${hit[0].trim()}"`);
    }
    expect(
      violations,
      `src/ 出现盘符绝对路径（换机即崩，D7）：\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
