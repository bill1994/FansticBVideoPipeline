/**
 * 双渲像素一致性检查（D5.6，2026-10-26）。
 *
 * 判据：**同一 Composition、同一 props、同一帧，渲两次 → PNG 字节完全相同。**
 *
 * 🔴 为什么比字节而不是比像素：
 *   PNG 编码对「同像素 + 同编码参数」是确定性的，**字节相同必然像素相同**（更强的判据），
 *   而且不必引入 `pixelmatch` / `pngjs` 之类的解码依赖。
 *   字节不同时本脚本**不下结论**（可能只是编码器元数据差异），只把两个文件路径打出来让人看。
 *
 * 🔴 为什么不整片逐帧比：一条 6667 帧的片子渲两遍约 40 分钟。
 *   抽样帧足以覆盖「确定性被破坏」的典型来源（缓动用了 Date.now / 随机数 /
 *   依赖浏览器 ticker），因为这些一旦发生，**任何一帧都会抖**。
 *
 * 用法：
 *   npm run determinism -- --job demo --jobs-dir examples
 *   npm run determinism -- --job skill-kukini-1022 --frames 100,1200,3000
 *
 * 退出码：0 = 全部帧两次一致；1 = 有帧不一致（**确定性红线被破坏**）；
 *         2 = 前置缺失（没跑过 render --dry-run，拿不到 render-props.json）。
 *
 * ⚠️ 不进 `npm test`：一帧约 12–16 秒（含 bundling），默认跑 3 帧 × 2 次 ≈ 1–1.5 分钟。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

interface Args {
  job: string;
  jobsDir: string;
  frames?: number[];
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const job = get('--job') ?? get('-j');
  if (job === undefined) {
    console.error('缺少 --job <id>。用法：npm run determinism -- --job demo --jobs-dir examples');
    process.exit(2);
  }
  const rawFrames = get('--frames');
  return {
    job,
    jobsDir: get('--jobs-dir') ?? 'jobs',
    ...(rawFrames === undefined
      ? {}
      : { frames: rawFrames.split(',').map((s) => Number.parseInt(s.trim(), 10)) }),
  };
}

const sha256 = (file: string): string =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const base = path.join(args.jobsDir, args.job);
  const renderDir = path.join(base, '05-render');
  const propsFile = path.join(renderDir, 'render-props.json');

  if (!fs.existsSync(propsFile)) {
    console.error(
      `缺少 ${propsFile}\n` +
        `  ↳ 先跑：npm run pipeline -- render --dry-run --job ${args.job} --jobs-dir ${args.jobsDir}\n` +
        `    （dry-run 只做映射与启动闸检查，不真渲染，几秒完成）`,
    );
    return 2;
  }

  const props = JSON.parse(fs.readFileSync(propsFile, 'utf8')) as {
    durationInFrames?: number;
  };
  const total = props.durationInFrames ?? 0;
  if (total <= 0) {
    console.error(`render-props.json 里没有可用的 durationInFrames（读到 ${String(props.durationInFrames)}）`);
    return 2;
  }

  /**
   * 默认抽样帧：**从 storyboard 里挑真有动效的帧**，不按百分比瞎抽。
   *
   * 🔴 为什么改（2026-10-26 实测踩过）：demo 总长 900 帧，而 overlay 只落在
   *   78–724 的若干区间里。按 10%/50%/90% 抽到 90 / 450 / 810 三帧，
   *   其中两帧是纯空画面 —— 空画面比空画面**必然**一致，
   *   「确定性成立」就成了零证据力的假绿。这条自检与下方「全部帧 hash 相同 → 警告」配合，
   *   防止以后又抽到空帧还以为验过了。
   */
  const storyboardFile = path.join(base, '03-storyboard', 'storyboard.json');
  let frames: number[];
  if (args.frames !== undefined) {
    frames = args.frames;
  } else if (fs.existsSync(storyboardFile)) {
    const sb = JSON.parse(fs.readFileSync(storyboardFile, 'utf8')) as {
      tracks?: { items?: { fromFrame: number; durationInFrames: number }[] }[];
    };
    const mids: number[] = [];
    for (const t of sb.tracks ?? []) {
      for (const it of t.items ?? []) {
        mids.push(it.fromFrame + Math.floor(it.durationInFrames / 2));
      }
    }
    // 去重后均匀取 3 个（覆盖开头/中段/结尾的动效，而不是同一段里挤三帧）
    const uniq = [...new Set(mids)].sort((a, b) => a - b);
    frames =
      uniq.length === 0
        ? [0.1, 0.5, 0.9].map((r) => Math.min(total - 1, Math.round(total * r)))
        : [uniq[0], uniq[Math.floor(uniq.length / 2)], uniq[uniq.length - 1]].filter(
            (v): v is number => v !== undefined,
          );
  } else {
    frames = [0.1, 0.5, 0.9].map((r) => Math.min(total - 1, Math.max(0, Math.round(total * r))));
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-determinism-'));
  const publicDir = path.join(base, '00-input');
  const results: { frame: number; a: string; b: string; same: boolean }[] = [];

  try {
    for (const frame of frames) {
      const outA = path.join(tmp, `f${frame}-a.png`);
      const outB = path.join(tmp, `f${frame}-b.png`);
      for (const out of [outA, outB]) {
        const r = spawnSync(
          'npx',
          [
            'remotion',
            'still',
            'src/remotion/index.ts',
            'Overlay',
            out,
            `--frame=${frame}`,
            `--props=${propsFile}`,
            `--public-dir=${publicDir}`,
            '--gl=angle',
          ],
          { stdio: ['ignore', 'ignore', 'pipe'], shell: true, encoding: 'utf8' },
        );
        if (r.status !== 0) {
          console.error(`帧 ${frame} 渲染失败（exit ${String(r.status)}）：\n${(r.stderr ?? '').slice(-800)}`);
          return 1;
        }
      }
      const a = sha256(outA);
      const b = sha256(outB);
      results.push({ frame, a, b, same: a === b });
      console.log(`${a === b ? '✅' : '❌'} 帧 ${frame}: ${a.slice(0, 16)}… ${a === b ? '==' : '!='} ${b.slice(0, 16)}…`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const bad = results.filter((r) => !r.same);
  /**
   * 🔴 自我否证检查：如果**所有抽样帧的 hash 彼此相同**，说明抽到的都是同一张静态画面
   *    （典型：全落在 overlay 区间之外）。此时「两次一致」几乎零证据力 ——
   *    空画面比空画面必然相等。如实警告，不让它冒充「已验过确定性」。
   */
  const distinctFrames = new Set(results.map((r) => r.a)).size;

  if (bad.length === 0) {
    console.log(
      `\n✅ 确定性成立：${results.length} 帧 × 2 次渲染，PNG 字节完全一致。\n` +
        `   （比字节 ⇒ 像素必然相同；任何依赖时间/随机/ticker 的实现都会在这里露馅）`,
    );
    if (results.length > 1 && distinctFrames === 1) {
      console.log(
        `\n⚠️ **但证据力弱**：${results.length} 个抽样帧的画面**彼此完全相同**，\n` +
          `   说明抽到的都是同一张静态画面（很可能全在 overlay 区间之外）。\n` +
          `   ↳ 请用 --frames 明确指定有动效的帧，例如先从 storyboard.json 看 items 的\n` +
          `     fromFrame+durationInFrames，取区间中点。`,
      );
    }
    return 0;
  }

  console.log(
    `\n❌ 确定性被破坏：${bad.length}/${results.length} 帧两次渲染不一致（帧号 ${bad.map((b) => b.frame).join(', ')}）。\n` +
      `   常见来源：组件用了 Date.now / Math.random / CSS animation / 库自带 ticker，\n` +
      `   或某帧依赖了未固定的外部状态（字体加载时序、GPU 非确定性）。\n` +
      `   ↳ 该帧可疑范围按 template 逐个二分：先跑 --frames <该单帧> 复现，再看该帧有哪些模板在播。`,
  );
  return 1;
}

process.exitCode = main();
