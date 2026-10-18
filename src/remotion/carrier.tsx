/**
 * 背景链（载体类）的**分段包裹**渲染。
 *
 * ── 为什么载体类需要一套独立机制 ─────────────────────────────
 * 叠加类模板画自己的东西，与视频**并列**即可（现状：一个 `<Sequence>`
 * 包住 items，items 之间空档就是"什么都没渲染"）。
 *
 * 载体类（`subject-transform` / `footage-transform`）不同：它们**改变实拍
 * 视频的呈现**（C6 双栈的语义分界），实现上必须**包裹视频**（children 透传）。
 * 而视频必须**全程可见** —— 若像叠加类那样只在 item 区间渲染 children，
 * 区间外视频会消失。因此把 `[trackStart, trackEnd]` 切成两类段：
 *
 *   · item 段（有 item 活跃）→ `<Sequence>` 包 `MotionItem`（组件包裹 children）
 *   · 间隙段（无 item 活跃）→ `<Sequence>` 直接透传 children（无变换）
 *
 * 任一时刻恰好渲染**一份** children，恰好应用**零或一层**变换。
 *
 * ── 为什么不做成"轨道级组件读时钟" ─────────────────────────────
 * E2 红线：整个渲染树**只有 `MotionItem` 一处**读 `useCurrentFrame()`。
 * 分段切分是**纯数据计算**（只依赖 track 的时间区间，不依赖当前帧），
 * 因此本机制不需要第二个时钟读取点 —— 帧的推进权仍只在 MotionItem 一处。
 *
 * ── 已知边界：同 track 内载体 item 重叠 ───────────────────────
 * 🔴 **重叠语义未在文档中定义**（`track 内 item 允许重叠但必须同 scope`
 * 是通用时间轴规则，未给载体类的重叠语义）。
 * 本实现取 **first-wins（先开始者接管该段）** 的确定性降级，
 * 并在段数据上标 `overlapped: true` 供审计。
 * ⚠️ 若真实素材出现载体重叠需求，**应先立裁决再改此处**。
 * （不选"嵌套串联"：同一 MotionItem 体系下无法为嵌套层各取正确的相对帧，
 * 强行做需要第二个时钟读取点，触 E2 红线。）
 */

import type { FC, ReactNode } from 'react';
import { Sequence } from 'remotion';
import type { StoryboardItem, StoryboardTrack } from '../core/types.ts';
import type { CaptionData } from './caption.ts';
import { MotionItem } from './MotionItem.tsx';

/** 背景链上的一个时间段：item 段或无 item 的间隙段。 */
export interface CarrierSegment {
  /** 轨道内**相对**帧（相对 `min(fromFrame)`，与 `TrackSequence` 的外层一致）。 */
  from: number;
  length: number;
  /** `null` = 间隙（无 item 活跃）。 */
  item: StoryboardItem | null;
  /** item 在原 `track.items` 中的下标（间隙为 `-1`）。 */
  index: number;
  /** 该段有多个 item 同时活跃（未定义语义的降级，见文件头）。 */
  overlapped: boolean;
}

/**
 * 把一条载体 track 切成"item 段 / 间隙段"的完整序列（纯函数，可单测）。
 *
 * 切点 = 所有 item 的起止帧（`trackStart` / `trackEnd` 必然在内）。
 * 每段的归属：活跃 item 为空 → 间隙；否则取**最先开始者**（first-wins）。
 */
