# P1-b 创作期动效生成 Implementation Plan

> ✅ **本计划四个 Task 全部执行完毕（2026-10-24，2026-10-26 复核勾选）**。
> 全 20 个 Step 已完成；下方 checkbox 原先全空是「执行后未回填」，不代表未做。
> 复核证据：`src/core/motion-accept.ts` / `src/core/spec-loader.ts` / `tools/accept-motion-spec.mts`
> 均在；`tests/motionboard.test.ts` 22 项（= Task 1 预期 19+3）、`tests/motion-accept.test.ts` 13 项、
> `tests/spec-loader.test.ts` 5 项全过；SKILL.md 有「创作期动效生成」节；
> commit `f3440f8` / `90a0b8a` / `6392900` / `424daff` / `4d57090` / `60a6b45` / `6357cbd` / `17a7afc` 齐全。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地提案 P1-b——无合适模板时按 `motionboard.genPrompt` 生成新 MotionSpec，过六道验收后版本化入库并可被引用；渲染期确定性一字不改。

**Architecture:** 生成器宿主 = 创作期会话 AI（skill 流程，管线内零 LLM）。新增三块：① genPrompt 契约（字段 + 白名单 + 零泄漏断言）；② `npm run motion:accept` 验收命令（六道门槛机械化，全过盖签章）；③ spec-loader 验签（`custom/*` 无签章 / 签章 hash 不符 → ConfigError 拒绝装载，AC-7 的机械化实现）。产物落点 `templates/specs/*.json`（MotionSpec JSON，零 codegen，装载/渲染链已存在）。

**Tech Stack:** TypeScript（Node 侧 vitest）、sha-256（node:crypto）、复用 `core/spec.ts`（validateMotionSpec/deriveDeclaration）、`templates/registry.ts`、`remotion/renderer` 的 `renderToStaticMarkup`（DOM 级判据）。

**Spec:**
- `docs/proposals/2026-10-22-创作期动效生成与Studio审核闸.md`（§4 生成物验收门槛、§4.5 genPrompt 契约、§5 P1-b 行）
- `.claude/artifacts/designs/creative-motion-and-studio-review.md`（P1-b 节、AC-7/8/9、生成空间边界）
- 冲突时以提案为准；本计划未覆盖的裁决（如扩语法 back/elastic、svg 图元）**不在本计划范围**。

## Global Constraints

- 渲染期确定性红线一字不改；**管线内禁调 LLM**（生成只发生在创作期会话/工具中）
- `genPrompt` 禁写坐标、帧号、颜色、CSS（同 params 纪律）；binder / validate / render **零消费**
- MotionSpec 语法边界：5 图元（`text/panel/bar/rule/triangle`）× ≤4 elements × 8 可动属性（`SPEC_PROPERTIES`）× 5 缓动（`SPEC_EASES`）× 令牌色；≤16KB（`MAX_SPEC_BYTES`）；`SPEC_VERSION = 1`
- 生成模板命名：`custom/<语义名>@0.1` 起步，定稿升 1.0；重掷 = 新版本文件，旧 job 引用永不失效
- 一致性/工具类检查走结构断言或独立命令，**不占 18 项校验名额**（同 M-3 ⑤ / P1-a 先例）
- 验收失败的产物留 `out/` 供排查，不入库、不可被 motionboard 引用
- Remotion 锁 4.0.534；commit 信息中文、遵守登记册纪律（本计划无新增校验项，无登记册行变更；P1-b 落地状态在收尾任务就地补记提案头）

## Review Focus

1. **手改已签章 spec 后再跑管线**——期望：loader 报「签章 hash 与文件内容不符」并指出重跑 `motion:accept`（Task 3 测试）
2. **手丢无签章的 spec 进 `templates/specs/`**——期望：`custom/*` 装载被 ConfigError 拦下，报文件名（Task 3 测试）
3. **genPrompt 泄漏进机器判定链**——期望：带/不带 genPrompt 的同一 board 绑定结果逐字节一致，产物 storyboard.json 无该键（Task 1 测试）
4. **语法外需求的 prompt 硬编**——期望：验收命令逐道报因（哪道、为什么），产物不进 `templates/specs/`（Task 2 测试）
5. **同 id 重掷旧引用失效**——期望：同目录两个版本文件并存时双双注册、`getTemplate` 各自可达（Task 3 测试）

