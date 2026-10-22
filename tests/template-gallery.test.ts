import { beforeAll, describe, expect, test } from 'vitest';
import { loadSpecsFromDisk } from '../src/core/spec-loader.ts';
import { listTemplates } from '../src/templates/registry.ts';
import {
  buildGalleryItem,
  buildTemplateCatalog,
  gallerySlug,
  renderGalleryHtml,
} from '../src/templates/gallery.ts';

beforeAll(() => {
  loadSpecsFromDisk();
});

describe('模板预览画廊', () => {
  test('catalog 覆盖所有已声明模板并标记实现状态', () => {
    const catalog = buildTemplateCatalog();
    const declared = listTemplates()
      .map((t) => t.id)
      .sort();
    expect(catalog.map((e) => e.id).sort()).toEqual(declared);
    expect(catalog.filter((e) => e.implemented)).toHaveLength(17);
    expect(
      catalog
        .filter((e) => !e.implemented)
        .map((e) => e.id)
        .sort(),
    ).toEqual(['annotation/pointer-callout@1.0', 'transition/whip-pan@1.0']);
  });

  test('每个已实现模板都有三帧预览，且必填参数齐全', () => {
    const catalog = buildTemplateCatalog();
    for (const entry of catalog.filter((e) => e.implemented)) {
      expect(entry.preview, entry.id).not.toBeNull();
      const preview = entry.preview!;
      expect(preview.frames, entry.id).toHaveLength(3);
      for (const frame of preview.frames) {
        expect(Number.isInteger(frame), entry.id).toBe(true);
        expect(frame, entry.id).toBeGreaterThanOrEqual(0);
        expect(frame, entry.id).toBeLessThan(preview.durationInFrames);
      }
      for (const key of entry.requiredParams) {
        expect(preview.params, `${entry.id} 缺 ${key}`).toHaveProperty(key);
      }
    }
  });

  test('预览 item 使用模板声明的 footprint 与单一 motion', () => {
    const catalog = buildTemplateCatalog();
    for (const entry of catalog.filter((e) => e.implemented)) {
      const item = buildGalleryItem(entry);
      expect(item.motion).toBe(entry.id);
      expect(item.fromFrame).toBe(0);
      expect(item.durationInFrames).toBe(entry.preview!.durationInFrames);
      expect(item.footprint).toEqual(entry.footprint);
    }
  });

  test('字幕模板的预览包含 cue 与词级时间', () => {
    const entry = buildTemplateCatalog().find((e) => e.id === 'caption/karaoke-word@1.0');
    expect(entry?.preview?.caption?.cues).toHaveLength(1);
    expect(entry?.preview?.caption?.words.length).toBeGreaterThan(0);
  });

  test('gallery.html 离线、确定、17 张卡有图、2 张未实现', () => {
    const catalog = buildTemplateCatalog();
    const html = renderGalleryHtml(catalog);
    expect((html.match(/data-gallery-card="1"/g) ?? [])).toHaveLength(17);
    expect((html.match(/data-gallery-card="0"/g) ?? [])).toHaveLength(2);
    expect((html.match(/<img /g) ?? [])).toHaveLength(51);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toBe(renderGalleryHtml(catalog));
  });

  test('gallery.html 转义模板元数据', () => {
    const [first] = buildTemplateCatalog();
    const html = renderGalleryHtml([{ ...first!, name: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('预览图文件名安全且唯一', () => {
    const slugs = buildTemplateCatalog().map((e) => gallerySlug(e.id));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});
