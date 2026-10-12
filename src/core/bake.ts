/**
 * 锚点 → 帧的一次性烘焙。
 *
 * 真源：SPEC §1.5 / 登记册 C2。
 *  - 真相层 = 帧：最终落盘 `fromFrame` + `durationInFrames`
 *  - 作者语法层 = 锚点 + 帧偏移：模型写 `{anchor:"word:37", offset:"-8f"}`，**不手算帧**
 *  - 一次性烘焙：resolver 解析锚点 → 帧并落盘，**锚点用完即弃**（`_author` 随即剥离）
 *  - 不设 guard 文本快照
 */

import type {
  AuthorAnchor,
  BakeRecord,
  BakeReport,
  Storyboard,
  StoryboardItem,
  WordTimestamp,
} from './types.ts';
import { ConfigError } from './exit-code.ts';
import { getTemplate } from '../templates/registry.ts';

const OFFSET_RE = /^([+-]?\d+)f$/;

/** 解析帧偏移。缺省为 0。 */
export function parseOffset(offset: string | undefined): number {
  if (offset === undefined || offset === '') return 0;
  const m = OFFSET_RE.exec(offset);
  if (!m) {
    throw new ConfigError(
      `无法解析帧偏移 ${JSON.stringify(offset)} —— 期望形如 "-8f" / "+4f" / 省略`,
    );
  }
  return Number.parseInt(m[1] as string, 10);
}

export interface ResolvedAnchor {
  fromFrame: number;
  wordIndex: number | null;
  wordStartFrame: number | null;
  wordEndFrame: number | null;
}

/**
 * 解析单个锚点。
 *
 * | anchor 语法        | 含义                                   |
 * |--------------------|----------------------------------------|
 * | `word:37`          | 第 37 个词的起点 + offset 帧            |
 * | `abs:372`          | 绝对帧 372（手写逃生口）                |
 * | `abs:12.4s`        | 绝对秒 12.4 → 帧（手写逃生口）          |
 *
 * ⚠️ `abs:` 的两种写法为【实现期拟定，文档未点名】—— SPEC §1.5 只说
 *    「`abs`（绝对帧/秒）作为手写逃生口」，未定义字面语法。
 */
export function resolveAnchor(
  anchor: string,
  offset: string | undefined,
  words: WordTimestamp[],
  fps: number,
): ResolvedAnchor {
  const off = parseOffset(offset);

  if (anchor.startsWith('word:')) {
    const raw = anchor.slice('word:'.length);
    const idx = Number.parseInt(raw, 10);
    if (!Number.isInteger(idx)) {
      throw new ConfigError(`word 锚点的序号非法：${JSON.stringify(anchor)}`);
    }
    const w = words.find((x) => x.index === idx);
    if (!w) {
      throw new ConfigError(`word 锚点 ${anchor} 在 01-align 中不存在（共 ${words.length} 个词）`);
    }
    return {
      fromFrame: w.startFrame + off,
      wordIndex: w.index,
      wordStartFrame: w.startFrame,
      wordEndFrame: w.endFrame,
    };
  }

  if (anchor.startsWith('abs:')) {
    const raw = anchor.slice('abs:'.length);
    const secMatch = /^(-?\d+(?:\.\d+)?)s$/.exec(raw);
    const frames = secMatch
      ? Math.round(Number.parseFloat(secMatch[1] as string) * fps)
      : Number.parseInt(raw, 10);
    if (!Number.isFinite(frames)) {
      throw new ConfigError(`abs 锚点非法：${JSON.stringify(anchor)}`);
    }
    return { fromFrame: frames + off, wordIndex: null, wordStartFrame: null, wordEndFrame: null };
  }

  throw new ConfigError(
    `未知锚点语法 ${JSON.stringify(anchor)} —— 支持 "word:<n>" 与 "abs:<帧|秒s>"`,
  );
}

export interface BakeResult {
  storyboard: Storyboard;
  report: BakeReport;
}

/**
 * 烘焙：把 `_author` 锚点解析成绝对帧，随后**剥离** `_author`。
 *
 * 时长来源（【实现期拟定】，因「模型禁写帧数」）：
 *   1. item 已显式带 `durationInFrames` → 直接采用
 *   2. 否则取 `max(模板 minVisibleInFrames, 锚定词的区间长度)`
 *      —— 锚定词区间长度是「这句话说了多久」，比任何全局常数都贴近真相。
 */
export function bake(
  draft: Storyboard,
  words: WordTimestamp[],
  fps: number,
): BakeResult {
  const records: BakeRecord[] = [];
  const tracks = draft.tracks.map((track) => ({
    ...track,
    items: track.items.map((item, itemIndex) => {
      const author: AuthorAnchor | undefined = item._author;
      const baked: StoryboardItem = { ...item };

      let resolved: ResolvedAnchor | null = null;
      if (author) {
        resolved = resolveAnchor(author.anchor, author.offset, words, fps);
        baked.fromFrame = resolved.fromFrame;
      } else if (!Number.isFinite(baked.fromFrame)) {
        throw new ConfigError(
          `track "${track.id}" 的第 ${itemIndex} 个 item 既无 _author 锚点、也无 fromFrame`,
        );
      }

      if (!Number.isFinite(baked.durationInFrames) || baked.durationInFrames <= 0) {
        const tpl = getTemplate(item.motion);
        const byWord =
          resolved?.wordStartFrame != null && resolved.wordEndFrame != null
            ? resolved.wordEndFrame - resolved.wordStartFrame + 1
            : 0;
        baked.durationInFrames = Math.max(tpl.minVisibleInFrames, byWord);
      }

      if (author && resolved) {
        records.push({
          trackId: track.id,
          itemIndex,
          anchor: author.anchor,
          offset: author.offset ?? '0f',
          wordIndex: resolved.wordIndex ?? -1,
          wordStartFrame: resolved.wordStartFrame ?? -1,
          wordEndFrame: resolved.wordEndFrame ?? -1,
          fromFrame: resolved.fromFrame,
        });
      }

      // 锚点用完即弃
      delete baked._author;
      return baked;
    }),
  }));

  return {
    storyboard: { ...draft, tracks },
    report: { fps, records },
  };
}
