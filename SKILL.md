---
name: remotion-overlay-pipeline
description: >-
  在已拍摄、已粗剪、**没有任何文字与特效**的实拍口播视频上，叠加 motion-graphic overlay
  （字幕条 / 大字强调 / 数字卡 / 分屏 / 推近等），产出可直接发布的成片。
  当用户给出「口播视频 + 一份编辑好的 SRT」，想要字幕、动效、版式装饰时使用。
  本管线既可以由模型逐阶段操作（本文件就是给模型读的契约），
  也可以由内置生成器产出意图底稿（`motionboard.json`）；确定性底座（对齐/感知/烘焙/校验/渲染）不依赖特定模型。
  五阶段：align → perceive → storyboard → validate → render。
---

# Remotion Overlay Pipeline —— 编排层

> **这是入口。** 各阶段怎么做，看 `.workbuddy/skills/<stage>/SKILL.md`；
> 环境怎么装，看 `docs/SETUP.md`；为什么这么设计，看 `docs/decisions/OPEN-DECISIONS.md`。

## 什么时候用

✅ 用：实拍口播 + 人工校对过的 SRT，要在画面上加字幕/动效，且**没有剪辑软件时间线可操作**。
❌ 不用：需要换画面/重剪（这不管剪辑）；需要 AI 配音/数字人；素材里已烧字幕。

## 动手前必须确认的三件事

| 要确认 | 为什么 |
|---|---|
| **SRT 是用户编辑过的真值** | 文字权威归 SRT，时间由音频重新推导。SRT 不对，后面全错 |
| **素材是「已粗剪拼接、无任何文字」** | 管线只叠加，不改剪辑 |
| **`jobs/<id>/00-input/` 里放视频 + SRT，`source.json` 填好 fps 与 durationInFrames**（由 AI 实测生成，见下节） | 阶段目录是不可变快照，缺上游直接报错，不会猜 |

环境没装的先跑 `npm run doctor`，它一次说清缺什么。

### 新 job 引导：source.json 由 AI 实测生成

用户只放视频 + SRT，**从不手写 source.json**。AI 建立 job 时按固定四步执行：

| 步 | 动作 | 判据 |
|---|---|---|
| 1 | 扫描 `00-input/` | 视频、SRT **各恰好一份** → 直接进入第 2 步；多份或缺失 → **这是唯一提问点**，请用户指认哪个配哪个 |
| 2 | `ffprobe` 实测视频 | `fps`（r_frame_rate）、时长秒数、`width`/`height`；`durationInFrames = round(时长秒 × fps)`，若 ffprobe 给出 `nb_frames` 则交叉对账，不一致停下报告 |
| 3 | 写 `source.json` | 四个必填字段 + 分辨率（竖屏素材**建议**显式填 width/height，不填则 render 阶段 ffprobe 自动探测） |
| 4 | 向用户**报告实测值** | 「实测 30fps / 3337 帧 / 1920×1080，已写入」——报告事实，不是索要数据 |

**纪律**：
- 🔴 `fps` / `durationInFrames` **只能来自 ffprobe 实测**，禁止凭记忆、估算或「常见值」填写——它们是全管线时间轴的锚，填错则所有帧语义漂移
- 🔴 `source.json` 已存在时**不改写**（与「管线只读用户文件」同一精神）；只在缺失时生成
- 用户可手改 `source.json`；改了 `fps` ⇒ 全部已烘焙帧作废，须重跑 03 起的全部阶段

## 五阶段

```
00-input ──▶ 01-align ──▶ 02-perceive ──▶ 03-storyboard ──▶ 04-validate ──▶ 05-render
 素材       词级时间戳      主体区域         动效草案           构建期校验       成片
                                      （模型填表）                        └─ 有 error 必须停
```