---

### Task 1: genPrompt 契约（§4.5 连带改动 ①②）

**Files:**
- Modify: `src/core/types.ts`（`MotionBoardItem`，约 :480 起）
- Modify: `src/core/motionboard.ts`（`ALLOWED_MOTIONBOARD_ITEM_KEYS`，:42）
- Test: `tests/motionboard.test.ts`（追加 describe；该文件已有 19 项）

**Interfaces:**
- Consumes: 现有 `assertMotionboardKeys`、`bindMotionboard(board, opts)` → `{ draft, report }`（`src/core/motionboard.ts:203`）
- Produces: `MotionBoardItem.genPrompt?: string`——Task 4 的 skill 契约引用此字段名

- [x] **Step 1: 写失败测试**（追加到 `tests/motionboard.test.ts`）

```ts
describe('genPrompt 契约（提案 §4.5）', () => {
  it('白名单放行 genPrompt：assertMotionboardKeys 不抛', () => {
    // 构造合法 intent 条目 + genPrompt: '玻璃质感的数字翻牌，翻开后微微回弹'
    // 调 assertMotionboardKeys(item) → 不抛
  });

  it('零机器消费：带/不带 genPrompt 的同一 board 绑定输出逐字节一致', () => {
    // boardA 无 genPrompt；boardB 相同但条目带 genPrompt
    // JSON.stringify(bindMotionboard(boardA, opts)) === JSON.stringify(bindMotionboard(boardB, opts))
    // （draft 与 report 都比）
  });

  it('零泄漏：绑定产物条目不含 genPrompt 键', () => {
    // 遍历 draft 条目，断言 !('genPrompt' in item)
  });
});
```

- [x] **Step 2: 跑测试确认红**

Run: `npx vitest run tests/motionboard.test.ts`
Expected: FAIL——第一条因白名单未放行抛错（`genPrompt` 是未知键）

- [x] **Step 3: 实现**

- `types.ts`：`MotionBoardItem` 增 `genPrompt?: string`，注释写明「仅创作期生成器与人审读；binder/validate/render 零消费（守 P0）；禁坐标/帧/颜色/CSS」
- `motionboard.ts`：白名单数组加 `'genPrompt'`

- [x] **Step 4: 跑测试确认绿**

Run: `npx vitest run tests/motionboard.test.ts`
Expected: PASS（19 + 3）

