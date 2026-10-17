/**
 * `carrier/split-frame@1.0` —— cover 裁切分屏 + 主体锚定窗口。
 *
 * ── 它也是「包裹视频」那一类（背景链 / subject-transform）──────────
 * 与 `punch-in` 同职责：**不画自己的内容**，而是把 children（实拍视频）
 * 放进一个变换容器原样透传 —— 改变**视频的呈现**，而不是在视频上盖一层。
 * 注入机制见 `src/remotion/carrier.tsx`。
 *
 * ── 形态：画面被竖着劈成两半 ─────────────────────────────────────
 * ```
 *  ┌──────────┬────────────────┐
 *  │          │                │   ← 展示条（视频），宽 = ratio（钳 0.3–0.7）
 *  │ overlay  │   实拍视频     │      side=right 时视频在右，overlay 在左
 *  │  自由区  │   （窗口内）   │
 *  └──────────┴────────────────┘
 * ```
 * 视频显示的是**裁切窗口**（画面的一条全高竖条），而窗口**以该 shot 的
 * `safeArea` 中心为锚**（D4-t2 Q3）⇒ 主体几乎恒完整，被切掉的是它两侧的空白。
 *
 * ── 为什么是「平移 + 裁切」而不是「缩放」────────────────────────
 * 展示条宽与窗口宽**都等于 `clamp(ratio)`** ⇒ 缩放系数恒为 1。
 * 「cover 填满、不留黑边」已经由「等宽 + 平移 + 裁切」达成，
 * 再乘一个 scale 只是白白扔像素（数字变焦的可见劣化线）。
 * 🔴 因此本组件**不读 `frame`**：输出是纯静态几何，`MotionItem` 仍是全树唯一读时钟处。
 *    代价与理由见 `core/carrier-window.ts` 文件头第 2 条（加了动画会动摇 `W-D2-02` 的判据基础）。
 *
 * ── 参数 ────────────────────────────────────────────────────────
 * | 键 | 来源 | 语义 |
 * |---|---|---|
 * | `side` | 模型可填 | 视频显示在哪一侧：`left` / `right`（其他值回退 `right`，与声明的 footprint 同侧） |
 * | `ratio` | 模型可填 | 展示条宽占画面宽的比例，钳制 [0.3, 0.7]，缺省 0.5 |
 * | `window` | **校验期写入** | 归一化裁切窗 `[x,0,w,1]`。**刻意不进 `paramsSchema`** —— 模型不能填系统字段（同 `textMetrics` 的分工） |
 *
 * ⚠️ **已知限制（诚实记录）**：主体锚定窗口只在该 item 带 `carrier` 声明时生效
 * （`item.carrier.params.window`）。把本模板当普通 carrier item 直接放进 track
 * （`motion: carrier/split-frame@1.0`）时**拿不到 `safeArea`**，只能得到**居中窗口**；
 * 这条路径要支持锚定窗口需在 P3 接线时一并处理。
 */

import {
  carrierDisplayRect,
  carrierParamsOf,
  computeCarrierWindow,
  readCarrierRatio,
  readCarrierSide,
  visibleRegion,
  type CarrierSide,
} from '../../core/carrier-window.ts';
import type { Footprint } from '../../core/types.ts';
import type { TemplateComponent } from './contract.tsx';

/** 归一化数 → 百分比字符串（固定 4 位小数，避免不同平台浮点尾数差异）。 */
function pct(v: number): string {
  return `${(v * 100).toFixed(4)}%`;
}

/**
 * 当前帧的完整几何（纯函数，可单测 —— 这是本模板唯一"会变"的东西：
 * 不是随帧变，而是随 `params` 变）。
 */
export interface SplitFrameGeometry {
  /** 裁切窗（源画面坐标，全高竖条）。 */
  window: Footprint;
  /** 展示条（画面坐标，全高竖条）。 */
  display: Footprint;
  /** 把窗口左边界挪到展示条左边界所需的水平位移（归一化画面宽）。 */
  shift: number;
  side: CarrierSide;
  ratio: number;
}

/**
 * 算几何：`window` 有就用（校验期锚定过的），没有就退回**居中**窗口。
 *
 * ⚠️ 缺 `window` 时用 `null` 作锚点 —— 而 `computeCarrierWindow(null, …)`
 *    的锚点正是画面中心 0.5（见该函数文件头第 3 条：感知低置信时不得失效）。
 */
