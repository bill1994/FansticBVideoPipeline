/**
 * `06-review/confirmed.json` —— 人工放行记录的**唯一读写入口**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么上提到 `core/`（2026-10-19 端到端审计后）
 * ─────────────────────────────────────────────────────────────
 * 这份记录原本只定义在 `stages/render.ts` 里，于是：
 *   · `render` 读它（管 fullscreen）；
 *   · `storyboard` **完全不读**，却在门控失败时让用户「写 confirmed.json 再继续」。
 * 实测结果：用户照着提示写了 `stage: "alignment"` 的放行记录，
 * 重跑 `storyboard` **仍然 exit 1、报错一字不改** —— 提示让人做的事做了也没用。
 *
 * 放在 `stages/render.ts` 里是结构性问题：`storyboard` 若从 `stages/render`
 * 导入，会形成**下游 → 下游**的依赖（03 依赖 05），与「禁跨级引用」同源。
 * 上提到 `core/` 后两边共用同一份解析与校验，不产生跨阶段依赖。
 *
 * ─────────────────────────────────────────────────────────────
 * 文件形状（`F3-1` 裁决，2026-10-19）
 * ─────────────────────────────────────────────────────────────
 * 一个 job 可能需要在**多个阶段**分别放行：
 *   · `alignment` —— 对齐门控没过，人工核验后放行（`storyboard` 读）
 *   · `render`    —— fullscreen 必然覆盖全画面，人工确认后放行（`renderGate` 读）
 *
 * 所以文件支持**两种形状**，读取端都认：
 *
 * ```jsonc
 * // ① 多记录（推荐，新写法）
 * { "records": [
 *     { "jobId": "j1", "stage": "alignment", ... },
 *     { "jobId": "j1", "stage": "render", "acknowledgedFullscreen": ["fs/000"], ... }
 * ] }
 *
 * // ② 单条（旧写法，仍兼容）
 * { "jobId": "j1", "stage": "render", ... }
 * ```
 *
 * 🔴 **为什么必须支持多条**：修复 `stage` 校验之后，一份单条记录会让
 * 「既需要对不放行、又需要 fullscreen 确认」的 job 陷入死锁 ——
 * 写 alignment 则 render 闸拒，写 render 则 storyboard 拒。
 * 此前因为 `stage` 不参与判定、一张凭据通吃所有关卡，这个限制被静默掩盖。
 *
 * ─────────────────────────────────────────────────────────────
 * 两个消费者，各自只认自己的 `stage`
 * ─────────────────────────────────────────────────────────────
 * | 消费者 | 认哪个 stage | 用哪个字段 |
 * |--------|-------------|-----------|
 * | `stages/storyboard.ts` | `alignment` | `confirmedBy` / `confirmedAt`（回填 meta） |
 * | `stages/render.ts`     | `render`    | `acknowledgedFullscreen`（fullscreen 启动闸）、`acknowledgedReview`（must_review 确认闸，P1-a） |
 */

import path from 'node:path';
import { STAGES } from './config.ts';
import { ConfigError } from './exit-code.ts';
import { exists, jobDir, readJson } from './io.ts';

/** 允许出现在 `confirmed.json` 里的阶段值。 */
export const CONFIRMED_STAGES = ['alignment', 'storyboard', 'validate', 'render'] as const;

export type ConfirmedStage = (typeof CONFIRMED_STAGES)[number];

/**
 * 人工放行记录。
 *
 * | 字段 | 承载 | 语义 |
 * |------|------|------|
 * | `overrides` | C2-4 降级放行 | **改了什么**（field/from/to）|
 * | `acknowledgedFullscreen` | D3-a | **确认了哪些**（原样放行，没有「改」）|
 */
export interface ConfirmedRecord {
  jobId: string;
  stage: ConfirmedStage;
  reason: string;
  confirmedBy: string;
  confirmedAt: string;
  overrides?: { itemId: string; field: string; from: unknown; to: unknown }[];
  /**
   * D3-a：已人工确认的 fullscreen item ref（`trackId/000` 形式）。
   * 必须覆盖 storyboard 内**全部** fullscreen 项，否则 render 启动闸拒绝启动。
   */
  acknowledgedFullscreen?: string[];
  /**
   * P1-a（2026-10-22）：已人工看片确认的 must_review item ref。
   * 与 `acknowledgedFullscreen` 同记录共存（F3-1）：一个 job 既有 fullscreen
   * 又有 must_review 时，写一条 render 记录带两个字段即可，不必拆两条
   * （同一 stage 只许一条记录，拆开反而触发「凭据歧义」守卫）。
   */
  acknowledgedReview?: string[];
}

/** 查询结果。`available` 用于生成「你写的是哪些阶段」这类可执行报错。 */
export interface ConfirmLookup {
  /** `stage` 与请求一致的那条记录。 */
  record: ConfirmedRecord | null;
  /** 文件里实际存在的全部 stage（保持出现顺序）。 */
  available: ConfirmedStage[];
}

function recordPath(jobId: string, jobsDir?: string): string {
  return path.join(jobDir(jobId, jobsDir), STAGES.review, 'confirmed.json');
}

function nonEmpty(v: unknown, field: string, index: number | null): string {
  if (typeof v !== 'string' || v.trim() === '') {
    const at = index === null ? '' : `（第 ${index + 1} 条记录）`;
    throw new ConfigError(
      `06-review/confirmed.json 的 \`${field}\` 必须是非空字符串${at}（实际：${JSON.stringify(v)}）。\n` +
        `  这份文件是人工闸的凭据，缺字段等于签了个不具名的字。`,
    );
  }
  return v;
}