| 阶段 | 命令 | 产物 | 谁来做 |
|---|---|---|---|
| `align` | `npm run pipeline -- align --job <id>` | `words.json`（词级时间戳）+ `align-report.json` | 机器（whisper + DP） |
| `perceive` | `npm run pipeline -- perceive --job <id>` | `shots.json` + `regions.json` | 机器（scdet + YuNet + 显著性） |
| `storyboard` | `npm run pipeline -- storyboard --job <id>` | `storyboard.json`（已烘焙成绝对帧） | **你** 写 `motionboard.json`（缺失时内置生成器产出意图底稿）；按 M-3 同时落盘**语义 pacing**（`meta.source:'semantic'`，判据写 reason） |
| `validate` | `npm run pipeline -- validate --job <id>` | `validate-report.json`（18 项 + 2 条 extra） | 机器 |
| `render` | `npm run pipeline -- render --job <id>` | `out.mp4` | 机器（Remotion） |

### 各阶段什么时候该停

- **`align` 门控不过**（`alignedRatio` / 均值置信度 / 低置信占比）→ 退出码 1。**不要绕过**：先查 SRT 与音频是否真的对得上。
- **`validate` 有 error** → 必须停，回 `storyboard` 改 `motionboard.json` 重跑。warning 不拦。
- **`render` 报 fullscreen 未确认** → 读 `06-review/confirmed.json` 的 `acknowledgedFullscreen`，这是人工闸，**不要替用户填**。

## 三条铁律（写在代码里，不靠自觉）

### 1. 帧是真相，你不写帧

只写**锚点**，烘焙器算帧：

```json
{ "anchor": "word:37", "offset": "-8f" }
```

| 锚点 | 含义 |
|---|---|
| `word:N` | 第 N 个词（`01-align/words.json` 的索引） |
| `cue:N` | 第 N 条 SRT 字幕（**字幕类优先用它**，时间取 SRT） |
| `abs:<帧>` 或 `abs:<秒s>` | 绝对位置 |

`offset` 负值 = 抢拍，合法（下界是锚定词所在 cue 的起点）。

### 2. 你只填表，不写样式

`motionboard.json` 里每条的 `params` 只填模板声明的键。**禁止**写坐标、帧号、颜色、CSS、`window`。
`window` 是校验期写入的系统字段，填了会被拒。

### 3. 确定性

禁 `Date.now()` / `Math.random()` / CSS animation。全树只有 `MotionItem` 读时钟。
你要"随机"效果时用固定的种子值。

## 创作期动效生成（无合适模板时）

库内模板绑不上时可以**生成新动效**。随机性关在创作期：生成与重掷自由（每次结果可以不同），
定稿入库后渲染期确定性红线一字不改。生成物是 **MotionSpec JSON**（声明式：图元 `elements`
+ 关键帧轨道 `tracks`），零 codegen、零渲染层改动。提案 §2/§4/§4.5：
`docs/proposals/2026-10-22-创作期动效生成与Studio审核闸.md`。

**三种触发**（给 motionboard 条目写 `genPrompt`，写作纪律见 storyboard skill）：

1. intent 绑不定 —— `bind-report.json` 的 `noFits` 记到的条目
2. 安全阀整批转 custom 的条目
3. 人工指定想要新动效

**流程（顺序固定，跳步不许入库）**：

