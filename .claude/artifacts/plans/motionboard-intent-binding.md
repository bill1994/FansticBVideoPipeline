# motionboard × storyboard 整合 Implementation Plan（v2，Wave 5 整合版）

> Status: APPROVED —— IMPLEMENTED（2026-10-21 实施完成；验证证据见下「Verification steps」各项）
> 实施偏差记录：①intent 条目 sim_max 采用候选档位递减（0.85 − 0.05×order，与 plan 一致）；
> ②钉死条目缺省 sim_max = 1.0；③字幕轨探测按**条目 motion** 而非轨道 id（demo 的字幕轨叫 `caption-bar`）。
> 两条 reservations 仍开放：intent 词表零命中回填、真实模型会话起草验证。
> Source: [.claude/artifacts/designs/motionboard-intent-binding.md](../designs/motionboard-intent-binding.md)（v2）
> Mode: (default)；Iterations: 2 / 3（v1 三分支方案被 Wave 5 推翻后重写）
> Author: user
> Last updated: 2026-10-21

## Requirements summary

motionboard 与 storyboard **整合为单一可编辑文件** `03-storyboard/motionboard.json`（intent / 钉死 motion 混合条目）：
模型读 skill + 资源生成之、人可改，绑定器作为 storyboard 阶段**调度前的解析步**把意图解析成模板绑定，
产 `bind-report.json`，随 bake 将 intent「用完即弃」→ storyboard.json。draft 概念退役
（draft.json / draft.synth.json / draft.bind.json / `--draft` 全部移除，无兼容层，全量迁移）。

## Acceptance criteria

- AC-1：baseline-kukini 手写 motionboard.json → `storyboard --force` → `validate --force` → **0 error**（E-D4-01 不复发）
- AC-2：同一 motionboard 两次绑定，bind-report.json 逐字节一致
- AC-3：候选全被门控挡下 → bind-report 记 no-fits + stderr warn，条目不产 MG，字幕轨恒在
- AC-4：bind-report 可查每条 `intent → motion id → 命中候选序`；钉死条目标记 `pinned: true`
- AC-5：motionboard.json 不存在 → 生成器产出（intent 形态）并同 run 绑定出预览；存在 → 管线零改写该文件
- AC-6：intent 词表覆盖全部可绑定注册模板（fullscreen 除外）；映射缺失启动抛 ConfigError
- AC-7：`--draft` 传入报「未知参数」；`npm test` 全量绿；`examples/demo` 端到端可跑
- AC-8：无字幕模式仍拦生成器；手写 motionboard 仅 abs: 锚点可用（沿用 M-1g 拦截）

## RALPLAN-DR

### Principles

1. **一个可编辑文件**：用户/模型拥有 motionboard.json；管线除首跑生成外只读。
2. **下游契约零改动**：storyboard.json/validate/render 不感知意图层存在。
3. **复用不新建**：绑定器复用 `carrierRouteIfNeeded`、`paramsForMotion`、键检查、两道闸、bake。
4. **不静默**：no-fits、优先级、废弃参数全部显式。
5. **intent 用完即弃**：随 `_author` 在 bake 剥离，storyboard.json 只有帧（C2 铁律延伸）。

### Decision drivers

单一可编辑文件（Wave 5 决定性）/ 零下游改动 / 溯源可对账 / 迁移干净（无兼容层）。

### Viable options（解析步位置）

**Option A（favored）：绑定器 = runStoryboard 内、调度前的解析步**。读 motionboard.json → bind → DraftStoryboard → 汇入既有键检查/调度/bake。
Pros：单一入口、复用全部防线、生成器与绑定共用同一解析路径。Cons：runStoryboard 主流程 +1 步（接受）。

**Option B：绑定并入 bake.ts**（锚点与 intent 一起解析）。rejected：bake 在调度**之后**，
而 intent 解析需要产出 sim_max/confidence 供两道闸 —— 顺序不成立；且 no-fits 须在调度前裁剪。

**Option C：独立 bind 命令**。rejected：v1 已裁（入口重复 + 固化陷阱），Wave 5 维持。

## Implementation steps

1. **契约** — `src/core/types.ts`（末尾追加）：
   `MotionBoardItem { _author: AuthorAnchor; intent?: string; motion?: string; featuredText?: string;
   note?: string; confidence: number; params?: Record<string, unknown>; footprint?: Footprint; exclusive?: string }`
   （intent 与 motion **二选一**，由 `assertMotionboardKeys` 校验）；`MotionBoard { meta{fps,version}; items; noMotionRanges }`。
