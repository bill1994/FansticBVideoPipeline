import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  contactSheetFrameIndices,
  parseBlackdetect,
  parseFreezedetect,
  parseVolumedetect,
  runMediaQa,
  type MediaQaRunner,
} from '../src/core/media-qa.ts';

type Call = { command: string; args: string[] };

interface FakeHandlers {
  duration?: string;
  audioStream?: string;
  videoStderr?: string;
  audioStderr?: string;
  /** 'ok'（写文件）/ 'fail'（退出码 1）/ 'unavailable'（spawn 失败） */
  contactSheet?: 'ok' | 'fail' | 'unavailable';
}

function fakeRunner(calls: Call[], handlers: FakeHandlers = {}): MediaQaRunner {
  return {
    run(command, args) {
      calls.push({ command, args });
      if (command === 'ffprobe' && args.some((a) => a.includes('format=duration'))) {
        return { stdout: handlers.duration ?? '10.0\n', status: 0 };
      }
      if (command === 'ffprobe' && args.some((a) => a.includes('stream=index'))) {
        return { stdout: handlers.audioStream ?? '1\n', status: 0 };
      }
      if (command === 'ffmpeg' && args.includes('volumedetect')) {
        return {
          stderr: handlers.audioStderr ?? 'mean_volume: -23.0 dB\nmax_volume: -3.1 dB\n',
          status: 0,
        };
      }
      if (command === 'ffmpeg' && args.some((a) => a.includes('blackdetect'))) {
        return { stderr: handlers.videoStderr ?? '', status: 0 };
      }
      if (command === 'ffmpeg' && args.some((a) => a.includes('tile=3x3'))) {
        if (handlers.contactSheet === 'unavailable') return { error: 'spawn ffmpeg ENOENT' };
        if (handlers.contactSheet === 'fail') return { status: 1, stderr: 'boom' };
        const output = args[args.length - 1]!;
        fs.writeFileSync(output, 'jpeg');
        return { status: 0 };
      }
      return { status: 0 };
    },
  };
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'media-qa-'));
}

