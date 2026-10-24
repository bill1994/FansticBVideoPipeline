/**
 * MotionSpec 磁盘装载（S1a，2026-10-20）。
 *
 * 扫描 `templates/specs/*.json` → 校验 → 验签（custom-* 入库文件，P1-b）
 * → 派生声明 → 注册进模板注册表。
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
import { deriveDeclaration, validateMotionSpec, type MotionSpec } from './spec.ts';
import { canonicalSpecHash } from './motion-accept.ts';
import { registerTemplate } from '../templates/registry.ts';

/**
 * 验收入库文件的命名约定（AC-7 验签判据）：motion:accept 全过后写出的文件
 * 恒为 `custom-<语义名>.json`（tools/accept-motion-spec.mts）。
 *
 * 🔴 为什么判**文件名**而不是 id 前缀：`validateMotionSpec` 的 ID_RE 强制
 *    **所有** spec 的 id 以 `custom/` 开头 —— 现有 8 份基线 spec（fade-up.json
 *    等）的 id 同样是 `custom/fade-up@1.0`，按 id 判会把基线全部拒之门外，
 *    「基线无签章照常装载」的向后兼容（AC-8 回归保障）就没了。文件名前缀
 *    是「验收产物」与「基线手写 spec」唯一可靠的区分。
 */
const CUSTOM_SIGNED_PREFIX = 'custom-';

/**
 * 验签门（P1-b Task 3，AC-7）：`custom-*` 入库文件必须带吻合签章。
 *
 * 形状已由 `validateMotionSpec` 校验；这里只做两件事：
 * ① 签章存在性 —— 缺失即拒（创作期 spec 必须走 motion:accept 六道门入库）；
 * ② hash 对拍 —— `acceptance.specHash === canonicalSpecHash(spec 去 acceptance)`，
 *    不符说明文件在验收后被手改过。两处的错误信息都给可执行做法（重跑
 *    motion:accept）。非 `custom-*` 文件（基线 spec）不做任何要求。
 *
 * @throws ConfigError 由调用方的 try/catch 包上文件名再抛
 */
function verifyAcceptanceSignature(spec: MotionSpec, name: string): void {
  if (!name.startsWith(CUSTOM_SIGNED_PREFIX)) return;
  if (spec.acceptance === undefined) {
    throw new ConfigError(
      `custom 入库 spec（${CUSTOM_SIGNED_PREFIX}*.json，motion:accept 的产物）缺少验收签章 —— ` +
        `重跑 npm run motion:accept -- templates/specs/${name} 过六道门后再装载`,
    );
  }
  if (spec.acceptance.specHash !== canonicalSpecHash(spec)) {
    throw new ConfigError(
      '签章与文件内容不符（acceptance.specHash ≠ canonical spec hash）—— ' +
        '文件在验收后被改动过。重跑 npm run motion:accept -- templates/specs/' +
        `${name} 重新验收入库`,
    );
  }
}

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

      // P1-b 验签门（AC-7）：custom-* 入库文件必须带吻合签章；基线不要求。
      verifyAcceptanceSignature(spec, name);

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
