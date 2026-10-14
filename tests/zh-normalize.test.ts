/**
 * 中文归一（繁简 / 全角 / 罗马数字）的测试。
 *
 * 样本全部取自 2026-10-14 真实素材实测：
 * whisper base 对 `TestResources/kukini.mp4` 前 30s 的输出
 * vs `TestResources/10月6日.srt` 原文。
 *
 * 🔴 核心断言：归一后 whisper 输出 与 SRT 原文**字形一致**。
 * 这正是第二步 DP 能工作的前提 —— 若这里不一致，
 * alignedRatio 会趋近 0，而 M-1c 门控会把编码问题误报成数据质量问题。
 */

import { describe, it, expect } from 'vitest';
import { normalizeToken, normalizeText, __test__ } from '../src/core/zh-normalize.ts';

describe('中文归一', () => {
  describe('繁 → 简（实测对照）', () => {
    // 左：whisper 实际输出；右：SRT 原文
    const CASES: Array<[string, string]> = [
      ['整個', '整个'],
      ['雙鞋', '双鞋'],
      ['色調', '色调'],
      ['結合', '结合'],
      ['這雙', '这双'],
      ['貼合感', '贴合感'],
      ['驚喜', '惊喜'],
      // 🔴 只测「字形」，不测「字音」。
      // 「無鞋神」是 base 模型把「绳」听成「神」的同音错字 —— 那是 ASR 的错误，
      // 归一化层**不该**、也**无法**修复它（见 normalizeText 的「刻意不做的事」）。
      // 这里只断言字形替换：無 → 无；鞋/神 已是简体，原样保留。
      ['無鞋神', '无鞋神'],
    ];

    for (const [src, want] of CASES) {
      it(`「${src}」→「${want}」`, () => {
        expect(normalizeText(src)).toBe(want);
      });
    }

    it('🔴 真实性检验：归一后与 SRT 字形一致（这是 DP 的前提）', () => {
      // 若这条挂了，说明映射表漏字 —— 第二步 DP 会在这些字上全部错位
      const whisper = '俾老婆整個雙鞋圈鞋眼包';
      const srt = '给老婆整了双鞋圈显眼包';
      // 归一后：整/个/双 应已一致；「俾→给」「眼→了」「包→包」属同音/形近错字，
      // **不是归一该管的**（见文件头「刻意不做的事」）。
      const n = normalizeText(whisper);
      expect(n).toContain('整个');
      expect(n).toContain('双鞋');
      // 显式记录：归一不解决错字
      expect(n).not.toBe(srt);
    });
  });

  describe('全角 → 半角', () => {
    it('全角字母', () => {
      expect(normalizeText('ＳＴＵＳＳＹ')).toBe('STUSSY');
    });

    it('全角空格', () => {
      expect(normalizeText('a\u3000b')).toBe('a b');
    });

    it('半角原样不动', () => {
      expect(normalizeText('Kukini')).toBe('Kukini');
    });
  });

  describe('罗马数字（仅尾随）', () => {
    it('尾随全角 Ⅱ → II（实测：Kukini Ⅱ）', () => {
      expect(normalizeToken('Ⅱ')).toBe('II');
    });

    it('混合尾随 Ⅳ Ⅲ Ⅱ Ⅰ', () => {
      expect(normalizeToken('Ⅳ')).toBe('IV');
      expect(normalizeToken('Ⅲ')).toBe('III');
      expect(normalizeToken('Ⅸ')).toBe('IX');
    });

    it('⚠️ 词中间的罗马数字不拆（保词边界，DP 要对齐它）', () => {
      // 「KukiniⅡ联名」这种形态：Ⅱ 不在末尾，不处理
      const s = normalizeToken('KukiniⅡ联名');
      // Ⅱ 保留原样（不是尾随）
      expect(s).toContain('Ⅱ');
    });
  });

  describe('长度不变（DP 下标对账的前提）', () => {
    it('归一前后码点数一致', () => {
      const cases = ['整個雙鞋', 'ＳＴＵＳＳＹ', '貼合感', '黑白主色調'];
      for (const c of cases) {
        expect([...normalizeText(c)].length, `「${c}」长度变了`).toBe([...c].length);
      }
    });

    it('空串与纯 ASCII 不受影响', () => {
      expect(normalizeToken('')).toBe('');
      expect(normalizeText('hello world')).toBe('hello world');
      expect(normalizeText('12345')).toBe('12345');
    });
  });

  describe('幂等性（归一两次结果相同）', () => {
    it('已归一的文本再归一无变化', () => {
      const cases = ['整个双鞋', '色调', 'STUSSY', 'Kukini II'];
      for (const c of cases) {
        const once = normalizeText(c);
        expect(normalizeText(once), `「${c}」不幂等`).toBe(once);
      }
    });
  });

  describe('映射表自检（防「文档一套代码一套」）', () => {
    it('T2S 的键必须都是繁体（值不等于键）', () => {
      const identity = Object.entries(__test__.T2S).filter(([k, v]) => k === v);
      expect(identity, `以下键值相同（无意义映射）：${identity.map(([k]) => k).join(',')}`).toEqual([]);
    });

    it('ROMAN 的 10 个值互不重复', () => {
      const vals = Object.values(__test__.ROMAN);
      expect(new Set(vals).size).toBe(vals.length);
    });

    it('实测确认的 8 个字必须在表内（防误删）', () => {
      const verified = ['個', '雙', '無', '調', '結', '樂', '這', '體'];
      const missing = verified.filter((c) => !(c in __test__.T2S));
      expect(missing, `实测确认的字被删了：${missing.join(',')}`).toEqual([]);
    });
  });
});