export function splitCarrierSegments(track: StoryboardTrack): CarrierSegment[] {
  const items = track.items;
  if (items.length === 0) return [];

  const start = Math.min(...items.map((i) => i.fromFrame));
  const end = Math.max(...items.map((i) => i.fromFrame + i.durationInFrames));

  const bounds = new Set<number>([start, end]);
  for (const it of items) {
    bounds.add(it.fromFrame);
    bounds.add(it.fromFrame + it.durationInFrames);
  }
  const points = [...bounds].filter((p) => p >= start && p <= end).sort((a, b) => a - b);

  const segments: CarrierSegment[] = [];
  for (let k = 0; k < points.length - 1; k += 1) {
    const a = points[k]!;
    const b = points[k + 1]!;
    if (b <= a) continue;

    const active = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => it.fromFrame <= a && a < it.fromFrame + it.durationInFrames);

    if (active.length === 0) {
      segments.push({ from: a - start, length: b - a, item: null, index: -1, overlapped: false });
      continue;
    }
    // first-wins：开始最早的接管该段（并列取声明靠前者）。
    let first = active[0]!;
    for (const cur of active) {
      if (cur.it.fromFrame < first.it.fromFrame) first = cur;
    }
    segments.push({
      from: a - start,
      length: b - a,
      item: first.it,
      index: first.idx,
      overlapped: active.length > 1,
    });
  }
  return segments;
}

/**
 * 载体轨在整条时间轴上的「窗口前 / 窗口内 / 窗口后」划分（纯函数，可单测）。
 *
 * 🔴 存在的理由：2026-10-18 真素材首跑发现，原实现只渲染轨道窗口内的 children，
 *    **窗口外的视频整段消失**（成片纯黑）。这个划分是那次修复的核心，
 *    所以它必须是**可断言的纯函数**，而不是埋在 JSX 里的算术。
 *
 * 不变量：`head + (end - start) + tail === total`（total 不小于 end 时），
 * 且三段拼起来无缝覆盖 `[0, total)`。
 */
export function carrierWindowLayout(
  track: StoryboardTrack,
  durationInFrames?: number,
): { start: number; end: number; head: number; tail: number; total: number } {
  const start = Math.min(...track.items.map((i) => i.fromFrame));
  const end = Math.max(...track.items.map((i) => i.fromFrame + i.durationInFrames));
  const total = durationInFrames ?? end;
  const head = start > 0 ? Math.min(start, total) : 0;
  const tailStart = Math.min(end, total);
  const tail = total > tailStart ? total - tailStart : 0;
  return { start, end, head, tail, total };
}

/**
 * 把**多条**载体轨合并成一张**绝对时间表**：任一时间窗只对应「零或一个」变换。
 *
 * ── 为什么必须合并，而不是继续嵌套 ─────────────────────────────
 * `CarrierChain` 原本用 `reduce` 把多条载体轨**嵌套**包裹 children。
 * 但 `<Sequence from={x}>` 是**相对父级**偏移时间的：嵌套 n 层，内层看到的
 * 帧就被叠加了 n 次偏移，而 `item.fromFrame` 是**绝对帧** ⇒ 内层永远对不上。
 *
 *   实测（2026-10-18 第二次真渲）：影子载体轨（6488–6638，split-frame）单独存在时
 *   完美分屏；一旦外层还有 `punch-in`（2594–2744），内层起点被算成 `2744 + 6488`，
 *   远超成片长度 ⇒ 完全失效。像素/SSIM 实测：加了影子轨与不加**一模一样**（SSIM 1.0）。
 *
 *   这不是「补一个 from={0}」能解决的：偏移发生在每一个 `<Sequence>` 上，
 *   而变换必须包住视频，就只能嵌套。
 *
 * ── 解法：把时间轴拍平 ─────────────────────────────────────────
 * 取所有载体 item 的起止帧作为切点，把整条时间轴切成**原子窗口**；
 * 每个窗口最多挂一个变换 —— 于是渲染时**不需要嵌套**，视频在任一时刻只渲染一次。
 *
 * ⚠️ **已知边界（诚实记录）**：两个载体的时间**真正重叠**时，本函数取
 *   「**最内层轨道**（数组靠前者）优先」，外层的变换在该窗口被丢弃。
 *   D4-t2 已记录「同 track 内载体 item 重叠语义未定义」，跨 track 重叠同样未定义；
 *   这里取一个确定性降级，而不是让两条变换互相叠乘（那会产生没人能预期的画面）。
 *   若真实素材需要「放大 + 分屏」同时生效，应**先立裁决再改此处**。
 */
