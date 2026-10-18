/**
 * 阶段写盘守卫 —— 不可变快照的**唯一执行点**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这组测试必须存在（2026-10-18 审计发现）
 * ─────────────────────────────────────────────────────────────
 * `occlusion.ts` 的架构论证里写着「`io.ts` 的不可变快照守班会直接拒绝
 * 04 阶段回写 03”—— 而当时：
 *   ① 函数名 `guardSnapshot` **根本不存在**；
 *   ② 真正同作用的 `assertNotWritingUpstream` **零调用**（连测试都没有）。
 *
 * 也就是说，那条论证的**依据是假的**（结论侥幸对，因为方案 A 本身绕开了写回）。
 * 这是「文档说它承重、代码里没人读」的第五次复发。
 *
 * 所以这里钉两件事：
 *   ① 守卫函数本身的边界（同阶段放行 / 下游写上游必抛）
 *   ② **写入入口**真的调了它 —— 且是**在落盘之前**拦下（不能先写后抛）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import {
  assertNotWritingUpstream,
  stageDir,
  writeStageJson,
} from '../src/core/io.ts';
import { STAGES } from '../src/core/config.ts';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-stageio-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('assertNotWritingUpstream', () => {
  it('写自己这一级：放行', () => {
    expect(() => assertNotWritingUpstream(STAGES.validate, STAGES.validate)).not.toThrow();
  });

  it('写更晚的一级：放行（不算破坏快照）', () => {
    expect(() => assertNotWritingUpstream(STAGES.render, STAGES.validate)).not.toThrow();
  });

  it('写更早的一级：必抛 ConfigError，且错误信息点明上下游', () => {
    expect(() => assertNotWritingUpstream(STAGES.storyboard, STAGES.validate)).toThrow(
      ConfigError,
    );
    expect(() => assertNotWritingUpstream(STAGES.storyboard, STAGES.validate)).toThrow(
      /下游不得回写上游/,
    );
  });
});

describe('writeStageJson', () => {
  it('写自己阶段：落盘且内容可读回', () => {
    const file = writeStageJson({
      jobId: 'j1',
      self: STAGES.validate,
      target: STAGES.validate,
      file: 'validate-report.json',
      data: { ok: true, n: 18 },
      jobsDir: root,
    });

    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ ok: true, n: 18 });
  });

  it('🔴 下游写上游：抛错，且**一个字节都不落盘**', () => {
    const target = path.join(stageDir('j1', STAGES.storyboard, root), 'storyboard.json');

    expect(() =>
      writeStageJson({
        jobId: 'j1',
        self: STAGES.validate,
        target: STAGES.storyboard,
        file: 'storyboard.json',
        data: { hacked: true },
        jobsDir: root,
      }),
    ).toThrow(ConfigError);

    // 关键：守卫必须在 writeJson 之前执行，不能"写完再抛"
    expect(fs.existsSync(target)).toBe(false);
  });

  it('render 写 03：同样拦住（任何下游都一样）', () => {
    expect(() =>
      writeStageJson({
        jobId: 'j1',
        self: STAGES.render,
        target: STAGES.storyboard,
        file: 'storyboard.json',
        data: {},
        jobsDir: root,
      }),
    ).toThrow(ConfigError);
  });
});
