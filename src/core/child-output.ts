/**
 * 子进程输出解码 —— **唯一实现点**（2026-10-26）。
 *
 * 🔴 为什么单独成文件：这个坑出现过**两次**，第二次正是因为它当时只写在 `render.ts` 里。
 *   ① `render` 渲失败时 `outputTail` 全是乱码（`'npx' ����`）；
 *   ② `cancel` 调 `taskkill` 的回执也是乱码（`�ɹ�: ����ֹ PID`）。
 *   两者都是「Windows 的 cmd / 系统工具走 GBK(cp936)，父进程按 utf8 硬解」。
 *
 * 修一次就必须修一类 —— 所以把解码收成公共函数，而不是在第二个调用点再抄一遍
 * （项目已经因为「同一概念两份实现」栽过多次，见 `targetRef` / `padStart(3,'0')`）。
 */

import { spawnSync } from 'node:child_process';

/**
 * 解转子进程输出。
 *
 * 顺序：**严格 utf8** → 回退 **gbk** → 最后 **latin1**（至少不丢字节）。
 *
 * ⚠️ 必须用 `fatal: true` 的 utf8：非严格模式下 Node 会把非法字节换成 `U+FFFD`（�），
 *    看起来"解成功了"，实际已经不可逆地丢掉了信息，回退分支永远不会触发。
 */
export function decodeChildOutput(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return buf.toString('latin1');
    }
  }
}

/**
 * 同步跑子进程并把输出按正确编码解出来。
 *
 * 供 `cancel` 的 `taskkill` 这类「输出只用于给人看」的调用点使用。
 * 注意：**不用它跑会吐出大段日志的命令**（会整块驻留内存），长任务走流式。
 */
export function runForText(
  cmd: string,
  args: string[],
  opts: { shell?: boolean } = {},
): { status: number | null; output: string } {
  const r = spawnSync(cmd, args, {
    shell: opts.shell ?? true,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const buf = Buffer.concat([
    Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.alloc(0),
    Buffer.isBuffer(r.stderr) ? r.stderr : Buffer.alloc(0),
  ]);
  return { status: r.status, output: decodeChildOutput(buf).trim() };
}