export interface CarrierWindow {
  /** **绝对帧**。 */
  from: number;
  length: number;
  /** `null` = 该窗口无变换（视频原样透传）。 */
  item: StoryboardItem | null;
  /** 该变换来自哪条载体轨（无变换为 null）。 */
  trackId: string | null;
}

export function composeCarrierTimeline(
  tracks: StoryboardTrack[],
  durationInFrames: number,
): CarrierWindow[] {
  const total = Math.max(1, durationInFrames);

  // 1. 每条轨先各自拍平成绝对帧段（复用已单测的 `carrierRenderSegments`）
  const perTrack = tracks.map((t) => carrierRenderSegments(t, total));

  // 2. 切点 = 所有段的起止帧 ∪ 两端
  const bounds = new Set<number>([0, total]);
  for (const segs of perTrack) {
    for (const s of segs) {
      bounds.add(Math.max(0, Math.min(total, s.from)));
      bounds.add(Math.max(0, Math.min(total, s.from + s.length)));
    }
  }
  const points = [...bounds].sort((a, b) => a - b).filter((p, i, arr) => i === 0 || p > arr[i - 1]!);

  // 3. 每个窗口挑一个变换：轨道数组靠前 = 更内层 ⇒ 优先级更高（D4-t3 ②）
  const raw: CarrierWindow[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (b <= a) continue;

    let picked: { item: StoryboardItem; trackId: string } | null = null;
    for (let ti = 0; ti < perTrack.length; ti += 1) {
      const seg = perTrack[ti]!.find((s) => s.item !== null && s.from <= a && a < s.from + s.length);
      if (seg?.item) {
        picked = { item: seg.item, trackId: tracks[ti]!.id };
        break;
      }
    }
    raw.push({
      from: a,
      length: b - a,
      item: picked?.item ?? null,
      trackId: picked?.trackId ?? null,
    });
  }

  // 4. 相邻同变换窗口合并（减少 Sequence 数量，也让表更易读）
  const out: CarrierWindow[] = [];
  for (const w of raw) {
    const prev = out.at(-1);
    if (prev && prev.item === w.item && prev.trackId === w.trackId) {
      prev.length += w.length;
    } else {
      out.push({ ...w });
    }
  }
  return out.length > 0 ? out : [{ from: 0, length: total, item: null, trackId: null }];
}

/**
 * 载体轨的**绝对帧**渲染段（纯函数，可单测）。
 *
 * 🔴 为什么必须是绝对帧（2026-10-18 第二次真渲抓到）：
 *   `CarrierChain` 会把多条载体轨**嵌套**（影子轨最内层、真实载体轨在外层）。
 *   原实现每层都用 `<Sequence from={start}>` 把时间偏移到「轨道内相对帧」，
 *   于是内层拿到的 `useCurrentFrame()` 是**父层已经偏移过**的局部帧，而
 *   `item.fromFrame` 是**绝对帧** ⇒ 内层的段永远对不上，等于没渲染。
 *   实测：影子轨单独存在时正常（分屏成立），一旦外层有 `punch-in` 就完全失效，
 *   因为内层 Sequence 的起点被叠加成了 `2744 + 6488`，早已超出成片长度。
 *
 *   修法：每层都用 `<Sequence from={0} durationInFrames={total}>` 作为容器
 *   （**零偏移 ⇒ 局部帧 == 绝对帧**），段内 `from` 一律写**绝对帧**。
 *   这样嵌套多少层都不会叠加偏移。
 */
export interface CarrierRenderSegment {
  /** **绝对帧**。 */
  from: number;
  length: number;
  /** `null` = 无变换透传段（窗口前/后的间隙或窗口内无 item 的间隙）。 */
  item: StoryboardItem | null;
  /** item 在原 `track.items` 中的下标（透传段为 -1）。 */
  index: number;
}

