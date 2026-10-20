/**
 * MotionSpec 磁盘装载（S1a，2026-10-20）。
 *
 * 扫描 `templates/specs/*.json` → 校验 → 派生声明 → 注册进模板注册表。
 *
 * 🔴 **本文件绝不能被 `src/remotion/` 下任何文件 import**：
 *    它依赖 `node:fs` / `node:path`，而 Remotion 组件会被打包进**浏览器**运行，
 *    那里没有 `fs` —— 一旦被渲染层引入，`remotion studio` / `render` 会直接崩。
 *    渲染层要拿 spec，只能通过 `storyboard.meta` / props 里的**纯数据**，
 *    或者在 Node 侧（本文件的调用方）先把声明注册好。
 *
 * 🔴 目录不存在时**静默跳过**：spec 是可选扩展，没有它项目照常跑；
 *    把「没装扩展」当错误会让每个新 clone 的仓库第一步就红。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ConfigError } from './exit-code.ts';
import { log } from './log.ts';
import { deriveDeclaration, validateMotionSpec } from './spec.ts';
import { registerTemplate } from '../templates/registry.ts';

/** 已成功装载的目录（幂等：CLI 只会调一次，测试/重复调用不应重复注册）。 */
const loadedDirs = new Set<string>();

/** 默认 spec 目录：`<repo>/templates/specs`（相对本文件定位，不依赖 cwd）。 */
export function defaultSpecDir(): string {
  return path.resolve(import.meta.dirname, '../../templates/specs');
}

/**
 * 装载目录下的全部 spec。
 *
 * @param dir 默认 `templates/specs`；测试可传临时目录
 * @returns 本次新注册的模板数（目录已装载过 / 不存在时返回 0）
 * @throws ConfigError 任一文件读取/解析/校验/注册失败（带文件名）
 */
export function loadSpecsFromDisk(dir: string = defaultSpecDir()): number {
  const resolved = path.resolve(dir);
  if (loadedDirs.has(resolved)) return 0;
  if (!fs.existsSync(resolved)) {
    loadedDirs.add(resolved);
    return 0;
  }

  const files = fs
    .readdirSync(resolved)
    .filter((f) => f.endsWith('.json'))
    .sort();

  let count = 0;
  for (const name of files) {
    const file = path.join(resolved, name);
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      throw new ConfigError(`读取 spec 失败（templates/specs/${name}）：${(e as Error).message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new ConfigError(
        `spec JSON 解析失败（templates/specs/${name}）：${(e as Error).message}`,
      );
    }

    try {
      const spec = validateMotionSpec(parsed, {
        byteSize: Buffer.byteLength(raw, 'utf8'),
        source: `templates/specs/${name}`,
      });

      // 装载期 warning（不进 18 项校验）：逐字揭示与 clip 同用会切出半个字。
      const hasSplitChars = spec.elements.some(
        (el) => el.type === 'text' && el.split === 'chars',
      );
      const hasClipTrack = spec.tracks.some((t) => t.property === 'clip');
      if (hasSplitChars && hasClipTrack) {
        log.warn(
          `${name}: split:'chars' 与 clip 轨同用 —— 裁切边界会从字符中间扫过，` +
            `会出现半个字（S1 实测）。要逐字请只用 split；要揭示请只用 clip。`,
        );
      }

      registerTemplate(deriveDeclaration(spec), `templates/specs/${name}`);
      count += 1;
    } catch (e) {
      if (e instanceof ConfigError) {
        // 带文件名再抛一次：调用方（CLI）只看到一行入口，必须能定位是哪个 spec。
        throw new ConfigError(`spec 装载失败（templates/specs/${name}）：\n${e.message}`);
      }
      throw e;
    }
  }

  loadedDirs.add(resolved);
  return count;
}

/**
 * **仅供测试**：清除「已装载」标记（不清注册表；注册表用
 * `__resetRegistryForTests` 一起清，避免不同测试互相污染）。
 */
export function __resetSpecLoaderForTests(): void {
  loadedDirs.clear();
}
