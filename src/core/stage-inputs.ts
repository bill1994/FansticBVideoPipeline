/**
 * 阶段输入指纹（P0-4，2026-10-26）。
 *
 * 🔴 **为什么单独一个模块**：这套 hash 有**两个消费者** ——
 *   `stages/storyboard.ts` 烘焙时写入、`validate/context.ts` 校验时对拍。
 *   两处各写一份就必然漂移（项目已经因为「同一概念两套真源」栽过四次）。
 *
 * 算法与 `hashStoryboardFile` 保持同一套语义：**文件原始字节的 sha256**。
 * 不按解析后的 canonical JSON 算 —— 那样「改了但有语义等价」的编辑会被放过，
 * 而这里要答的问题恰恰是「文件被动过没有」。
 *
 * 覆盖范围：`03-storyboard/motionboard.json`（唯一可编辑意图层）
 * 与 `01-align/words.json`（对齐产物）。这两个变了，旧 storyboard 就不再对应当前输入。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { STAGES } from './config.ts';
import { jobDir } from './io.ts';

export interface InputsFingerprint {
  /** `03-storyboard/motionboard.json` 原始字节的 sha256。 */
  motionboardHash: string;
  /** `01-align/words.json` 原始字节的 sha256。 */
  wordsHash: string;
  /** 上面两者的合成值，写进 `storyboard.meta.inputsHash`。 */
  inputsHash: string;
}

/** 单文件原始字节 sha256。 */
export function fileSha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 两个子 hash → 合成指纹。**唯一实现点**（写侧与校验侧共用）。 */
export function composeInputsHash(motionboardHash: string, wordsHash: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ motionboardHash, wordsHash }), 'utf8')
    .digest('hex');
}

/**
 * 读盘算当前指纹。
 *
 * ⚠️ 任一输入文件缺失时**抛错**（不返回 null）：调用方必须自己决定
 *    「缺文件该报错还是跳过」，这个决定不该藏在算 hash 的顺手里。
 */
export function computeInputsFingerprint(jobId: string, jobsDir?: string): InputsFingerprint {
  const base = jobDir(jobId, jobsDir);
  const motionboardHash = fileSha256(path.join(base, STAGES.storyboard, 'motionboard.json'));
  const wordsHash = fileSha256(path.join(base, STAGES.align, 'words.json'));
  return { motionboardHash, wordsHash, inputsHash: composeInputsHash(motionboardHash, wordsHash) };
}
