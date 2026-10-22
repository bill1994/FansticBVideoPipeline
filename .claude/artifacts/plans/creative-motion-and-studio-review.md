# 创作期动效生成 × Studio 审核闸 Implementation Plan（P1-a）

> Status: APPROVED
> Source: [.claude/artifacts/designs/creative-motion-and-studio-review.md](../designs/creative-motion-and-studio-review.md)（ALIGNED）
> Mode: (default)
> Iterations: 1 / 3
> Author: user
> Last updated: 2026-10-22
> 范围：**P1-a Studio 审核闸**。P1-b（MotionSpec 生成流程）为 skill 增补，不在本 plan。

## Requirements summary

渲染是 20 分钟级反馈环，用户要求两件事：① 渲染前在 Remotion Studio 里**看到真实 storyboard 效果**，
人工确认后才允许渲染；② must_review 条目（闸2/产路地板产出）必须逐条过目。落地方式：新增
`review` 命令复用 render 的映射产出预览 props 并挂载 Studio；`renderGate` 扩展 must_review
确认闸（confirmed.json 新字段 `acknowledgedReview`）+ storyboard hash 防漂移。

## 聊天内容 × 提案 一致性审计（用户要求，2026-10-22）

| 项 | 结论 |
|---|---|
| 提案 §6 四项待裁决 | ✅ 用户全部确认（must_review 硬闸 / 会话内生成先跑通 / 映射共用+hash 防漂移 / `custom/<名>@0.1`），提案状态已更新为 ACCEPTED |
| P1-b 生成物落点 | ✅ 修正：不是组件代码，是 **MotionSpec JSON**——`templates/specs/` 已有 8 份共创 spec + 完整装载/渲染链（spec-loader → validateMotionSpec → SpecRenderer），零 codegen |
| 🔴 修正设计文档一处错误 | 设计文档原写「writeStageJson 拒绝覆写已存在文件」——**实为只守写入方向**（[io.ts:127](../../src/core/io.ts#L127) `writeJson` 直接覆写），重复 review 直接覆写 preview-props，无需 --force。已改 |
| 提案 §5「映射前移共用一份」 | 细化为「**共用映射代码**、两份产物文件」（06-review/preview-props.json 与 05-render/render-props.json 各自落盘）——避免不可变快照语义混乱，hash 防漂移补齐一致性 |
| 确定性红线 | ✅ 不改：随机性关在创作期；preview-props **不含墙钟字段**（保 AC-1 逐字节一致） |

## Acceptance criteria

- AC-1：`review --job X` 产出 `06-review/preview-props.json`（映射内容与 render 同源 +
  `storyboardHash`），同一 storyboard 两次执行**逐字节一致**；并启动 Studio 挂载该 props
- AC-2：存在 must_review 条目且 confirmed.json 无 stage:"render" 记录、或 `acknowledgedReview`
  未覆盖全部 refs → `render` 退出码 1，报错逐一列出缺失 ref 与重跑指引
- AC-3：`acknowledgedReview` 覆盖全部 refs（可与 `acknowledgedFullscreen` 同记录共存）→ render
  正常启动；fullscreen 闸行为与现状逐字节一致
- AC-4：无 must_review 条目的 job → render 不要求 confirmed 记录（现状回归）
- AC-5：review 之后 storyboard.json 被改动 → render 拒绝启动，报错指明 hash 不一致、要求重跑 review
- AC-6：`npm test` 全量不回退；typecheck 干净

## RALPLAN-DR

### Principles

1. **复用不新建**：review 是 render 映射段的前移复用，不是第二套映射；确认闸是 D3-a 机制的扩展，不是新概念
2. **不静默**：闸拒绝必须列出可执行清单（缺失 ref / 重跑指引），沿用 renderGate 既有报错风格
3. **确定性**：preview-props 不含墙钟；hash 用 storyboard.json 文件字节 sha256（内容 hash，不吃 mTime 亏）
4. **外科手术**：不碰 align/perceive/storyboard/validate 任何行为；fullscreen 闸现状逐字节保持
5. **确认凭据继续手写**：v1 不做交互式确认命令（沿 confirmed.json「唯一无人写代码的产物」定位，工具只做指引）

### Decision drivers

渲染 20 分钟反馈环（闸必须在渲染前）/ D3-a 既有机制（confirmed.json + renderGate）/ 禁第二份映射真源 / F3-1 多记录兼容 / Studio 挂载可行性未实测（退路已定）

### Viable options

**Option A（favored）：映射抽取共用 + Studio 挂载 + 闸扩展**
- 实现：从 `runRender` 抽映射段为 `composeRenderProps`；review 命令调用之 → 写 preview-props（含 hash）→ 启动 studio；renderGate 加 must_review 块
- 改动：`src/stages/render.ts`（重构+闸扩展）、`src/stages/render-props.ts`（新）、`src/stages/review.ts`（新）、`src/core/confirmed.ts`、`src/cli.ts`、tests ×3
- Pros：预览 = 真实渲染输入（同一 resolveScene）；闸零新概念；hash 有产出方
- Cons：要重构 render.ts 的映射段（430 行核心文件）

**Option B：review 自建映射，不动 render.ts**
- Pros：零重构风险
- Cons：**第二份映射真源**，预览与成片漂移只是时间问题——项目已三次踩过「两套实现漂移」坑（intent 词表/字幕轨/D-B 字号表）。REJECT（invalidation：违反单一真源纪律，漂移直接掏空审核意义）

**Option C：不入 CLI，纯 skill 流程 + renderGate 扩展**
- Pros：改动最小（只动 renderGate + confirmed.ts）
- Cons：无人产出 preview-props 与 hash → 防漂移落空；用户手动拼 `remotion studio --props` 命令易错且每次重复
- REJECT 作为主方案；其「手动挂载」保留为 studio `--props` 实测失败时的退化路径

## Implementation steps

1. **spike（一切之前）**：验证 `npx remotion studio src/remotion/index.ts --props=<json> --public-dir=<dir>` 在 4.0.534 / Windows 挂载成功——失败则启用退化路径（contact-sheet 静帧审核），plan 相应节重写后再继续
2. **抽取映射** — `src/stages/render.ts:143-315` 的映射段（source/resolveScene/stacks/carrierTracks/caption/templates/size）抽为 `src/stages/render-props.ts` 的 `composeRenderProps(jobId, jobsDir)`；`runRender` 改为调用，`writeStageJson` 落点（05-render/render-props.json）不变
3. **重构安全判据**：抽前后对 demo job 各跑一次 `render --dry-run`，`render-props.json` **逐字节不变**（快照过期先 `--force` 重跑 demo 作基线）
4. **confirmed 扩展** — `src/core/confirmed.ts:69-81` `ConfirmedRecord` 加 `acknowledgedReview?: string[]`；`parseRecord:148-157` 镜像 `acknowledgedFullscreen` 的数组校验
5. **renderGate 扩展** — `src/stages/render.ts:60-99`：fullscreen 块之后追加 must_review 块——
   `refs = ctx.scene.filter(s => s.item.decision?.review === 'must_review').map(s => s.ref)`（ctx 复用 line 71 既有 buildContext）；
   refs 非空时：要求 preview-props.json 存在且其 `storyboardHash` === 当前 storyboard.json 字节 sha256，否则拒（指明重跑 review）；
   `lookupConfirmed('render')` 的 `acknowledgedReview` 覆盖全部 refs，缺 → 列出缺失 ref
6. **review 命令** — 新 `src/stages/review.ts` `runReview({jobId, jobsDir})`：
   校验 validate 报告 ok → `composeRenderProps` → 附加 `storyboardHash` → `writeStageJson(target: STAGES.review, self: STAGES.review, 'preview-props.json')` →
   `printBlock` must_review 队列 + confirmed.json 追加写法 → `execFileSync('npx', ['remotion','studio','src/remotion/index.ts', '--props=<file>', '--public-dir=<00-input>'], { stdio: 'inherit', shell: true })`
7. **CLI** — `src/cli.ts:97` USAGE 加 review 行；`:154` switch 加 `case 'review'`（无新参数，沿用 --job/--jobs-dir）
8. **测试** —
   `tests/confirmed.test.ts`：acknowledgedReview 合法解析 / 非字符串数组拒绝
   `tests/render-gate.test.ts`（若无则并入 confirmed.test 或新建）：must_review 未确认拒（列 ref）/ 覆盖后放 / 无 must_review 不要求 / hash 漂移拒
   `tests/review.test.ts`（新）：preview-props 与 render 映射同源逐字节一致（同 storyboard）、含 storyboardHash、重跑覆写、不含墙钟字段

## Workspace setup

- 实施前 `git status --short` + `git branch --show-current`。
- 🔴 当前 working tree **有未提交改动**（Reservation ① 词表回填 + skill 新 job 引导 + 提案/设计文档 + .runlogs 删除）——
  按用户惯例等待提交指示。实施本 plan 前**必须先落定这批改动**（用户指示提交，或 stash），
  不得混入。推荐 worktree：`git worktree add -b codex/studio-review-gate ../VideoPipeline-review-gate`。

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `studio --props` 不支持/行为异常 | Step 1 spike 先行；退化路径 = contact-sheet 静帧审核（复用 media-qa），闸逻辑不变 |
| render.ts 映射段重构引入回归 | Step 3 字节级判据（demo 前后逐字节一致）+ AC-4 回归测试 |
| resolveScene 双跑（review 与 render 各一次）不一致 | 纯函数 + 每次从盘重建 ctx；tests/review.test.ts 钉「同 storyboard 两文件逐字节一致」 |
| 用户手写 confirmed 漏字段/拼错 | `parseRecord`（confirmed.ts:95-157）既有强校验沿用，报错带可执行修法 |
| must_review 为 0 的旧 job 行为变化 | 闸仅在 refs 非空时生效（AC-4 回归测试） |

## Verification steps

- AC-1：对 `skill-kukini-1022` 跑 `npm run pipeline -- review --job skill-kukini-1022` → 检查
  `06-review/preview-props.json` 存在且含 storyboardHash；跑两次哈希比对文件逐字节一致
- AC-2：手写一条不含 acknowledgedReview 的 render 记录 → `render` 退出码 1，stderr 列出全部缺失 ref
- AC-3：补全 acknowledgedReview（覆盖 validate 输出的 must_review 队列 refs）→ `render --dry-run` 通过且
  fullscreen 行为与改动前一致（对 demo job 对照）
- AC-4：对无 must_review 的 job（demo）直接 `render --dry-run` → 不要求 confirmed（现状）
- AC-5：确认后 `touch` 之外的**真实改动**（改 storyboard 任一帧）→ `render` 拒绝并指明 hash 不一致
- AC-6：`npm run typecheck` + `npm test` 全量

## ADR

- **Decision**：P1-a 采用「映射抽取共用 + Studio 挂载 + must_review 确认闸 + storyboard hash 防漂移」——
  review 复用 `composeRenderProps` 产出 `06-review/preview-props.json`，renderGate 扩展
  `acknowledgedReview` 覆盖检查与 hash 一致性校验；无 must_review 不阻
- **Drivers**：20 分钟渲染反馈环（决定性）/ D3-a 机制复用 / 禁第二份映射真源 / F3-1 兼容 / 确定性红线
- **Alternatives considered**：A chosen；B rejected（第二份映射真源 → 漂移掏空审核意义）；
  C rejected（hash 无产出方 + 手动挂载易错）——C 的手动挂载保留为 spike 失败退化路径
- **Why chosen**：预览与成片共用同一映射与消解路径（用户在 Studio 看到的就是会渲出来的）；
  闸机制零新概念（D3-a 同构扩展）；hash 防漂移把「确认」钉在具体 storyboard 版本上
- **Consequences**：render.ts 映射段外移（一次性重构，字节级判据护航）；06-review 从「只放
  confirmed.json」变为有产物目录；must_review 从「建议看片」升级为「不看不能渲」（用户明确要求）；
  无 must_review 的 job 行为零变化
- **Follow-ups**：studio `--props` spike（第一件事）；`review --confirm` 辅助命令（实施时按体验定）；
  P1-b skill 增补（MotionSpec 生成流程，另出 plan）；扩语法候选（SpecEase back/elastic、svg 图元）进 backlog

## Review trail

- Planner draft v1：Option A/B/C 三案，A favored（映射抽取 + 闸扩展 + hash）；B/C 给出具体 invalidation
- Architect challenge v1：①steelman——resolveScene 双跑若非确定则预览失真 → 以「review/render 同 storyboard 逐字节一致」测试锁死（buildContext 每次从盘重建 + 纯函数，成立）；②tension——重构 render.ts 的回归风险 vs 复制漂移风险 → 字节级重构判据化解；③tension——闸严格度 vs 易用性 → 仅 must_review 硬闸（spec 已裁决）
- Critic verdict v1: APPROVED，附 3 条 reservations：
  ① 重构判据依赖 demo 快照新鲜度 → 已并入 Step 3（先重跑 demo 作基线）
  ② studio --props 未实测 → 已提为 Step 1 spike（先于一切实施）
  ③ hash 只覆盖 storyboard.json，regions.json 变化不在防护内 → 接受（validate --force 流程已要求重跑），review 输出附带上游 mTime 提示
- Final iterations: 1 / 3