| 步 | 动作 |
|---|---|
| 1 | 读该条目的 `genPrompt`。无 `genPrompt` 的 no-fit 条目**不生成**——维持 custom 人工逃生口（生成是增强，不是替换） |
| 2 | 按 spec 契约产 MotionSpec JSON：**语法内编排**——5 图元（≤4 elements）× 8 可动属性 × 5 缓动 × 令牌色，≤16KB；「每次不一样」来自编排差异。语法外需求（3D / 粒子 / 自定义路径）→ **诚实报告**并转 Tier 2（扩图元改 SpecRenderer，或写组件模板），🔴 禁硬编、禁伪装成 spec 能表达的形态 |
| 3 | 生成物**必须有贯穿 item 的动效**——三帧两两不等是验收门，只入场就定住的静态摆设过不了 |
| 4 | `npm run motion:accept -- <file>` 过六道验收：结构 / 注册（id/scope/layer/footprint 齐备）/ 画廊三帧非空白 / **动效真在动（三帧 markup 两两不等）** / 确定性 lint（零 `Date.now` / `Math.random` / `useFrame` / `animation:`）/ 签章。任一门失败 → 报因打回重掷，不入库、不可被引用 |
| 5 | 全过则工具自动把**带签章**的 spec 写入 `templates/specs/custom-<语义名>@<版本>.json`（文件名由完整 id 派生，升 @版本自动落新文件）。🔴 入库文件**不要手改**——spec-loader 对 `custom-*` 文件验签，缺签章或内容与 hash 不符直接 ConfigError 拒装载 |
| 6 | motionboard 该条目改 `motion` 钉死新模板（或 intent 指向它），重跑 `storyboard` → `validate` |

**id 与版本**：`custom/<语义名>@0.1` 起步，定稿升 `1.0`。**重掷 = 新版本文件**——入库文件名
由完整 id 派生（`custom-<语义名>@<版本>.json`），**升 @版本号即落新文件**：`@0.1` 与 `@0.2`
并存于 `templates/specs/`，已出片 job 引用的旧版本照常装载、永不失效。护栏由工具强制，
不是纪律：accept 对**同语义名同版本**、内容不同（canonical hash 不符）的入库目标**默认拒绝
覆写**并提示升版本，`--force` 可显式越过。

**为什么不在渲染时生成**：真素材渲染墙钟 20 分钟，反馈环不可接受；18 项校验全是结构判定，
对未知结构的生成物失明。生成物必须先过验收、成为库内可指认的模板，才允许被 motionboard 引用。

## 常见失败与处置

| 现象 | 多半是 | 做法 |
|---|---|---|
| `validate` 报 `E-C2-5-01` | 锚点落在词区间外 | 换锚点，别加 offset 硬凑 |
| `validate` 报 `W-C2-5-02`（密度，warning 不阻断） | 一个 cue 塞了太多条 | 拆到相邻 cue；⚠️ 该阈值仍是占位值（2026-10-24 起降级为 warning，见 C2-5b） |
| `validate` 报 `E-C4-01`（footprint 相交） | 两条同组动效时间重叠 | 错开或换不同组 |
| `validate` 报 `W-D2-01`（遮挡） | 叠加压到主体 | 已自动平移消解；仍超预算才需改 footprint |
| 字幕内容对但高亮不亮 | `words.json` 词时与 SRT 窗口偏离 >20% | 产物层已由 `M-1f` 按 SRT 窗口重铺；仍有残余偏差时（`M-1d` 告警档 2%、阻断线未校准），显示层兜底：宁可不高亮，不显示错句子 |
| 渲染全黑 | 视频没挂载，或素材开头本来就黑 | 抽单像素判断：容器底 `0,0,0` / 占位底 `16,20,24` |

## 两条操作纪律

- 🔴 **阶段目录语义不对称，别搞混**：`align` / `perceive` 已有产物即跳过（不可变快照）—— 改了这两个阶段的代码必须加 `--force`，否则你会白等十几分钟；`storyboard` / `validate` / `render` 没有跳过逻辑，每次重算（改它们无需 `--force`）。
- 🔴 **长任务别 `| tail`**：错误会被吞掉。重定向到日志文件再 `grep`。

## 数字从哪查（别凭记忆）

| 想知道 | 查 |
|---|---|
| 校验项 / 单测 / 模板实现数 / 成片基准 | `PROGRESS.md` §七 |
| 哪些阈值还是占位值、怎么校准 | `docs/decisions/PARAM-DECISIONS.md`（`npm run placeholders` 生成） |
| 某个"为什么这么设计" | `docs/decisions/OPEN-DECISIONS.md`（裁决唯一真源） |
| 还没解决的问题 | `PROGRESS.md` §四 / `OPEN-DECISIONS.md` 的 OPEN 清单 |
