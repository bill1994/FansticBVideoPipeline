/**
 * 一次性安装 whisper.cpp 与模型 —— M-1 第一步的环境准备。
 *
 * 用法：
 *   node --experimental-strip-types tools/setup-whisper.mts
 *
 * 为什么单独一个脚本而不是塞进 CLI：
 * 装 whisper 是**一次性的环境准备**，不是管线的一步。
 * 塞进 align 阶段会让每次跑管线都去探测/下载几百 MB。
 *
 * ── 国内网络的坑（2026-10-13 实测）─────────────────────────────
 * `downloadWhisperModel()` 从 huggingface.co 直下，**本机代理对
 * huggingface 域返回 ConnectTimeout**。须走 hf-mirror：
 *   https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
 * 故本脚本先试官方，失败则自动切镜像 —— 不要求使用者手工选。
 */

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { installWhisperCpp, downloadWhisperModel } from '@remotion/install-whisper-cpp';

const FOLDER = 'whisper.cpp';
const CPP_VERSION = '1.5.5';
const MODEL = process.argv[2] ?? 'base';

const mirrorUrl = (m: string): string =>
  `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-${m}.bin`;

function expectedSize(model: string): number | null {
  // 与官方 getModelPath 同一批数值，抄一份以便本地校验完整性
  const sizes: Record<string, number> = {
    tiny: 77691713, base: 147951465, small: 487601967,
    'base.en': 147964211, 'small.en': 487614201, 'tiny.en': 77704715,
    medium: 1533763059,
  };
  return sizes[model] ?? null;
}

async function main(): Promise<void> {
  console.log(`[1/2] 安装 whisper.cpp ${CPP_VERSION}`);
  console.log('      Windows 走预编译二进制（≤1.6.0），不需要 cmake / Python');
  const r1 = await installWhisperCpp({ to: FOLDER, version: CPP_VERSION, printOutput: true });
  console.log(`      alreadyExisted = ${r1.alreadyExisted}`);

  console.log(`[2/2] 准备模型 ${MODEL}`);
  const bin = path.resolve(FOLDER, `ggml-${MODEL}.bin`);

  // 上次失败可能留下 0 字节文件，会让官方 API 直接报错，先清掉
  if (fs.existsSync(bin) && fs.statSync(bin).size === 0) {
    fs.unlinkSync(bin);
    console.log('      清理了上次失败留下的 0 字节文件');
  }

  try {
    const r2 = await downloadWhisperModel({ folder: FOLDER, model: MODEL as never, printOutput: true });
    console.log(`      alreadyExisted = ${r2.alreadyExisted}`);
    console.log('DONE');
    return;
  } catch (e) {
    console.log(`      官方源失败：${(e as Error).message}`);
    console.log('      切 hf-mirror 重试…');
  }

  if (!fs.existsSync(FOLDER)) fs.mkdirSync(FOLDER, { recursive: true });
  const url = mirrorUrl(MODEL);
  console.log(`      GET ${url}`);
  execFileSync('curl', ['-L', '-f', '--retry', '3', '-m', '1800', '-o', bin, url], {
    stdio: 'inherit',
  });

  const size = fs.statSync(bin).size;
  const want = expectedSize(MODEL);
  if (want !== null && size !== want) {
    throw new Error(`模型大小不符：实际 ${size}，期望 ${want}。请删除 ${bin} 后重试。`);
  }
  console.log(`      OK ${size} 字节`);
  console.log('DONE');
}

main().catch((e: unknown) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
