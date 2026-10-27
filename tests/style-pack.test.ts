/**
 * 样式包 / 设计令牌（EAC P1-4，2026-10-27）。
 *
 * 锁四件事：
 *   ① **未知包名必须抛 ConfigError**，不静默回退 —— 回退会把「包名打错」变成
 *      「配色莫名不对」，后者极难排查；
 *   ② 缺省（`source.json` 没写）必须是 `dark`，且它的色值与改造前的 `tokens.ts` **逐字一致**
 *      —— 这是「现有 job 行为不变」这条验收的唯一保证；
 *   ③ 两套包的色值必须真的不同（否则「两个 pack 渲出不同」是假的）；
 *   ④ 结构不合法的包必须拒绝（缺色键 / 缺字体）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PACK,
  listPackNames,
  loadStylePack,
  resolveStylePackName,
} from '../src/core/style-pack.ts';

describe('样式包 · 加载与校验', () => {
  it('仓库自带 dark / light 两套', () => {
    const names = listPackNames();
    expect(names).toContain('dark');
    expect(names).toContain('light');
  });

  it('🔴 未知包名抛 ConfigError，且提示可用包名', () => {
    expect(() => loadStylePack('neon-cyber')).toThrow(/未知样式包/);
    try {
      loadStylePack('neon-cyber');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('dark');
      expect(msg).toContain('light');
    }
  });

  it('缺省包名是 dark', () => {
    expect(DEFAULT_PACK).toBe('dark');
    expect(resolveStylePackName({})).toBe('dark');
    expect(resolveStylePackName(null)).toBe('dark');
    expect(resolveStylePackName({ stylePack: 'light' })).toBe('light');
    // 非字符串 / 空串 都按缺省处理，不当作合法包名
    expect(resolveStylePackName({ stylePack: 42 })).toBe('dark');
    expect(resolveStylePackName({ stylePack: '' })).toBe('dark');
  });
});

describe('样式包 · 内容契约', () => {
  it('dark 与改造前的 tokens.ts 逐字一致（现有 job 观感不变）', () => {
    const dark = loadStylePack('dark');
    expect(dark.colors.ink).toBe('#FFFFFF');
    expect(dark.colors.brand).toBe('#FFC53D');
    expect(dark.colors.plate).toBe('rgba(14,17,20,0.78)');
    expect(dark.mode).toBe('dark');
  });

  it('两套包的 ink / brand / mode 都不同（否则「换 pack 渲出不同」是假的）', () => {
    const dark = loadStylePack('dark');
    const light = loadStylePack('light');
    expect(dark.colors.ink).not.toBe(light.colors.ink);
    expect(dark.colors.brand).not.toBe(light.colors.brand);
    expect(dark.mode).not.toBe(light.mode);
  });
});

describe('样式包 · 结构校验（坏包必须拒）', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-pack-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function write(name: string, body: unknown): void {
    fs.writeFileSync(path.join(tmp, `${name}.json`), JSON.stringify(body), 'utf8');
  }

  it('缺色键 → 报错并点名缺哪个', () => {
    write('broken', { name: 'broken', colors: { ink: '#fff' }, fonts: { sans: 'x', numeric: 'y' } });
    expect(() => loadStylePack('broken', tmp)).toThrow(/colors\.inkDim/);
  });

  it('缺 fonts → 报错', () => {
    write('nofont', {
      name: 'nofont',
      colors: {
        ink: '#fff',
        inkDim: '#eee',
        brand: '#f00',
        accent: '#00f',
        plate: '#000',
        hairline: '#333',
      },
    });
    expect(() => loadStylePack('nofont', tmp)).toThrow(/fonts/);
  });

  it('mode 只能是 dark / light', () => {
    write('badmode', {
      name: 'badmode',
      mode: 'neon',
      colors: {
        ink: '#fff',
        inkDim: '#eee',
        brand: '#f00',
        accent: '#00f',
        plate: '#000',
        hairline: '#333',
      },
      fonts: { sans: 'x', numeric: 'y' },
    });
    expect(() => loadStylePack('badmode', tmp)).toThrow(/mode/);
  });
});
