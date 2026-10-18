/**
 * job 目录读写 + 不可变快照守卫。
 *
 * 真源：SPEC §5.1（F1）三个关键设计点
 *  1. 每级是不可变快照 —— 下游不得回写上游文件
 *  2. 禁跨级引用 —— storyboard 只能引用 01/02 的产物，不得引用 05 的成片
 *  3. 06-review 独立于 03 —— 人工放行信息不进 storyboard
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_JOBS_DIR, STAGE_ORDER, STAGES } from './config.ts';
import { ConfigError } from './exit-code.ts';

export type StageName = (typeof STAGE_ORDER)[number];

/** 阶段名 → 目录序号，用于「不得回写上游」的判定。 */
function stageIndex(stage: StageName): number {
  return STAGE_ORDER.indexOf(stage);
}

export function jobDir(jobId: string, jobsDir: string = DEFAULT_JOBS_DIR): string {
  return path.resolve(jobsDir, jobId);
}

export function stageDir(jobId: string, stage: StageName, jobsDir: string = DEFAULT_JOBS_DIR): string {
  return path.join(jobDir(jobId, jobsDir), stage);
}

/** 一次性建齐全部阶段目录 —— 目录结构本身就是契约的一部分。 */
export function ensureJobDirs(jobId: string, jobsDir: string = DEFAULT_JOBS_DIR): string {
  const root = jobDir(jobId, jobsDir);
  for (const s of STAGE_ORDER) {
    fs.mkdirSync(path.join(root, s), { recursive: true });
  }
  return root;
}

/**
 * 不可变快照守卫：本阶段不得写**更早**的阶段目录。
 *
 * ─────────────────────────────────────────────────────────────
 * 2026-10-18 修正（审计发现）
 * ─────────────────────────────────────────────────────────────
 * 本函数自 2026-10-13 起存在，但**零调用** —— 而 `validate/occlusion.ts` 的
 * 架构论证里却写着「`io.ts` 的不可变快照守卫（`guardSnapshot` 会直接拒绝
 * 04 阶段回写 03 的产物）」。两处都不对：
 *   ① `guardSnapshot` 这个函数名**从来不存在**；
 *   ② 真正同作用的函数（就是本函数）**没有任何人调用**。
 * 结论侥幸成立（方案 A 本身绕开了"落 resolved storyboard"这条路），
 * 但**论证的前提是假的**。这是「文档说它承重、代码里没人读」的第五次复发。
 *
 * 现在本函数是 `writeStageJson()` 的必经之路 —— 唯一执行点，
 * 见 `tests/stage-io.test.ts`（含「越权时一个字节都不落盘」的反向断言）。
 *
 * @param writesTo 写入目标所在的阶段
 * @param self 发起写入的本阶段
 */
export function assertNotWritingUpstream(writesTo: StageName, self: StageName): void {
  if (stageIndex(writesTo) < stageIndex(self)) {
    throw new ConfigError(
      `不可变快照被破坏：${self} 阶段试图写更早的 ${writesTo}。下游不得回写上游。`,
    );
  }
}

/**
 * 写阶段产物的**唯一入口** —— 所有 stage 的落盘都必须走这里。
 *
 * 为什么不让各 stage 自己 `writeJson(path.join(stageDir(...)))`：
 * 那样「防回写」就只能靠自觉，而自觉已经在 2026-10-18 被证明是空的。
 * 把守卫放进写入入口，越权写在**落盘之前**就被拦（不是写完再抛）。
 */
export function writeStageJson<T>(opts: {
  jobId: string;
  /** 发起写入的本阶段。 */
  self: StageName;
  /** 写入目标的阶段目录。 */
  target: StageName;
  /** 相对阶段目录的文件名（可含子目录）。 */
  file: string;
  data: T;
  jobsDir?: string;
}): string {
  assertNotWritingUpstream(opts.target, opts.self);
  const file = path.join(stageDir(opts.jobId, opts.target, opts.jobsDir), opts.file);
  writeJson(file, opts.data);
  return file;
}

export function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new ConfigError(
      `缺少前置产物：${file}\n` +
        `（阶段目录是不可变快照，缺失即为前置阶段未跑 —— 不要跳过上游直接跑下游）`,
    );
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ConfigError(`读取失败 ${file}：${(e as Error).message}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new ConfigError(`JSON 解析失败 ${file}：${(e as Error).message}`);
  }
}

/** 递归按键名排序 —— 保证同一对象无论构造顺序如何，落盘字节一致。 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value;
}

/**
 * 确定性 JSON 落盘：2 空格缩进 + 键名排序 + 末尾换行。
 * 同一输入必须产出**逐字节一致**的文件，可直接入 git diff。
 */
export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = `${JSON.stringify(sortKeys(data), null, 2)}\n`;
  fs.writeFileSync(file, body, 'utf8');
}

export function exists(file: string): boolean {
  return fs.existsSync(file);
}

/**
 * 断言下游阶段没有偷偷引用成片。
 * storyboard 只能引用 01/02 —— 引 05 会形成环路。
 */
export function assertNoCrossStageReference(
  referencedStages: string[],
  currentStage: StageName,
): void {
  for (const r of referencedStages) {
    if (r === STAGES.render || r === STAGES.review) {
      throw new ConfigError(
        `禁跨级引用：${currentStage} 不得引用 ${r}（防环路）。`,
      );
    }
  }
}