2. **intent 词表 v0** — 新模块 `src/core/motionboard.ts`：`MOTIONBOARD_INTENTS: Record<string, { candidates: string[] }>`
   —— `number-emphasis→[data/stat-card@1.0, typography/kinetic-line@1.0]`、`contrast-turn→[typography/kinetic-line@1.0]`、
   `question→[typography/kinetic-line@1.0]`、`enum→[typography/lower-third@1.0, typography/kinetic-line@1.0]`、
   `repetition-term→[typography/tag-float@1.0]`、`closing-verdict→[typography/center-emphasis@1.0, typography/kinetic-line@1.0]`、
   `definition→[typography/kinetic-line@1.0]`、`keypoint→[typography/kinetic-line@1.0, typography/tag-float@1.0]`。
   启动期逐候选 `registry.get` 校验（缺失抛 `ConfigError`，AC-6）。
3. **绑定器** — `src/core/motionboard.ts`：`assertMotionboardKeys()`（未知键/二选一违规一次列全抛 ConfigError，
   fps 对 source.json 校验）+ `bindMotionboard(mb, cues, words, source, registry) → { draft: DraftStoryboard, report: BindReport }`：
   字幕轨沿用「每 cue 恒一条 caption」（从 `rhythm-rules.ts:676-679` 导出 `CAPTION_TRACK/MOTION_TRACK/CAPTION_MOTION` 复用）；
   intent 条目 → 候选逐个过 `max(minVisibleInFrames, toFrame-fromFrame+1)` 门控（同 bake.ts:201 口径）→
   `params = featuredText ? {text: featuredText} : paramsForMotion(...)`；钉死条目直通（params 原样，#16 兜底）；
   两类条目均过 `carrierRouteIfNeeded`（自 `rhythm-rules.ts:781-801` 导出）；
   `sim_max`：钉死 1.0 / 意图首选 0.85、降档递减 0.05；`confidence` 取条目值。
4. **生成器改造** — `src/core/rhythm-rules.ts`：`synthDraft` 改为 `generateMotionboard(...)`：
   产出 **MotionBoard 形态**（decideMotion 的结果改写为 intent 条目——其映射从 `MOTIONBOARD_INTENTS` 派生，单一真源；
   caption 不再由生成器逐条铺，交给绑定器统一铺）。
5. **主流程重排** — `src/stages/storyboard.ts`：删除三来源分支；改为
   `motionboard.json 不存在 → generateMotionboard + writeStageJson('motionboard.json')` →
   `bindMotionboard → writeStageJson('bind-report.json')` → `assertDraftItemKeys`（允许键集扩为
   motion/params/footprint/exclusive/footprintAnimates/carrier/confidence —— intent/featuredText/note/_author 绑定后已剥离或属 `_author` 内）
   → 两道闸 → bake（现有）。`draft.synth.json` 写盘删除；no-subtitle 拦截保留（AC-8）。
6. **CLI** — `src/cli.ts`：`--draft` 从 `parseArgs:65-66` 与 USAGE 移除（传入报未知参数，AC-7）；
   USAGE 的 storyboard 行改为「读 03-storyboard/motionboard.json（缺失则规则生成）→ 绑定 → 烘焙」。
7. **迁移** — `examples/demo/03-storyboard/draft.json` → `motionboard.json`（条目转钉死形态：motion+params 原样、
   `_author.anchor` 保留）；`tests/draft-keys.test.ts`、`tests/stage-order.test.ts`、`tests/rhythm-table.test.ts` 的
   synthDraft 用例迁移到 generateMotionboard/bindMotionboard；`tools/list-placeholders.mts` 等如引用 draft 路径一并改。
8. **skill 增补** — `.workbuddy/skills/storyboard/SKILL.md` 增「motionboard 起草」节：
   可读资源清单（words/cues/shots/regions/pacing 底稿）、intent 词表全文、featuredText 纪律（提炼短语非复读、
   缺省可空由绑定器机械提取）、confidence 自评、锚点语法、钉死条目的使用时机。
9. **测试** — `tests/motionboard.test.ts`（新）：二选一校验 / 未知键 / 绑定成功与候选降级 / no-fits 显式 /
   钉死直通 / AC-2 逐字节 / AC-5 管线不改写 / face 0% 继承 carrier / `--draft` 未知参数。
10. **验证** — baseline-kukini 手写 motionboard（12 条节奏表行转意图 + 2 条 featuredText 精修示例）→ AC-1/2/4；
    `examples/demo` 端到端 → AC-7；全量 `npm test`。

## Workspace setup

