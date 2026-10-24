#!/usr/bin/env node
/**
 * measure-text-metrics.mts — D-B2 逐模板「字号 × 字数」实测表。
 *
 * 运行：npx tsx tools/measure-text-metrics.mts
 *
 * ── 它解决什么问题 ─────────────────────────────────────────────
 * 构建期校验 #17 用**估算**判断文本溢出。2026-10-15 的结论是
 * 「一套通用系数（CJK 1.0em / 拉丁 0.5em）套不住差异巨大的字重与容器」。
 * D-B2 裁决（2026-10-16）选方案 C：**建实测表**，把系数从「猜」变成「实测」。
 *
 * ── 怎么测（量的是真实模板组件）───────────────────────────────
 * 1. bundle `src/remotion/probe-entry.tsx`（只注册 TextMetricsProbe 合成）
 * 2. 每个模板 × 字符类（CJK / 数字）× 1 / 2 / 10 字，渲静帧
 *    · 纯洋红背景、full-screen footprint：避免底板与背景干扰
 *    · 中段帧：入场已结束、出场未开始
 * 3. 按**文字颜色**筛像素（白 / 金黄），取包围盒宽度 —— 不把底板、阴影算进去
 * 4. 对「字数 → 包围盒宽」线性拟合，斜率 / 字号 = 实测 em 系数
 *
 * 🔴 **必须分 CJK 与拉丁两类测**（2026-10-24 实测踩过）：
 *    最初只测了一类，试图用一个 `charWidthEm` 同时修 CJK 与粗体数字，
 *    结果是「修好数字就把 CJK 砍半」。现契约拆成 `charWidthEm`（CJK）
 *    + `latinWidthEm`（拉丁/数字），本工具按类测量、按类回填。
 *
 * 🔴 **每个样本必须重新 selectComposition**：
 *    `renderStill` 用 `composition.props` 作为 resolved props；只传 `inputProps`
 *    不重建 composition，所有样本都会渲成默认 props（斜率为 0）。
 *
 * 产物：
 *   · docs/templates/2026-10-24-文本度量实测表.json   机器可读（可复算 / 可审查）
 *   · docs/templates/2026-10-24-文本度量实测表.md     人读表格
 *   · out/text-metrics-probe/*.png                  原始静帧（gitignored，便于复核）
 *
 * ⚠️ 实测值依赖**本机字体栈**（Windows Microsoft YaHei / Helvetica Neue）。
 *    换机后字体度量会变，须重跑本工具并复核契约值。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { Jimp } from 'jimp';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.ts';
import { isImplemented } from '../src/remotion/templates/index.tsx';
import { TEXT_WIDTH_KEYS } from '../src/validate/text-metrics.ts';
import { FONT } from '../src/remotion/tokens.ts';
import type { StoryboardItem } from '../src/core/types.ts';
import {
  DEFAULT_TEXT_METRICS_PROBE_PROPS,
  PROBE_BACKGROUND,
} from '../src/remotion/gallery/TextMetricsProbe.tsx';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outDir = path.join(repoRoot, 'out/text-metrics-probe');
const docsDir = path.join(repoRoot, 'docs/templates');
const jsonOut = path.join(docsDir, '2026-10-24-文本度量实测表.json');
const mdOut = path.join(docsDir, '2026-10-24-文本度量实测表.md');

/** 被测字数。1 用于看截距异常，2/10 给出稳定的斜率。 */
const LENGTHS = [1, 2, 10] as const;
/** 中段帧：入场（约 14 帧）已结束、出场（约 70 帧）未开始。 */
const MEASURE_FRAME = 45;
/** 两类字符：CJK 与拉丁数字。数字用 800 粗体模板（stat-card）验证字重差异。 */
const CLASSES = [
  { name: 'cjk', char: '测' },
  { name: 'latin', char: '1' },
] as const;

type ClassName = (typeof CLASSES)[number]['name'];

interface ClassMeasurement {
  char: string;
  lengths: number[];
  widthsPx: number[];
  pxPerChar: number;
  measuredEm: number;
  currentEm: number;
}

interface Measurement {
  id: string;
  key: string;
  fontSizePx: number;
  classes: Record<ClassName, ClassMeasurement>;
}

/** 该模板的文字颜色（与 tokens.ts 的令牌一致）。 */
function textColorOf(id: string): { r: number; g: number; b: number } {
  if (id.startsWith('data/stat-card')) return { r: 255, g: 197, b: 61 }; // COLOR.brand
  return { r: 255, g: 255, b: 255 }; // COLOR.ink
}

/** 文字像素筛选：容忍 PNG 编码与抗锯齿的轻微偏移，但不收半透明阴影。 */
function isTextPixel(r: number, g: number, b: number, c: { r: number; g: number; b: number }): boolean {
  return Math.abs(r - c.r) <= 12 && Math.abs(g - c.g) <= 12 && Math.abs(b - c.b) <= 12;
}

