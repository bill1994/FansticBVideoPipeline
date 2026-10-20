/**
 * MotionSpec 契约 / 校验 / 派生 / 装载（S1a，2026-10-20）。
 *
 * 这一组测试钉的是「数据层」：拒绝规则一条不漏、派生声明字段可核对、
 * 装载失败必须带文件名。渲染（SpecRenderer）属于 S1b，不在此覆盖。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/exit-code.ts';
import {
  COLOR_TOKENS,
  MAX_SPEC_BYTES,
  deriveDeclaration,
  validateMotionSpec,
} from '../src/core/spec.ts';
import {
  __resetSpecLoaderForTests,
  defaultSpecDir,
  loadSpecsFromDisk,
} from '../src/core/spec-loader.ts';
import { getTemplate } from '../src/templates/registry.ts';

/** 一份合法 spec（每个用例从它派生，避免互相污染）。 */
function baseSpec(): Record<string, unknown> {
  return {
    specVersion: 1,
    id: 'custom/fade-up@1.0',
    layer: 60,
    footprint: [0.15, 0.62, 0.7, 0.18],
    minVisibleInFrames: 24,
    occludesSubject: false,
    elements: [
      {
        type: 'text',
        slot: 'main',
        content: 'excerpt',
        sizePx: 48,
        weight: 700,
        align: 'left',
        paddingPx: 24,
      },
    ],
    tracks: [
      {
        element: 0,
        property: 'opacity',
        keys: [
          { t: 0, v: 0, ease: 'out' },
          { t: 1, v: 1, ease: 'out' },
        ],
      },
    ],
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const tmpDirs: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-spec-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  __resetSpecLoaderForTests();
});

describe('deriveDeclaration —— 字段逐个正确', () => {
  it('合法 spec → 声明字段与来源逐项一致', () => {
    const decl = deriveDeclaration(validateMotionSpec(baseSpec()));
    expect(decl.id).toBe('custom/fade-up@1.0');
    expect(decl.family).toBe('custom');
    expect(decl.subtype).toBe('fade-up');
    expect(decl.version).toBe('1.0');
    expect(decl.scope).toBe('overlay-safe');
    expect(decl.status).toBe('custom');
    expect(decl.layer).toBe(60);
    expect(decl.footprint).toEqual([0.15, 0.62, 0.7, 0.18]);
    expect(decl.minVisibleInFrames).toBe(24);
    expect(decl.occludesSubject).toBe(false);
    // excerpt → main 槽必填 string
    expect(decl.paramsSchema).toEqual({ main: 'string' });
    expect(decl.requiredParams).toEqual(['main']);
    // textMetrics 取 main 槽
    expect(decl.textMetrics).toEqual({ fontSizePx: 48, paddingPx: 24 });
    // spec 原文挂上，供 S1b 渲染消费
    expect(decl.spec?.id).toBe('custom/fade-up@1.0');
  });

  it('literal 图元不产生 paramsSchema 键；number 图元产生', () => {
    const spec = baseSpec();
    spec['elements'] = [
      { type: 'text', slot: 'main', content: 'literal:固定文案', sizePx: 40, weight: 600, align: 'center', paddingPx: 10 },
      { type: 'text', slot: 'sub', content: 'number', sizePx: 20, weight: 400, align: 'center', paddingPx: 4 },
    ];
    const decl = deriveDeclaration(validateMotionSpec(spec));
    expect(decl.paramsSchema).toEqual({ sub: 'string' });
    expect(decl.requiredParams).toEqual(['sub']);
  });

  it('无 main 槽 → 不产生 textMetrics', () => {
    const spec = baseSpec();
    spec['elements'] = [
      { type: 'text', slot: 'sub', content: 'excerpt', sizePx: 20, weight: 400, align: 'left', paddingPx: 4 },
    ];
    const decl = deriveDeclaration(validateMotionSpec(spec));
    expect(decl.textMetrics).toBeUndefined();
    expect(decl.paramsSchema).toEqual({ sub: 'string' });
  });
});

