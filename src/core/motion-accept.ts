/**
 * motion:accept 六道验收门槛（P1-b Task 2，提案 §4）。
 *
 * 创作期会话 AI 产出 spec 后的**唯一入库通道**：`acceptMotionSpec(raw, fileName)`
 * 按固定顺序过六道门，任一道不过即拒绝，全部通过才产出带签章的验收块。
 *
 * ── 六道门（顺序即报因顺序）────────────────────────────────────
 * 1. **structure**：`validateMotionSpec` 通过（JSON 可解析、颜色只认令牌、
 *    图元/属性/缓动白名单、≤16KB）
 * 2. **registration**：`deriveDeclaration(spec)` 后 id/scope/layer/footprint
 *    声明齐备；`custom/` 前缀 id 合法（`custom/<语义名>@<semver>`）
 * 3. **frames**：注册进模板注册表后，`renderToStaticMarkup` 于帧 6/45/72
 *    （与画廊同帧位）渲染，DOM 含元素节点、无 `data-template-missing`
 * 4. **animates**：三帧 markup 两两不等（同 tests/template-render.test.tsx 判据）
 * 5. **lint**：spec 原文不含 `Date.now` / `Math.random` / `useFrame` /
 *    `animation:` 子串（JSON 里本不该有，防御未来扩语法）
 * 6. **签章**：全部通过后产出 acceptance 块（**无时间戳**，保确定性）
 *
 * ── 失败短路语义 ───────────────────────────────────────────────
 * 门 3 起是**渲染门**：前面任何一道失败都绝不对未通过结构校验的 spec 渲染。
 * 门 1/2 是纯数据检查（便宜、对未验数据安全），失败一次列全后短路——
 * 这也是 id 前缀检查能归到门 2 的原因：`validateMotionSpec` 的 ID_RE 本就
 * 强制 `custom/` 前缀，结构失败时门 2 仍做一次纯字符串前缀检查，把这条
 * （简报划归门 2 的）报因以 `registration` 名义与结构报因一并列出。
 *
 * ── 确定性红线（E2）────────────────────────────────────────────
 * 本文件不读时钟、不用随机数；签章只有 toolVersion / specHash / gates，
 * 无时间戳 —— 同一份 raw 重跑必得逐字节相同的验收块。
 *
 * ⚠️ 依赖边界：本文件被 Node 侧命令（tools/accept-motion-spec.mts）与测试
 *    消费，**不被 src/remotion/ 下任何文件 import**——它引了 react-dom/server
 *    与模板组件映射表，那些不许进浏览器 bundle（同 spec-loader 的纪律，
 *    方向相反的镜像：本文件只在 Node 侧活）。
 */

import { createHash } from 'node:crypto';
import { ConfigError } from './exit-code.ts';
import {
  MAX_SPEC_BYTES,
  deriveDeclaration,
  validateMotionSpec,
  type MotionSpec,
  type MotionSpecAcceptance,
} from './spec.ts';
import type { StoryboardItem } from './types.ts';
import { hasTemplate, registerTemplate } from '../templates/registry.ts';
import { EMPTY_CAPTION } from '../remotion/caption.ts';
import { getTemplateComponent } from '../remotion/templates/index.tsx';
import { renderToStaticMarkup } from 'react-dom/server';

/** 三帧采样点：与画廊（`src/templates/gallery.ts` PREVIEW_FRAMES）同帧位。 */
export const ACCEPT_FRAMES = [6, 45, 72] as const;

/** 验收渲染的 item 时长：与画廊 PREVIEW_DURATION 一致（90 帧 @30fps = 3 秒）。 */
export const ACCEPT_PREVIEW_DURATION = 90;

/** 门名清单 —— 顺序即报因顺序，也是签章里的 `gates` 数组。 */
export const ACCEPT_GATES = ['structure', 'registration', 'frames', 'animates', 'lint'] as const;

export type AcceptGateName = (typeof ACCEPT_GATES)[number];

/**
 * 验收签章。🔴 无时间戳：同输入重跑必须逐字节一致（E2）。
 *
 * 形状契约在 `spec.ts`（MotionSpecAcceptance）—— 本类型是它的窄化扩展
 * （toolVersion 钉死 1、gates 钉死五道门名），漂移会在编译期报错。
 */