/** 读 PNG，返回文字像素的包围盒宽度；找不到文字像素时抛错（宁可失败不臆造）。 */
async function textBBoxWidth(file: string, color: { r: number; g: number; b: number }): Promise<number> {
  const image = await Jimp.read(file);
  const { width, height, data } = image.bitmap;
  let minX = width;
  let maxX = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (!isTextPixel(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, color)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (maxX < 0) {
    throw new Error(`${path.basename(file)} 中找不到文字像素（颜色 ${JSON.stringify(color)}）`);
  }
  return maxX - minX + 1;
}

/** 最小二乘斜率：字数 → 宽度。 */
function linearSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function markdownTable(rows: Measurement[]): string {
  const lines = [
    '# 文本度量实测表（D-B2，2026-10-24）',
    '',
    '> 由 `npx tsx tools/measure-text-metrics.mts` 生成，**不要手改**。',
    '> 方法：真实模板组件（`MotionItem` 主链）在纯洋红背景、full-screen footprint 下，',
    '> 对 CJK 与数字各渲染 1 / 2 / 10 个字，按文字颜色取包围盒宽度，线性拟合得到 px/字 与 em 系数。',
    '> ⚠️ 数值依赖本机字体栈（见 JSON 的 `environment`），换机后须重跑。',
    '',
    '| 模板 | 参数键 | 字号 | CJK px/字 | CJK 实测 em | CJK 契约 | 数字 px/字 | 数字实测 em | 数字契约 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => {
      const c = r.classes.cjk;
      const l = r.classes.latin;
      return `| \`${r.id}\` | \`${r.key}\` | ${r.fontSizePx} | ${c.pxPerChar.toFixed(2)} | **${c.measuredEm.toFixed(3)}** | ${c.currentEm} | ${l.pxPerChar.toFixed(2)} | **${l.measuredEm.toFixed(3)}** | ${l.currentEm} |`;
    }),
    '',
    '> 契约字段：CJK 用 `charWidthEm`（缺省 1.0），数字/拉丁用 `latinWidthEm`（缺省 0.5）。',
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(docsDir, { recursive: true });

  const targets = BUILTIN_TEMPLATES.filter((t) => t.textMetrics && isImplemented(t.id));
  if (targets.length === 0) throw new Error('没有可测量的模板（textMetrics + 已实现）');

  console.log(`待测模板：${targets.length} 个；每模板 ${CLASSES.length} 类 × ${LENGTHS.length} 个长度`);

  const serveUrl = await bundle({ entryPoint: path.join(repoRoot, 'src/remotion/probe-entry.tsx') });
  const browser = await openBrowser('chrome', {
    chromiumOptions: { gl: 'angle' },
    logLevel: 'error',
  });

  const rows: Measurement[] = [];
  const durationInFrames = DEFAULT_TEXT_METRICS_PROBE_PROPS.item.durationInFrames;
  try {
    for (const tpl of targets) {
      const metrics = tpl.textMetrics!;
      const key = TEXT_WIDTH_KEYS.find((k) => k in tpl.paramsSchema);
      if (!key) {
        throw new Error(`${tpl.id} 有 textMetrics，却没有 ${TEXT_WIDTH_KEYS.join('/')} 中的任一参数键`);
      }
      const color = textColorOf(tpl.id);
      const slug = tpl.id.replace(/[/@]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-');
      const classes = {} as Record<ClassName, ClassMeasurement>;

      for (const cls of CLASSES) {
        const widths: number[] = [];
        for (const n of LENGTHS) {
          const params: Record<string, unknown> = { [key]: cls.char.repeat(n) };
          const item: StoryboardItem = {
            fromFrame: 0,
            durationInFrames,
            motion: tpl.id,
            footprint: [0, 0, 1, 1],
            params,
          };
          const inputProps = { item } as unknown as Record<string, unknown>;
          // 每个样本重建 composition：renderStill 用 composition.props 作 resolved props。
          const composition = await selectComposition({
            serveUrl,
            id: 'TextMetricsProbe',
            inputProps,
            puppeteerInstance: browser,
            chromiumOptions: { gl: 'angle' },
            logLevel: 'error',
          });
          const output = path.join(outDir, `${slug}-${cls.name}-n${n}.png`);
          await renderStill({
            composition,
            serveUrl,
            output,
            frame: MEASURE_FRAME,
            inputProps,
            puppeteerInstance: browser,
            imageFormat: 'png',
            overwrite: true,
            chromiumOptions: { gl: 'angle' },
            logLevel: 'error',
          });
          widths.push(await textBBoxWidth(output, color));
        }
        const pxPerChar = linearSlope([...LENGTHS], widths);
        classes[cls.name] = {
          char: cls.char,
          lengths: [...LENGTHS],
          widthsPx: widths,
          pxPerChar,
          measuredEm: pxPerChar / metrics.fontSizePx,
          currentEm: cls.name === 'cjk' ? (metrics.charWidthEm ?? 1) : (metrics.latinWidthEm ?? 0.5),
        };
      }

      rows.push({ id: tpl.id, key, fontSizePx: metrics.fontSizePx, classes });
      console.log(
        `  ${tpl.id} (${key}, ${metrics.fontSizePx}px) → CJK ${classes.cjk.measuredEm.toFixed(3)}em / 数字 ${classes.latin.measuredEm.toFixed(3)}em`,
      );
    }
  } finally {
    await browser.close({ silent: true });
    await fs.rm(serveUrl, { recursive: true, force: true }).catch(() => undefined);
  }

  const payload = {
    generatedAt: '2026-10-24',
    tool: 'tools/measure-text-metrics.mts',
    method: {
      composition: 'TextMetricsProbe',
      background: PROBE_BACKGROUND,
      frame: MEASURE_FRAME,
      lengths: [...LENGTHS],
      footprint: [0, 0, 1, 1],
      classes: CLASSES.map((c) => ({ name: c.name, char: c.char })),
      note: '按文字颜色筛像素取包围盒；斜率 = 每字前进宽度。CJK 与数字分别拟合。',
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      fontSans: FONT.sans,
      fontNumeric: FONT.numeric,
    },
    measurements: rows,
  };
  await fs.writeFile(jsonOut, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdOut, markdownTable(rows), 'utf8');
  console.log(`完成：${path.relative(repoRoot, jsonOut)} / ${path.relative(repoRoot, mdOut)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
