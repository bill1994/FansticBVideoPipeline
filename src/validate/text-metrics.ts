/**
 * 文本溢出校验 —— 构建期校验项 **#17**。
 *
 * 来源：**D-B 裁决（2026-10-15，用户拍板选方案 B）**。
 * 背景：真渲实测 16 中文字 + `123456789` 时，4 个模板全部溢出，
 * `data/stat-card` 甚至**溢出画面边界**；而当时的校验器全是结构判定，
 * **完全看不出来**，报告照样 `ok: true`。
 *
 * 🔴 **根因**：`whiteSpace: nowrap` 意味着溢出**既不折行也不缩放**。
 *    这是项目最忌讳的故障形态 —— 静默、看起来正常、成片已坏。
 *    （与本日「定义了没人用」同源：项目对「未实现」有诚实降级，
 *    对「实现了但输出越界」此前**没有任何机制**。）
 *
 * ── 判定式 ──────────────────────────────────────────────────────
 * ```
 * 估算宽 = Σ 每字宽 × 字数
 * 每字宽 = fontSizePx × charWidthEm
 * 可用宽 = footprint 宽 × 画面宽 − paddingPx
 * 超宽 ⟺ 估算宽 > 可用宽 × (1 + slackRatio)
 * ```
 *
 * ── 三个已定参数（D-B 裁决，必须一起定）────────────────────────
 * | 参数 | 值 | 依据 |
 * |---|---|---|
 * | `charWidthEm` | CJK 1.0 / 拉丁数字 0.5 / 空格 0.3 | 全角≈1em；实测「14 字 ≈ 806px 框」反推 54×14=756 加 padding吻合 |
 * | `slackRatio` | **0.15** | 字体实际度量可能略宽于估算，留档防误伤 |
 * | 报错档| **warning（不阻断）** | 同 `DENSITY.maxItemsPerCue` 教训：未校准判定当error 用会伤害真实用户 |
 *
 * 🔴 **为何warning 而非 error**：这是**估算**判定，不是精确度量。
 *    若当error 用，估算误差会直接阻断合法创作 —— 那就是
 *    计划书风险 R6「审美断言设计过度 ⇒ 误伤」的具体化。
 *    实测校准后可升error。
 *
 * ── 单一真源纪律 ────────────────────────────────────────────────
 * 字号与内边距**必须**读 `TemplateDeclaration.textMetrics`，
 * **禁止在本文件另写一份字号表** —— 否则改组件字号时判定会静默失准。
 * 这与 `DUR.exit` 事故同款病（定义了没人用 / 静默漂移）。
 */

import { CODES } from '../core/errors.ts';
import type { ReportItem } from '../core/report.ts';
import type { TextMetrics } from '../templates/types.ts';
import type { SceneItem, ValidateContext } from './context.ts';
import { mk } from './item.ts';

/**
 * 画面基准宽度。
 *
 * ⚠️ **为什么硬编码 1920**：契约里的 `fontSizePx` 与 `footprint` 都是
 *    相对 1920×1080 标定的（Remotion `Root.tsx` 的 Composition 尺寸）。
 *    换分辨率须同步调整字号，否则判定失准 —— 与「改 fps 必须重新烘焙」同理。
 */
/**
 * 画面宽度的**缺省值**（不是唯一基准）。
 *
 * 🔴 2026-10-19 `P4` 之后画面宽度进契约（`source.json` 的 `width`/`height`），
 *    校验改用 `ctx.source.width ?? FRAME_WIDTH_PX` —— 否则竖屏素材（1080 宽）
 *    会被按 1920 估算，**系统性漏报溢出**。
 *    此常量只在清单未填时兜底，与 `core/video-size.ts` 的 `DEFAULT_RENDER_WIDTH` 同值。
 */
const FRAME_WIDTH_PX = 1920;

/** 各类字符的宽度估算系数（em 倍数）。 */
const EM = {
  /** 中日韩文字 —— 全角，等于字号本身。 */
  cjk: 1.0,
  /** ASCII 字母与数字 —— 约半个字宽。 */
  latin: 0.5,
  /** 空格。 */
  space: 0.3,
} as const;

/**
 * 逐字累加宽度估算。
 *
 * ⚠️ 纯字符分类，**不做字体度量** —— 校验器是纯 JSON→JSON，
 * 碰不到浏览器布局（这正是方案 A「渲染期自适应」测不了的原因）。
 *
 * 🔴 **用码点判断，不用正则字符类**：`/[一-鿿]/` 这类写法在
 *    源码里是「字面量范围」，一旦编辑器/转码环节动了字节就会静默失配
 *    —— 且失配表现为「漏判」，不报错。故直接比码点。
 */
