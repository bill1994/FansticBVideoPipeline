#!/usr/bin/env node
/**
 * accept-motion-spec.mts —— `npm run motion:accept` 命令壳（P1-b Task 2，提案 §4）。
 *
 * 用法：npm run motion:accept -- <spec.json 路径> [--force]
 *
 * 读 argv 路径 → `acceptMotionSpec` 六道验收门：
 * · 任一门失败：逐条 console.error 报因 + 退出码 1；
 * · 全部通过：把**带签章的全文**（spec + acceptance 块）写到
 *   `templates/specs/custom-<语义名>@<版本>.json`（文件名由完整 id 派生，
 *   `specLibraryFileName`：'/' 换 '-'，@ 与 . 保留）并打印入库路径。
 *
 * 入库覆写护栏（修复轮 1）：目标文件已存在且 canonical hash 与本次产物
 * 不同（同语义名**同版本**、异内容）→ 拒绝写入并提示升 @版本另立文件；
 * 不存在或 hash 相同（重跑同一产物）→ 正常写入。`--force` 显式越过护栏
 * （越权是人下的决定）。修复轮 2 起文件名按完整 id 派生——升 @版本自动落
 * 新文件（custom/x@0.1 与 @0.2 并存），「重掷 = 新版本文件」字面成立。
 * 判定与文件名派生实现在 `src/core/motion-accept.ts`（纯函数，可测）；
 * 本文件只做 I/O 壳。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  acceptMotionSpec,
  decideSpecOverwrite,
  specLibraryFileName,
} from '../src/core/motion-accept.ts';

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const input = args.find((a) => a !== '--force');
  if (input === undefined || input === '') {
    console.error('用法：npm run motion:accept -- <spec.json 路径> [--force]');
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

  const outPath = path.resolve(
    import.meta.dirname,
    '../templates/specs',
    specLibraryFileName(result.spec.id),
  );
  const signed = `${JSON.stringify({ ...result.spec, acceptance: result.acceptance }, null, 2)}\n`;

  // 覆写护栏（--force 显式越过）：同语义名同版本异内容不入库，旧版本留给已出片 job
  if (!force) {
    const existing = fs.existsSync(outPath)
      ? (fs.readFileSync(outPath, 'utf8') as string)
      : undefined;
    const decision = decideSpecOverwrite(existing, result.acceptance.specHash, result.spec.id);
    if (decision.action === 'reject') {
      console.error(decision.reason);
      process.exitCode = 1;
      return;
    }
  }

  fs.writeFileSync(outPath, signed, 'utf8');
  console.log(`六道门槛全部通过，已入库：${outPath}`);
  console.log(`  specHash: ${result.acceptance.specHash}`);
}

main();
