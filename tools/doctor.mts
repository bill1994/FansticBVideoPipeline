#!/usr/bin/env node
/**
 * doctor.mts — 环境自检 CLI（薄壳）。检查逻辑在 `src/core/doctor.ts`，便于单测。
 *
 * 运行：npm run doctor
 * 退出码：0 = 无 fail（warn 不算失败）；1 = 有 fail
 */

import path from 'node:path';
import { doctorOk, realDeps, runChecks } from '../src/core/doctor.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const results = runChecks(realDeps(repoRoot));

const ICON = { ok: '✅', warn: '⚠️ ', fail: '❌' } as const;

for (const r of results) {
  process.stdout.write(`${ICON[r.status]} ${r.label.padEnd(14)} ${r.detail}\n`);
  if (r.hint) process.stdout.write(`   ↳ ${r.hint}\n`);
}

const fails = results.filter((r) => r.status === 'fail').length;
const warns = results.filter((r) => r.status === 'warn').length;
process.stdout.write(`\n${results.length} 项检查：fail ${fails} / warn ${warns}\n`);

if (!doctorOk(results)) {
  process.stdout.write('环境未就绪 —— 按上面的 ↳ 逐条处理，处理后**重开终端**再跑一次。\n');
  process.exit(1);
}
process.stdout.write('环境就绪。可以跑 demo：npm run pipeline -- validate --job demo --jobs-dir examples\n');