describe('媒体 QA —— 解析器', () => {
  test('解析 blackdetect 的成对区间与未闭合起点', () => {
    const text = [
      '[blackdetect @ 0x1] black_start:0.5 black_end:2.0 black_duration:1.5',
      '[blackdetect @ 0x1] black_start:4 black_end:4.5 black_duration:0.5',
      '[blackdetect @ 0x1] black_start:9',
    ].join('\n');
    expect(parseBlackdetect(text)).toEqual({
      segments: [
        { start: 0.5, end: 2, duration: 1.5 },
        { start: 4, end: 4.5, duration: 0.5 },
      ],
      openStart: 9,
    });
  });

  test('解析 freezedetect 的成对区间与未闭合起点', () => {
    const text = [
      '[freezedetect @ 0x1] freeze_start: 3.0',
      '[freezedetect @ 0x1] freeze_duration: 2.0',
      '[freezedetect @ 0x1] freeze_end: 5.0',
      '[freezedetect @ 0x1] freeze_start: 8.0',
    ].join('\n');
    expect(parseFreezedetect(text)).toEqual({
      segments: [{ start: 3, end: 5, duration: 2 }],
      openStart: 8,
    });
  });

  test('解析 volumedetect 的 mean / max', () => {
    expect(parseVolumedetect('mean_volume: -23.0 dB\nmax_volume: -3.1 dB\n')).toEqual({
      meanDb: -23,
      maxDb: -3.1,
    });
  });

  test('联系表帧号：9 个、递增、包含首尾', () => {
    const frames = contactSheetFrameIndices(900, 9);
    expect(frames).toHaveLength(9);
    expect(frames[0]).toBe(0);
    expect(frames.at(-1)).toBe(899);
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i]!).toBeGreaterThan(frames[i - 1]!);
    }
    expect(contactSheetFrameIndices(5, 9)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('媒体 QA —— 执行体', () => {
  test('正常成片：无 error，黑场/静帧进 warning，联系表产出', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'out.mp4');
      const sheet = path.join(dir, 'contact-sheet.jpg');
      fs.writeFileSync(file, 'fake');
      const calls: Call[] = [];
      const qa = runMediaQa({
        file,
        expectedDurationSec: 10,
        fps: 30,
        durationInFrames: 300,
        contactSheetPath: sheet,
        runner: fakeRunner(calls, {
          videoStderr:
            'black_start:1 black_end:2 black_duration:1\n' +
            'freeze_start:4 freeze_end:6 freeze_duration:2\n',
        }),
      });

      expect(qa.ok).toBe(true);
      expect(qa.errors).toEqual([]);
      expect(qa.unavailable).toEqual([]);
      expect(qa.black.segments).toHaveLength(1);
      expect(qa.freeze.segments).toHaveLength(1);
      expect(qa.audio).toEqual({ meanDb: -23, maxDb: -3.1 });
      expect(qa.contactSheet).toBe(sheet);
      expect(fs.existsSync(sheet)).toBe(true);
      expect(qa.warnings.some((w) => w.includes('黑场'))).toBe(true);
      expect(qa.warnings.some((w) => w.includes('静帧'))).toBe(true);
      expect(calls.some((c) => c.args.includes('blackdetect=d=0.25:pix_th=0.10,freezedetect=n=-50dB:d=1'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('未闭合的黑场/静帧按 1 段计，并注明从何时开始', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'out.mp4');
      fs.writeFileSync(file, 'fake');
      const qa = runMediaQa({
        file,
        expectedDurationSec: 10,
        fps: 30,
        durationInFrames: 300,
        runner: fakeRunner([], { videoStderr: 'black_start:2\nfreeze_start:5\n' }),
      });
      expect(qa.black.openStart).toBe(2);
      expect(qa.freeze.openStart).toBe(5);
      expect(qa.warnings.some((w) => w.includes('1 段黑场'))).toBe(true);
      expect(qa.warnings.some((w) => w.includes('1 段静帧'))).toBe(true);
      expect(qa.warnings.some((w) => w.includes('未闭合'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('成片时长与预期不符 → error', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'out.mp4');
      fs.writeFileSync(file, 'fake');
      const qa = runMediaQa({
        file,
        expectedDurationSec: 10,
        fps: 30,
        durationInFrames: 300,
        runner: fakeRunner([], { duration: '8.0\n' }),
      });
      expect(qa.ok).toBe(false);
      expect(qa.errors.join(' ')).toContain('时长');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ffprobe / ffmpeg 不可用 → unavailable，不误报 error', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'out.mp4');
      fs.writeFileSync(file, 'fake');
      const runner: MediaQaRunner = {
        run() {
          return { error: 'spawn ENOENT' };
        },
      };
      const qa = runMediaQa({
        file,
        expectedDurationSec: 10,
        fps: 30,
        durationInFrames: 300,
        contactSheetPath: path.join(dir, 'sheet.jpg'),
        runner,
      });
      expect(qa.ok).toBe(true);
      expect(qa.actualDurationSec).toBeNull();
      expect(qa.contactSheet).toBeNull();
      expect(qa.unavailable.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('联系表生成失败只进 warning，不阻断', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'out.mp4');
      fs.writeFileSync(file, 'fake');
      const qa = runMediaQa({
        file,
        expectedDurationSec: 10,
        fps: 30,
        durationInFrames: 300,
        contactSheetPath: path.join(dir, 'sheet.jpg'),
        runner: fakeRunner([], { contactSheet: 'fail' }),
      });
      expect(qa.ok).toBe(true);
      expect(qa.contactSheet).toBeNull();
      expect(qa.warnings.some((w) => w.includes('联系表'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('无音频流 → audio=null，不产生音频 warning', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'out.mp4');
      fs.writeFileSync(file, 'fake');
      const calls: Call[] = [];
      const qa = runMediaQa({
        file,
        expectedDurationSec: 10,
        fps: 30,
        durationInFrames: 300,
        runner: fakeRunner(calls, { audioStream: '\n' }),
      });
      expect(qa.audio).toBeNull();
      expect(qa.warnings.some((w) => w.includes('音频'))).toBe(false);
      expect(calls.some((c) => c.args.includes('volumedetect'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('音频静音/近满刻度 → warning', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'out.mp4');
      fs.writeFileSync(file, 'fake');
      const silent = runMediaQa({
        file,
        expectedDurationSec: 10,
        fps: 30,
        durationInFrames: 300,
        runner: fakeRunner([], {
          audioStderr: 'mean_volume: -80.0 dB\nmax_volume: -70.0 dB\n',
        }),
      });
      expect(silent.warnings.some((w) => w.includes('静音'))).toBe(true);

      const loud = runMediaQa({
        file,
        expectedDurationSec: 10,
        fps: 30,
        durationInFrames: 300,
        runner: fakeRunner([], {
          audioStderr: 'mean_volume: -1.0 dB\nmax_volume: 0.0 dB\n',
        }),
      });
      expect(loud.warnings.some((w) => w.includes('满刻度'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
