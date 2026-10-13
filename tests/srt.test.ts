/**
 * SRT 解析 —— M-1（方案 b）输入侧的单测。
 *
 * 重点不在「正常 SRT 能解析」，而在**变体与损坏输入的处理**：
 * 解析器面对的是用户交上来的真实文件，格式脏是常态。
 *
 * 🔴 一条贯穿全文件的纪律：**解析失败必须抛 `ConfigError`（退出码 2），
 * 不返回空数组**。空数组会让下游以为「这段没有台词」——
 * 把配置错当成内容没做好，正是本项目反复要防的那类静默失败。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSrt, __test__ } from '../src/core/srt.ts';
import { ConfigError } from '../src/core/exit-code.ts';

const FPS = 30;

function tmpSrt(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srt-test-'));
  const f = path.join(dir, 'a.srt');
  fs.writeFileSync(f, content, 'utf8');
  return f;
}

describe('parseSrt —— 正常与变体', () => {
  it('标准 SRT（逗号毫秒、CRLF）', () => {
    const f = tmpSrt('1\r\n00:00:01,000 --> 00:00:03,000\r\n强制对齐\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,500\r\n词级时间戳\r\n');
    const cues = parseSrt(f, FPS);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ index: 0, text: '强制对齐', fromFrame: 30, toFrame: 90 });
    expect(cues[1]!.text).toBe('词级时间戳');
  });

  it('点号毫秒分隔符（部分工具导出如此）', () => {
    const f = tmpSrt('1\n00:00:01.000 --> 00:00:03.000\n文本\n');
    expect(parseSrt(f, FPS)[0]!.fromFrame).toBe(30);
  });

  it('单行 cue 与多行 cue 都能解析', () => {
    const single = tmpSrt('1\n00:00:01,000 --> 00:00:02,000\n一句话\n');
    expect(parseSrt(single, FPS)[0]!.text).toBe('一句话');
    const multi = tmpSrt('1\n00:00:01,000 --> 00:00:03,000\n第一行\n第二行\n');
    expect(parseSrt(multi, FPS)[0]!.text).toBe('第一行\n第二行');
  });

  it('序号缺省 / 与顺序不符 → 不依赖序号，只依赖块序', () => {
    const f = tmpSrt('99\n00:00:01,000 --> 00:00:02,000\n甲\n\n1\n00:00:03,000 --> 00:00:04,000\n乙\n');
    const cues = parseSrt(f, FPS);
    expect(cues.map((c) => c.text)).toEqual(['甲', '乙']);
    // 序号连续重编号
    expect(cues.map((c) => c.index)).toEqual([0, 1]);
  });

  it('BOM 被剥掉', () => {
    const f = tmpSrt('﻿1\n00:00:01,000 --> 00:00:02,000\n文本\n');
    expect(parseSrt(f, FPS)).toHaveLength(1);
  });

  it('末尾无空行也能解析', () => {
    const f = tmpSrt('1\n00:00:01,000 --> 00:00:02,000\n文本');
    expect(parseSrt(f, FPS)).toHaveLength(1);
  });

  it('toFrame 用 ceil —— 不丢时长（0.01s 不该塌成 0 帧）', () => {
    const f = tmpSrt('1\n00:00:00,000 --> 00:00:00,010\n短\n');
    expect(parseSrt(f, FPS)[0]!.toFrame).toBe(1);
  });

  it('保留原始秒数供人工对账（B2-fix：不参与判定）', () => {
    const f = tmpSrt('1\n00:01:02,500 --> 00:01:05,000\n文本\n');
    const c = parseSrt(f, FPS)[0]!;
    expect(c.srtFromSec).toBe(62.5);
    expect(c.srtToSec).toBe(65);
  });
});

describe('parseSrt —— 非台词内容剥离', () => {
  const strip = __test__.stripNonSpeech;

  it('方括号注音 / 六角括号音效', () => {
    expect(strip('[笑声]\n真正的台词')).toBe('真正的台词');
    expect(strip('【音乐渐入】\n台词')).toBe('台词');
  });

  it('圆括号内容整行', () => {
    expect(strip('（停顿）\n台词')).toBe('台词');
  });

  it('说话人标签单独成行', () => {
    expect(strip('张三：\n你好')).toBe('你好');
  });

  it('「音效：xxx」这类显式标注', () => {
    expect(strip('音效：掌声\n台词')).toBe('台词');
  });

  it('🔴 不误伤正常台词里的括号与冒号', () => {
    // 整块正则会误伤这类，必须逐行判定
    expect(strip('他说（轻声）：你好')).toBe('他说（轻声）：你好');
    expect(strip('参数是 3.5：很关键')).toBe('参数是 3.5：很关键');
    expect(strip('C++ 和 Rust')).toBe('C++ 和 Rust');
  });

  it('剥离后为空的 cue 被丢弃、不占序号', () => {
    const f = tmpSrt(
      '1\n00:00:01,000 --> 00:00:02,000\n[笑声]\n\n2\n00:00:03,000 --> 00:00:04,000\n真台词\n',
    );
    const cues = parseSrt(f, FPS);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ index: 0, text: '真台词' });
  });
});

describe('parseSrt —— 损坏输入必须显式失败', () => {
  it('文件不存在 → ConfigError', () => {
    expect(() => parseSrt(path.join(os.tmpdir(), 'nope-404.srt'), FPS)).toThrow(ConfigError);
  });

  it('🔴 解析为空 → 抛错而非返回空数组', () => {
    const f = tmpSrt('');
    expect(() => parseSrt(f, FPS)).toThrow(/为空/u);
  });

  it('全是非台词行 → 等同于空 → 抛错', () => {
    const f = tmpSrt('1\n00:00:01,000 --> 00:00:02,000\n[笑声]\n');
    expect(() => parseSrt(f, FPS)).toThrow(/为空/u);
  });

  it('时间戳格式错 → 抛错并指出行号', () => {
    const f = tmpSrt('1\n00:00:01 --> 00:00:02\n文本\n');
    expect(() => parseSrt(f, FPS)).toThrow(/第 2 行/u);
  });

  it('结束早于开始 → 抛错', () => {
    const f = tmpSrt('1\n00:00:05,000 --> 00:00:02,000\n文本\n');
    expect(() => parseSrt(f, FPS)).toThrow(/早于开始/u);
  });

  it('🔴 时间未前进（块顺序错乱）→ 抛错', () => {
    // SRT 时间戳虽不参与判定，但顺序错乱通常意味着文件损坏，须显式暴露
    const f = tmpSrt('1\n00:00:10,000 --> 00:00:12,000\n甲\n\n2\n00:00:01,000 --> 00:00:02,000\n乙\n');
    expect(() => parseSrt(f, FPS)).toThrow(/未前进/u);
  });
});

describe('M-1 相关纪律', () => {
  it('🔴 时间戳不参与判定，但解析结果里保留它 —— 供人工对账', () => {
    // B2-fix 说的是「不信任 SRT 时间戳」，不是「丢弃它们」：
    // 人工返修时要能看出 SRT 原本说了什么时间。
    const f = tmpSrt('1\n00:00:01,000 --> 00:00:03,000\n文本\n');
    const c = parseSrt(f, FPS)[0]!;
    expect(c.srtFromSec).toBe(1);
    expect(c.fromFrame).toBe(30);
  });

  it('fps 影响帧换算 —— 同一份 SRT 在不同 fps 下帧数不同', () => {
    const f = tmpSrt('1\n00:00:01,000 --> 00:00:02,000\n文本\n');
    expect(parseSrt(f, 30)[0]!.fromFrame).toBe(30);
    expect(parseSrt(f, 25)[0]!.fromFrame).toBe(25);
  });
});