export interface MotionAcceptance extends MotionSpecAcceptance {
  toolVersion: 1;
  /** canonical spec hash（算法见 canonicalSpecHash）—— 签发与验签两侧共用。 */
  specHash: string;
  gates: readonly AcceptGateName[];
}

export type MotionAcceptResult =
  | { ok: true; spec: MotionSpec; acceptance: MotionAcceptance }
  | { ok: false; failures: string[] };

/** 门 5 的禁用子串：确定性红线在 spec 原文上的机械化投影。 */
const LINT_BANNED: readonly string[] = ['Date.now', 'Math.random', 'useFrame', 'animation:'];

/**
 * canonical spec hash —— 签章 hash 的唯一实现点（P1-b Task 3 裁决）。
 *
 * 公式：`sha256(JSON.stringify(spec 去除 acceptance 键, null, 2))`，UTF-8。
 *
 * 🔴 为什么不是 raw 字节 hash：命令落盘时会重序列化
 *    （`JSON.stringify({ ...spec, acceptance })`，accept-motion-spec.mts），
 *    raw 字节 hash 与落盘后的文件内容天然脱钩 —— loader 拿文件复算不出
 *    签发时的 hash。canonical 形态从**解析出的 spec 对象**计算，签发侧
 *    （本文件门 6）与验签侧（spec-loader）都能复算同一结果；已带签章的
 *    spec 重跑验收也因剥离 acceptance 而幂等（tests/motion-accept.test.ts ⑤b）。
 *
 * 供 spec-loader 验签复用（AC-7）：`acceptance.specHash === canonicalSpecHash(spec)`。
 */
export function canonicalSpecHash(spec: MotionSpec): string {
  // 🔴 剥离 `acceptance`（签章本体）与 `_doc`（配方卡，2026-10-26）。
  //
  //   为什么必须剥离 `_doc`：给它加内容会改变 specHash，而 `custom/*` 入库文件
  //   验签严格对拍 ⇒ 「给已入库的 template 补一段配方卡」会直接把它变成
  //   「签章与文件内容不符」而拒装载。文档字段不该影响「可渲染语义是否通过验收」。
  //
  //   ⚠️ **`_note` 刻意不剥离** —— 它与 `_doc` 虽然都是文档字段，但既有测试
  //   （`spec-loader.test.ts` 用例 ②）正是用「手改 `_note`」来模拟文件被篡改，
  //   即「`_note` 参与 hash」是当前已生效的语义。改它会同时改变三条既有测试的
  //   判定，属于行为变更而非本次 P0-3 的范围。若要统一（两个都剥离），
  //   须同批更新那几条测试并走一次显式裁决。
  const { acceptance: _stripped, _doc: _docStripped, ...canonical } =
    spec as unknown as Record<string, unknown>;
  return createHash('sha256').update(JSON.stringify(canonical, null, 2), 'utf8').digest('hex');
}

/**
 * 入库文件名（修复轮 2，方案 b）——按**完整 id** 派生：
 * `custom/<语义名>@<版本>` → `custom-<语义名>@<版本>.json`。
 *
 * 为什么含版本：`custom/x@0.1` 与 `custom/x@0.2` 因此是**两个文件**——
 * 「重掷 = 新版本文件」由命名规则字面成立，旧 job 引用的旧版本永不失效
 * （loader 验签按 `custom-` 前缀判据，不受文件名细节影响，`custom-*` 判据不变）。
 *
 * 消毒：合法 id（ID_RE：`custom/[a-z0-9-]+@x.y`）本就文件名安全；本函数是
 * 导出 API，对任意输入防御——'/' 与其余文件名非法字符（\\ : * ? " < > | 与
 * 控制字符）统一换 '-'，@ 与 . 保留（版本号语义）。
 */
export function specLibraryFileName(specId: string): string {
  const sanitized = specId.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-');
  return `${sanitized}.json`;
}

