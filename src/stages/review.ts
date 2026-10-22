/**
 * Stage review（P1-a，2026-10-22）—— 渲染前的 Remotion Studio 人工审核闸。
 *
 * 为什么渲染前必须能看片：渲染是 20 分钟级的反馈环，「渲出来才知道不对」
 * 是最贵的失败方式。review 复用 render 的同一份映射（composeRenderProps）
 * 产出 `06-review/preview-props.json` 并挂载 Studio —— 用户在 Studio 里
 * 看到的就是 render 会渲出来的。
 *
 * 🔴 不写 `05-render/render-props.json`：`writeStageJson` 是不可变快照守卫的
 *    执行点，review（06）写 05 是下游写上游，守卫会拦；两份产物各写各的
 *    目录，hash 防漂移补齐一致性。
 *
 * 确认凭据继续手写（v1 裁决）：confirmed.json 仍是「唯一没有写入代码」的
 * 产物，本命令只做指引 —— 打印 must_review 队列与写法，不代写。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { STAGES } from '../core/config.ts';
import { ConfigError, StageBlockedError } from '../core/exit-code.ts';
import { exists, jobDir, readJson, writeStageJson } from '../core/io.ts';
import { log, printBlock } from '../core/log.ts';
import type { ValidateReport } from '../core/report.ts';
import { composeRenderProps, hashStoryboardFile } from './render-props.ts';

export interface ReviewOptions {
  jobId: string;
  jobsDir?: string;
  /** 只产出 preview-props 与队列打印，不启动 Studio（脚本化退化路径，plan edge case）。 */
  dryRun?: boolean;
}

export interface ReviewOutcome {
  /** 06-review/preview-props.json 的绝对路径。 */
  previewFile: string;
  /** must_review 条目的 item ref 队列（render 确认闸的覆盖目标）。 */
  mustReviewRefs: string[];
  /** 当前 storyboard.json 的字节 sha256（render 启动闸比对用）。 */
  storyboardHash: string;
}

/**
 * 与 renderGate 同一条起跑线：validate 报告必须存在且 ok。
 * 语义与 `renderGate` 首段一致（报告存在 + ok=true），报错文案按 review 场景写。
 */
function validateGate(jobId: string, jobsDir?: string): string | null {
  const reportFile = path.join(jobDir(jobId, jobsDir), STAGES.validate, 'validate-report.json');
  if (!exists(reportFile)) {
    return '04-validate/validate-report.json 不存在 —— 未跑校验，不得进入审核';
  }
  const report = readJson<ValidateReport>(reportFile);
  if (!report.ok) {
    return `校验报告 ok=false（error=${report.summary.error}）—— 先走人工返修回路，再来看片`;
  }
  return null;
}

/**
 * 映射 + 落盘（无 Studio 副作用）—— 测试入口，也是 runReview 的第一步。
 *
 * 同一 storyboard 两次执行产出**逐字节一致**的 preview-props.json
 * （确定性红线：props 无墙钟字段，hash 只吃 storyboard 内容字节）。
 */
export function writePreviewProps(opts: ReviewOptions): ReviewOutcome {
  const blocked = validateGate(opts.jobId, opts.jobsDir);
  if (blocked) throw new StageBlockedError(blocked);

  const composed = composeRenderProps(opts.jobId, opts.jobsDir);
  const storyboardHash = hashStoryboardFile(opts.jobId, opts.jobsDir);

  // 重跑 review 覆写 preview-props 并重算 hash —— writeStageJson 只守写入
  // 方向不守存在（io.ts writeJson 直接覆写），无需 --force。
  const previewFile = writeStageJson({
    jobId: opts.jobId,
    self: STAGES.review,
    target: STAGES.review,
    file: 'preview-props.json',
    jobsDir: opts.jobsDir,
    data: { ...composed.props, storyboardHash },
  });

  // must_review 队列来自 composeRenderProps 的同一份 ctx.scene —— 与 renderGate
  // 单源，杜绝「review 打印的 ref 与 render 闸算的 ref 各走各的」。
  return {
    previewFile,
    mustReviewRefs: composed.mustReviewRefs,
    storyboardHash,
  };
}

