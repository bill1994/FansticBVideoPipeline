/**
 * 产物时序自检（`F3-2`，2026-10-20）。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么这组测试必须存在
 * ─────────────────────────────────────────────────────────────────
 * 这道守卫防的是**实测发生过的故障**（`jobs/e2e-perceive`，2026-10-20 复跑时抓到）：
 *
 * ```
 * 10-18 14:53  storyboard.json      ← 用旧版 words.json 烘焙
 * 10-18 14:54  validate-report.json ← 校验的是上面那份 storyboard
 * 10-19 12:57  words.json           ← M-1f 落地后 align --force，覆盖成新版
 * ```
 *
 * 下游比上游旧 22 小时，那份报告却仍写着 `ok:true / error:0`，
 * 只是 warning 从真实的 21 变成了过时的 11（W-C3-01 由 14 变 4）。
 *
 * 🔴 **为什么不能用现有的 `alignmentConfidence` 断言兜住**：
 *    实测确认那个案例里两者**相等** —— M-1f 只重铺词时、不改均值置信度。
 *    ⇒ 现有防线确实漏了这个方向，本守卫不是冗余。
 *
 * 它与 `assertNotWritingUpstream`（`stage-io.test.ts` 覆盖）管的是**两个维度**：
 * · `assertNotWritingUpstream` → 写入方向：04 不许回写 03（防「改坏」）
 * · 本守卫                → 时序方向：上游更新后下游重跑了没（防「没跟着改」）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import { buildContext } from '../src/validate/context.ts';
import { STAGES } from '../src/core/config.ts';

/** 把某个文件的 mtime 设成「距 now 多少分钟前」。 */
function ageMinutes(file: string, minutes: number): void {
  const t = new Date(Date.now() - minutes * 60_000);
  fs.utimesSync(file, t, t);
}

describe('产物时序自检 —— 下游早于上游即报错', () => {
  let root: string;
  let jobId: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-order-'));
    jobId = 'j';
    const base = path.join(root, jobId);
    for (const s of Object.values(STAGES)) fs.mkdirSync(path.join(base, s), { recursive: true });

    fs.writeFileSync(
      path.join(base, STAGES.input, 'source.json'),
      JSON.stringify({ video: 'v.mp4', srt: 'v.srt', fps: 30, durationInFrames: 900 }),
    );
    fs.writeFileSync(
      path.join(base, STAGES.align, 'words.json'),
      JSON.stringify({ fps: 30, words: [], cues: [] }),
    );
    fs.writeFileSync(
      path.join(base, STAGES.align, 'align-report.json'),
      JSON.stringify({
        fps: 30,
        meanConfidence: 0.9,
        lowConfidenceRatio: 0,
        gatePassed: true,
        lowConfidenceWords: [],
        textSource: 'srt',
        alignedRatio: 1,
        thresholds: { alignedRatioMin: 0.8, lowConfidenceRatioMax: 0.3, meanConfidenceMin: 0.6 },
      }),
    );
    fs.writeFileSync(path.join(base, STAGES.perceive, 'shots.json'), JSON.stringify([]));
    fs.writeFileSync(path.join(base, STAGES.perceive, 'regions.json'), JSON.stringify([]));
    fs.writeFileSync(
      path.join(base, STAGES.storyboard, 'storyboard.json'),
      JSON.stringify({
        meta: { fps: 30, anchorMode: 'word', alignmentConfidence: 0.9 },
        tracks: [],
        noMotionRanges: [],
      }),
    );
    fs.writeFileSync(
      path.join(base, STAGES.storyboard, 'bake-report.json'),
      JSON.stringify({ fps: 30, resolved: [] }),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('🔴 storyboard 早于 words.json ⇒ 抛 ConfigError（报告不可信）', () => {
    const base = path.join(root, jobId);
    ageMinutes(path.join(base, STAGES.storyboard, 'storyboard.json'), 120); // 下游旧 2 小时
    ageMinutes(path.join(base, STAGES.align, 'words.json'), 10); // 上游新

    let msg = '';
    try {
      buildContext(jobId, root);
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      msg = (e as Error).message;
    }
    expect(msg, '应当抛错').not.toBe('');
    expect(msg).toContain('产物时序倒挂');
    // 报错要说清是哪一对、并给出可执行的修复动作
    expect(msg).toContain('storyboard.json');
    expect(msg).toContain('words.json');
    expect(msg).toContain('npm run pipeline -- storyboard');
  });

  it('🔴 bake-report 早于 words.json ⇒ 同样报错（另一对也要查）', () => {
    const base = path.join(root, jobId);
    // storyboard 保持较新（否则会先被 storyboard 那对拦下），只让 bake 旧
    ageMinutes(path.join(base, STAGES.align, 'words.json'), 60);
    ageMinutes(path.join(base, STAGES.storyboard, 'bake-report.json'), 5);
    ageMinutes(path.join(base, STAGES.storyboard, 'storyboard.json'), 1);

    expect(() => buildContext(jobId, root)).toThrow(ConfigError);
  });

  it('🔴 perceive 早于 storyboard ⇒ 报错（换素材只清了下游的情况）', () => {
    const base = path.join(root, jobId);
    // storyboard 必须**比 regions 旧**才构成倒挂：旧 5 分钟，perceive 新 1 分钟
    ageMinutes(path.join(base, STAGES.align, 'words.json'), 60);
    ageMinutes(path.join(base, STAGES.perceive, 'regions.json'), 1); // 上游最新
    ageMinutes(path.join(base, STAGES.storyboard, 'storyboard.json'), 5); // 下游较旧
    ageMinutes(path.join(base, STAGES.storyboard, 'bake-report.json'), 5);

    expect(() => buildContext(jobId, root)).toThrow(ConfigError);
  });

  it('✅ 时序正常 ⇒ 放行（不误伤干净的全链）', () => {
    const base = path.join(root, jobId);
    ageMinutes(path.join(base, STAGES.align, 'words.json'), 100); // 上游旧
    ageMinutes(path.join(base, STAGES.perceive, 'regions.json'), 90);
    ageMinutes(path.join(base, STAGES.storyboard, 'storyboard.json'), 10); // 下游新

    expect(() => buildContext(jobId, root)).not.toThrow();
  });

  it('✅ 上游缺失 ⇒ 不由此守卫报（交给「缺少前置产物」那条报错）', () => {
    const base = path.join(root, jobId);
    fs.rmSync(path.join(base, STAGES.align, 'words.json'));
    // 缺失优先报「缺少前置产物」，不是「时序倒挂」—— 两者是不同的错误
    let msg = '';
    try {
      buildContext(jobId, root);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('缺少前置产物');
    expect(msg).not.toContain('时序倒挂');
  });
});