- 实施前 `git status --short` + `git branch --show-current`。
- ⚠️ working tree 现有大量未提交改动（E-D4-01 修复/wiki/基线报告/对标报告/spec/plan）——**实施前须与用户确认这批改动先行提交**，
  本 plan 改动不得混入。当前分支 `main` → 推荐
  `git worktree add -b codex/motionboard-integration ../VideoPipeline-motionboard`。

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| 迁移面漏改（demo/tests/工具引用 draft） | 步骤 7 清单化 + 全量测试 + demo 端到端（AC-7） |
| 生成器与绑定器对词表两套实现 → 漂移 | `MOTIONBOARD_INTENTS` 单一真源，decideMotion 映射从词表派生（步骤 4） |
| 人写 params 破坏 #16 | #16 照常兜底（绑定器直通不清洗），错误显式暴露 |
| motionboard.json 被管线误改 | writeStageJson 仅在「不存在时生成」分支写它；存在即只读（AC-5 钉死） |
| no-fits 被当成功 | bind-report 显式条目 + stderr warn（AC-3） |
| intent 解析需 cue 数据但 no-subtitle 无 cue | 沿用 M-1g 拦截：无字幕模式生成器/意图绑定均不可用（AC-8） |

## Verification steps

- AC-1/4：baseline-kukini 手写 motionboard → `npm run pipeline -- storyboard --job baseline-kukini-1021 --force` →
  `validate --force` → 0 error；查 bind-report.json 候选序与 pinned 标记。
- AC-2：同 motionboard 跑两遍，哈希比对 bind-report.json。
- AC-3：构造 20 帧 cue + `number-emphasis`（stat-card 需 45/kinetic-line 需 30）→ no-fits 条目 + warn。
- AC-5：删 motionboard.json 跑一次（生成+绑定）→ 再跑一次 → 文件 mtime/内容不变、不重复生成。
- AC-7：`--draft x` 报未知参数；`npm test` 全量；`examples/demo` storyboard+validate+render --dry-run。
- AC-8：`--no-subtitle` job 跑 storyboard → 现有 ConfigError 文案仍在。

## Pre-mortem（--deliberate 触发项：无。default 模式以 reservations 代替）

## ADR

- **Decision**：storyboard 与 motionboard 整合为单一可编辑文件 `motionboard.json`（intent/钉死混合），
  绑定器为 runStoryboard 内调度前的解析步；draft 概念全量退役、无兼容层。
- **Drivers**：单一可编辑文件（Wave 5 用户决定性输入）、零下游改动、迁移干净。
- **Alternatives**：v1 三分支方案 — rejected（Wave 5：用户不要 draft 存在）；绑定并入 bake — rejected（调度先于 bake，顺序不成立）；
  独立 bind 命令 — rejected（v1 ADR）；兼容旧 draft.json — rejected（用户选「改名+无兼容」）。
- **Why chosen**：一份文件承载「生成→人改→绑定」全生命周期，心智与工具面都最简；
  解析步放在调度前是唯一满足「sim_max 先于两道闸」的位置。
- **Consequences**：runStoryboard 主流程重排（一次性）；demo/tests/CLI/skill 同步迁移（一次性成本）；
  bind-report.json 成为新 03 产物；未来「意图→MotionSpec 生成」在 bindMotionboard 内插拔。
- **Follow-ups**：intent 词表语义类扩充随模板库；数据复盘闭环供词表校准（对标报告 Catch-up #2）；
  skill 是否抽宿主中立包（对标报告 §6.3）另议。

## Review trail

- v1（三分支）：Planner→Architect→Critic 一轮 APPROVED（reservations：词表未实测、skill 假设未验证）。
- **Wave 5 用户修订**：不要 draft 存在；整合 storyboard 与 motionboard → v2 重写（本版）。
- v2 Critic 复核：AC-5/AC-7 新增可验证；reservations 沿用 v1 两条 —— ①intent 词表静态推导需首跑回填零命中项；
  ②「模型照 skill 产出合法 motionboard」待真实模型会话验证（实施后第一件事）。
- 实施后评审修复（2026-10-21）：`MOTIONBOARD_INTENTS` 迁至 `core/rhythm-rules.ts` 并由 `decideMotion`
  派生选型（步骤 2 与步骤 4 存在隐性冲突——词表在 motionboard.ts 会使派生成环，落地以步骤 4 单一真源为准）；
  `definition` 词表候选修正为 `[center-emphasis, kinetic-line]` 对齐规格 P1 选型表；featuredText 改为
  schema 感知覆盖语义键（text/value/title）。Final iterations: 2 / 3。
- Reservation ② 验证（2026-10-21，baseline-kukini-1021 真实模型会话）：按 skill 起草流程
  生成器底稿（48 cue → 12 intent）→ 模型精修（改判 3 / 文案精修 4 / 钉死 1 / 增 1 删 1 / 留 3 对照）→
  绑定 noFits 0 → validate 0 error。底稿缺陷被模型纠出：「一个」误命中数字出假数据卡（cue25/37）、
  「怎么样/怎么」误命中 question（cue20/30/32）、机械提取残缺（cue44「么不管是…」）。
  Final iterations: 2 / 3。