/**
 * CLI 入口：映射落盘 → 打印 must_review 队列与确认写法 → 前台启动 Studio。
 * Studio 退出（关窗 / Ctrl+C）后提醒写 confirmed.json，再走 render。
 * `dryRun` 时只做前两步（脚本化退化：无人看片，产物照出）。
 */
export function runReview(opts: ReviewOptions): ReviewOutcome {
  const out = writePreviewProps(opts);
  const base = jobDir(opts.jobId, opts.jobsDir);
  const inputDir = path.join(base, STAGES.input);

  /**
   * 上游 mTime 提示（plan Critic reservation ③）：hash 只锚 storyboard.json，
   * 「上游语义变了、storyboard 重烘焙后字节恰好不变」的窄缝它不响 ——
   * 把上游两份关键产物的修改时间摆在眼前，人工比对最便宜。
   */
  const mtime = (rel: string): string => {
    const f = path.join(base, rel);
    return exists(f) ? new Date(fs.statSync(f).mtime).toISOString() : '（缺失）';
  };

  printBlock(
    [
      `preview-props 已生成：${out.previewFile}`,
      `storyboardHash：${out.storyboardHash.slice(0, 16)}…（render 闸将比对，storyboard 改动后需重跑 review）`,
      `上游产物 mTime：words.json ${mtime(path.join(STAGES.align, 'words.json'))} / regions.json ${mtime(path.join(STAGES.perceive, 'regions.json'))}`,
      '',
      out.mustReviewRefs.length > 0
        ? `必须逐条过目的 must_review 条目（${out.mustReviewRefs.length} 条）：${out.mustReviewRefs.join(', ')}`
        : '本 job 无 must_review 条目 —— 仍可自愿全量看片。',
      '',
      '看片确认后，把确认**追加**进 06-review/confirmed.json（不要覆盖已有记录）：',
      '  { "records": [ /* …已有记录… */, {',
      `    "jobId": "${opts.jobId}", "stage": "render", "reason": "看片确认",`,
      '    "confirmedBy": "…", "confirmedAt": "…",',
      `    "acknowledgedReview": [${out.mustReviewRefs.map((r) => `"${r}"`).join(', ')}]`,
      '  } ] }',
      ...(opts.dryRun ? ['', 'dry-run：不启动 Studio。'] : ['', '正在启动 Remotion Studio（关闭窗口或 Ctrl+C 退出）…']),
    ].join('\n'),
  );

  if (opts.dryRun) {
    log.info('dry-run：preview-props 已生成，跳过 Studio');
    return out;
  }

  try {
    execFileSync(
      'npx',
      [
        'remotion',
        'studio',
        'src/remotion/index.ts',
        `--props=${out.previewFile}`,
        `--public-dir=${inputDir}`,
      ],
      { stdio: 'inherit', shell: true },
    );
  } catch (e) {
    const err = e as Error & { status?: number; signal?: string; code?: string };
    // 用户中断（Ctrl+C / kill）是正常退出路径：preview-props 已落盘、看片凭
    // 用户自觉，不作错误处理。0xC000013A = STATUS_CONTROL_C_EXIT（Windows）。
    if (err.signal !== undefined || err.status === 3221225786) {
      log.warn('Studio 被用户中断 —— preview-props 已落盘，看片确认照常有效。');
    } else {
      // 🔴 启动失败 / 崩溃不能假装「看完了」：preview-props 在 spawn 前就已
      //    落盘，静默当成功会让人对着没看过的画面写确认 —— 审核闸被掏空。
      throw new ConfigError(
        `Remotion Studio 异常退出（${
          err.status !== undefined ? `exit ${err.status}` : (err.code ?? err.message)
        }）—— 本次看片未完成，不得据此写确认。\n` +
          `  preview-props 已生成（${out.previewFile}）；请重跑 review，或排查 Studio 启动环境（npx / 端口 / node 版本）。`,
      );
    }
  }

  log.done('看片结束。确认写进 06-review/confirmed.json 后，执行 render。');
  return out;
}
