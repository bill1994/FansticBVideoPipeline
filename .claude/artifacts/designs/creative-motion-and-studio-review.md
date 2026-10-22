# 创作期动效生成 × Studio 审核闸 Spec

> Status: ALIGNED
> Author: user
> Last updated: 2026-10-22
> 来源提案：[docs/proposals/2026-10-22-创作期动效生成与Studio审核闸.md](../../docs/proposals/2026-10-22-创作期动效生成与Studio审核闸.md)
> 用户裁决：四项建议全部采纳（must_review 硬闸 / 会话内生成先跑通 / render-props 共用+hash 防漂移 / `custom/<语义名>@0.1`）

## Background

用户两条需求：① 没有可用模板时按 prompt 生成新 motion，接受每次生成结果不同；② 渲染前在
Remotion Studio 人工审核，确认后才渲染。设计原则（已对齐）：**随机性关进创作期**——生成与
重掷发生在创作期（产物是入库模板），渲染期确定性红线一字不改。渲染时即时生成被明确否决
（20 分钟反馈环 / 18 项校验对未知结构失明 / E-C6-01 静默截断放大 / 溯源断裂）。

## In scope

### P1-a · Studio 审核闸（先行交付）

- **`review` 命令**（`npm run pipeline -- review --job <id>`）：
  复用 render 的 C6 双栈映射产出预览 props → 写 **`06-review/preview-props.json`**
  （🔴 不写 `05-render/render-props.json`——`writeStageJson` 是不可变快照守卫执行点，
  review 先写会让 render 阶段撞守卫）→ 启动 `remotion studio` 挂载真实 storyboard
- **must_review 确认闸**：`renderGate()` 扩展——沿 `fullscreenRefs` 同一模式重算
  `ctx.scene.filter(s => s.item.decision?.review === 'must_review')` 的 refs，
  要求 `confirmed.json`（stage:"render"）的新字段 **`acknowledgedReview`** 全部覆盖；
  未覆盖 → 退出码 1 并列出缺失 ref。无 must_review 条目 → 不要求记录（现状不变）
- **confirmed.ts 契约扩展**：`ConfirmedRecord`（stage:"render"）新增可选字段
  `acknowledgedReview: string[]`，与 `acknowledgedFullscreen` 同记录共存（F3-1 不破坏）
- **hash 防漂移**：review 映射时记录 storyboard hash；render 启动闸比对
  （呼应 `assertStageOrderIsSane` 的时序守卫思路：review 之后 storyboard 变了 → 确认作废）

### P1-b · 创作期生成（契约级，P1-a 后另行排期）

- **生成落点已存在且为声明式**（2026-10-22 复核修正：不是组件代码）：`templates/specs/` 下
  已有 8 份用户与模型共创的 MotionSpec（fade-up / typewriter-cn 等）——生成物是
  **MotionSpec JSON**（渲染无关描述契约：图元 elements + 关键帧轨道 tracks），
  经 `spec-loader` → `validateMotionSpec` → `deriveDeclaration` 注册，
  由 `SpecRenderer` 通用渲染器消费（S2，5 类图元）。零 codegen、零渲染层改动
- **会话内生成流程**（skill 增补，不接管线内 LLM）：prompt → 模型按 spec 契约产出
  MotionSpec JSON → 校验通过 → 入库 `templates/specs/custom-<名>.json`（`custom/<名>@0.1` 起步）→ 立即可引用
- **六道验收门槛**（两项已被现有机制天然覆盖）：①结构校验（`validateMotionSpec` 已实现：
  颜色只认令牌、拒绝规则一次列全）②确定性（SpecRenderer 帧驱动纯函数，天然满足）
  ③注册检查（id/scope/layer/footprint 声明齐备）④画廊三帧渲染非空白
  ⑤「不同帧不同 DOM」断言 ⑥版本化（定稿升 1.0，旧 job 引用永不失效）
- **生成空间边界（双层，2026-10-22 与用户对齐）**：spec 是受限语法——5 图元（≤4 个）×
  8 可动属性 × 5 缓动 × 令牌色，≤16KB。prompt 生成 = **语法内编排**（分解 prompt →
  选图元/定几何/排关键帧），「每次不一样」来自编排差异；语法外需求（3D/粒子/自定义路径）
  → 生成器**诚实报告**并转 Tier 2（扩图元改 SpecRenderer，或写组件模板），🔴 不硬编。
  压制是真实代价，换取：生成物必过校验、必确定、必可预览（约束是生成质量的朋友）。
- **首批扩语法候选**（每次都是小裁决，`specVersion` 字段已预留演进通道，旧 spec 永不失效）：
  ①`SpecEase` 增 `back`/`elastic`（改 tokens.ts 缓动映射 + spec.ts 白名单，两处）；
  ②`svg` 图元（path 数据 + 令牌 fill）——**轨道系统与图元解耦**，8 条属性轨对新图元自动生效
  （svg + clip 轨 = AE 式描边生长），是"复杂 prompt 要 SVG"的正解。

## Out of scope

- **渲染时按 prompt 即时生成**（红线，理由见提案 §2）
- **管线内调 LLM**：生成只发生在创作期会话/工具中
- 06-review Web 编辑器 / 备选机制（`alternatives` 仍无消费）
- P1-b 的自动验收流水线实现（本 spec 只定契约）

## Assumptions

