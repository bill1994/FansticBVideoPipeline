/**
 * 参数契约校验 —— 构建期校验项 **#16**。
 *
 * 来源：P1 裁决（登记册，2026-10-13）。
 *
 * ── 为什么新增这一项 ────────────────────────────────────────────
 * 写首批模板清单时发现：`paramsSchema` 只被定义（`templates/types.ts`）与
 * 注册（`templates/builtin.ts` / `registry.ts`），**校验器侧零引用**。
 * 后果是模型填了模板未声明的键、或漏填必填键，构建期一声不吭。
 *
 * 最危险的具体后果：`caption/karaoke-word` **故意不把 `text` 放进
 * paramsSchema**（字幕文本来自 SRT），而 `MotionItem.tsx:35` 直读
 * `item.params.text` —— 模型一旦硬塞 `text`，字幕文本就有了第二个来源，
 * 与语音对不上，**而时序校验只看帧区间、任何校验项都拦不住**。
 *
 * ── 判定口径（三条，全 error）──────────────────────────────────
 *   E-P1-01 未知键   params 里有、paramsSchema 没声明的键
 *   E-P1-02 缺必填键 requiredParams 里的键没出现在 params 中
 *   E-P1-03 类型不符 声明 'number' 但给了非有限数值 / 'boolean' 但给了字符串等
 *
 * 判定顺序固定为 01 → 02 → 03：**未知键最能指出模型对模板的理解偏差**，
 * 先报它，同一个item 的其他问题不会被埋掉。
 *
 * ── 明确不做的事 ───────────────────────────────────────────────
 * · **不做隐式转换**：`scale: "1.08"` 不等于 `scale: 1.08`。
 *   校验器不做模型该做的事，把字符串悄悄转成数字等于替模型做决策。
 * · **不判语义**：`stat-card` 的 `value: "999%"` 数值可疑但结构正确，
 *   校验器只验结构。语义真伪需人工或后续 VLM，见裁决材料 §4.3。
 * · **不剔除 item**：校验器是纯函数且逐项独立判定（SPEC §2.1）。
 *   剔除会让报告随哪几项先跑而变，并吞掉其他项的真实问题。
 */

import { CODES } from '../core/errors.ts';
import type { ReportItem } from '../core/report.ts';
import type { SceneItem, ValidateContext } from './context.ts';
import { mk } from './item.ts';

/**
 * 类型判定。**刻意比裸 `typeof` 更严**：
 * · `'number'` 额外要求有限值 —— `NaN` / `Infinity` 的 `typeof` 也是
 *   `'number'`，裸 typeof 会放行，而它们在插值时会产生 NaN 污染整条画面。
 * · 不接受任何隐式转换，也不接受数字字符串。
 */
function typeOk(expected: string, actual: unknown): boolean {
  switch (expected) {
    case 'string':
      return typeof actual === 'string';
    case 'boolean':
      return typeof actual === 'boolean';
    case 'number':
      return typeof actual === 'number' && Number.isFinite(actual);
    default:
      // 未知类型词：不判类型（模板声明写错属另一类问题，不在这里连带报错）
      return true;
  }
}

/** 单个 item 的参数契约判定。 */
function checkOne(s: SceneItem): ReportItem[] {
  const out: ReportItem[] = [];
  const params = s.item.params ?? {};
  const declared = s.tpl.paramsSchema;
  const required = s.tpl.requiredParams ?? [];
  const frames = [s.start, s.end];

  // ── E-P1-01 未知键 ────────────────────────────────────────────
  const unknown = Object.keys(params).filter((k) => !(k in declared)).sort();
  if (unknown.length > 0) {
    out.push(
      mk(
        CODES.PARAMS_UNKNOWN_KEY,
        'build',
        [s.ref],
        frames,
        `motion "${s.tpl.id}" 的 params 含未声明键：${unknown.join(', ')}`,
        s.tpl.family === 'caption' && unknown.includes('text')
          ? '⚠️ 字幕文本来自 SRT，不经 params。给它 text 会让字幕与语音出现第二个来源，' +
                '且时序校验只看帧区间、拦不住这种错。要改字幕请改 SRT 或 words.json。'
          : `该模板已声明的键：${Object.keys(declared).join(', ') || '（无）'}。` +
            '模型只应填表，不应自造参数。',
      ),
    );
  }

  // ── E-P1-02 缺必填键 ──────────────────────────────────────────
  // `params` 整体缺失与 `params: {}` 产出**完全相同**的判定 ——
  // 两者语义上就是一回事，不该被实现区分开。
  const missing = required.filter((k) => !(k in params)).sort();
  if (missing.length > 0) {
    out.push(
      mk(
        CODES.PARAMS_MISSING_REQUIRED,
        'build',
        [s.ref],
        frames,
        `motion "${s.tpl.id}" 的 params 缺必填键：${missing.join(', ')}`,
        `该模板的必填参数：${required.join(', ')}；可选参数：${
          Object.keys(declared).filter((k) => !required.includes(k)).join(', ') || '（无）'
        }。`,
      ),
    );
  }

  // ── E-P1-03 类型不符 ──────────────────────────────────────────
  const badType = Object.keys(declared)
    .filter((k) => k in params)
    .filter((k) => !typeOk(declared[k] as string, params[k]))
    .sort();
  if (badType.length > 0) {
    const detail = badType
      .map((k) => {
        const v = params[k];
        const shown = typeof v === 'number' && !Number.isFinite(v) ? String(v) : JSON.stringify(v);
        return `${k}（声明 ${declared[k]}，实得 ${shown}）`;
      })
      .join('; ');
    out.push(
      mk(
        CODES.PARAMS_TYPE_MISMATCH,
        'build',
        [s.ref],
        frames,
        `motion "${s.tpl.id}" 的 params 类型不符：${detail}`,
        '不做隐式转换 —— 字符串 "1.08" 不等于数字 1.08，由渲染期去猜等于替模型做决策。',
      ),
    );
  }

  return out;
}

/** #16 参数契约。遍历全部 item，不因某项非法而剔除。 */
export function checkParams(ctx: ValidateContext): ReportItem[] {
  return ctx.scene.flatMap(checkOne);
}