describe('validateMotionSpec —— 拒绝规则逐条', () => {
  const rejects = (mutate: (s: Record<string, unknown>) => void, pattern: RegExp) => {
    const spec = baseSpec();
    mutate(spec);
    expect(() => validateMotionSpec(spec)).toThrow(ConfigError);
    expect(() => validateMotionSpec(spec)).toThrow(pattern);
  };

  it('1. id 必须以 custom/ 开头且形如 family/subtype@x.y', () => {
    rejects((s) => (s['id'] = 'typography/fade-up@1.0'), /id 非法/);
    rejects((s) => (s['id'] = 'custom/fade_up@1.0'), /id 非法/);
    rejects((s) => (s['id'] = 'custom/fade-up'), /id 非法/);
  });

  it('2. 缺 layer / footprint / minVisibleInFrames / occludesSubject 任一', () => {
    rejects((s) => delete s['layer'], /layer/);
    rejects((s) => delete s['footprint'], /footprint/);
    rejects((s) => delete s['minVisibleInFrames'], /minVisibleInFrames/);
    rejects((s) => delete s['occludesSubject'], /occludesSubject/);
  });

  it('3. footprint 越界或 w/h ≤ 0', () => {
    rejects((s) => (s['footprint'] = [1.2, 0, 0.5, 0.2]), /footprint\.x=1\.2 不在 0–1/);
    rejects((s) => (s['footprint'] = [0, 0, 0, 0.2]), /w\/h 必须 > 0/);
    rejects((s) => (s['footprint'] = [0, 0, 0.2]), /四元组/);
  });

  it('4. elements > 3；keys 数量越界', () => {
    rejects((s) => {
      s['elements'] = new Array(4).fill(null).map((_, i) => ({
        type: 'text', slot: i === 0 ? 'main' : 'sub', content: 'excerpt',
        sizePx: 20, weight: 400, align: 'left', paddingPx: 2,
      }));
    }, /elements 数量 4 > 上限 3/);

    rejects((s) => {
      (s['tracks'] as { keys: unknown[] }[])[0]!.keys = [{ t: 0, v: 0 }];
    }, /keys 数量 1 不在 2–8/);

    rejects((s) => {
      (s['tracks'] as { keys: unknown[] }[])[0]!.keys = Array.from({ length: 9 }, (_, i) => ({
        t: i / 8, v: i / 8,
      }));
    }, /keys 数量 9 不在 2–8/);
  });

  it('5. 未知属性名 / 未知缓动名', () => {
    rejects((s) => {
      (s['tracks'] as { property: string }[])[0]!.property = 'whirl';
    }, /property 未知/);
    rejects((s) => {
      (s['tracks'] as { keys: { ease: string }[] }[])[0]!.keys[0]!.ease = 'bounce';
    }, /ease 未知/);
  });

  it('6. t 未严格递增（同值也算未递增）', () => {
    rejects((s) => {
      (s['tracks'] as { keys: unknown[] }[])[0]!.keys = [
        { t: 0.5, v: 0 },
        { t: 0.5, v: 1 },
      ];
    }, /未严格递增/);
    rejects((s) => {
      (s['tracks'] as { keys: unknown[] }[])[0]!.keys = [
        { t: 0.8, v: 0 },
        { t: 0.2, v: 1 },
      ];
    }, /未严格递增/);
  });

  it('7. t 单位非法 / 同一轨混用单位', () => {
    rejects((s) => {
      (s['tracks'] as { keys: unknown[] }[])[0]!.keys = [
        { t: 0, v: 0 },
        { t: 1.2, v: 1 },
      ];
    }, /t=1\.2 非法/);
    rejects((s) => {
      (s['tracks'] as { keys: unknown[] }[])[0]!.keys = [
        { t: '0f', v: 0 },
        { t: '8s', v: 1 },
      ];
    }, /非法/);
    // 同一轨混用 number 与 "Nf"：无法比较先后 ⇒ 拒绝
    rejects((s) => {
      (s['tracks'] as { keys: unknown[] }[])[0]!.keys = [
        { t: 0.1, v: 0 },
        { t: '8f', v: 1 },
      ];
    }, /单位混用/);
  });

  it('8. 数值越界：scale / rotate / opacity / blur', () => {
    const setTrack = (s: Record<string, unknown>, property: string, v: unknown) => {
      (s['tracks'] as unknown[])[0] = {
        element: 0,
        property,
        keys: [
          { t: 0, v },
          { t: 1, v },
        ],
      };
    };
    rejects((s) => setTrack(s, 'scale', 3.1), /scale ∈ \[0\.2, 3\]/);
    rejects((s) => setTrack(s, 'rotate', 16), /rotate ∈ \[-15, 15\]/);
    rejects((s) => setTrack(s, 'opacity', -0.1), /opacity ∈ \[0, 1\]/);
    rejects((s) => setTrack(s, 'blur', 21), /blur ∈ \[0, 20\]/);
  });

  it('8b. clip 四边必须在 0–100', () => {
    const spec = baseSpec();
    (spec['tracks'] as unknown[])[0] = {
      element: 0,
      property: 'clip',
      keys: [
        { t: 0, v: '0,0,0,0' },
        { t: 1, v: '10,20,130,0' },
      ],
    };
    expect(() => validateMotionSpec(spec)).toThrow(/四边必须在 0–100/);
  });

  it('9. color 只认令牌，且禁止 ease', () => {
    const withColor = (v: unknown, withEase: boolean) => {
      const spec = baseSpec();
      (spec['tracks'] as unknown[])[0] = {
        element: 0,
        property: 'color',
        keys: [
          withEase ? { t: 0, v, ease: 'out' } : { t: 0, v },
          { t: 1, v },
        ],
      };
      return spec;
    };
    expect(() => validateMotionSpec(withColor('#FF0000', false))).toThrow(/必须是颜色令牌之一/);
    expect(() => validateMotionSpec(withColor(COLOR_TOKENS[0], false))).not.toThrow();
    expect(() => validateMotionSpec(withColor(COLOR_TOKENS[0], true))).toThrow(/color 轨禁止出现 ease/);
  });

  it('10. element 索引越界', () => {
    rejects((s) => ((s['tracks'] as { element: number }[])[0]!.element = 1), /element=1 越界/);
    rejects((s) => ((s['tracks'] as { element: number }[])[0]!.element = -1), /越界/);
  });

  it('11. 未知顶层字段（白名单）', () => {
    rejects((s) => (s['foo'] = 1), /未知顶层字段：`foo`/);
  });

  it('12. 文件体积 > 16KB', () => {
    expect(() => validateMotionSpec(baseSpec(), { byteSize: MAX_SPEC_BYTES + 1 })).toThrow(
      /16KB/,
    );
    expect(() => validateMotionSpec(baseSpec(), { byteSize: MAX_SPEC_BYTES })).not.toThrow();
  });

  it('13. 绝对帧 t 不得超 minVisibleInFrames（否则短 cue 截断动画）', () => {
    const withFrames = (second: string) => {
      const spec = baseSpec();
      (spec['tracks'] as { keys: unknown[] }[])[0]!.keys = [
        { t: '0f', v: 0 },
        { t: second, v: 1 },
      ];
      return spec;
    };
    // 恰好等于下限：通过
    expect(() => validateMotionSpec(withFrames('24f'))).not.toThrow();
    // 超一格：报错，文案点明会被截断
    expect(() => validateMotionSpec(withFrames('25f'))).toThrow(
      /t="25f" 超出本 spec 声明的 minVisibleInFrames=24 —— 短句会把它截断在中途/,
    );
  });

  it('14. `_note` 是显式允许的文档字段（不参与派生），其它未知字段仍拒绝', () => {
    const spec = baseSpec();
    spec['_note'] = '入场用绝对帧，避免整句滑动';
    const decl = deriveDeclaration(validateMotionSpec(spec));
    expect(decl.id).toBe('custom/fade-up@1.0');
    expect(decl.spec?.['_note']).toBeDefined();

    const badType = baseSpec();
    badType['_note'] = 123;
    expect(() => validateMotionSpec(badType)).toThrow(/_note 必须是字符串/);

    // 白名单只多这一个键 —— 任意其它键仍然拒绝
    rejects((s) => (s['note'] = 'x'), /未知顶层字段：`note`/);
  });

  it('一次列全所有问题（不是遇到第一个就停）', () => {
    const spec = baseSpec();
    spec['foo'] = 1;
    spec['layer'] = 'x';
    try {
      validateMotionSpec(spec);
      expect.unreachable('应当抛错');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/共 2 处/);
      expect(msg).toMatch(/foo/);
      expect(msg).toMatch(/layer/);
    }
  });
});

