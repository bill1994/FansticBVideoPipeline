/**
 * 时间轴类校验：项 #1 / #2 / #6 / #7 / #9 / #10。
 */

import { CODES } from '../core/errors.ts';
import type { ReportItem } from '../core/report.ts';
import { DENSITY, HANDOFF_GAP_SECONDS } from '../core/config.ts';
import type { ValidateContext } from './context.ts';
import { mk } from './item.ts';

/**
 * #1 时序校验：`fromFrame` 须落在目标词区间内，否则 error。
 *
 * 「目标词」由 `03-storyboard/bake-report.json` 提供 —— 烘焙后 `_author` 已剥离，
 * fromFrame 本身不再携带词信息。无锚点的 item（`abs:` 逃生口）不参与本项。
 */
export function checkTiming(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const r of ctx.bake.records) {
    if (r.wordIndex < 0 || r.wordStartFrame < 0) continue; // abs 逃生口，无目标词
    if (r.fromFrame >= r.wordStartFrame && r.fromFrame <= r.wordEndFrame) continue;
    const ref = `${r.trackId}/${String(r.itemIndex).padStart(3, '0')}`;
    out.push(
      mk(
        CODES.TIMING,
        'build',
        [ref],
        [r.fromFrame, r.wordEndFrame],
        `fromFrame=${r.fromFrame} 落在目标词 word:${r.wordIndex} 区间 [${r.wordStartFrame}, ${r.wordEndFrame}] 之外`,
        '收紧 offset，或改锚到相邻的词 —— 动效早于词出现或晚于词结束都会被观众察觉',
      ),
    );
  }
  return out;
}

/**
 * #2 密度校验：每 cue 的 item 数超阈值 → error。
 *
 * ⚠️ 阈值数值真源未给（见 config.ts 的 DENSITY.placeholder）。判定本身可跑，
 *    但数字是占位值，须与 C2-2 一并实测校准。
 */
export function checkDensity(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  if (ctx.cues.length === 0) return out;

  for (const cue of ctx.cues) {
    const hit = ctx.scene.filter((s) => s.start >= cue.fromFrame && s.start <= cue.toFrame);
    const n = hit.length;
    if (n <= DENSITY.maxItemsPerCue) continue;
    out.push(
      mk(
        CODES.DENSITY,
        'build',
        hit.map((s) => s.ref),
        [cue.fromFrame, cue.toFrame],
        `cue #${cue.index} 内有 ${n} 个 item，超过阈值 ${DENSITY.maxItemsPerCue}`,
        `「${cue.text}」一句话塞 ${n} 个动效。拆到相邻 cue，或删掉优先级最低的。` +
          `（阈值 ${DENSITY.maxItemsPerCue} 为占位初值，待实测校准）`,
      ),
    );
  }
  return out;
}

/** #6 最小可见时长：`durationInFrames < minVisibleInFrames` → error。 */
export function checkMinVisible(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const s of ctx.scene) {
    if (s.item.durationInFrames >= s.tpl.minVisibleInFrames) continue;
    out.push(
      mk(
        CODES.MIN_VISIBLE,
        'build',
        [s.ref],
        [s.start, s.end],
        `durationInFrames=${s.item.durationInFrames} < 模板 ${s.tpl.id} 的 minVisibleInFrames=${s.tpl.minVisibleInFrames}`,
        '延长时长，或换一个物理下限更短的模板。最小可见时长按 motion 类别派生，没有全局固定值。',
      ),
    );
  }
  return out;
}

/**
 * #7 词级边界对齐：起点**恰好**落在某个词的 startFrame 上 → warning。
 *
 * 不做全局吸附 —— 吸附会让动效显得机械。这里只提示，不拦。
 */
export function checkWordBoundary(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  const starts = new Set(ctx.words.map((w) => w.startFrame));
  for (const s of ctx.scene) {
    if (!starts.has(s.start)) continue;
    out.push(
      mk(
        CODES.WORD_BOUNDARY,
        'build',
        [s.ref],
        [s.start, s.end],
        `起点 ${s.start} 恰好落在词级边界上，容易被观众读成机械对齐`,
        '改用 cue 边界，或加几帧微偏移（如 offset -4f）',
      ),
    );
  }
  return out;
}

/** #9 接力 gap > 1.5s → warning。 */
export function checkHandoffGap(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  const limit = Math.round(HANDOFF_GAP_SECONDS * ctx.fps);
  const byId = new Map(ctx.storyboard.tracks.map((t) => [t.id, t]));

  for (const track of ctx.storyboard.tracks) {
    const targetId = track.handoffTo;
    if (!targetId) continue;
    const target = byId.get(targetId);
    if (!target) {
      // 引用不存在的 track 是结构错误，不是「gap 过大」。交给 registry/结构层报 ConfigError。
      continue;
    }
    const srcEnd = Math.max(...track.items.map((i) => i.fromFrame + i.durationInFrames), 0);
    const dstStart = Math.min(...target.items.map((i) => i.fromFrame), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(dstStart)) continue;
    const gap = dstStart - srcEnd;
    if (gap <= limit) continue;
    out.push(
      mk(
        CODES.HANDOFF_GAP,
        'build',
        [track.id, targetId],
        [srcEnd, dstStart],
        `接力 ${track.id} → ${targetId} 的 gap = ${gap} 帧（${(gap / ctx.fps).toFixed(2)}s）> ${HANDOFF_GAP_SECONDS}s`,
        '超过 1.5s 观众会把两段读成互不相关的事，接力语义失效。缩短 gap 或取消 handoffTo。',
      ),
    );
  }
  return out;
}

/**
 * #10 composition 尾部截断 → error（**不可省**）。
 *
 * item 结束帧超出 `<Composition>` 的 durationInFrames 时，Remotion
 * **静默截断、不报错不打日志** —— 成片少一截而全链路无任何报错。
 */
export function checkTailTruncation(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const s of ctx.scene) {
    if (s.end <= ctx.source.durationInFrames) continue;
    out.push(
      mk(
        CODES.TAIL_TRUNCATION,
        'build',
        [s.ref],
        [s.end, ctx.source.durationInFrames],
        `item 结束帧 ${s.end} 超出成片总时长 ${ctx.source.durationInFrames}（超出 ${s.end - ctx.source.durationInFrames} 帧）`,
        'Remotion 会静默截断且不打日志。前移 fromFrame 或缩短 durationInFrames。',
      ),
    );
  }
  return out;
}
