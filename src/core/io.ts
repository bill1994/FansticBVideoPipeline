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
 * 不可变快照守卫：写某个阶段的产物前，确认它不早于上游读入的阶段。
 * `writesTo` 必须 >= `readsFrom` 中最新的一级。
 */
export function assertNotWritingUpstream(
  writesTo: StageName,
  readsFrom: StageName[],
): void {
  for (const r of readsFrom) {
    if (stageIndex(writesTo) < stageIndex(r)) {
      throw new ConfigError(
        `不可变快照被破坏：本阶段写 ${writesTo}，却引用了更晚的 ${r}。下游不得回写上游。`,
      );
    }
  }
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