describe('S2 图元契约（panel / bar / rule / triangle / split / stagger）', () => {
  const textEl = (over: Record<string, unknown> = {}) => ({
    type: 'text',
    slot: 'main',
    content: 'excerpt',
    sizePx: 48,
    weight: 700,
    align: 'left',
    paddingPx: 20,
    ...over,
  });
  const withElements = (elements: unknown[]): Record<string, unknown> => {
    const spec = baseSpec();
    spec['elements'] = elements;
    return spec;
  };
  const rejects = (spec: Record<string, unknown>, pattern: RegExp) => {
    expect(() => validateMotionSpec(spec)).toThrow(ConfigError);
    expect(() => validateMotionSpec(spec)).toThrow(pattern);
  };
  const accepts = (spec: Record<string, unknown>) => {
    expect(() => validateMotionSpec(spec)).not.toThrow();
  };

  it('panel 必须排在所有 text 之前（后置会盖住文字）', () => {
    rejects(
      withElements([textEl(), { type: 'panel', fill: 'plate' }]),
      /panel 却排在 text（下标 0）之后 —— 卡底后置会盖住文字/,
    );
    accepts(
      withElements([{ type: 'panel', fill: 'plate', radius: 'md', shadow: 'card' }, textEl()]),
    );
  });

  it('白名单按 type 分组：跨类型字段被拒', () => {
    rejects(
      withElements([{ type: 'bar', edge: 'left', thicknessPx: 6, slot: 'main' }]),
      /（bar）未知字段：`slot`/,
    );
    rejects(
      withElements([{ type: 'triangle', dir: 'up', sizePx: 40, content: 'excerpt' }]),
      /（triangle）未知字段：`content`/,
    );
    accepts(withElements([{ type: 'bar', edge: 'left', thicknessPx: 6, fill: 'brand' }, textEl()]));
  });

  it('panel 的颜色/圆角/阴影只接受令牌', () => {
    rejects(
      withElements([{ type: 'panel', fill: '#FFFFFF' }, textEl()]),
      /fill 必须是令牌之一/,
    );
    rejects(
      withElements([{ type: 'panel', radius: 'xl' }, textEl()]),
      /radius 必须是令牌之一/,
    );
    rejects(
      withElements([{ type: 'panel', shadow: 'glow' }, textEl()]),
      /shadow 必须是令牌之一/,
    );
  });

  it('bar：edge 枚举 / thicknessPx 取值域 / insetPx', () => {
    rejects(withElements([{ type: 'bar', edge: 'middle', thicknessPx: 6 }, textEl()]), /edge 必须是/);
    rejects(withElements([{ type: 'bar', edge: 'left', thicknessPx: 0 }, textEl()]), /thicknessPx/);
    rejects(
      withElements([{ type: 'bar', edge: 'left', thicknessPx: 6, insetPx: -1 }, textEl()]),
      /insetPx 必须是 0–500/,
    );
  });

  it('rule：axis 枚举 / at 0–100', () => {
    rejects(withElements([{ type: 'rule', axis: 'x', at: 50, thicknessPx: 4 }, textEl()]), /axis 必须是/);
    rejects(withElements([{ type: 'rule', axis: 'h', at: 120, thicknessPx: 4 }, textEl()]), /at 必须是 0–100/);
    accepts(withElements([textEl(), { type: 'rule', axis: 'h', at: 100, thicknessPx: 4, fill: 'accent' }]));
  });

  it('triangle：dir 枚举 / sizePx 上限', () => {
    rejects(withElements([{ type: 'triangle', dir: 'diag', sizePx: 40 }, textEl()]), /dir 必须是/);
    rejects(withElements([{ type: 'triangle', dir: 'up', sizePx: 500 }, textEl()]), /sizePx 必须是 \(0, 400\]/);
  });

  it('text 的 split / perUnit / holdFrames', () => {
    rejects(withElements([textEl({ split: 'words' })]), /split 只支持 "chars"/);
    // perUnit 只接受 "Nf"（不接受比例，避免两套时间语义混用）
    rejects(withElements([textEl({ perUnit: '2' })]), /perUnit 必须是 "Nf"/);
    rejects(withElements([textEl({ perUnit: '0f' })]), /perUnit 必须是 "Nf"/);
    rejects(withElements([textEl({ holdFrames: -1 })]), /holdFrames/);
    accepts(withElements([textEl({ split: 'chars', perUnit: '2f', holdFrames: 6 })]));
  });

  it('stagger：perElement 必须是 "Nf"、order 枚举、未知键拒绝', () => {
    const withStagger = (stagger: unknown) => {
      const spec = baseSpec();
      spec['stagger'] = stagger;
      return spec;
    };
    rejects(withStagger({ perElement: '0f', order: 'index' }), /perElement 必须是 "Nf"/);
    rejects(withStagger({ perElement: '4f', order: 'random' }), /order 必须是 "index" 或 "reverse"/);
    rejects(withStagger({ perElement: '4f', order: 'index', delay: 1 }), /未知字段/);
    accepts(withStagger({ perElement: '4f', order: 'reverse' }));
  });

  it('emoji 拒绝：逐字按码点切会拆成两半', () => {
    rejects(withElements([textEl({ content: 'literal:太棒了👍' })]), /含 emoji/);
    accepts(withElements([textEl({ content: 'literal:太棒了' })]));
  });

  it('装饰图元不参与 textMetrics / paramsSchema', () => {
    const spec = withElements([
      { type: 'panel', fill: 'plate' },
      { type: 'bar', edge: 'left', thicknessPx: 99 },
      textEl({ sizePx: 48, paddingPx: 20, content: 'literal:固定文案' }),
    ]);
    const decl = deriveDeclaration(validateMotionSpec(spec));
    // 只有 text 的 48/20 进 textMetrics，bar 的 99 不能进来
    expect(decl.textMetrics).toEqual({ fontSizePx: 48, paddingPx: 20 });
    // literal 不产生 params
    expect(decl.paramsSchema).toEqual({});
  });
});

