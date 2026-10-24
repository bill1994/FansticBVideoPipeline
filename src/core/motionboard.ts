/**
 * motionboard 绑定器 —— 统一可编辑意图层 → 烘焙输入（Wave 5 整合，2026-10-21）。
 *
 * ─────────────────────────────────────────────────────────────
 * 定位（真源：.claude/artifacts/designs/motionboard-intent-binding.md v2）
 * ─────────────────────────────────────────────────────────────
 * storyboard 与 motionboard 是**同一份文件的两个生命周期**：
 * motionboard.json 是唯一可编辑意图层（生成器首跑产出 → 模型精修 → 人工增删改），
 * 绑定器是 storyboard 阶段**调度前的解析步** —— 把 intent 解析成模板绑定，
 * 产 `bind-report.json`；intent 随 `_author` 在 bake 时「用完即弃」。
 *
 * 铁律延续：
 *  · 模型只选 intent 词表，不写坐标/帧数/颜色/CSS（params 由绑定器填）；
 *  · 钉死条目（motion）直通 —— 人工兜底通道，`#16` 仍校验其 params；
 *  · 不静默：候选全部失败 → no-fits 显式落 report + 阶段侧 warn；
 *  · 纯函数：同一 motionboard 两次绑定逐字节一致（禁时钟/随机/磁盘）。
 */

import { ConfigError } from './exit-code.ts';
import {
  builtinTemplateLookup,
  carrierRouteForSpan,
  paramsForMotion,
  CAPTION_MOTION,
  CAPTION_TRACK,
  MOTIONBOARD_INTENTS,
  type TemplateLookup,
} from './rhythm-rules.ts';
import type {
  BindRecord,
  BindReport,
  Cue,
  DraftItem,
  DraftStoryboard,
  MotionBoard,
  MotionBoardItem,
  PerceiveRegion,
  WordTimestamp,
} from './types.ts';

/** motionboard item 顶层允许键。多一个都拦 —— 否则会原样落进 storyboard.json。 */
const ALLOWED_MOTIONBOARD_ITEM_KEYS = new Set([
  '_author',
  'intent',
  'motion',
  'featuredText',
  'note',
  // 创作期生成 prompt（提案 §4.5）：仅创作期生成器与人审读，判定链零消费（守 P0）
  'genPrompt',
  'confidence',
  'params',
  'footprint',
  'exclusive',
  'footprintAnimates',
  'carrier',
  'fromFrame',
  'durationInFrames',
  'sim_max',
]);

/** 键名 → 额外提示（最容易写错的那几个）。 */
const MB_KEY_HINTS: Record<string, string> = {
  decision: '（decision 是烘焙产物字段，不要写在 motionboard 里）',
  routing: '（routing 由闸1 算出）',
  review: '（review 由产路地板算出）',
  handoffTo: '（handoffTo 是 track 层字段，不能放 item 层）',
  text: '（文案请写 featuredText —— 绑定器会按模板 paramsSchema 填对键）',
  anchor: '（锚点写在 _author 里：{"_author": {"anchor": "cue:0"}}）',
};

/**
 * motionboard 契约门 —— 结构错误（退出码 2），不降级为校验条目。
 *
 * 与起草稿键检查（`assertDraftItemKeys`）同款纪律：形状不对就早失败，
 * 占用 18 项校验的名额反而是错位。
 */
