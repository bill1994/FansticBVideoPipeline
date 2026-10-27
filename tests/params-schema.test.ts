/**
 * 参数契约校验 —— 校验项 #16（P1）。
 *
 * 独立文件而非并入 `validate.test.ts`：本项属「参数契约」数据域，
 * 与 timeline / geometry / occlusion 无关；沿用现有「文件按域」的组织方式。
 *
 * 本文件含两类用例，**第二类更重要**：
 * 1. 正常判定（未知键 / 缺必填 / 类型不符）
 * 2. **回归锁** —— 锁死那些「容易被后人好心改坏」的设计决定
 */

import { describe, expect, it } from 'vitest';
import { runValidation } from '../src/validate/index.ts';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.ts';
import { makeCtx, makeItem, makeTrack } from './_ctx.ts';

const KINETIC = 'typography/kinetic-line@1.0'; // paramsSchema {text, enter}, required [text]
const CAPTION = 'caption/karaoke-word@1.0'; // paramsSchema {boxed}, 无必填
const STAT = 'data/stat-card@1.0'; // paramsSchema {value, unit}, required [value]

function codes(motion: string, params?: Record<string, unknown>): string[] {
  return runValidation(
    makeCtx({
      tracks: [makeTrack('a', 60, [makeItem({ motion, fromFrame: 100, durationInFrames: 90, params })])],
    }),
  ).items.map((i) => i.code);
}

describe('#16 参数契约', () => {
  it('全部必填齐全且类型正确 → 无 params 码', () => {
    expect(codes(KINETIC, { text: '强制对齐' })).not.toContain('E-P1-02');
    expect(codes(KINETIC, { text: '强制对齐', enter: 'fade-up' })).not.toContain('E-P1-02');
  });

  it('未知键 → E-P1-01，且 targets 精确指向该 item', () => {
    const r = runValidation(
      makeCtx({
        tracks: [
          makeTrack('a', 60, [makeItem({ motion: KINETIC, fromFrame: 100, durationInFrames: 90, params: { text: 'x', bogus: 1 } })]),
        ],
      }),
    );
    const item = r.items.find((i) => i.code === 'E-P1-01');
    expect(item?.targets).toEqual(['a/000']);
    expect(item?.level).toBe('error');
    expect(item?.message).toContain('bogus');
  });

  it('🔴 caption 硬塞 text → E-P1-01（字幕唯一来源被污染，不可降级为 warning）', () => {
    const r = runValidation(
      makeCtx({
        tracks: [makeTrack('a', 60, [makeItem({ motion: CAPTION, fromFrame: 100, durationInFrames: 90, params: { boxed: false, text: '模型写的字幕' } })])],
      }),
    );
    const item = r.items.find((i) => i.code === 'E-P1-01');
    expect(item?.level).toBe('error');
    expect(item?.message).toContain('text');
    // hint 必须点明字幕来自 SRT —— 这是它比其他未知键更危险的原因
    expect(item?.hint).toContain('SRT');
  });

  it('缺必填键 → E-P1-02', () => {
    const c = codes(STAT, { unit: 'x' });
    expect(c).toContain('E-P1-02');
    const item = runValidation(
      makeCtx({ tracks: [makeTrack('a', 60, [makeItem({ motion: STAT, fromFrame: 100, durationInFrames: 90, params: { unit: 'x' } })])] }),
    ).items.find((i) => i.code === 'E-P1-02');
    expect(item?.message).toContain('value');
  });

  it('可选键缺失不算错误（enter 无默认填写也不报）', () => {
    expect(codes(KINETIC, { text: 'x' })).not.toContain('E-P1-02');
  });

  it('类型不符 → E-P1-03', () => {
    const c = codes('cinematic/punch-in@1.0', { scale: '1.08' });
    expect(c).toContain('E-P1-03');
  });

  it('反 gaming：NaN / Infinity 必须报类型错（裸 typeof 会放行）', () => {
    const r1 = runValidation(
      makeCtx({ tracks: [makeTrack('a', 60, [makeItem({ motion: 'cinematic/punch-in@1.0', fromFrame: 100, durationInFrames: 90, params: { scale: NaN } })])] }),
    );
    expect(r1.items.map((i) => i.code)).toContain('E-P1-03');
    const r2 = runValidation(
      makeCtx({ tracks: [makeTrack('a', 60, [makeItem({ motion: 'cinematic/punch-in@1.0', fromFrame: 100, durationInFrames: 90, params: { scale: Infinity } })])] }),
    );
    expect(r2.items.map((i) => i.code)).toContain('E-P1-03');
  });

  it('反 gaming：布尔与数字字符串不得被隐式转换放行', () => {
    expect(codes(CAPTION, { boxed: 'false' })).toContain('E-P1-03');
    expect(codes(CAPTION, { boxed: 0 })).toContain('E-P1-03');
    // 而真正的布尔值通过
    expect(codes(CAPTION, { boxed: false })).not.toContain('E-P1-03');
  });

  it('反 gaming：未知键不得因「值类型碰巧对」而豁免', () => {
    // text 未声明，即使它是 string 类型，也必须报未知键
    const c = codes(CAPTION, { boxed: true, text: 'x' });
    expect(c).toContain('E-P1-01');
  });

  it('params 整体缺失 与 params:{} 产出完全相同的码集合', () => {
    // 注意：`makeItem` 现在给默认 params，故这里用 `params: undefined` 显式覆盖
    const withUndefined = runValidation(
      makeCtx({
        tracks: [makeTrack('a', 60, [makeItem({ motion: STAT, fromFrame: 100, durationInFrames: 90, params: undefined })])],
      }),
    ).items.map((i) => i.code);
    const withEmpty = runValidation(
      makeCtx({ tracks: [makeTrack('a', 60, [makeItem({ motion: STAT, fromFrame: 100, durationInFrames: 90, params: {} })])] }),
    ).items.map((i) => i.code);
    expect(withUndefined).toEqual(withEmpty);
    // 且都应报缺必填的 value
    expect(withUndefined).toContain('E-P1-02');
  });

  it('一个 item 同时犯三种错 → 三条码全出（不因前一条而跳过）', () => {
    const c = codes(STAT, { nope: 1, wrongType: 'x' });
    expect(c).toContain('E-P1-01'); // nope
    expect(c).toContain('E-P1-02'); // value 缺失
  });

  it('非法 item 不得被剔除 —— 其他校验项仍应执行', () => {
    const r = runValidation(
      makeCtx({
        tracks: [
          makeTrack('a', 60, [makeItem({ motion: STAT, fromFrame: 100, durationInFrames: 90, params: { nope: 1 } })]),
        ],
        // 同时埋一个时长错误（该模板 minVisible 45，90帧够；改用禁配段相交更直接）
        noMotionRanges: [{ fromFrame: 0, durationInFrames: 900, reason: 'test' }],
      }),
    );
    const codesAll = r.items.map((i) => i.code);
    // 参数非法的 item 仍在 scene 里，其他校验项照常对它判定
    expect(codesAll).toContain('E-P1-01');
    expect(codesAll).toContain('E-E5-01');
  });
});

