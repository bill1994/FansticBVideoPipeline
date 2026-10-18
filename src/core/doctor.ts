/**
 * 环境自检（`npm run doctor`）—— 换机/接手时的第一步。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它（2026-10-18）
 * ─────────────────────────────────────────────────────────────
 * 在第二台机器上重装环境时，实际卡住的顺序是：
 *   ffmpeg 不在 PATH → whisper.cpp 没装 → 模型默认是 `small` 而只下了 `base`
 * 每一步都只在**真正跑 align 的那一刻**才报错，且报的是管道异常而非"缺什么"。
 * 换机成本高，不是因为步骤多，而是因为**没有任何一处能一次说清缺什么**。
 *
 * ─────────────────────────────────────────────────────────────
 * 设计约束
 * ─────────────────────────────────────────────────────────────
 * · **只读**。不下载、不修改任何文件 —— 自检不该有副作用。
 * · **可注入依赖**。`DoctorDeps` 把「node 版本 / 命令是否存在 / 文件系统」
 *   全变成入参，于是本模块可在测试里构造"缺 ffmpeg"这类环境，而不必真的卸载它。
 * · **fail 必须带 hint**。只说"缺 ffmpeg"等于把问题丢回去；要说清装法。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** fail / warn 时给出**可执行**的下一步。 */
  hint?: string;
}

export interface DoctorDeps {
  /** 仓库根（用于解析相对路径）。 */
  repoRoot: string;
  /** 环境变量（默认 process.env）。 */
  env: NodeJS.ProcessEnv;
  /** 当前 Node 版本，形如 `22.19.0`。 */
  nodeVersion: string;
  /** 命令是否可在 PATH 中执行。 */
  hasCommand: (cmd: string) => boolean;
  /** 文件/目录是否存在。 */
  exists: (p: string) => boolean;
  /** 列目录（不存在则返回空数组）。 */
  readdir: (p: string) => string[];
}

