/**
 * spec-loader 验签 —— custom 入库 spec 必须带吻合签章（P1-b Task 3，AC-7/AC-8）。
 *
 * 被测对象：`loadSpecsFromDisk`（src/core/spec-loader.ts）装载循环内的验签门。
 *
 * 🔴 判据是**文件名 `custom-` 前缀**，不是 id 前缀：
 *    `validateMotionSpec` 的 ID_RE 本就强制**所有** spec 的 id 以 `custom/`
 *    开头 —— 现有 8 份基线 spec（fade-up.json 等）的 id 同样是
 *    `custom/fade-up@1.0`。按 id 前缀判会把基线全部拒掉，「基线无签章正常
 *    装载」（用例④，向后兼容保障）就无法成立。而 motion:accept 的入库命名
 *    恰是 `custom-<语义名>.json`（tools/accept-motion-spec.mts）——
 *    文件名前缀是「验收入库产物」与「基线手写 spec」的唯一可靠区分。
 *
 * 签章对拍用**同一 canonical 公式**就地复算（sha256(JSON.stringify(spec 去
 * acceptance 键, null, 2))），不借生产 helper —— helper 自身的正确性由
 * tests/motion-accept.test.ts ⑤ 对拍钉住，这里只验 loader 的比较行为。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import {
  __resetSpecLoaderForTests,
  loadSpecsFromDisk,
} from '../src/core/spec-loader.ts';
import {
  __resetRegistryForTests,
  getTemplate,
  hasTemplate,
} from '../src/templates/registry.ts';

/** 一份合法 spec（每用例从干净深拷贝派生，同 spec-contract.test.ts 的 baseSpec）。 */
function baseSpec(): Record<string, unknown> {
  return {
    specVersion: 1,
    id: 'custom/x@0.1',
    layer: 60,
    footprint: [0.15, 0.62, 0.7, 0.18],
    minVisibleInFrames: 24,
    occludesSubject: false,
    elements: [
      {
        type: 'text',
        slot: 'main',
        content: 'excerpt',
        sizePx: 48,
        weight: 700,
        align: 'left',
        paddingPx: 24,
      },
    ],
    tracks: [
      {
        element: 0,
        property: 'opacity',
        keys: [
          { t: 0, v: 0, ease: 'out' },
          { t: 1, v: 1, ease: 'out' },
        ],
      },
    ],
  };
}

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** canonical 形态：spec 去 acceptance 键后按 2 空格缩进重序列化（P1-b Task 3 裁决公式）。 */
function canonicalJsonOf(spec: Record<string, unknown>): string {
  const { acceptance: _omit, ...rest } = spec;
  return JSON.stringify(rest, null, 2);
}

/** 按裁决公式就地签发：acceptance 块盖在顶层（toolVersion/gates 与 motion:accept 产物同构）。 */
function signedRaw(spec: Record<string, unknown>): string {
  return JSON.stringify(
    {
      ...spec,
      acceptance: {
        toolVersion: 1,
        specHash: sha256hex(canonicalJsonOf(spec)),
        gates: ['structure', 'registration', 'frames', 'animates', 'lint'],
      },
    },
    null,
    2,
  );
}

const tmpDirs: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-spec-verify-'));
  tmpDirs.push(d);
  return d;
}

const writeSpec = (dir: string, name: string, raw: string): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, raw, 'utf8');
  return file;
};

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  __resetSpecLoaderForTests();
  __resetRegistryForTests();
});

describe('loadSpecsFromDisk 验签 —— custom-* 入库 spec（AC-7）', () => {
  it('① 无签章 custom spec（custom-*.json）→ ConfigError，消息含文件名与 motion:accept 指引', () => {
    const dir = tmpDir();
    writeSpec(dir, 'custom-x.json', JSON.stringify(baseSpec(), null, 2));
    expect(() => loadSpecsFromDisk(dir)).toThrow(ConfigError);
    expect(() => loadSpecsFromDisk(dir)).toThrow(/custom-x\.json/);
    expect(() => loadSpecsFromDisk(dir)).toThrow(/motion:accept/);
  });

  it('② 有签章但文件被手改（hash 不符）→ ConfigError，消息含「签章与文件内容不符」与重跑指引', () => {
    const dir = tmpDir();
    const tampered = JSON.parse(signedRaw(baseSpec())) as Record<string, unknown>;
    // 手改内容但不重签：_note 仍是合法字符串（结构校验照过），只有 hash 对拍失败
    tampered['_note'] = '验收之后被手改过';
    writeSpec(dir, 'custom-x.json', JSON.stringify(tampered, null, 2));
    expect(() => loadSpecsFromDisk(dir)).toThrow(ConfigError);
    expect(() => loadSpecsFromDisk(dir)).toThrow(/签章与文件内容不符/);
    expect(() => loadSpecsFromDisk(dir)).toThrow(/motion:accept/);
  });

  it('③ 签章吻合 → 注册成功，hasTemplate 可查', () => {
    const dir = tmpDir();
    writeSpec(dir, 'custom-x.json', signedRaw(baseSpec()));
    expect(loadSpecsFromDisk(dir)).toBe(1);
    expect(hasTemplate('custom/x@0.1')).toBe(true);
  });

  it('④ 基线 spec（非 custom-* 命名，无签章）→ 正常装载；真实基线目录回归', () => {
    // 边界：custom/ id + 无签章 + 基线命名 → 不受验签门约束（向后兼容）
    const dir = tmpDir();
    writeSpec(dir, 'fade-up.json', JSON.stringify(baseSpec(), null, 2));
    expect(loadSpecsFromDisk(dir)).toBe(1);
    expect(hasTemplate('custom/x@0.1')).toBe(true);

    // 回归保障：仓库里 8 份基线 spec 全部无签章，装载必须照常全绿
    expect(loadSpecsFromDisk()).toBeGreaterThanOrEqual(8);
    expect(hasTemplate('custom/fade-up@1.0')).toBe(true);
  });

  it('⑤ 同 id 双版本并存（custom/x@0.1 与 @0.2）→ 双双注册，getTemplate 各自可达', () => {
    const dir = tmpDir();
    writeSpec(dir, 'custom-x.json', signedRaw(baseSpec()));
    writeSpec(
      dir,
      'custom-x-b.json',
      signedRaw({ ...baseSpec(), id: 'custom/x@0.2', layer: 61 }),
    );
    expect(loadSpecsFromDisk(dir)).toBe(2);
    expect(getTemplate('custom/x@0.1').layer).toBe(60);
    expect(getTemplate('custom/x@0.2').layer).toBe(61);
  });
});
