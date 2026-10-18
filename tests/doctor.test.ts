/**
 * 环境自检 —— 用假依赖构造「缺这缺那」的环境，而不必真的卸载组件。
 *
 * 🔴 这组测试的价值不在覆盖率，而在**换机时不用真的把环境搞坏一次**：
 * 「ffmpeg 不在 PATH 时到底报什么」只能靠注入依赖来验。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { doctorOk, runChecks, type DoctorDeps } from '../src/core/doctor.ts';

const ROOT = '/repo';

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  // 路径一律用 path.join 构造 —— doctor 内部也是 path.join，正/反斜杠必须一致
  const files = new Map<string, string[]>([
    [path.join(ROOT, 'whisper.cpp'), ['main.exe', 'ggml-base.bin']],
  ]);
  const exists = new Set<string>([
    path.join(ROOT, 'docs/decisions/PARAM-DECISIONS.md'),
    path.join(ROOT, 'perceive-models/face_detection_yunet_2026may-official.onnx'),
  ]);

  return {
    repoRoot: ROOT,
    env: {},
    nodeVersion: '22.22.2',
    hasCommand: () => true,
    exists: (p) => exists.has(p),
    readdir: (p) => files.get(p) ?? [],
    ...over,
  };
}

const byId = (rs: ReturnType<typeof runChecks>, id: string) => rs.find((r) => r.id === id)!;

describe('doctor / 通过的路径', () => {
  it('环境齐全时无 fail', () => {
    const rs = runChecks(deps({ env: { WHISPER_MODEL: 'base' } }));
    expect(doctorOk(rs)).toBe(true);
    expect(rs.filter((r) => r.status === 'fail')).toHaveLength(0);
  });

  it('Node 版本按 22.19 比较：22.18 不合格，22.19 合格', () => {
    expect(byId(runChecks(deps({ nodeVersion: '22.18.9' })), 'node').status).toBe('fail');
    expect(byId(runChecks(deps({ nodeVersion: '22.19.0' })), 'node').status).toBe('ok');
    expect(byId(runChecks(deps({ nodeVersion: '24.0.0' })), 'node').status).toBe('ok');
  });
});

describe('doctor / 失败时必须给出可执行的下一步', () => {
  it('缺 ffmpeg → fail，且 hint 里含安装命令与「重开终端」', () => {
    const r = byId(
      runChecks(deps({ hasCommand: (c) => c !== 'ffmpeg', env: { WHISPER_MODEL: 'base' } })),
      'ffmpeg',
    );
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/winget|apt|brew/);
    expect(r.hint).toMatch(/重开终端/);
  });

  it('缺 ffmpeg 时整体不通过', () => {
    expect(doctorOk(runChecks(deps({ hasCommand: () => false })))).toBe(false);
  });

  it('whisper.cpp 目录空 → fail，hint 指向 setup 脚本', () => {
    const r = byId(runChecks(deps({ readdir: () => [] })), 'whisper-bin');
    expect(r.status).toBe('fail');
    expect(r.hint).toContain('setup-whisper');
  });
});

describe('doctor / 模型版本不匹配是 warn 而非 fail', () => {
  it('默认要 small、实际只有 base → warn 且提示设 WHISPER_MODEL', () => {
    const r = byId(runChecks(deps()), 'whisper-model');
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/small/);
    expect(r.hint).toMatch(/WHISPER_MODEL=base/);
  });

  it('显式指定 base 后即为 ok', () => {
    expect(byId(runChecks(deps({ env: { WHISPER_MODEL: 'base' } })), 'whisper-model').status).toBe('ok');
  });

  it('一个模型都没有 → fail', () => {
    const r = byId(runChecks(deps({ readdir: () => ['main.exe'] })), 'whisper-model');
    expect(r.status).toBe('fail');
  });

  it('模型 warn 不影响整体通过（warn 不是 fail）', () => {
    expect(doctorOk(runChecks(deps()))).toBe(true);
  });
});

describe('doctor / 文档与模型缺失', () => {
  it('PARAM-DECISIONS.md 缺失 → warn 且指向 npm run placeholders', () => {
    const r = byId(runChecks(deps({ exists: () => false })), 'param-doc');
    expect(r.status).toBe('warn');
    expect(r.hint).toContain('npm run placeholders');
  });

  it('WHISPER_CPP_PATH / PERCEIVE_MODEL 环境变量优先于默认路径', () => {
    const seen: string[] = [];
    runChecks(
      deps({
        env: { WHISPER_CPP_PATH: 'D:/w', PERCEIVE_MODEL: 'D:/m.onnx' },
        readdir: (p) => {
          seen.push(p);
          return [];
        },
        exists: (p) => {
          seen.push(p);
          return false;
        },
      }),
    );
    expect(seen).toContain(path.resolve('D:/w'));
    expect(seen).toContain(path.resolve('D:/m.onnx'));
  });
});
