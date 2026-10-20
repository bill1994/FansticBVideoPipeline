/**
 * 渲染期命名令牌。
 *
 * ── 为什么必须存在这一层 ───────────────────────────────────────
 * P1（登记册 2026-10-13）的硬约束之一是**禁模型写颜色 / 坐标 / 帧数 / CSS**。
 * `builtin.ts` 里 `caption/karaoke-word` 刻意不声明 `highlightColor`，
 * 注释明写「高亮色由渲染期按命名令牌（'brand' | 'accent'）解析，不经 params」。
 *
 * 那么"渲染期按命名令牌解析"具体解析成什么颜色？答案必须落在**代码**里，
 * 且只有这一处。若各模板组件各自内联 `#RRGGBB`，等于：
 *   · 令牌层形同虚设（声明了没 implementations，等价于零消费字段 —— 问题 9 的同款病）
 *   · 换肤要改 N 个文件
 *   · "禁颜色"这条约束实际上只禁了 params，没禁实现，等于自欺
 *
 * 因此本文件是**颜色的唯一来源**。模板组件禁止出现字面色值。
 *
 * ── 字体为什么不用 Web Font ─────────────────────────────────────
 * 渲染期兜底有 `E-RT-01`（字体未加载即 error）。引 Web Font 会新增
 * 「下载失败 / 字体缓存 / 每台机器字体不一致」三个失败模式，且需要 `delayRender`
 * 等待加载完成。首批模板一律用系统字体栈 —— 零网络、零加载等待、
 * 且系统字体在任何机器上都有确定行为。
 */

import { Easing } from 'remotion';

/**
 * 色板。命名而非字面，是为了让「换肤」只改这一处。
 *
 * 🔴 全部为**深底浅字**配置：项目产物是叠加在实拍口播视频上的，
 * 深底保证任何画面背景下字幕都可读。
 */
export const COLOR = {
  /** 主文本 / 字幕底色。 */
  ink: '#FFFFFF',
  /** 次级文本（副标题、单位、注释）。 */
  inkDim: 'rgba(255,255,255,0.72)',
  /** 品牌强调色 —— 数字、关键词、当前高亮词。 */
  brand: '#FFC53D',
  /** 辅助强调色 —— 边框、装饰线、次要高亮。 */
  accent: '#4DA3FF',
  /** 字幕底板 / 卡片背景。 */
  plate: 'rgba(14,17,20,0.78)',
  /** 描边。 */
  hairline: 'rgba(255,255,255,0.22)',
} as const;

/**
 * 字体栈。全部为系统字体，理由见文件头注释。
 *
 * 中文优先 —— 素材为纯中文口播（双语字幕对齐已明确不做，见 PROGRESS §五）。
 */
export const FONT = {
  /** 正文 / 字幕。 */
  sans: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif',
  /** 数字 / 英文强调。回退到无衬线，不引等宽（等宽在中文下字距难看）。 */
  numeric: '"Helvetica Neue", Arial, "Microsoft YaHei", sans-serif',
} as const;

/** 圆角。 */
export const RADIUS = {
  sm: '6px',
  md: '12px',
  lg: '20px',
} as const;

/**
 * 时长（帧）。
 *
 * ⚠️ 这些是**动画配比**，不是「素材该有多长」——后者由模型与校验项 #6 决定。
 * 这里定的是「一条 motion 内部的进出各占多少比例」，属于实现细节。
 *
 * 🔴 【实现期拟定，文档未点名】D1 第一轮的模板实现需要一套进出场时值，
 *    文档只规定 `minVisibleInFrames`（最短可见），未规定动画配比。
 *    取值为常凭经验，**待真实素材上调校**（见 docs/changelog）。
 *
 * ⚠️ 0.18/0.18 是**第二轮打磨前**的值。第二轮实测后改为入场 0.16 / 出场 0.22 ——
 *    入场要利落（观众在等信息），出场可以慢一点让「消失」不突兀。
 */
export const DUR = {
  /** 入场占整条 motion 的比例。第二轮：0.18 → 0.16（入场更利落）。 */
  enter: 0.16,
  /** 出场占整条 motion 的比例。第二轮：0.18 → 0.22（出场更从容）。 */
  exit: 0.22,
  /** 最短入场帧数 —— motion 极短时按比例算会得到 0 帧动画（看不见）。 */
  minEnter: 4,
  /** 最短出场帧数。 */
  minExit: 4,
} as const;

/** 入出场帧数。由 motion 总时长与配比共同决定，两端都有下限。 */
export function enterExitFrames(durationInFrames: number): { enter: number; exit: number } {
  const d = Math.max(1, durationInFrames);
  return {
    enter: Math.max(DUR.minEnter, Math.round(d * DUR.enter)),
    exit: Math.max(DUR.minExit, Math.round(d * DUR.exit)),
  };
}

