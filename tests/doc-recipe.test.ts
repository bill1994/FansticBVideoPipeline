/**
 * 配方卡 `_doc`（P0-3，2026-10-26）。
 *
 * 三条性质必须锁住，缺一条就会踩回项目的老坑：
 *   ① **不破坏装载**：`_doc` 在顶层白名单里，否则带配方卡的 spec 会被规则 11 拒掉；
 *   ② **不影响签章**：改 `_doc` 不能让 specHash 变，否则给已入库 custom spec 补文档 = 验签失败；
 *      同时 `_note` 刻意**仍参与** hash（既有语义，见 motion-accept 注释），本文件用
 *      「改 _doc 不变 / 改 _note 变」的对偶断言把这个不对称锁死；
 *   ③ **能流到消费端**：spec → `deriveDeclaration` → `decl.doc` → gallery catalog。
 *
 * 用仓库里真实的 8 份基线 spec 做数据驱动，不另造夹具 —— 夹具与真实文件漂移
 * 正是「定义了≠生效」的高发区。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveDeclaration, validateMotionSpec } from '../src/core/spec.ts';
import { canonicalSpecHash } from '../src/core/motion-accept.ts';
import { loadSpecsFromDisk } from '../src/core/spec-loader.ts';
import { buildTemplateCatalog } from '../src/templates/gallery.ts';

const SPEC_DIR = path.join(process.cwd(), 'templates', 'specs');
const specFiles = fs
  .readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();
// 基线 = 非 custom 入库文件。`custom-*.json` 是创作期生成、经 motion:accept
// 入库的模板，数量随使用增长 —— 计数钉线只钉基线，钉总数会让每落一个
// custom 模板就误报一次（2026-10-31 pulse-accent@0.1 首次触发）。
const baselineFiles = specFiles.filter((f) => !f.startsWith('custom-'));

const readSpec = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(SPEC_DIR, file), 'utf8')) as Record<string, unknown>;

describe('配方卡 _doc：8 份基线 spec 全部覆盖', () => {
  it('每份 spec 都有 _doc，且结构字段齐备（summary 非空 / fits 非空 / energy 合法）', () => {
    expect(baselineFiles.length).toBe(8);
    for (const file of specFiles) {
      const raw = readSpec(file);
      const doc = raw['_doc'] as Record<string, unknown> | undefined;
      expect(doc, `${file} 缺 _doc`).toBeDefined();
      expect(typeof doc?.['summary']).toBe('string');
      expect((doc?.['summary'] as string).length).toBeGreaterThan(0);
      expect(Array.isArray(doc?.['fits'])).toBe(true);
      expect((doc?.['fits'] as unknown[]).length).toBeGreaterThan(0);
      expect(['low', 'mid', 'mid-high', 'high']).toContain(doc?.['energy']);
    }
  });

  it('带 _doc 的 spec 能通过 validateMotionSpec（顶层白名单收录了它）', () => {
    for (const file of specFiles) {
      expect(() => validateMotionSpec(readSpec(file), { source: file })).not.toThrow();
    }
  });
});

describe('配方卡 _doc：不影响签章（但不改变 _note 的既有语义）', () => {
  it('🔴 改 _doc → canonicalSpecHash 不变（给已入库 custom spec 补文档不会验签失败）', () => {
    const raw = readSpec('fade-up.json');
    const spec = validateMotionSpec(raw);
    const before = canonicalSpecHash(spec);

    const withOtherDoc = validateMotionSpec({
      ...raw,
      _doc: { ...(raw['_doc'] as object), summary: '换一句完全不同的话' },
    });
    expect(canonicalSpecHash(withOtherDoc)).toBe(before);
  });

  it('🔴 改 `_note` → hash **要**变（既有语义：验签测试用例 ② 用手改 _note 模拟篡改）', () => {
    const raw = readSpec('fade-up.json');
    const before = canonicalSpecHash(validateMotionSpec(raw));
    const after = canonicalSpecHash(validateMotionSpec({ ...raw, _note: '手改过的说明' }));
    expect(after).not.toBe(before);
  });
});

describe('配方卡 _doc：能流到消费端', () => {
  it('deriveDeclaration 把 spec._doc 透传成 decl.doc', () => {
    const raw = readSpec('fade-up.json');
    const spec = validateMotionSpec(raw);
    const decl = deriveDeclaration(spec);
    expect(decl.doc).toBeDefined();
    expect(decl.doc?.summary).toBe((raw['_doc'] as Record<string, unknown>)['summary']);
  });

  it('未写 _doc 的 spec → decl.doc 省略（不是空对象，可区分「没写」与「写了空的」）', () => {
    const raw = readSpec('fade-up.json');
    const { _doc: _dropped, ...withoutDoc } = raw;
    const decl = deriveDeclaration(validateMotionSpec(withoutDoc));
    expect(decl.doc).toBeUndefined();
  });

  it('gallery catalog 的 description 来自 doc.summary，且 doc 字段可读', () => {
    // catalog 只列**已注册**模板：custom/* 必须先装载（同 template-gallery.test.ts 的做法）
    loadSpecsFromDisk();
    const catalog = buildTemplateCatalog();
    const entry = catalog.find((e) => e.id === 'custom/fade-up@1.0');
    expect(entry).toBeDefined();
    expect(entry?.doc).not.toBeNull();
    expect(entry?.description).toBe(entry?.doc?.summary);
  });
});