- `remotion studio` 支持 `--props` + `--public-dir` 挂载（4.0.534 / Windows 实测为 P1-a
  第一个验证点；不行则退化为 contact-sheet 静帧审核，media-qa 机制复用）
- 本机 Node 22.22 满足 Studio 要求（LOCAL.md，doctor 全绿）
- must_review refs 可在 render 闸重算获得（与 fullscreenRefs 同路径，无新数据依赖）
- 掷骰重生成 = 产出新版本/新模板，旧版本保留——已出片 job 不受影响

## Solution（sketch）

```
review 命令（新）：
  1. renderGate 复检（validate ok 必须先成立）
  2. 复用 render 的映射段 → 写 06-review/preview-props.json + storyboard hash
  3. 启动 studio（前台阻塞）+ 打印 must_review 队列与确认写法
  4. 用户看片 → 手写/助手代写 confirmed.json 的 acknowledgedReview

renderGate（扩展）：
  fullscreen 闸（不动）
  + must_review 闸：refs = ctx.scene.filter(review==='must_review')
    缺失确认 → StageBlockedError 列出未覆盖 ref
    + storyboard hash 与 review 记录不一致 → 提示重跑 review

P1-b（会话流程，skill 增补）：
  prompt → 组件+声明 → 六道验收 → custom/<名>@0.1 入库 → motionboard 引用
```

## Edge cases & risks

| Category | Notes |
|---|---|
| 不可变守卫冲突 | review 与 render 各写各的 props 文件（06-review vs 05-render），互不撞 |
| 重复 review | `writeStageJson` 只守写入方向不守存在（[io.ts:127](../../src/core/io.ts#L127) `writeJson` 直接覆写）——重跑 review 覆写 preview-props.json 并重算 hash，无需 --force |
| 确认后改 storyboard | hash 比对发现漂移 → render 拒绝并提示重跑 review（确认不跨版本有效） |
| 无 must_review 的 job | 闸不生效，review 仍可用（自愿全量看片） |
| Studio 交互阻塞 | review 命令前台运行至用户关闭；脚本化场景退化为 dry-run + 手动确认 |
| 生成物质量 | 六道验收不过 → 不入库不可引用；验收失败的产物留 `out/` 供排查不入库 |

## Acceptance criteria

**P1-a**

- AC-1：`review --job X` 产出 `06-review/preview-props.json`（含 storyboard/stacks/carrierTracks/
  caption/templates 完整映射）并启动 Studio；同一 storyboard 两次执行逐字节一致
- AC-2：存在 must_review 条目且 `confirmed.json` 无 stage:"render" 记录或 `acknowledgedReview`
  未覆盖全部 refs → `render` 退出码 1，报错逐一列出缺失 ref
- AC-3：`acknowledgedReview` 覆盖全部 refs（可与 `acknowledgedFullscreen` 同记录共存）→ render
  正常启动，fullscreen 闸行为不变
- AC-4：无 must_review 条目的 job → render 不要求 confirmed 记录（回归保障）
- AC-5：review 之后 storyboard 被改动 → render 拒绝启动，提示重跑 review（hash 比对生效）
- AC-6：`--spec-only` 产物相关测试全绿；`npm test` 全量不回退

**P1-b（契约级）**

- AC-7：未过六道验收的 `custom/*` 声明 → storyboard/validate 阶段 ConfigError，不进入渲染
- AC-8：定稿入库的 `custom/<名>@1.0` → 同 props 渲染输出稳定（确定性回归测试）
- AC-9：skill 含「生成→验收→入库→引用」流程节；重掷产生新版本，旧 job 引用不受影响

## Open questions

- `remotion studio --props` 在 4.0.534 / Windows 的实测行为（P1-a 第一个验证点，失败退路已定：
  contact-sheet 静帧审核）
- `acknowledgedReview` 的确认操作形态：v1 手写/助手代写 confirmed.json（沿既有闸的错误信息
  指引风格）；是否加 `review --confirm` 辅助命令待 P1-a 实施时定
- 生成器宿主细节（P1-b）：会话 skill 的验收清单如何机械化（脚本化验收命令 vs 会话自检）

## Core entities (ontology)

| Entity | Type | Key fields | Relationship |
|---|---|---|---|
| preview-props.json | 新阶段产物（06-review） | 同 render-props + storyboardHash | 由 review 产出、Studio 消费 |
| ConfirmedRecord | 扩展（core/confirmed.ts） | stage:"render" + acknowledgedReview[] | render 启动闸消费 |
| must_review 队列 | 已有（validate/report P2） | item refs | 确认闸的覆盖目标 |
| custom/* 模板 | 已有机制（S1b snapshot + hydrate） | MotionSpec → 声明 | P1-b 生成物的入库形态 |
| 六道验收 | 新（P1-b 契约） | 清单即门槛 | 生成物 → 入库的唯一通道 |

## Interview metadata

- Mode: --spec-only（default 深度）
- Waves: 1（预检即达阈值——需求经提案会话充分对齐，四项裁决用户已确认）
- Final ambiguity: 11.25%
- Status: PASSED

### Clarity breakdown

| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| Goal | 0.9 | 0.40 | 0.36 |
| Scope | 0.9 | 0.25 | 0.225 |
| AC | 0.85 | 0.25 | 0.2125 |
| Context | 0.9 | 0.10 | 0.09 |
