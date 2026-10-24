#!/usr/bin/env node
/**
 * accept-motion-spec.mts —— `npm run motion:accept` 命令壳（P1-b Task 2，提案 §4）。
 *
 * 用法：npm run motion:accept -- <spec.json 路径>
 *
 * 读 argv 路径 → `acceptMotionSpec` 六道验收门：
 * · 任一门失败：逐条 console.error 报因 + 退出码 1；
 * · 全部通过：把**带签章的全文**（spec + acceptance 块）写到
 *   `templates/specs/custom-<语义名>.json`（名取自 spec id 的 <语义名> 段）
 *   并打印入库路径。
 *
 * 六道门的实现全在 `src/core/motion-accept.ts`（可测）；本文件只做 I/O 壳。
 */

import fs from 'node:fs';
import path from 'node:path';
import { acceptMotionSpec } from '../src/core/motion-accept.ts';
import { parseMotionId } from '../src/templates/types.ts';

function main(): void {
  const input = process.argv[2];
  if (input === undefined || input === '') {
    console.error('用法：npm run motion:accept -- <spec.json 路径>');
    process.exitCode = 1;
    return;
  }

  const absolute = path.resolve(input);
  const fileName = path.basename(absolute);
  let raw: string;
  try {
    raw = fs.readFileSync(absolute, 'utf8');
  } catch (e) {
    console.error(`读取 spec 失败（${fileName}）：${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const result = acceptMotionSpec(raw, fileName);
  if (!result.ok) {
    for (const failure of result.failures) console.error(failure);
    process.exitCode = 1;
    return;
  }

  const { subtype } = parseMotionId(result.spec.id);
  const outPath = path.resolve(import.meta.dirname, '../templates/specs', `custom-${subtype}.json`);
  const signed = `${JSON.stringify({ ...result.spec, acceptance: result.acceptance }, null, 2)}\n`;
  fs.writeFileSync(outPath, signed, 'utf8');
  console.log(`六道门槛全部通过，已入库：${outPath}`);
  console.log(`  specHash: ${result.acceptance.specHash}`);
}

main();