export function carrierRenderSegments(
  track: StoryboardTrack,
  durationInFrames?: number,
): CarrierRenderSegment[] {
  const { start, end, head, tail, total } = carrierWindowLayout(track, durationInFrames);
  const out: CarrierRenderSegment[] = [];

  // 窗口前：无变换透传（视频必须全程可见）
  if (head > 0) out.push({ from: 0, length: head, item: null, index: -1 });

  // 窗口内：按 splitCarrierSegments 的**相对**切分，换算成绝对帧
  for (const seg of splitCarrierSegments(track)) {
    out.push({ from: start + seg.from, length: seg.length, item: seg.item, index: seg.index });
  }

  // 窗口后：无变换透传
  if (tail > 0) {
    out.push({ from: Math.min(end, total), length: tail, item: null, index: -1 });
  }
  return out;
}

/**
 * 一条载体 track 的渲染：外层 `<Sequence>` 把绝对帧转成轨道内相对帧
 * （与叠加侧的 `TrackSequence` 同构），内层按段渲染。
 *
 * 🔴 **2026-10-18 实测修正（第一份真素材成片）**：原实现把 **整条链**套在一个
 *   `<Sequence from={start} durationInFrames={end-start}>` 里 —— 于是**轨道窗口之外
 *   children（=视频）根本不被挂载**，成片在窗口外是纯黑（根容器的 `backgroundColor:'black'`）。
 *   文件头那句「视频必须全程可见」的意图是对的，实现漏了窗口外的两段。
 *
 *   为什么会一直没被发现：demo job 是 `hasVideo: false`（走占位底），黑底 vs 占位底
 *   在结构测试里无差别；而 `punch-in` 这种载体类只要出现一次（footage-transform），
 *   就会把**它自己区间之外的整段视频抹掉**。像素采样实测：载体窗内 197/207/214（有画面），
 *   窗外 0/0/0（纯黑）—— 这正是「单测全绿、画面全错」的第四层假绿。
 *
 *   修法：窗口前 `[0, start)` 与窗口后 `[end, duration)` 各补一段**无变换的透传**，
 *   保证「任一时刻恰好渲染一份 children、零或一层变换」这条不变量在**整条时间轴**上成立。
 */
/**
 * 背景链的渲染入口：把**合并后的时间表**逐窗渲染，任一时刻**视频只渲染一次**。
 *
 * 为什么不再嵌套（见 `composeCarrierTimeline` 的文件头）：嵌套 `<Sequence>` 会
 * 逐层叠加时间偏移，内层拿到的帧与绝对帧对不上，于是「内层载体悄悄失效、画面看不出来」——
 * 这正是 2026-10-18 第二次真渲抓到的 bug（加与不加影子轨 SSIM = 1.0，完全没生效）。
 *
 * ⚠️ `MotionItem` 仍是全树**唯一**读时钟处（E2 红线）：这里只做时间切分，
 *    `frame` 由内层 `<Sequence from={w.from}>` 归零后交给 MotionItem。
 */
export const CarrierTimeline: FC<{
  tracks: StoryboardTrack[];
  caption: CaptionData;
  durationInFrames: number;
  children: ReactNode;
}> = ({ tracks, caption, durationInFrames, children }) => {
  if (tracks.length === 0) return <>{children}</>;
  const total = Math.max(1, durationInFrames);
  const windows = composeCarrierTimeline(tracks, total);

  return (
    <Sequence from={0} durationInFrames={total}>
      {windows.map((w) => (
        <Sequence
          key={`${w.from}-${w.length}-${w.trackId ?? 'none'}`}
          from={w.from}
          durationInFrames={w.length}
        >
          {w.item ? (
            <MotionItem
              trackId={w.trackId ?? 'carrier'}
              itemIndex={-1}
              item={w.item}
              caption={caption}
            >
              {children}
            </MotionItem>
          ) : (
            children
          )}
        </Sequence>
      ))}
    </Sequence>
  );
};
