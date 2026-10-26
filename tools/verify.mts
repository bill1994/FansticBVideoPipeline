/**
 * 一条命令跑完三段验收（A3，2026-10-26）。
 *
 * 为什么需要：此前只有 `npm test`（纯单元）与一堆手敲的 CLI 命令 ——
 * **没有任何一条命令能回答「README 的第一条流程现在还成立吗」**。
 * 单元测试全绿但五阶段串不上，是这个项目反复出现的假绿形态之一。
 *
 * 三段（任一失败即停，非零退出）：
 *   ① typecheck —— tsc --noEmit
 *   ② test      —— vitest 全量（含跨阶段集成测试）
 *   ③ e2e       —— 复制 examples/demo 到临时目录，用 **CLI** 真跑
 *                  storyboard → validate → review --dry-run → render --dry-run
 *
 * 为什么 e2e 段用 CLI 而不是直接调函数：函数级链路已被 `tests/pipeline-e2e.test.ts`
 * 覆盖；这里要验的是**用户实际敲的那条命令**（参数解析、退出码、产物落盘位置）。
 *
 * ⚠️ 边界：e2e 段不跑 align / perceive（需 whisper 模型与 ffmpeg，分钟级），
 *   也不真渲视频（900 帧约 1 分钟 + 依赖 Chrome）。这两块的验证分别是
 *   各自阶段的单测与 `npm run determinism`。
 *
 * 用法：`npm run verify`（全量，约 1.5–2 分钟）/ `npm run verify -- --skip-test`（快速冒烟）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

interface StepResult {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
}

const ROOT = process.cwd();
const skipTest = process.argv.includes('--skip-test');

/** 跑一条命令，把 stdout/stderr 收集起来（只在失败时回显尾部）。 */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; expectFail?: boolean } = {},
): { ok: boolean; output: string; status: number | null } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  // ⚠️ 必须剥掉 ANSI 颜色码再匹配：vitest 输出形如 `Tests\x1b[1m\x1b[32m 836 passed`，
  //    直接正则会把数字挡在色码后面（第一版就因此打印成 "? 项通过"）。
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '');
  const status = r.status;
  const ok = opts.expectFail === true ? status !== 0 : status === 0;
  return { ok, output, status };
}

function step(name: string, fn: () => { ok: boolean; detail: string }): StepResult {
  const t0 = Date.now();
  const { ok, detail } = fn();
  const ms = Date.now() - t0;
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(12)} ${(ms / 1000).toFixed(1)}s  ${detail}`);
  return { name, ok, ms, detail };
}

/** 取输出里第一行像样的错误（失败时回显，避免整屏日志）。 */
function tailOf(output: string, lines = 12): string {
  const picked = output
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(-lines)
    .join('\n');
  return picked;
}

function main(): number {
  console.log('\n===== npm run verify =====\n');
  const results: StepResult[] = [];

  results.push(
    step('typecheck', () => {
      const r = run('npm', ['run', 'typecheck']);
      return { ok: r.ok, detail: r.ok ? 'tsc --noEmit 通过' : tailOf(r.output) };
    }),
  );
  if (!results.at(-1)?.ok) return finish(results);

  if (!skipTest) {
    results.push(
      step('test', () => {
        const r = run('npm', ['test']);
        // vitest 的汇总行形如 "Tests  828 passed (828)"
        const m = r.output.match(/Tests\s+(\d+)\s+passed/);
        return {
          ok: r.ok,
          detail: r.ok ? `${m?.[1] ?? '?'} 项通过` : tailOf(r.output, 30),
        };
      }),
    );
    if (!results.at(-1)?.ok) return finish(results);
  }

  results.push(
    step('e2e-demo', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-verify-'));
      try {
        fs.cpSync(path.join(ROOT, 'examples', 'demo'), path.join(tmp, 'demo'), { recursive: true });
        // ⚠️ stage 必须紧跟 `--`（CLI 的解析顺序是 `pipeline -- <stage> --job <id>`）
        const cli = (stage: string, ...extra: string[]): string[] => [
          'run',
          'pipeline',
          '--',
          stage,
          '--job',
          'demo',
          '--jobs-dir',
          tmp,
          ...extra,
        ];

        // ① 烘焙
        const sb = run('npm', cli('storyboard'));
        if (!sb.ok) return { ok: false, detail: `storyboard 失败\n${tailOf(sb.output)}` };

        // ② 校验
        const va = run('npm', cli('validate'));
        const checked = va.output.match(/checked=(\d+)/)?.[1];
        if (!va.ok || checked !== '18') {
          return { ok: false, detail: `validate 失败或 checked≠18（读到 ${String(checked)}）\n${tailOf(va.output)}` };
        }

        // ③ 看片（dry-run：只产 preview-props，不启 Studio）
        const rv = run('npm', cli('review', '--dry-run'));
        if (!rv.ok) return { ok: false, detail: `review 失败\n${tailOf(rv.output)}` };

        // ④ 渲染启动闸：demo 故意留一条 must_review，**预期被拦**
        const blocked = run('npm', cli('render', '--dry-run'), { expectFail: true });
        if (!blocked.output.includes('must_review')) {
          return { ok: false, detail: `render 未被 must_review 闸拦下（闸门可能失效）\n${tailOf(blocked.output)}` };
        }

        // ⑤ 补人工确认后放行
        fs.writeFileSync(
          path.join(tmp, 'demo', '06-review', 'confirmed.json'),
          `${JSON.stringify(
            {
              records: [
                {
                  jobId: 'demo',
                  stage: 'render',
                  reason: 'verify：e2e 冒烟',
                  confirmedBy: 'verify',
                  confirmedAt: new Date().toISOString(),
                  acknowledgedReview: ['typo-main/002'],
                },
              ],
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        const passed = run('npm', cli('render', '--dry-run'));
        if (!passed.ok) return { ok: false, detail: `确认后 render 仍失败\n${tailOf(passed.output)}` };

        return { ok: true, detail: 'storyboard → validate(18) → review → render 闸门两向均符合预期' };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }),
  );

  return finish(results);
}

function finish(results: StepResult[]): number {
  const total = results.reduce((s, r) => s + r.ms, 0);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '✅ 全部通过' : `❌ ${failed.length} 段失败`} · 总耗时 ${(total / 1000).toFixed(1)}s`);
  if (failed.length > 0) {
    console.log(`失败段：${failed.map((f) => f.name).join(', ')}`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