/** 校验单条记录。`index === null` 表示文件是「单对象」旧形状。 */
function parseRecord(raw: unknown, jobId: string, index: number | null): ConfirmedRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(
      `06-review/confirmed.json 的记录必须是对象${index === null ? '' : `（第 ${index + 1} 条）`}。`,
    );
  }
  const r = raw as Partial<ConfirmedRecord>;
  const at = index === null ? '' : `（第 ${index + 1} 条记录）`;

  const stage = r.stage as ConfirmedStage | undefined;
  if (!stage || !CONFIRMED_STAGES.includes(stage)) {
    throw new ConfigError(
      `06-review/confirmed.json 的 \`stage\` 非法${at}：${JSON.stringify(r.stage)}。\n` +
        `  允许值：${CONFIRMED_STAGES.join(' / ')}。`,
    );
  }

  // 防「复制了别的 job 的确认文件」：jobId 与目录不符时这条记录不属于本 job。
  const declaredJob = nonEmpty(r.jobId, 'jobId', index);
  if (declaredJob !== jobId) {
    throw new ConfigError(
      `06-review/confirmed.json 的 \`jobId\`${at}为 "${declaredJob}"，但当前 job 是 "${jobId}"。\n` +
        `  放行记录不能跨 job 复用。`,
    );
  }

  const record: ConfirmedRecord = {
    jobId: declaredJob,
    stage,
    reason: nonEmpty(r.reason, 'reason', index),
    confirmedBy: nonEmpty(r.confirmedBy, 'confirmedBy', index),
    confirmedAt: nonEmpty(r.confirmedAt, 'confirmedAt', index),
    ...(r.overrides !== undefined ? { overrides: r.overrides } : {}),
    ...(r.acknowledgedFullscreen !== undefined
      ? { acknowledgedFullscreen: r.acknowledgedFullscreen }
      : {}),
    ...(r.acknowledgedReview !== undefined ? { acknowledgedReview: r.acknowledgedReview } : {}),
  };

  if (record.overrides !== undefined && !Array.isArray(record.overrides)) {
    throw new ConfigError(`06-review/confirmed.json 的 \`overrides\` 必须是数组${at}。`);
  }
  if (
    record.acknowledgedFullscreen !== undefined &&
    (!Array.isArray(record.acknowledgedFullscreen) ||
      record.acknowledgedFullscreen.some((x) => typeof x !== 'string'))
  ) {
    throw new ConfigError(
      `06-review/confirmed.json 的 \`acknowledgedFullscreen\` 必须是字符串数组${at}` +
        `（item ref 形如 \`trackId/000\`）。`,
    );
  }
  if (
    record.acknowledgedReview !== undefined &&
    (!Array.isArray(record.acknowledgedReview) ||
      record.acknowledgedReview.some((x) => typeof x !== 'string'))
  ) {
    throw new ConfigError(
      `06-review/confirmed.json 的 \`acknowledgedReview\` 必须是字符串数组${at}` +
        `（must_review item ref 形如 \`trackId/000\`）。`,
    );
  }

  return record;
}

/**
 * 读全部放行记录。文件不存在返回 `[]`；结构不合法直接抛（退出码 2）。
 *
 * 为什么做结构校验：这份文件是全流程**唯一没有写入代码**的产物（纯人工手写），
 * 在此之前写错字段名不会有任何反馈 —— 只是闸静默地当成「没确认」。
 */
export function readConfirmedRecords(jobId: string, jobsDir?: string): ConfirmedRecord[] {
  const file = recordPath(jobId, jobsDir);
  if (!exists(file)) return [];

  const raw = readJson<unknown>(file);
  const shaped = raw as { records?: unknown };
  const isMulti = Array.isArray(shaped?.records);

  const list: unknown[] = isMulti ? (shaped.records as unknown[]) : [raw];
  if (list.length === 0) {
    throw new ConfigError(
      '06-review/confirmed.json 的 `records` 是空数组。\n' +
        '  要么删掉整个文件，要么至少写一条记录 —— 空数组是一种没说出口的歧义。',
    );
  }

  const out = list.map((r, i) => parseRecord(r, jobId, isMulti ? i : null));

  // 同一 stage 出现多条 = 凭据歧义。不猜「取最后一条」：这是审计记录，重复即错误。
  const seen = new Map<ConfirmedStage, number>();
  out.forEach((r, i) => {
    const prev = seen.get(r.stage);
    if (prev !== undefined) {
      throw new ConfigError(
        `06-review/confirmed.json 里 stage="${r.stage}" 出现了两次` +
          `（第 ${prev + 1} 条与第 ${i + 1} 条）。\n` +
          `  同一阶段只能有一条放行记录 —— 请合并或删掉旧的。`,
      );
    }
    seen.set(r.stage, i);
  });

  return out;
}

/** 按阶段取放行记录。找不到时 `record = null`，但 `available` 会告诉你现有的是哪些。 */
export function lookupConfirmed(
  jobId: string,
  stage: ConfirmedStage,
  jobsDir?: string,
): ConfirmLookup {
  const all = readConfirmedRecords(jobId, jobsDir);
  return {
    record: all.find((r) => r.stage === stage) ?? null,
    available: all.map((r) => r.stage),
  };
}

/** 文件名常量，供报错文案与测试复用。 */
export const CONFIRMED_FILE = 'confirmed.json';
