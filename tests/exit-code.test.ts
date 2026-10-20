/**
 * 异常 → 进程退出码的映射。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么单独钉这一组（2026-10-19 端到端审计）
 * ─────────────────────────────────────────────────────────────
 * `render` 失败时原本抛 `ConfigError`，而 CLI 把 `ConfigError` 一律映射成 **2**。
 * 于是错误文案写着「渲染失败（退出码 4）」，`$?` 实际是 **2** ——
 * **报错信息自己报错了自己的退出码**，按文档写 `if ($? == 4)` 的监控永远不触发。
 *
 * 更糟的是 `EXIT.RENDER_FAILED = 4` 全库零消费：常量存在、文档写着、
 * 没有任何代码返回过它。「定义了≠生效」的第七次。
 */

import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  EXIT,
  RenderFailedError,
  StageBlockedError,
  exitCodeFor,
} from '../src/core/exit-code.ts';

describe('exitCodeFor —— 文档承诺的退出码必须真的返回', () => {
  it('参数 / 配置非法 → 2', () => {
    expect(exitCodeFor(new ConfigError('bad'))).toBe(EXIT.BAD_ARGS);
    expect(EXIT.BAD_ARGS).toBe(2);
  });

  it('阶段前置未满足 → 1', () => {
    expect(exitCodeFor(new StageBlockedError('blocked'))).toBe(EXIT.VALIDATION_FAILED);
    expect(EXIT.VALIDATION_FAILED).toBe(1);
  });

  it('🔴 渲染失败 → 4（修复前落成 2）', () => {
    expect(exitCodeFor(new RenderFailedError('remotion exited 1'))).toBe(EXIT.RENDER_FAILED);
    expect(EXIT.RENDER_FAILED).toBe(4);
  });

  it('未归类异常 → 6，且不会被误判成 4', () => {
    expect(exitCodeFor(new Error('boom'))).toBe(EXIT.INTERNAL);
    expect(exitCodeFor('string thrown')).toBe(EXIT.INTERNAL);
  });

  it('子类关系不串味：RenderFailedError 不是 ConfigError', () => {
    const e = new RenderFailedError('x');
    expect(e instanceof ConfigError).toBe(false);
    expect(e instanceof StageBlockedError).toBe(false);
    expect(e.name).toBe('RenderFailedError');
  });
});