export function assertMotionboardKeys(mb: MotionBoard, sourceFps: number): void {
  const problems: string[] = [];

  if (mb.meta.fps !== sourceFps) {
    problems.push(
      `meta.fps ${mb.meta.fps} 与素材清单 ${sourceFps} 不一致 —— fps 与烘焙绑定，必须先统一`,
    );
  }

  const registry = builtinTemplateLookup();

  mb.tracks.forEach((track, ti) => {
    const trackLabel = track.id ?? `#${ti}`;
    (track.items ?? []).forEach((item, ii) => {
      const label = `轨「${trackLabel}」第 ${ii} 条`;
      const keys = Object.keys(item as object);
      for (const k of keys) {
        if (ALLOWED_MOTIONBOARD_ITEM_KEYS.has(k)) continue;
        problems.push(`${label}：未知键 \`${k}\`${MB_KEY_HINTS[k] ?? ''}`);
      }

      const hasIntent = item.intent !== undefined;
      const hasMotion = item.motion !== undefined;
      if (hasIntent && hasMotion) {
        problems.push(
          `${label}：intent 与 motion 二选一 —— 意图条目交给绑定器解析；确切知道模板时只写 motion`,
        );
      } else if (!hasIntent && !hasMotion) {
        problems.push(
          `${label}：intent 与 motion 二选一 —— 至少写一个（两者都缺则该条目无法成条）`,
        );
      } else if (hasIntent) {
        const def = MOTIONBOARD_INTENTS[item.intent!];
        if (!def) {
          problems.push(
            `${label}：未知 intent "${item.intent}" —— 词表：${Object.keys(MOTIONBOARD_INTENTS).join(', ')}`,
          );
        } else {
          for (const c of def.candidates) {
            if (!registry.get(c)) {
              problems.push(
                `${label}：intent "${item.intent}" 的候选模板未注册：${c} —— 检查 templates/builtin.ts 是否改名/降版本`,
              );
            }
          }
        }
      } else if (!registry.get(item.motion!)) {
        problems.push(`${label}：钉死模板未注册：${item.motion}`);
      }

      if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)) {
        problems.push(`${label}：confidence 必须是有限数值（闸2 输入，模型自评）`);
      }
      if (!item._author || typeof item._author.anchor !== 'string' || item._author.anchor === '') {
        problems.push(`${label}：缺少 _author.anchor（如 "cue:0" / "word:37" / "abs:240"）`);
      }
    });
  });

  if (problems.length > 0) {
    throw new ConfigError(
      `motionboard 契约错误（共 ${problems.length} 处）：\n` +
        problems.map((p) => `  · ${p}`).join('\n'),
    );
  }
}

/** 解析锚点 → 绑定所需的区间与文案。`abs:` 无区间（null），无文案。 */
function anchorSpan(
  anchor: string,
  words: readonly WordTimestamp[],
  cues: readonly Cue[],
): { start: number | null; end: number | null; cueText: string } {
  const m = /^(word|cue|abs):(.+)$/.exec(anchor);
  if (!m) return { start: null, end: null, cueText: '' };
  const [, kind, raw] = m as unknown as [string, string, string];
  if (kind === 'abs') return { start: null, end: null, cueText: '' };
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return { start: null, end: null, cueText: '' };
  if (kind === 'word') {
    const w = words[n];
    if (!w) return { start: null, end: null, cueText: '' };
    const cue = cues.find((c) => w.startFrame >= c.fromFrame && w.endFrame <= c.toFrame);
    return { start: w.startFrame, end: w.endFrame + 1, cueText: cue?.text ?? '' };
  }
  const c = cues[n];
  if (!c) return { start: null, end: null, cueText: '' };
  return { start: c.fromFrame, end: c.toFrame + 1, cueText: c.text ?? '' };
}

/** featuredText → params 的填补规则（schema 感知，不做隐式转换）。 */
function paramsWithFeatured(
  tplParamsSchema: Record<string, string>,
  params: Record<string, unknown> | null,
  featuredText: string,
): Record<string, unknown> | null {
  // 模板声明的文案语义键：text → value → title（取第一个声明者）。
  // 无论机械提取是否已产出 params，featuredText 一律覆盖语义键 ——
  // 模型的提炼文案优先于机械提取（评审 P1：此前 value/title 键会被静默丢弃）。
  const textKey = ['text', 'value', 'title'].find((k) => k in tplParamsSchema);
  if (!textKey) return params; // 模板无文案键 → featuredText 无处可落，保留原 params
  return { ...(params ?? {}), [textKey]: featuredText };
}

export interface BindSource {
  fps: number;
  alignmentConfidence: number;
}

