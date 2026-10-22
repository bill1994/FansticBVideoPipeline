#!/usr/bin/env node
/**
 * build-template-gallery.mts — 生成模板预览画廊（P0-1）。
 *
 * 运行：npm run templates:gallery
 * 产物：out/template-gallery/
 *   · images/<slug>-f<frame>.png   每个已实现模板 3 帧
 *   · gallery.html                 离线画廊（无外部资源）
 *   · catalog.json                 目录快照（可被后续 MCP / 工具复用）
 *
 * 为什么用 `TemplateGallery` 合成而不是 `Overlay`：
 * 预览只需要一个 item；走完整 storyboard 会为了一张图伪造一整套阶段产物。
 * 渲染仍经过 `MotionItem`（与成片同一条主链），不会出现“预览好看、成片另一套”。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { loadSpecsFromDisk } from '../src/core/spec-loader.ts';
import { listTemplates } from '../src/templates/registry.ts';
import {
  buildGalleryItem,
  buildTemplateCatalog,
  gallerySlug,
  renderGalleryHtml,
  type TemplateCatalogEntry,
} from '../src/templates/gallery.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outDir = path.join(repoRoot, 'out/template-gallery');
const imagesDir = path.join(outDir, 'images');

function previewInputProps(entry: TemplateCatalogEntry): Record<string, unknown> {
  const preview = entry.preview;
  if (preview === null) throw new Error(`模板 ${entry.id} 未实现，不能生成预览`);
  return {
    item: buildGalleryItem(entry),
    ...(preview.caption === undefined ? {} : { caption: preview.caption }),
    // `custom/*` 的声明不在 bundle 里，必须随 props 送进浏览器侧 hydrate。
    templates: listTemplates(),
  };
}

async function main(): Promise<void> {
  loadSpecsFromDisk();
  const catalog = buildTemplateCatalog();
  const implemented = catalog.filter((entry) => entry.implemented);
  const totalStills = implemented.reduce((sum, entry) => sum + (entry.preview?.frames.length ?? 0), 0);

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(imagesDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, 'catalog.json'),
    `${JSON.stringify(catalog, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(path.join(outDir, 'gallery.html'), renderGalleryHtml(catalog), 'utf8');

  console.log(
    `目录：${catalog.length} 个声明 / ${implemented.length} 个已实现 / ${catalog.length - implemented.length} 个未实现`,
  );
  console.log(`预览：${totalStills} 张（${implemented.length} 个模板 × 3 帧）`);
  console.log('打包 Remotion bundle…');

  let lastBucket = -1;
  const serveUrl = await bundle({
    entryPoint: path.join(repoRoot, 'src/remotion/index.ts'),
    onProgress: (progress) => {
      // Remotion 这里给的是 0–100（不是 0–1）；每 25% 打一行，避免刷屏。
      const bucket = Math.floor(progress / 25);
      if (bucket === lastBucket) return;
      lastBucket = bucket;
      process.stdout.write(`  bundle ${Math.round(progress)}%\n`);
    },
  });

  const browser = await openBrowser('chrome', {
    chromiumOptions: { gl: 'angle' },
    logLevel: 'error',
  });

  let done = 0;
  try {
    for (const entry of implemented) {
      const preview = entry.preview;
      if (preview === null) continue;
      const inputProps = previewInputProps(entry);
      const composition = await selectComposition({
        serveUrl,
        id: 'TemplateGallery',
        inputProps,
        puppeteerInstance: browser,
        chromiumOptions: { gl: 'angle' },
        logLevel: 'error',
      });

      for (const frame of preview.frames) {
        const output = path.join(imagesDir, `${gallerySlug(entry.id)}-f${frame}.png`);
        await renderStill({
          composition,
          serveUrl,
          output,
          frame,
          inputProps,
          puppeteerInstance: browser,
          imageFormat: 'png',
          overwrite: true,
          chromiumOptions: { gl: 'angle' },
          logLevel: 'error',
        });
        done += 1;
        process.stdout.write(`  [${done}/${totalStills}] ${entry.id} f${frame}\n`);
      }
    }
  } finally {
    await browser.close({ silent: true });
    // bundle 是本次运行的临时目录；画廊只依赖 out/template-gallery。
    await fs.rm(serveUrl, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`完成：${path.relative(repoRoot, path.join(outDir, 'gallery.html'))}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
