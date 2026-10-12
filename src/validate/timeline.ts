/**
 * 时间轴类校验：项 #1 / #2 / #6 / #7 / #9 / #10。
 */

import { CODES } from '../core/errors.ts';
import type { ReportItem } from '../core/report.ts';
import { DENSITY, HANDOFF_GAP_SECONDS } from '../core/config.ts';
import type { Cue } from '../core/types.ts';
import type { ValidateContext } from './context.ts';
import { mk } from './item.ts';

/**
 * 找到覆盖该词起点的 cue。
 * 找不到时返回 `null` —— 调用方退化为「词起点」，即保守收紧。
 */
export function cueForWord(cues: Cue[], wordStartFrame: number): Cue | null {
  return cues.find((c) => wordStartFrame >= c.fromFrame && wordStartFrame <= c.toFrame) ?? null;
}

/**
 * #1 时序校验 → `E-C2-5-01`。
 *
 * **合法区间 = `[锚定词所在 cue 的起点, 该词 endFrame]`**（C2-5a 补正）。
 *
 * ⚠️ 下界**不是词起点**。C2-5 原文写的是「目标词区间」，但那样一来 C2 自身的规范示例
 * （`{anchor:"word:37", offset:"-8f"}` → 帧 372）必然报错 —— 负偏移就是把帧推到词起点之前。
 * 而禁掉负偏移，抢拍只能靠 `abs:` 手写帧号，即失去「跟着词走」的能力，违反 C2 铁律
 * 「不让模型手算帧」。故把下界放宽到 cue 起点：**同一句话内提前进入可接受，跨到上一句才是真错位**。
 *
 * cue 覆盖不到该词时退化为词起点（保守）。
 * `abs:` 锚点无目标词，不参与本项。
 */
export function checkTiming(ctx: ValidateContext): ReportItem[] {
  const out: ReportItem[] = [];
  for (const r of ctx.bake.records) {
    if (r.wordIndex < 0 || r.wordStartFrame < 0) continue; // abs 逃生口，无目标词

    const cue = cueForWord(ctx.cues, r.wordStartFrame);
    const lowerBound = cue ? cue.fromFrame : r.wordStartFrame;

    if (r.fromFrame >= lowerBound && r.fromFrame <= r.wordEndFrame) continue;

    const ref = `${r.trackId}/${String(r.itemIndex).padStart(3, '0')}`;
    const tooEarly = r.fromFrame < lowerBound;
    const boundDesc = cue
      ? `锚定词所在 cue#${cue.index} 的起点`
      : `锚定词起点（该词未被任何 cue 覆盖）`;

    out.push(
      mk(
        CODES.TIMING,
        'build',
        [ref],
        [lowerBound, r.wordEndFrame],
        `fromFrame=${r.fromFrame} 落在合法区间 [${lowerBound}, ${r.wordEndFrame}] 之外` +
          `（目标词 word:${r.wordIndex}，下界＝${boundDesc}）`,
        tooEarly
          ? '动效抢到上一句里去了。收紧 offset，让它落回本 cue 内。注意：**负偏移本身是合法的**（抢拍），只有跨过 cue 起点才算错位。'
          : '动效晚于该词结束。前移 fromFrame，或改锚到下一个词。',
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
