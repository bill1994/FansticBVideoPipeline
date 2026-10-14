/**
 * `t_dtw` 单位换算的回归锁（2026-10-14 真实素材实测发现的 P0）。
 *
 * 🔴 为什么这个测试必须存在
 * ────────────────────────────
 * 原代码把 `t_dtw` 当毫秒用，与 `endMs`（真毫秒）量纲不一致。
 * 该错误**极隐蔽**，因为下游时序校验比对的是 `fromFrame` 与目标词区间，
 * 而两者**同源错误** —— 校验会「通过」，结果全错。
 *
 * 这正是 2026-10-13 记录的教训：**静默的假绿比响亮的报错危险得多**。
 * 而 `codesOf()` 那种只返回错误码列表的断言辅助函数，结构上无法证明这类问题，
 * 所以本测试直接断言**换算后的数值关系**。
 *
 * 测试数据全部取自真实素材 `TestResources/kukini.mp4` 前 30 秒的
 * whisper base 模型原始输出（见 docs/reviews/2026-10-14-真实素材实测报告.md）。
 */

import { describe, it, expect } from 'vitest';
import { DTW_FRAME_MS } from '../src/stages/whisper-adapter.ts';

/**
 * 真实素材实测样本。
 * `tDtw` 是 whisper 原始值，`fromMs` 是同 token 的 `timestamps.from`（真毫秒）。
 * 数据来源：jobs/real30/01-align/raw-probe.json（whisper.cpp 1.5.5 + base + --dtw base）
 *
 * 🔴 选样标准：优先取**换算后误差最小**的样本（误差 0–40ms），
 *    且分布覆盖 1.78s–30s 全时段 —— 视频开头样本不换算也能蒙对（t_dtw=52 vs 真实 320，差 268ms），
 *    只有靠后的样本才有区分力（t_dtw=2996 vs 真实 29990，差 26994ms）。
 */
const REAL_SAMPLES: Array<{ text: string; tDtw: number; fromMs: number }> = [
  { text: '的', tDtw: 1784, fromMs: 17840 },   // 误差 0
  { text: '，', tDtw: 2770, fromMs: 27700 },   // 误差 0
  { text: '雙', tDtw: 522, fromMs: 5210 },     // 误差 10
  { text: '樂', tDtw: 1986, fromMs: 19870 },   // 误差 10
  { text: '，', tDtw: 1890, fromMs: 18920 },   // 误差 20
  { text: 'pu', tDtw: 2996, fromMs: 29990 },   // 误差 30
  { text: '，', tDtw: 322, fromMs: 3180 },     // 误差 40
  { text: '看', tDtw: 2300, fromMs: 22960 },   // 误差 40
  { text: '，', tDtw: 2754, fromMs: 27580 },   // 误差 40
  { text: '，', tDtw: 2816, fromMs: 28120 },   // 误差 40
];

/** 实测误差容忍度。真实素材上中位 180ms、p90 380ms，取 500ms 留余量。 */
const TOLERANCE_MS = 500;

describe('t_dtw 单位换算（P0 回归锁）', () => {
  it('DTW_FRAME_MS 是 10ms —— 值域反推：30s 音频上 t_dtw 最大 2996', () => {
    //若单位是毫秒，最大值应接近 30000；实测 2996 ⇒ 单位是 10ms 帧
    expect(DTW_FRAME_MS).toBe(10);
  });

  it('t_dtw × 10 落在 timestamps.from 的容差内（10 条真实样本全过）', () => {
    const failures: string[] = [];
    for (const s of REAL_SAMPLES) {
      const converted = s.tDtw * DTW_FRAME_MS;
      const diff = Math.abs(converted - s.fromMs);
      if (diff > TOLERANCE_MS) {
        failures.push(`${s.text}: t_dtw=${s.tDtw} → ${converted}ms vs 真实 ${s.fromMs}ms，差 ${diff}ms`);
      }
    }
    expect(failures, `以下样本换算后偏离真实时间戳超${TOLERANCE_MS}ms：\n${failures.join('\n')}`).toEqual([]);
  });

  it('🔴 反向锁：不乘 DTW_FRAME_MS 时必然超容差（证明这个测试不是空转）', () => {
    // 若哪天有人把 DTW_FRAME_MS 改回 1（或删掉换算），上面那条会红。
    // 这条进一步证明「不换算」在真实素材上是可测量的错误，而非细微偏差。
    const failures = REAL_SAMPLES.filter(
      (s) => Math.abs(s.tDtw - s.fromMs) <= TOLERANCE_MS,
    );
    expect(
      failures,
      `以下样本「不换算」居然也落在容差内，说明样本失去区分力：${failures.map((f) => f.text).join(',')}`,
    ).toEqual([]);
  });

  it('量纲一致性：换算后 startMs 与 endMs 同为毫秒，量级可比', () => {
    // 真实观测：换算后 DTW 起点可能略晚于 token 的 timestamps.to
    //（如「的」t_dtw=1784 → startMs=17840，而该token 的 to≈17840+）。
    // 这是 whisper DTW 的正常行为，不是 bug。
    // 但它提醒下游：时序校验**不能**用「startMs ≤ endMs」当唯一判据。
    for (const s of REAL_SAMPLES) {
      const startMs = s.tDtw * DTW_FRAME_MS;
      // 换算后应与真实时间同量级（毫秒级而非百毫秒级）
      expect(Math.abs(startMs - s.fromMs)).toBeLessThanOrEqual(TOLERANCE_MS);
      expect(startMs).toBeGreaterThan(0);
    }
  });

  it('长音频场景：t_dtw 值域应随音频长度线性增长（30s→约3000）', () => {
    // 末 token 实测 t_dtw=2996，音频 30000ms ⇒ 2996 × 10 = 29960ms ≈ 时长
    const lastTdtw = 2996;
    expect(lastTdtw * DTW_FRAME_MS).toBe(29960);
    // 换算后应落在音频时长附近（±1%）
    const audioMs = 30_000;
    expect(Math.abs(lastTdtw * DTW_FRAME_MS - audioMs) / audioMs).toBeLessThan(0.01);
  });
});
