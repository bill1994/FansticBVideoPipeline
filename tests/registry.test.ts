/**
 * 模板注册表查重（2026-10-20 修复）。
 *
 * 历史问题：`registerTemplate` 直接 `registry.set(t.id, t)` ——
 * 同 id 会**静默替换内置模板**，一处调用就能改掉 `scope` /
 * `minVisibleInFrames`，而全链路无任何提示。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import {
  __resetRegistryForTests,
  getTemplate,
  registerTemplate,
} from '../src/templates/registry.ts';
import type { TemplateDeclaration } from '../src/templates/types.ts';

function customTemplate(id: string): TemplateDeclaration {
  return {
    id,
    family: 'custom',
    subtype: 'test-double',
    version: '1.0',
    scope: 'overlay-safe',
    layer: 50,
    occludesSubject: false,
    paramsSchema: {},
    status: 'custom',
    footprint: [0, 0, 0.2, 0.2],
    minVisibleInFrames: 1,
  };
}

afterEach(() => {
  __resetRegistryForTests();
});

describe('registerTemplate —— 禁止静默覆盖', () => {
  it('同 id 注册两次 → ConfigError（自定义模板）', () => {
    registerTemplate(customTemplate('test/dup@1.0'));
    expect(() => registerTemplate(customTemplate('test/dup@1.0'))).toThrow(ConfigError);
    expect(() => registerTemplate(customTemplate('test/dup@1.0'))).toThrow(
      /模板 id 重复：test\/dup@1\.0/,
    );
  });

  it('给了来源时，错误信息带上「已由 … 注册」', () => {
    registerTemplate(customTemplate('test/dup-src@1.0'), 'tests/fixture-a.ts');
    expect(() => registerTemplate(customTemplate('test/dup-src@1.0'))).toThrow(
      /已由 tests\/fixture-a\.ts 注册/,
    );
  });

  it('没给来源时不编造来源（只报 id 重复）', () => {
    registerTemplate(customTemplate('test/no-src@1.0'));
    let message = '';
    try {
      registerTemplate(customTemplate('test/no-src@1.0'));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('模板 id 重复');
    expect(message).not.toContain('已由');
  });

  it('🔴 不得覆盖内置模板（以 typography/kinetic-line@1.0 试）', () => {
    const original = getTemplate('typography/kinetic-line@1.0');
    expect(() =>
      registerTemplate({
        ...original,
        minVisibleInFrames: 1, // 试图把下限改小
      }),
    ).toThrow(/不得覆盖内置模板：typography\/kinetic-line@1\.0/);
    // 失败后注册表必须原样未变
    expect(getTemplate('typography/kinetic-line@1.0').minVisibleInFrames).toBe(
      original.minVisibleInFrames,
    );
  });

  it('不同 id 可正常注册；__resetRegistryForTests 后可复用同一 id', () => {
    registerTemplate(customTemplate('test/a@1.0'));
    registerTemplate(customTemplate('test/b@1.0'));
    expect(getTemplate('test/a@1.0').subtype).toBe('test-double');

    __resetRegistryForTests();
    expect(() => getTemplate('test/a@1.0')).toThrow(ConfigError); // 已被清掉
    expect(() => registerTemplate(customTemplate('test/a@1.0'))).not.toThrow();
  });

  it('重置不会清掉内置模板', () => {
    __resetRegistryForTests();
    expect(getTemplate('typography/kinetic-line@1.0').id).toBe('typography/kinetic-line@1.0');
  });
});