export function estimateTextWidthPx(text: string, metrics: TextMetrics): number {
  // D-B2：CJK 与拉丁/数字是**两把尺子** —— 粗体数字 0.667em 与 CJK 1.0em
  // 不能共用一个系数（见 TextMetrics.latinWidthEm 的说明）。
  // ⚠️ 两者都是**绝对 em 值**，不是「再乘一次基准」：
  //    写成 `latinEm * EM.latin` 会把默认 0.5 再打五折（2026-10-24 踩过）。
  const cjkEm = metrics.charWidthEm ?? EM.cjk;
  const latinEm = metrics.latinWidthEm ?? EM.latin;
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 32 || code === 9) w += EM.space;
    // CJK 文字与标点 —— 三个区段，**缺一即系统性低估溢出**：
    //   U+3000–303F CJK 符号与标点（、。「」）
    //   U+4E00–9FFF 统一表意文字（一二三四…）
    //   U+FF00–FFEF 全角 ASCII（**（）【】** 等常用全角括号在这一段，
    //     ⚠️ 漏掉这段会把「（一）」算成 3 个半角字而非 3 个全角字）
    else if (
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      w += cjkEm;
    } else w += latinEm;
  }
  return w * metrics.fontSizePx;
}

/**
 * 参与宽度判定的参数键（按主次顺序）。
 *
 * 🔴 **单一真源**：校验器与 D-B2 实测工具共用这张表 ——
 *    若工具测了 `target` 而校验器不判它，实测表就成了摆设。
 * `target` 是 `annotation/pointer-callout` 的标注文字（2026-10-24 起有 textMetrics），
 * 到此为止四个键覆盖全部「会画文字」的内置模板。
 */
export const TEXT_WIDTH_KEYS = ['title', 'value', 'text', 'target'] as const;

/** 脚本文本 → 用于宽度的键（按主次顺序）。 */
function widthKeysOf(s: SceneItem): string[] {
  const schema = s.tpl.paramsSchema;
  const out: string[] = [];
  // 顺序 = 判定优先级。**只取模板已声明的键**，
  // 杜绝「校验器认出一个 paramsSchema 里没有的键」这类自造契约。
  for (const k of TEXT_WIDTH_KEYS) {
    if (k in schema) out.push(k);
  }
  return out;
}

function checkOne(s: SceneItem, canvasWidth: number): ReportItem[] {
  const out: ReportItem[] = [];
  const metrics = s.tpl.textMetrics;
  // 省略 textMetrics = 该模板无可测文本（载体类 / fullscreen / 字幕带）
  // ⇒ 跳过，**不误报**（字幕文本来自 SRT，不是模型自由填写）。
  if (!metrics) return out;

  const slack = metrics.slackRatio ?? 0.15;
  const [, , fw] = s.item.footprint;
  const available = fw * canvasWidth - (metrics.paddingPx ?? 0);
  const limit = available * (1 + slack);

  for (const key of widthKeysOf(s)) {
    const raw = s.item.params?.[key];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const est = estimateTextWidthPx(raw, metrics);
    if (est <= limit) continue;

    // ⚠️ 报告只**告知不阻断**（见文件头）。给出可操作的换算：
    // 在同字号下最多能放几个字 —— 比只说"超了"有用得多。
    const perChar = metrics.fontSizePx * (metrics.charWidthEm ?? EM.cjk);
    const maxChars = perChar > 0 ? Math.floor(available / perChar) : 0;
    out.push(
      mk(
        CODES.TEXT_OVERFLOW,
        'build',
        [s.ref],
        [s.start, s.end],
        `params.${key} 估算宽 ${Math.round(est)}px > 可用宽 ${Math.round(available)}px（含 ${Math.round(
          slack * 100,
        )}% 余量），会溢出 footprint`,
        `模板 ${s.tpl.id} 字号 ${metrics.fontSizePx}px、可用宽约 ${Math.round(available)}px`
          + ` ⇒ 同字号下最多约${maxChars} 字，当前 ${raw.length} 字。`
          + `缩短文案、缩小 footprint，或改小该模板字号（改字号须同步改 builtin.ts 的 textMetrics）。`
          + `\n⚠️ 此条为**估算**判定（未做字体度量），不阻断；确认误报可忽略。`,
      ),
    );
  }
  return out;
}

/** #17 文本溢出。遍历全部 item，不因某项非法而剔除（与 #16 同纪律）。 */
export function checkTextOverflow(ctx: ValidateContext): ReportItem[] {
  // P4 之后画面宽度可能不是 1920（竖屏 / 任意分辨率），估算基准必须跟着走。
  const canvasWidth = ctx.source.width ?? FRAME_WIDTH_PX;
  return ctx.scene.flatMap((s) => checkOne(s, canvasWidth));
}