/**
 * 进出场进度 —— 所有模板共用的分段推进。
 *
 * 🔴 **2026-10-15 补记**：本函数是因为「定义了 `exit` 却只有字幕模板在用」
 * 才提取的。原先 4 个 typography/data 模板**只做入场、出场完全缺失**，
 * 表现为「弹一下→ 画面静止几十帧 → 突然消失」。
 * 逐帧差异探针（`tools/render-probe.mts`）实测 f12–f59 帧差恒为 0 才暴露出来。
 *
 * ⇒ 这与登记册记录的问题 9（`occludesSubject`/`handoffIn` 零消费）**同款病**：
 *    **声明了 / 定义了，但没人用。** 区别只在于一个是契约字段、一个是令牌。
 *    教训一致：新增能力必须当场接入消费方，否则等于没做。
 *
 * 🔴 **2026-10-15 第二轮打磨**：此前全程**线性**插值，看起来像机器人推东西。
 *    现改为入场缓出 / 出场缓入（行业惯例：入场要"利落"、出场要"干脆"）。
 *
 * ── 缓动曲线选型依据（实测数值，非拍脑袋）─────────────────────────
 * `Easing.bezier` 各候选在 t=0.1/0.2/0.3 的推进量：
 *
 * | 曲线 | t=0.1 | t=0.2 | t=0.3 | 结论 |
 * |---|---|---|---|---|
 * | linear | 0.100 | 0.200 | 0.300 | ❌ 匀速，机械感 |
 * | cubic-out | 0.271 | 0.488 | 0.657 | 温和，可用但不够利落 |
 * | **expo-out (0.16,1,0.3,1)** | **0.494** | **0.752** | **0.877** | ✅ **选用** |
 * | back-out (0.34,1.56,..) | 0.404 | 0.703 | 0.907 | ❌ t=0.5 处达1.087 **超调 8.7%** |
 *
 * 30fps 下一条 60 帧 motion 的入场只有 ~11 帧：linear 在第 2 帧才动 10%，
 * 观众看到的是"缓慢爬升"；expo-out 在第 2 帧已完成 49%，读作"弹出"。
 *
 * 出场选 `Easing.in(Easing.cubic)`：比 expo-in 温和。
 * expo-in 在 t=0.9 已达 0.506，最后一段几乎消失，配上字幕会像"字被吸走"，
 * 反而显得廉价 —— 出场过快是成片里最常见的"没做完"感来源。
 *
 * ⚠️ **刻意不用 `back-out`**：它超调 8.7% 会让元素短暂越出 `footprint`
 * （字幕越框、竖条溢出），而 `footprint` 语义是「取全动画期最大包围盒」
 * （`types.ts`）—— 超调会让实际绘制超出声明范围，属契约违反而非视觉细节。
 *
 * 语义：返回 `{ enter, exit }`，两者都是 0–1 的进度值。
 * · `enter`：入场进度，0 → 1（**已缓出**，可直接当 opacity / 位移插值系数）
 * · `exit`：出场进度，0 → 1（**已缓入且反向**：调用方直接乘opacity 即可）
 */
export function enterExitProgress(
  frame: number,
  durationInFrames: number,
): { enter: number; exit: number } {
  const { enter, exit } = enterExitFrames(durationInFrames);
  // ⚠️ clamp 必须在缓动**之前** —— 缓动函数在 t>1 时行为未定义
  // （cubic-out 会继续上升、back-out 会剧烈超调），
  // 未钳制的帧会让画面飞出footprint，那是"第一帧/最后一帧就错位"的根因。
  const enterP = ENTER_EASE(clamp01(frame / Math.max(1, enter)));
  const exitP =
    frame >= durationInFrames - exit
      ? EXIT_EASE(clamp01((frame - (durationInFrames - exit)) / Math.max(1, exit)))
      : 0;
  return { enter: enterP, exit: exitP };
}

/**
 * 入场缓动 —— expo-out，等价于 CSS `cubic-bezier(0.16, 1, 0.3, 1)`。
 *
 * ⚠️ 抽成常量而非内联：调参时只改这一处，且测试可直接引用同一函数，
 * 避免"测试里写了另一条曲线、以为在测实际用的那条"。
 */
export const ENTER_EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** 出场缓动 —— cubic-in，等价于 CSS `cubic-bezier(0.55, 0.055, 0.675, 0.19)`。 */
export const EXIT_EASE = Easing.in(Easing.cubic);

/**
 * MotionSpec 的缓动名 → 函数映射（S1b，2026-10-20）。
 *
 * 🔴 **唯一真源**：`SpecRenderer` 只从这里取，禁止组件内联缓动 ——
 *    与 `ENTER_EASE` / `EXIT_EASE` 同理，测试要能引用「实际用的那条曲线」。
 * `expoOut` 复用 `ENTER_EASE`（项目实测选用的 0.16,1,0.3,1），不新造。
 */
export const SPEC_EASE: Record<
  'linear' | 'out' | 'in' | 'inOut' | 'expoOut',
  (t: number) => number
> = {
  linear: (t: number) => t,
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.cubic),
  inOut: Easing.inOut(Easing.quad),
  expoOut: ENTER_EASE,
};

/** 0–1 钳制。纯函数。 */
export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 整体不透明度 = 入场淡入 × 出场淡出。 */
export function fadeInOut(frame: number, durationInFrames: number): number {
  const { enter, exit } = enterExitProgress(frame, durationInFrames);
  return enter * (1 - exit);
}

/**
 * 阴影。文字压在实拍画面上需要描边/阴影保证可读，
 * 否则亮背景上白字直接消失 —— 这是"能发布"与"能看"的差别。
 */
export const SHADOW = {
  /** 字幕级：紧致投影。 */
  text: '0 2px 8px rgba(0,0,0,0.85)',
  /** 卡片级：带主色辉光。 */
  card: '0 8px 32px rgba(0,0,0,0.55)',
} as const;