/** 默认真实依赖 —— CLI 用。 */
export function realDeps(repoRoot: string): DoctorDeps {
  return {
    repoRoot,
    env: process.env,
    nodeVersion: process.versions.node,
    hasCommand: (cmd) => {
      const probe = process.platform === 'win32' ? `${cmd}.exe` : cmd;
      const r = spawnSync(probe, ['-version'], { stdio: 'ignore', timeout: 8000 });
      return !r.error && r.status === 0;
    },
    exists: (p) => fs.existsSync(p),
    readdir: (p) => {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
  };
}

/** Node 主次版本比较：`22.19.0` >= `22.19`。 */
function nodeAtLeast(version: string, major: number, minor: number): boolean {
  const [a, b] = version.split('.').map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a! > major || (a === major && b! >= minor);
}

const WHISPER_BINARIES = ['main.exe', 'whisper-cli.exe', 'main', 'whisper-cli'];

/**
 * 跑全部检查。**顺序即排障顺序**：先系统级（node/ffmpeg），再项目级（whisper/模型）。
 */
export function runChecks(deps: DoctorDeps): CheckResult[] {
  const out: CheckResult[] = [];
  const { repoRoot, env } = deps;

  // ── 1. Node ──────────────────────────────────────────────
  out.push(
    nodeAtLeast(deps.nodeVersion, 22, 19)
      ? { id: 'node', label: 'Node.js', status: 'ok', detail: `v${deps.nodeVersion}` }
      : {
          id: 'node',
          label: 'Node.js',
          status: 'fail',
          detail: `v${deps.nodeVersion} 低于 Remotion 要求`,
          hint: '升级到 22.19+ 或 24+（详见 README「环境要求」）',
        },
  );

  // ── 2/3. ffmpeg / ffprobe ────────────────────────────────
  for (const cmd of ['ffmpeg', 'ffprobe'] as const) {
    out.push(
      deps.hasCommand(cmd)
        ? { id: cmd, label: cmd, status: 'ok', detail: '在 PATH 中可用' }
        : {
            id: cmd,
            label: cmd,
            status: 'fail',
            detail: '不在 PATH 中',
            hint:
              process.platform === 'win32'
                ? 'winget install --id Gyan.FFmpeg -e  然后重开终端（PATH 改动不刷新当前进程）'
                : 'apt install ffmpeg / brew install ffmpeg',
          },
    );
  }

  // ── 4. whisper.cpp ───────────────────────────────────────
  const cppRoot = env.WHISPER_CPP_PATH
    ? path.resolve(env.WHISPER_CPP_PATH)
    : path.join(repoRoot, 'whisper.cpp');
  const cppFiles = deps.readdir(cppRoot);
  const bin = WHISPER_BINARIES.find((b) => cppFiles.includes(b));
  out.push(
    bin
      ? { id: 'whisper-bin', label: 'whisper.cpp', status: 'ok', detail: `${bin} · ${cppRoot}` }
      : {
          id: 'whisper-bin',
          label: 'whisper.cpp',
          status: 'fail',
          detail: `${cppRoot} 下找不到 ${WHISPER_BINARIES.join(' / ')}`,
          hint: 'node --experimental-strip-types tools/setup-whisper.mts（或设 WHISPER_CPP_PATH 指向已有目录）',
        },
  );

  // ── 5. whisper 模型 ──────────────────────────────────────
  const models = cppFiles.filter((f) => /^ggml-.*\.bin$/.test(f)).map((f) => f.slice(5, -4));
  const want = env.WHISPER_MODEL ?? 'small';
  if (models.includes(want)) {
    out.push({ id: 'whisper-model', label: 'whisper 模型', status: 'ok', detail: `ggml-${want}.bin` });
  } else if (models.length > 0) {
    out.push({
      id: 'whisper-model',
      label: 'whisper 模型',
      status: 'warn',
      detail: `默认要 ${want}，实际只找到 ${models.join(' / ')}`,
      hint: `设 WHISPER_MODEL=${models[0]}（或补下 ggml-${want}.bin）；不设则 align 会在跑起来时才报错`,
    });
  } else {
    out.push({
      id: 'whisper-model',
      label: 'whisper 模型',
      status: 'fail',
      detail: '一个 ggml-*.bin 都没有',
      hint: 'node --experimental-strip-types tools/setup-whisper.mts [base|small]',
    });
  }

  // ── 6. perceive 模型 ─────────────────────────────────────
  const onnx = env.PERCEIVE_MODEL
    ? path.resolve(env.PERCEIVE_MODEL)
    : path.join(repoRoot, 'perceive-models', 'face_detection_yunet_2026may-official.onnx');
  out.push(
    deps.exists(onnx)
      ? { id: 'perceive-model', label: 'YuNet 模型', status: 'ok', detail: onnx }
      : {
          id: 'perceive-model',
          label: 'YuNet 模型',
          status: 'warn',
          // 缺它不是硬错：只有 perceive 的 face 通道需要；broll 显著性不依赖模型。
          detail: `找不到 ${onnx}`,
          hint: '从 perceive-models/ 的 README 取 sha256 重新下载，或设 PERCEIVE_MODEL 指向已有 .onnx',
        },
  );

  // ── 7. 占位值文档是否与代码同步 ──────────────────────────
  const docPath = path.join(repoRoot, 'docs/decisions/PARAM-DECISIONS.md');
  out.push(
    deps.exists(docPath)
      ? {
          id: 'param-doc',
          label: '参数决策档案',
          status: 'ok',
          detail: 'docs/decisions/PARAM-DECISIONS.md 存在',
        }
      : {
          id: 'param-doc',
          label: '参数决策档案',
          status: 'warn',
          detail: '文档缺失',
          hint: 'npm run placeholders',
        },
  );

  return out;
}

/** 有 fail 即不通过。warn 不影响退出码。 */
export function doctorOk(results: CheckResult[]): boolean {
  return results.every((r) => r.status !== 'fail');
}