- [x] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/motionboard.ts tests/motionboard.test.ts
git commit -m "feat(motionboard): genPrompt 契约——创作期生成 prompt 字段，机器判定链零消费（提案 §4.5）"
```

### Task 2: `npm run motion:accept` 六道验收命令

**Files:**
- Create: `tools/accept-motion-spec.mts`
- Modify: `package.json`（scripts 加 `"motion:accept": "tsx tools/accept-motion-spec.mts"`）
- Test: `tests/motion-accept.test.ts`（新文件；纯逻辑部分抽成可测函数放 `src/core/motion-accept.ts`，命令文件只做 CLI 壳）

**Interfaces:**
- Consumes: `validateMotionSpec` / `deriveDeclaration`（`core/spec.ts`）、`registerTemplate` / `hasTemplate`（`templates/registry.ts`，测试用 `__resetRegistryForTests`）、`renderToStaticMarkup`
- Produces: `acceptMotionSpec(raw: string, fileName: string): { ok: true; spec: MotionSpec } | { ok: false; failures: string[] }`（`src/core/motion-accept.ts`，Task 3 不消费它，但签章 hash 算法在此定：`sha256(raw bytes)` 十六进制）

六道门槛（顺序即报因顺序）：
1. **结构**：`validateMotionSpec` 通过（颜色只认令牌、图元/属性/缓动白名单、≤16KB）
2. **注册检查**：`deriveDeclaration(spec)` 后 id/scope/layer/footprint 声明齐备；`custom/` 前缀 id 合法（`custom/<语义名>@<semver>`）
3. **三帧非空白**：注册进临时 registry 后，`renderToStaticMarkup` 于帧 6/45/72 渲染，DOM 含元素节点、无 `data-template-missing`
4. **动效真在动**：三帧 markup 两两不等（同 `tests/template-render.test.tsx` 判据）
5. **确定性 lint**：spec 原文不含 `Date.now` / `Math.random` / `useFrame` / `animation:` 子串（JSON 里本不该有，防御未来扩语法）
6. **签章**：全部通过后产出 acceptance 块（无时间戳，保确定性）：

```json
{ "acceptance": { "toolVersion": 1, "specHash": "<sha256 of raw bytes>", "gates": ["structure", "registration", "frames", "animates", "lint"] } }
```

- [x] **Step 1: 写失败测试**（`tests/motion-accept.test.ts`，用 `tests/_ctx.ts` 与现有 spec 夹具的构造方式；合法 spec 夹具可从 `templates/specs/fade-up.json` 复制改 id 为 `custom/accept-fixture@0.1`）

```ts
// ① 合法 custom spec → ok:true，返回的 spec.id === 'custom/accept-fixture@0.1'
// ② 图元超限（第 5 个 element）→ ok:false，failures[0] 提到 'structure'
// ③ 三帧全同（tracks 置空使 DOM 恒定）→ ok:false，failures 提到 'animates'
// ④ 原文含 'Date.now' → ok:false，failures 提到 'lint'
// ⑤ 验收签章：ok 时的 acceptance.specHash === sha256(原始字节)；重跑同输入逐字节一致
// ⑥ id 非 custom/ 前缀 → ok:false，failures 提到 'registration'
// ⑦ 确定性回归（AC-8）：任一帧渲染两次，markup 逐字节相等
```

- [x] **Step 2: 跑测试确认红**

Run: `npx vitest run tests/motion-accept.test.ts`
Expected: FAIL——模块不存在

- [x] **Step 3: 实现** `src/core/motion-accept.ts`（六道，任一失败即短路人畜报因）+ `tools/accept-motion-spec.mts`（读 argv 路径 → `acceptMotionSpec` → 失败逐条 stderr + exit 1；成功把**带签章的全文**写到 `templates/specs/custom-<名>.json` 并打印入库路径）

- [x] **Step 4: 跑测试确认绿**

Run: `npx vitest run tests/motion-accept.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/motion-accept.ts tools/accept-motion-spec.mts package.json tests/motion-accept.test.ts
git commit -m "feat(motion): motion:accept 六道验收命令——结构/注册/三帧/动效/lint/签章（提案 §4）"
```

### Task 3: spec-loader 验签（AC-7 / AC-8 / Review Focus 1·2·5）

**Files:**
- Modify: `src/core/spec-loader.ts`（`loadSpecsFromDisk` 循环内，:38-90）
- Test: `tests/spec-loader.test.ts`（追加；若现有测试在别处，沿其文件）

**Interfaces:**
- Consumes: Task 2 的签章格式（`acceptance.specHash` = sha256(raw bytes)）
- Produces: 装载许可语义——`custom/*` 必须有吻合签章；非 custom（现有 8 份基线 spec）不要求（向后兼容）

- [x] **Step 1: 写失败测试**

```ts
// ① 无签章 custom spec → ConfigError，消息含文件名与「motion:accept」指引
// ② 有签章但文件被手改（hash 不符）→ ConfigError，消息含「重跑 motion:accept」
// ③ 签章吻合 → 注册成功，hasTemplate('custom/x@0.1') === true
// ④ 非 custom（现有基线 spec，无签章）→ 正常装载（回归保障）
// ⑤ 同目录 custom/x@0.1 与 custom/x@0.2 并存 → 双双注册，getTemplate 各自可达
```

- [x] **Step 2: 跑测试确认红**

Run: `npx vitest run tests/spec-loader.test.ts`
Expected: FAIL——目前无验签逻辑（① 通过装载、② 不报错）

- [x] **Step 3: 实现**——装载循环内：解析出的 spec 若 `id` 以 `custom/` 开头 → 校验 `acceptance` 块存在且 `specHash === sha256(文件原始字节)`，否则 ConfigError（错误信息给可执行做法：`node --experimental-strip-types tools/accept-motion-spec.mts <file>` 重新验收）

- [x] **Step 4: 跑测试确认绿 + 全量回归**

Run: `npx vitest run tests/spec-loader.test.ts && npm test`
Expected: PASS；全量绿（现有 8 份基线 spec 无签章不受影响）

- [x] **Step 5: Commit**

```bash
git add src/core/spec-loader.ts tests/spec-loader.test.ts
git commit -m "feat(motion): spec-loader 验签——custom/* 无签章或 hash 不符拒绝装载（AC-7）"
```

### Task 4: skill 生成流程节 + 契约同步 + 收尾（AC-9）

**Files:**
- Modify: `SKILL.md`（根；新增「创作期动效生成」流程节）
- Modify: `.workbuddy/skills/storyboard/SKILL.md`（genPrompt 写作纪律）
- Modify: `docs/proposals/2026-10-22-创作期动效生成与Studio审核闸.md`（头部 P1-b 落地注记）
- Modify: `PROGRESS.md`（阶段 3 P1-b 状态、测试计数）、`docs/changelog/`（当日 changelog）

**Interfaces:**
- Consumes: Task 1 `genPrompt` 字段、Task 2 `npm run motion:accept`、bind-report `noFits`（`storyboard.ts:266` 已打印）
- Produces: 无代码接口；文档即交付物

- [x] **Step 1: 根 SKILL.md 增「创作期动效生成」流程节**——内容按提案 §2 图与 §4.5：触发三条件（bind-report noFits / 安全阀转 custom / 人工指定）→ 读该条目 `genPrompt` → 按 spec 契约产 MotionSpec JSON（语法内编排；语法外需求**诚实报告**转 Tier 2，禁硬编）→ `npm run motion:accept -- <file>` → 过则入库 `templates/specs/custom-<名>.json` → motionboard 条目改 `motion` 钉死（或 intent 指向）→ 重掷 = 新版本文件名（`custom/<名>@0.1` → `0.2`…，定稿 `1.0`）；旧 job 引用不受影响

- [x] **Step 2: storyboard skill 增 genPrompt 纪律**——写形态/质感/节奏，不写坐标/帧/颜色/CSS；intent 仍是绑定键，genPrompt 并存不替代；无 genPrompt 的 no-fit 维持 B4/N-3 custom 人工逃生口（生成是增强不是替换）

- [x] **Step 3: 文档收尾**——提案头加「P1-b 落地（2026-10-24，plan：本文档同目录）」注记；PROGRESS 阶段 3 P1-b 状态改「🔶 已落地」+ 测试计数更新；changelog 记当日四任务

- [x] **Step 4: 全量验证**

Run: `npm test && npm run typecheck && npm run placeholders -- --check`
Expected: 全绿

- [x] **Step 5: Commit**

```bash
git add SKILL.md .workbuddy/skills/storyboard/SKILL.md docs/proposals/ PROGRESS.md docs/changelog/
git commit -m "docs(skill): P1-b 生成流程节 + genPrompt 纪律 + 提案/PROGRESS 落地状态"
```

---

## 执行说明

- 分支：从当前 main 切 `codex/p1b-motion-generation`（P1-b 依赖 genPrompt 语义，不依赖 t1-calibration 分支；两分支合并顺序由主人定）
- Task 1 → 2 → 3 有接口依赖（签章格式），严格串行；Task 4 只依赖前三个的名字，可与 2/3 并行起草但建议串行收尾
- 验收命令与 loader 验签属**工具/结构层**，不新增校验项、不动 18 项清单与登记册
