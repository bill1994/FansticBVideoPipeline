/**
 * D-B2 探针入口 —— 只注册 `TextMetricsProbe` 一个合成。
 *
 * 🔴 **为什么不复用 `src/remotion/index.ts`**：主入口是成片渲染的入口，
 *    增加一个「测量专用合成」会让 Studio 列表与 render 产物多出无关项。
 *    探针只在 `tools/measure-text-metrics.mts` 里被 bundle，
 *    成片管线完全看不到它。
 */

import type { FC } from 'react';
import { Composition, registerRoot } from 'remotion';
import {
  DEFAULT_TEXT_METRICS_PROBE_PROPS,
  TextMetricsProbe,
  type TextMetricsProbeProps,
} from './gallery/TextMetricsProbe.tsx';

/** Remotion 的 Composition 泛型依赖 Zod schema；这里用窄化签名换类型一致（同 Root.tsx）。 */
const TypedProbeComposition = Composition as unknown as FC<{
  id: string;
  component: FC<TextMetricsProbeProps>;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps: TextMetricsProbeProps;
}>;

const ProbeRoot = () => (
  <TypedProbeComposition
    id="TextMetricsProbe"
    component={TextMetricsProbe}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={DEFAULT_TEXT_METRICS_PROBE_PROPS.item.durationInFrames}
    defaultProps={DEFAULT_TEXT_METRICS_PROBE_PROPS}
  />
);

registerRoot(ProbeRoot);
