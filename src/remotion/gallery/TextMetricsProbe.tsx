/**
 * 文本度量探针合成 —— **仅供 D-B2 批量实测工具使用**，不进成片、不进 Studio 主列表。
 *
 * ── 为什么要有它 ───────────────────────────────────────────────
 * D-B2 要回答的是「这个模板的字，真渲出来到底多宽」——
 * 而构建期校验只能用估算（纯 JSON→JSON）。两者若各写一套字号/系数，
 * 就会重演 `DUR.exit` / 字号真源那类「两处实现必然漂移」的病。
 *
 * 因此探针**直接渲染真实模板组件**（经 `MotionItem`，与成片同一条主链），
 * 只把背景换成纯色、把 footprint 铺满画面，让工具能按像素测出文字包围盒。
 * 不在探针里重建任何模板样式 —— 那样量到的就不是成片里的字。
 *
 * 🔴 背景用纯洋红：模板色板（白 / 金黄 / 蓝 / 深灰）与它没有重合，
 *    像素筛选不会把底板或装饰误当文字。
 */

import type { FC } from 'react';
import { AbsoluteFill } from 'remotion';
import type { StoryboardItem } from '../../core/types.ts';
import type { CaptionData } from '../caption.ts';
import { MotionItem } from '../MotionItem.tsx';

/** 探针背景（纯洋红）。 */
export const PROBE_BACKGROUND = '#FF00FF';

export type TextMetricsProbeProps = {
  item: StoryboardItem;
  caption?: CaptionData;
};

export const DEFAULT_TEXT_METRICS_PROBE_PROPS: TextMetricsProbeProps = {
  item: {
    fromFrame: 0,
    durationInFrames: 90,
    motion: 'typography/kinetic-line@1.0',
    footprint: [0, 0, 1, 1],
    params: { text: '测' },
  },
};

export const TextMetricsProbe: FC<TextMetricsProbeProps> = ({ item, caption }) => (
  <AbsoluteFill style={{ backgroundColor: PROBE_BACKGROUND }}>
    <MotionItem trackId="probe" itemIndex={0} item={item} caption={caption} />
  </AbsoluteFill>
);