export interface BindContext {
  cues: readonly Cue[];
  words: readonly WordTimestamp[];
  source: BindSource;
  regions?: readonly PerceiveRegion[];
}

/**
 * 绑定：motionboard → 烘焙输入（DraftStoryboard）+ 溯源报告。
 *
 *  · 钉死条目（motion）直通：params/footprint/exclusive/sim_max 原样保留
 *    （缺 sim_max 补 1.0 —— 调度分不该让人算）；
 *  · intent 条目：候选逐个过时长门控（`max(minVisible, toFrame-fromFrame+1)`
 *    与 bake.ts 同口径）→ 命中即填 params（featuredText 覆盖 text 键）→
 *    `carrierRouteForSpan` 区域退路 → `sim_max = 0.85 - 0.05 × 候选序`；
 *  · 全候选失败 → no-fits 记录 + 条目不产 MG（字幕轨不受影响）；
 *  · 字幕轨：motionboard 已声明 id 为 `caption` 的轨则直通，否则按 cue 自动铺
 *    （字幕层恒在，不受意图门槛约束）。
 */
export function bindMotionboard(
  mb: MotionBoard,
  ctx: BindContext,
  registry: TemplateLookup = builtinTemplateLookup(),
): { draft: DraftStoryboard; report: BindReport } {
  const records: BindRecord[] = [];
  let noFits = 0;
  const regions = ctx.regions ?? [];

  const resolveItem = (
    item: MotionBoardItem,
    trackId: string,
    itemIndex: number,
  ): { out?: DraftItem; record: BindRecord } => {
    const ref = `${trackId}/${String(itemIndex).padStart(3, '0')}`;
    const span = anchorSpan(item._author.anchor, ctx.words, ctx.cues);

    // ── 钉死条目：直通 ──────────────────────────────────────
    if (item.motion !== undefined) {
      const tpl = registry.get(item.motion);
      if (!tpl) {
        throw new ConfigError(`绑定：钉死条目引用了未注册模板：${item.motion}（${ref}）`);
      }
      const out: DraftItem = {
        _author: item._author,
        motion: item.motion,
        footprint: item.footprint ?? [...tpl.footprint] as [number, number, number, number],
        confidence: item.confidence,
        sim_max: item.sim_max ?? 1.0,
      };
      if (item.params !== undefined) out.params = item.params;
      if (item.exclusive !== undefined) out.exclusive = item.exclusive;
      if (item.footprintAnimates !== undefined) out.footprintAnimates = item.footprintAnimates;
      if (item.carrier !== undefined) out.carrier = item.carrier;
      if (item.fromFrame !== undefined) out.fromFrame = item.fromFrame;
      if (item.durationInFrames !== undefined) out.durationInFrames = item.durationInFrames;
      return {
        out,
        record: {
          ref,
          source: 'pinned',
          motion: item.motion,
          pinned: true,
          status: 'bound',
          reason: '钉死条目直通',
        },
      };
    }

    // ── intent 条目：候选逐个过门控 ─────────────────────────
    const def = MOTIONBOARD_INTENTS[item.intent!];
    if (!def) {
      throw new ConfigError(
        `绑定：未知 intent "${item.intent}" —— 词表：${Object.keys(MOTIONBOARD_INTENTS).join(', ')}（${ref}）`,
      );
    }
    const tried: string[] = [];
    for (let order = 0; order < def.candidates.length; order += 1) {
      const mid = def.candidates[order]!;
      tried.push(mid);
      const tpl = registry.get(mid);
      if (!tpl) {
        throw new ConfigError(
          `绑定：intent "${item.intent}" 的候选模板未注册：${mid} —— 检查 templates/builtin.ts`,
        );
      }
      // 时长门控（与 bake 隐式时长同口径；abs 锚点无区间 → 跳过门控，bake 会抬高到 minVisible）
      if (span.start !== null && span.end !== null && span.end - span.start < tpl.minVisibleInFrames) {
        continue;
      }
      let params: Record<string, unknown> | null;
      if (item.params !== undefined && order === 0) {
        params = item.params; // 作者随条目预填的参数（生成器按首选模板提取）
      } else {
        params = paramsForMotion(mid, span.cueText, []);
      }
      if (item.featuredText !== undefined) {
        params = paramsWithFeatured(tpl.paramsSchema, params, item.featuredText);
      }
      if (params === null) continue; // 文案提取不出 → 下一候选

      const out: DraftItem = {
        _author: item._author,
        motion: mid,
        footprint: item.footprint ?? [...tpl.footprint] as [number, number, number, number],
        params,
        confidence: item.confidence,
        sim_max: 0.85 - 0.05 * order,
      };
      if (item.exclusive !== undefined) out.exclusive = item.exclusive;
      if (item.footprintAnimates !== undefined) out.footprintAnimates = item.footprintAnimates;
      if (item.carrier !== undefined) {
        out.carrier = item.carrier;
      } else if (span.start !== null && span.end !== null) {
        const route = carrierRouteForSpan(registry, mid, span.start, span.end, regions);
        if (route) out.carrier = route;
      }
      return {
        out,
        record: {
          ref,
          source: 'intent',
          intent: item.intent,
          motion: mid,
          candidateOrder: order,
          candidatesTried: tried,
          featuredText: item.featuredText,
          status: 'bound',
          reason: `候选 ${order + 1}/${def.candidates.length}${order > 0 ? '（降档）' : ''}`,
        },
      };
    }

    noFits += 1;
    return {
      record: {
        ref,
        source: 'intent',
        intent: item.intent,
        motion: '',
        candidatesTried: tried,
        featuredText: item.featuredText,
        status: 'no-fits',
        reason:
          `候选 ${tried.join(' / ')} 均未通过时长门控或文案提取（cue ${span.start ?? '?'}–${span.end ?? '?'}）`,
      },
    };
  };

  const tracks = mb.tracks.map((track) => {
    const items: DraftItem[] = [];
    track.items.forEach((item, ii) => {
      const { out, record } = resolveItem(item, track.id, ii);
      records.push(record);
      if (out) items.push(out);
    });
    const out: { id: string; layer: number; handoffTo?: string | null; items: DraftItem[] } = {
      id: track.id,
      layer: track.layer,
      items,
    };
    if (track.handoffTo !== undefined) out.handoffTo = track.handoffTo;
    return out;
  });

  // 字幕轨恒在：motionboard 已含字幕条目（按条目 motion 探测，轨道名不拘 ——
  // demo 的字幕轨就叫 `caption-bar`）则直通，否则按 cue 自动铺
  const hasCaptionItems = mb.tracks.some((t) =>
    (t.items ?? []).some((i) => i.motion === CAPTION_MOTION),
  );
  if (ctx.cues.length > 0 && !hasCaptionItems) {
    const captionTpl = registry.get(CAPTION_MOTION);
    if (!captionTpl) {
      throw new ConfigError(`绑定：字幕模板未注册：${CAPTION_MOTION}`);
    }
    tracks.push({
      id: CAPTION_TRACK.id,
      layer: CAPTION_TRACK.layer,
      items: ctx.cues.map((c) => ({
        _author: { anchor: `cue:${c.index}` },
        motion: CAPTION_MOTION,
        footprint: [...captionTpl.footprint] as [number, number, number, number],
        sim_max: 1.0,
        confidence: 1.0,
      })),
    });
  }

  const meta: DraftStoryboard['meta'] = {
    fps: ctx.source.fps,
    anchorMode: mb.meta.anchorMode ?? 'word',
    alignmentConfidence: ctx.source.alignmentConfidence,
  };
  if (mb.meta.confirmedBy !== undefined) meta.confirmedBy = mb.meta.confirmedBy;
  if (mb.meta.confirmedAt !== undefined) meta.confirmedAt = mb.meta.confirmedAt;

  return {
    draft: { meta, tracks, noMotionRanges: mb.noMotionRanges },
    report: { fps: ctx.source.fps, records, noFits },
  };
}