export function splitFrameGeometry(
  params: Record<string, unknown> | undefined,
): SplitFrameGeometry {
  const ratio = readCarrierRatio(params);
  const side = readCarrierSide(params);
  const window = visibleRegion(params) ?? computeCarrierWindow(null, ratio);
  const display = carrierDisplayRect(side, ratio);
  return { window, display, shift: display[0] - window[0], side, ratio };
}

export const SplitFrame: TemplateComponent = ({ item, children }) => {
  const g = splitFrameGeometry(carrierParamsOf(item));
  const right = 1 - g.display[0] - g.display[2];

  // 🔴 **2026-10-17 真渲抽帧抓到的 bug（单测与静态断言都测不出）**：
  //
  //   原实现直接 `inset: 0` + `clip-path: inset(0 right% 0 display[0]%)`，
  //   真渲出来分界线落在画面 **0.75** 而非期望的 0.5，偏差 25%。
  //
  //   **根因**：`MotionItem` 会先按 `item.footprint` 给每个 item 套一个定位 div。
  //   本模板的 `footprint` 是 `[0.5, 0, 0.5, 1]`（右半屏），于是这个 div 只占
  //   画面 `[0.5, 1.0]`；而 **`clip-path` 的百分比相对父容器**，不是相对画面。
  //   于是「切掉左侧 50%」变成了「切掉 div 自己的左半」⇒ 画面可见 `[0.75, 1.0]`。
  //
  //   复算：`divLeft(0.5) + clipLeft(0.5) × divW(0.5) = 0.75`。
  //
  //   🔴 为什么只有本模板露馅：`punch-in` 用 `transform: scale()`，
  //     相对自身尺寸计算、不依赖父容器宽度 ⇒ 全屏 footprint 下恰好正确。
  //     **「静态断言全绿」不等于「画面正确」** —— 这是本次教训。
  //
  //   **修法**：先让本组件**铺满整个画面**（用负 margin 反向抵消 MotionItem 的
  //   footprint 定位），使 clip-path 的百分比重新对齐**画面坐标系**；
  //   展示条位置仍由 `display` 算出，与 footprint 解耦。
  //
  //   ⚠️ 为什么不用「改 footprint 为全屏」：那是 `builtin.ts` 的**声明**，
  //     声明同时被校验项读取（`#3/#4/#5/#11` 相交仲裁、可见性下限等）。
  //     改它会把几何修复变成校验语义变更，风险外溢。
  const fp = item.footprint;
  const fw = fp[2] > 0 ? fp[2] : 1;
  const fh = fp[3] > 0 ? fp[3] : 1;
  // 🔴 **百分比全部相对父容器**（父 = MotionItem 按 footprint 撑出的定位 div），
  //   不是相对画面。因此反向抵消时**必须除以父的 footprint 尺寸**才能换算到画面系：
  //     想要画面系的 -fp[0]，得写 -fp[0] / fw（父宽）；
  //     同理 top 用 -fp[1] / fh、尺寸用 1/fw、1/fh。
  //   （第一版修复漏了这个除法，真渲复验仍是 0.75 —— CSS 百分比的坐标系坑。）
  const compensate = {
    left: `${(-fp[0] / fw) * 100}%`,
    top: `${(-fp[1] / fh) * 100}%`,
    width: `${(1 / fw) * 100}%`,
    height: `${(1 / fh) * 100}%`,
  } as const;

  return (
    <div
      data-template="split-frame"
      data-side={g.side}
      data-ratio={g.ratio}
      data-window={g.window.map((v) => v.toFixed(4)).join(',')}
      style={{
        position: 'absolute',
        ...compensate,
        // 只让展示条那一竖条露出来。刻意**不用** overflow+缩窄父容器 ——
        // 那会把 children 一起缩小（children 是满画面尺寸的实拍视频），
        // 等于对视频做了一次数字变焦。clip-path 不影响子树尺寸。
        clipPath: `inset(0 ${pct(right)} 0 ${pct(g.display[0])})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          // 平移（不是 scale）：把裁切窗挪到展示条位置
          transform: `translateX(${pct(g.shift)})`,
        }}
      >
        {children}
      </div>
    </div>
  );
};