/**
 * 入库覆写护栏（P1-b 修复轮 1，AC-9）——「决定写入与否」的纯判定，I/O 在命令壳
 * （tools/accept-motion-spec.mts 读目标文件、按决定落盘）。
 *
 * 裁决（2026-10-24）：目标文件不存在，或 canonical hash 与本次产物相同
 * （重跑同一产物，幂等）→ 写入；已存在但 hash 不同（同语义名**同版本**、异内容）→
 * 拒绝——升 @版本会落新文件、根本不撞护栏，撞护栏的只能是「同一版本被改了内容」，
 * 此时重掷必须另立版本号，已出片 job 引用的旧版本不得被静默覆盖（AC-9）。
 * `--force` 是命令壳的显式越权旗标，不进本判定——判定层只回答
 * 「内容层面该不该覆写」，越权是人下的决定。
 *
 * 🔴 旧文件解析失败（手改成非法 JSON 等）按异内容处理：无法证明相同即拒绝，
 *    宁可拦下一次重跑，不静默盖掉一份无法验尸的旧版本。
 */
export type SpecWriteDecision = { action: 'write' } | { action: 'reject'; reason: string };

export function decideSpecOverwrite(
  existingRaw: string | undefined,
  incomingHash: string,
  specId: string,
): SpecWriteDecision {
  if (existingRaw === undefined) return { action: 'write' };
  let existingHash: string | null = null;
  try {
    existingHash = canonicalSpecHash(JSON.parse(existingRaw) as MotionSpec);
  } catch {
    existingHash = null;
  }
  if (existingHash === incomingHash) return { action: 'write' };
  return {
    action: 'reject',
    reason:
      `同语义名同版本不同内容：templates/specs/${specLibraryFileName(specId)} 已存在且 ` +
      `canonical hash 与本次产物不同——请另立版本（升 @版本号，新版本自动落新文件）` +
      `以保留旧版本供已出片 job 引用；确要覆盖用 --force`,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 过六道验收门。
 *
 * @param raw spec 文件原始字符串（签章对它计算，lint 在它上面扫描）
 * @param fileName 来源文件名，只用于报错定位（同 validateMotionSpec 的 source）
 */
export function acceptMotionSpec(raw: string, fileName: string): MotionAcceptResult {
  // ── 门 1 structure：JSON 可解析 + validateMotionSpec ──────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      failures: [`structure: spec JSON 解析失败（${fileName}）：${(e as Error).message}`],
    };
  }

  let spec: MotionSpec;
  try {
    // options 形态照抄 spec-loader.ts:71 的现有调用
    spec = validateMotionSpec(parsed, {
      byteSize: Buffer.byteLength(raw, 'utf8'),
      source: fileName,
    });
  } catch (e) {
    const message = e instanceof ConfigError ? e.message : String(e);
    const failures = [`structure: ${message}`];
    // id 前缀归门 2（简报明文「custom/ 前缀 id 合法」在门 2）。结构失败时
    // 只做这一项纯字符串检查，不碰其余未验数据 —— 报因一次列全，不留
    // 「改一轮跑一轮」的循环。
    const id = isRecord(parsed) && typeof parsed['id'] === 'string' ? parsed['id'] : null;
    if (id !== null && !id.startsWith('custom/')) {
      failures.push(
        `registration: id 非 custom/ 前缀：${JSON.stringify(id)} —— 必须是 custom/<语义名>@<semver>`,
      );
    }
    return { ok: false, failures };
  }

  // ── 门 1 加固（终审扫尾）：预量「带签章序列化后」的体积 ────────────
  // 上面的 byteSize 量的是**裸输入**，而 loader 验签量的是**签名后整文件**
  // （acceptance 块约 +220B）——裸 spec 落在 (MAX_SPEC_BYTES-签章开销, MAX_SPEC_BYTES]
  // 窗口时会「验收过、装载拒」。这里用与命令壳落盘**同构**的序列化预量一次：
  // {...spec, acceptance}（旧 acceptance 同名覆盖，与重签语义一致），specHash 取
  // canonical hash——门 6 真签章与它逐字节一致，预量体积即最终落盘体积
  // （命令壳另有 1B 尾随换行，与 220B 量级的窗口相比可忽略）。
  const simulatedSigned = JSON.stringify(
    {
      ...spec,
      acceptance: {
        toolVersion: 1,
        specHash: canonicalSpecHash(spec),
        gates: ACCEPT_GATES,
      } satisfies MotionSpecAcceptance,
    },
    null,
    2,
  );
  const signedBytes = Buffer.byteLength(simulatedSigned, 'utf8');
  if (signedBytes > MAX_SPEC_BYTES) {
    return {
      ok: false,
      failures: [
        `structure: 带签章序列化后 ${signedBytes}B > 上限 ${MAX_SPEC_BYTES}B（16KB）—— ` +
          'loader 验签量的是签名后整文件，裸输入达标不代表落盘达标；请精简 spec 内容',
      ],
    };
  }

  // ── 门 2 registration：派生声明齐备（id/scope/layer/footprint）────
  const decl = deriveDeclaration(spec);
  const regIssues: string[] = [];
  if (!spec.id.startsWith('custom/')) {
    regIssues.push(
      `id 非 custom/ 前缀：${JSON.stringify(spec.id)} —— 必须是 custom/<语义名>@<semver>`,
    );
  }
  if (decl.id !== spec.id || decl.id === '') regIssues.push('声明 id 缺失或与 spec 不一致');
  if (!decl.scope) regIssues.push('声明 scope 缺失');
  if (!Number.isFinite(decl.layer)) regIssues.push('声明 layer 缺失（非有限数）');
  if (!Array.isArray(decl.footprint) || decl.footprint.length !== 4) {
    regIssues.push('声明 footprint 缺失（非四元组）');
  }
  if (regIssues.length > 0) {
    return { ok: false, failures: regIssues.map((s) => `registration: ${s}`) };
  }

  // ── 门 3/4 frames + animates：注册后真渲染三帧 ────────────────────
  // 测试与命令壳可能对同一 id 重跑验收：已注册则跳过（同 deriveDeclaration
  // 的纯函数性，同 raw 必派生出同一声明，跳过不改变结果）。
  if (!hasTemplate(spec.id)) {
    registerTemplate(decl, `motion:accept（${fileName}）`);
  }
  const item: StoryboardItem = {
    fromFrame: 0,
    durationInFrames: ACCEPT_PREVIEW_DURATION,
    motion: spec.id,
    footprint: [...spec.footprint] as StoryboardItem['footprint'],
    // requiredParams 的槽位给采样文本：excerpt/number 图元没文本会退化成空串，
    // 三帧就会「空白/全同」，那是夹具的错，不是 spec 的错。
    params: Object.fromEntries((decl.requiredParams ?? []).map((k) => [k, '动效验收文本'])),
  };
  const markups = ACCEPT_FRAMES.map((frame) =>
    renderToStaticMarkup(
      getTemplateComponent(spec.id)({
        frame,
        durationInFrames: ACCEPT_PREVIEW_DURATION,
        item,
        caption: EMPTY_CAPTION,
      }),
    ),
  );

  const blankFrames = ACCEPT_FRAMES.filter(
    (_, i) => !/<[a-z]/i.test(markups[i] as string) || (markups[i] as string).includes('data-template-missing'),
  );
  if (blankFrames.length > 0) {
    return {
      ok: false,
      failures: [
        `frames: 帧 ${blankFrames.join('/')} 渲染为空白或占位块 ` +
          '（判据：DOM 含元素节点且无 data-template-missing，画廊占位块的标记）',
      ],
    };
  }

  const distinct = new Set(markups).size;
  if (distinct !== ACCEPT_FRAMES.length) {
    return {
      ok: false,
      failures: [
        `animates: 帧 6/45/72 的渲染输出只有 ${distinct} 种（需两两不等，` +
          '同 tests/template-render.test.tsx 判据）—— 动效没有贯穿整个 item',
      ],
    };
  }

  // ── 门 5 lint：spec 原文不含禁用子串 ─────────────────────────────
  const hits = LINT_BANNED.filter((s) => raw.includes(s));
  if (hits.length > 0) {
    return {
      ok: false,
      failures: [
        `lint: spec 原文含禁用子串：${hits.map((h) => JSON.stringify(h)).join('、')} ` +
          '（确定性红线：渲染只由 frame 驱动，同输入必须逐字节同输出）',
      ],
    };
  }

  // ── 门 6 签章：全过才产出，无时间戳；hash 用 canonical 形态 ────────
  return {
    ok: true,
    spec,
    acceptance: { toolVersion: 1, specHash: canonicalSpecHash(spec), gates: ACCEPT_GATES },
  };
}