describe('现有 spec 兼容性（S2 后必须全部仍合法）', () => {
  const dir = path.resolve(import.meta.dirname, '../templates/specs');
  const files = [
    'fade-up.json',
    'focus-in.json',
    'wipe-reveal.json',
    'clip-reveal-h.json',
    'card-stack.json',
    'bar-accent.json',
    'typewriter-cn.json',
    'rule-underline.json',
  ];

  it.each(files)('%s 通过校验并可派生声明', (file) => {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const spec = validateMotionSpec(JSON.parse(raw), {
      byteSize: Buffer.byteLength(raw, 'utf8'),
      source: file,
    });
    const decl = deriveDeclaration(spec);
    expect(decl.id).toBe(spec.id);
    expect(decl.scope).toBe('overlay-safe');
  });
});

describe('loadSpecsFromDisk —— 目录扫描与注册', () => {
  it('空目录不报错，返回 0', () => {
    const dir = tmpDir();
    expect(loadSpecsFromDisk(dir)).toBe(0);
  });

  it('目录不存在 → 静默跳过', () => {
    expect(loadSpecsFromDisk(path.join(tmpDir(), 'nope'))).toBe(0);
  });

  it('真实示例 templates/specs/fade-up.json 装载后可查到', () => {
    expect(defaultSpecDir()).toContain(path.join('templates', 'specs'));
    const n = loadSpecsFromDisk();
    expect(n).toBeGreaterThanOrEqual(8); // 4 旧 + 4 个 S2 验证 spec
    const tpl = getTemplate('custom/fade-up@1.0');
    expect(tpl.family).toBe('custom');
    expect(tpl.minVisibleInFrames).toBe(24);
    expect(tpl.occludesSubject).toBe(false);
    expect(tpl.spec?.tracks).toHaveLength(3);
    // S2 新图元 spec 也在册
    expect(getTemplate('custom/card-stack@1.0').spec?.elements[0]?.type).toBe('panel');
    // 幂等：重复装载不再注册（否则查重会直接抛）
    expect(loadSpecsFromDisk()).toBe(0);
  });

  it('任一文件校验失败 → 整个装载失败，错误带文件名', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ id: 'oops' }), 'utf8');
    expect(() => loadSpecsFromDisk(dir)).toThrow(ConfigError);
    expect(() => loadSpecsFromDisk(dir)).toThrow(/templates\/specs\/bad\.json/);
  });

  it('JSON 解析失败 → 带文件名', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json', 'utf8');
    expect(() => loadSpecsFromDisk(dir)).toThrow(/broken\.json/);
  });

  it('文件体积超 16KB → 拒绝', () => {
    const dir = tmpDir();
    const spec = baseSpec();
    spec['promptRef'] = 'x'.repeat(MAX_SPEC_BYTES);
    fs.writeFileSync(path.join(dir, 'huge.json'), JSON.stringify(spec), 'utf8');
    expect(() => loadSpecsFromDisk(dir)).toThrow(/16KB/);
  });
});