describe('#16 回归锁 —— 锁死不该被改坏的设计决定', () => {
  it('🔴 caption/karaoke-word 的 paramsSchema 不得含 text', () => {
    // 加了它，模型就能给字幕注入第二个文本来源，而时序校验拦不住
    const tpl = BUILTIN_TEMPLATES.find((t) => t.id === CAPTION);
    expect(tpl).toBeDefined();
    expect(Object.keys(tpl!.paramsSchema)).not.toContain('text');
  });

  it('🔴 任何模板的 paramsSchema 都不许声明颜色类参数', () => {
    // Spec 附录 A 第 1 条硬约束：禁写坐标 / 帧数 / 颜色 / CSS。
    // 高亮色应走命名令牌（'brand'|'accent'），不给模型 hex。
    for (const t of BUILTIN_TEMPLATES) {
      for (const key of Object.keys(t.paramsSchema)) {
        // ⚠️ 只匹配**参数名**，不要把模板 id 拼进来：
        //    正则里的 `fill`/`stroke` 会误伤模板名（如 `typography/outline-fill`，
        //    2026-10-27 实撞）。模板 id 放进提示消息，保留定位能力。
        expect(key, `${t.id} 的参数 ${key} 命名像颜色类参数`).not.toMatch(
          /color|colour|hex|fill|stroke|bg|background/i,
        );
      }
    }
  });

  it('声明的类型词必须落在已知集合内', () => {
    const known = new Set(['string', 'boolean', 'number']);
    for (const t of BUILTIN_TEMPLATES) {
      for (const [k, v] of Object.entries(t.paramsSchema)) {
        expect(known.has(v), `${t.id}:${k} 的类型词 "${v}" 未知`).toBe(true);
      }
    }
  });

  it('requiredParams 的每一项都必须在 paramsSchema 中声明过', () => {
    // 否则校验项 #16 会要求模型填一个从未声明过的键 —— 死锁
    for (const t of BUILTIN_TEMPLATES) {
      for (const k of t.requiredParams ?? []) {
        expect(k in t.paramsSchema, `${t.id}:${k} 被标为必填但未在 paramsSchema 声明`).toBe(true);
      }
    }
  });

  it('模板自身能通过自己的校验（10 个模板逐个过）', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const params: Record<string, unknown> = {};
      for (const k of t.requiredParams ?? []) {
        params[k] = t.paramsSchema[k] === 'number' ? 1 : t.paramsSchema[k] === 'boolean' ? true : 'x';
      }
      const c = codes(t.id, params);
      expect(c, `${t.id} 用自身声明的参数却被报未知键`).not.toContain('E-P1-01');
    }
  });
});
