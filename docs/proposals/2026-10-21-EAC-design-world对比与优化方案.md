# EAC design world 调研 × VideoPipeline 对比与优化方案

> 调研对象：`Ebony-Vinyl/EAC-design-world`
> 数据截止：commit `370eb4f`（2026-10-18，README 标注 v0.4.0 开发预览版）
> 调研方式：浅克隆源码 + 文档/目录/测试静态审阅 + catalog 统计；**未运行其完整媒体流程**
> （需 FFmpeg / Edge / Windows SAPI / 本地转录模型，且仓库未安装依赖）
> 对比基线：本地 `VideoPipeline` main @ `20457b5`（2026-10-21，691 项测试全过）
>
> 🟢 **实施状态（2026-10-27 更新，详见 §十一）**：**P0 四项全落地；P1-2 / P1-3 / P1-4 全部落地；P1-1 裁决不做**
> （P0-1/P0-2 于 10-22；P0-3/P0-4 于 10-26；P1-2 于 10-26；P1-3 三个手法于 10-27；P1-4 于 10-27；
> P1-1 于 10-27 由用户裁决不做）。
> ⚠️ **P1-3 是改道落地的**：原方案「导入 5–8 个 Shotcraft 组件」被废置（撞「借手法不抄代码」纪律），
> 改为「读手法文档 → 自己重写」，产出 3 个自研模板（marker-underline / outline-fill / gradient-sweep）。
> **P1-4 的 pack 内容自建**（未导 OpenDesign，理由见 §11.1 对应行）；P2-1~P2-4 为探索项，触发条件未到。
> 🔴 **P1-1 不做的理由**：本项目**本身就是 skill 管线**（`SKILL.md` + `npm run pipeline` 即工具层），
> 再建 MCP server 只会形成「CLI / MCP 双入口」，两套参数与错误语义必然漂移。
> 若是将来出现**非 WorkBuddy 的 MCP 客户端**，再按需薄封装，不要提前建。

---

## 一、结论摘要

**EAC design world 不是我们的同类竞品，而是“AI 自主视频制作工作台”。**
它把录制、剪辑、配音、配乐、字幕、动效模板、设计成品和 MCP 工具面串成一条从零创作的生产线；
我们做的是**在已拍摄、已粗剪的口播视频上叠加动效**这一个垂直环节。

它的真正可取之处不在“动效算法”，而在**外围工程与产品化**：

1. **内容目录化**：865 项内容、517 个模板条目、152 套设计体系、150 个 Shotcraft 镜头，
   每条都带 `renderable / status / requirements / license / provenance`，不把“索引到”伪装成“能渲染”。[cite:7][cite:8][cite:9][cite:10]
2. **预览与选择 UX**：模板卡片、真实视频/源码预览、搜索筛选、选片单、右侧画布，
   用户不必先渲染成片才知道模板长什么样。[cite:12]
3. **AI 工具面**：14 个 MCP/宿主工具，覆盖状态、项目、素材、时间线、任务、库读取、设计成品；
   模型通过结构化工具操作，而不是拼 shell。[cite:6]
4. **长任务与修订机制**：持久化任务队列、取消、崩溃恢复、`expectedRevision` 乐观锁、
   不可变设计修订。[cite:4][cite:5]
5. **媒体 QA**：全解码、时长、黑场、静帧、音频静音/近满刻度检查，技术质检与艺术评审明确分开。[cite:11]
6. **配方卡文档**：Shotcraft 的每个镜头都有 `一句话 / 适用 / 时长 / 能量 / 参数表 / 已知坑`，
   这种“可被模型直接消费的动效说明”正是我们 MotionSpec 目前缺的一层。[cite:9]

**我们的护城河没有变**：口播主体感知、遮挡预算、载体退让、SRT/词级字幕、18 项构建期校验、
阶段不可变快照、真实素材端到端确定性。这些在 EAC 的代码与文档中**未发现等价实现**。

**建议策略：守住内核，补齐外围。** 不扩产品边界，优先借它的 4 个工程机制
（模板目录/预览、MCP 工具面、任务队列、媒体 QA）和 1 个内容来源（Apache-2.0 的 Shotcraft Remotion 镜头）。

---

## 二、调研对象与方法

### 2.1 规模与构成

| 项 | EAC design world | VideoPipeline |
|---|---|---|
| 源码行数 | `src/` 约 5,840 行（`.mjs`） | `src/` 约 14,560 行（`.ts/.tsx`） |
| UI | `ui/` 约 2,924 行 React | 无独立 UI |
| 测试 | 27 个测试文件、约 214 个 `test()` | 41 个测试文件、691 项 |
| 运行时 | Node 22、Playwright/Edge、FFmpeg、React | Node 22.19+、Remotion 4.0.534、FFmpeg、whisper.cpp |
| 许可 | AGPL-3.0；内置内容各自许可 | MIT |

### 2.2 证据边界

- 本文所有 EAC 行为结论均来自源码与文档，引用到具体文件/行；**未实测其运行期性能**。
- “EAC 没有某能力”统一表述为“**在 src/docs 中未发现等价实现**”，属于证据缺失，不等于绝对不存在。
- 模板与内容数量来自其 `catalog.json` 统计，不代表每个条目都可离线渲染；
  README 自己明确说明“模板数量代表可检索内容，不代表每个模板均可离线直接渲染”。[cite:1]

---

## 三、EAC 是什么

### 3.1 定位与入口

EAC 是 DeepSeek Harness 的本地视频制作与设计工作室，也可独立运行：

```text
Harness 对话 / 设置 / 右侧画布
        │
   plugin/client + host
        │
   本地 HTTP 服务 + MCP
        │
项目存储 · 修订 · 任务队列
   ┌────┴────┐
FFmpeg/Playwright   设计成品存储
录制/剪辑/混音/编码   HTML/SVG/MD 预览/历史/导出
```

它面向“从零做一条视频/一份设计”，不是“给已有口播加 overlay”。[cite:1][cite:2]

### 3.2 内容库：规模大，但诚实标注可渲染性

OpenDesign 本地索引共 865 项：

| 内容 | 数量 |
|---|---:|
| 设计体系 | 152 |
| 模板条目 | 517 |
| 创作技能 | 169 |
| 基础组件 | 13 |
| 场景 | 14 |

517 个模板条目中：`source-ready` 303、`external-generation-required` 205、`reference-only` 9。[cite:10]

另有 Shotcraft 本地快照：**150 个镜头、124 条配方、59 个精选**，按 10 类动效组织；
镜头源码是 Remotion React/TSX，**不是**可直接喂给 HTML 渲染器的 `renderAt(t)` 页面。[cite:8][cite:9]

关键工程判断在 `catalog.mjs`：

- 只有含真实 HTML/SVG 源文件的条目才 `renderable`；
- prompt-only / example-only / external-generation 一律标记不可渲染；
- motion 条目还检查占位符与 HyperFrames 子合成依赖；
- 缺失依赖时明确报错，不伪造成功。[cite:7]

### 3.3 确定性渲染契约

EAC 的 HTML/动效模板契约不是 Remotion，而是浏览器可 seek：

- `window.renderAt(t)` 或 `window.__seek(t)`；
- 字体就绪后 `window.__ready = true`；
- 兼容 `window.__timelines`（对象/数组/Map）与 `data-duration`；
- 没有 `renderAt` 时回退到 `__timelines.*.seek(t)`；
- CSS 动画可被暂停并设置 `currentTime`。[cite:3]

渲染是 **Playwright/Edge 逐帧截图 → JPEG 序列 → ffmpeg 编码**，并在中点重复渲染两次做确定性抽检；
像素差超过阈值就保存两张对比帧并报错。[cite:3]

### 3.4 任务队列、修订与崩溃恢复

- `state.json` 持久化 projects/jobs/settings；
- 启动时把 `running/queued` 任务标成 `failed`，错误写明“制作进程已中断”；
- `pump()` 串行消费队列，`AbortController` 支持取消；
- `updateProject(id, fn, expectedRevision)` 做乐观锁，版本不一致拒绝写入。[cite:4][cite:5]

### 3.5 AI/MCP 工具面

工具清单（宿主侧加 `eac_` 前缀）：

`status`、`project_create/get`、`asset_import`、`timeline_plan`、`timeline_update`、
`job_submit/status/cancel`、`template_read`、`library_read`、
`design_project_create`、`design_artifact_save`、`design_state`、`library_list`。[cite:6]

这套工具面把“模型要做什么”变成了可校验的参数，而不是靠模型拼命令行；
同时把“不可用能力必须报告、不得虚构”写进工具描述和 production instructions。[cite:6]

### 3.6 媒体 QA

`qualityCheck()` 做：

- 全解码（`ffmpeg -f null`）；
- 时长与期望值比对（容差 ≥ 0.15s）；
- `blackdetect` 黑场、`freezedetect` 静帧；
- 音频峰值过低/接近满刻度告警；
- 输出 `errors` / `warnings`，内容告警不阻断。[cite:11]

### 3.7 它明确不做的

- 不嵌入 OpenDesign 全部 Electron/HyperFrames/插件市场；
- PPTX 导出是整页图像，不是逐元素可编辑；
- 桌面录制与 SAPI 旁白仅 Windows；
- 大量模板依赖 Blender 预渲染帧、字体、外部生成服务或子合成运行时；
- 可选 Motion Web / Onetake 库是非商业许可，不随发布包分发。[cite:1]

---

## 四、两者对比

### 4.1 定位差异

| 维度 | VideoPipeline | EAC design world |
|---|---|---|
| 起点 | 已拍摄、已粗剪、无文字无特效的口播视频 | 任意素材 / 现场录制 / 从零创作 |
| 核心问题 | 动效**放哪里、压不压主体、何时出现** | **如何把一条片子从 0 做出来** |
| 输出 | 叠加动效的成片 | 成片 + 工程 + 设计成品 + 检查报告 |
| 用户 | 口播创作者 / 后期 | 产品宣传片、设计、批量内容 |
| 产品形态 | CLI + 阶段目录 + SKILL | 插件 + 本地工作台 + UI + MCP |

**结论：两者是“垂直引擎”与“横向工作台”的关系，正面替代性很低。**

### 4.2 能力矩阵

评分为工程判断（1–5，5 最强），同一维度同一口径；不是基准测试。

| 维度 | VideoPipeline | EAC | 依据 |
|---|---:|---:|---|
| 口播叠加专用性 | **5** | 2 | 我们的输入/契约/校验全部围绕口播 overlay；EAC 是通用制作 |
| 主体感知与遮挡控制 | **5** | 1 | 我们有 face/handheld/broll 三通道、遮挡预算、载体退让、可见比；EAC 的 src/docs 未发现等价实现 |
| 动效模板数量 | 2 | **5** | 我们 9 个手写 + 8 个 spec；EAC 150 Shotcraft + 17 视频模板 + 79 motion 条目 |
| 模板可发现性/预览 | 1 | **5** | 我们只能渲染后看；EAC 有模板卡片、视频/源码预览、筛选、选片单 |
| 确定性 | **5** | 4 | 我们结构性禁止随机/时钟 + 691 项测试；EAC 有运行时单点抽检 |
| 构建期校验强度 | **5** | 2 | 我们 18 项 + 2 条 extra + 27 个错误码；EAC 以目录就绪性/媒体 QA 为主，未见等价 JSON 契约校验 |
| 字幕与词级时间 | **5** | 3 | 我们 SRT 权威、word/cue 锚点、逐词高亮、静音检测；EAC 是转录→SRT→ASS 烧录与时间线重映射 |
| AI 可操作性 | 2 | **5** | 我们 CLI + SKILL；EAC 14 个结构化工具 + MCP |
| 长任务编排 | 2 | 4 | 我们阶段快照 + mTime 时序守卫；EAC 持久队列/取消/崩溃恢复 |
| 修订与并发保护 | 2 | 4 | 我们 motionboard 可编辑但无 revision；EAC `expectedRevision` 乐观锁 |
| 媒体 QA | 3 | 4 | 我们有 render-report/ffprobe/人工抽帧；EAC 自动化黑场/静帧/音频检查 |
| 迭代/预览成本 | 1 | **5** | 我们改 motionboard 后往往要重渲 20 分钟；EAC 先看模板预览再决定 |
| 内容库/许可治理 | 1 | **5** | 我们没有 catalog/provenance；EAC 每条带 license/source/revision |
| 输出广度 | 2 | **5** | 我们只出 MP4；EAC 还有 HTML/SVG/MD、PDF/PNG/PPTX |
| 工程复杂度/可维护性 | **4** | 2 | 我们边界窄、依赖少；EAC 5.8k 后端 + UI + 多宿主/多库/多许可 |
| 许可宽松度 | **5** | 2 | 我们 MIT；EAC AGPL + 混合内容许可 |

### 4.3 架构差异

| 环节 | VideoPipeline | EAC |
|---|---|---|
| 时间基准 | 帧 + SRT + 词级锚点 | 秒制时间线 + 素材入点 |
| 动效表达 | TSX 组件 / MotionSpec JSON | HTML `renderAt(t)` / Remotion TSX / OpenDesign 模板 |
| 渲染 | Remotion 4.0.534，锁版本，`--gl=angle` | Playwright/Edge 逐帧截图 + ffmpeg |
| 阶段产物 | 不可变目录快照（00–06） | `state.json` + 项目/任务/修订 |
| 校验 | 18 项纯 JSON→JSON + 错误码 | 目录就绪性 + 媒体 QA + 人工评审 |
| 模型接口 | SKILL 文档 + CLI | SKILL/工具描述 + MCP/宿主工具 |
| 预览 | `render --dry-run` / 成片后抽帧 | 模板预览器 + 右侧画布 + 时间线编辑器 |

### 4.4 各自优缺点

**EAC 的优点（值得借）**

- 内容目录化与“可渲染性诚实标注”；
- 模板预览/选择/选片单的产品化；
- MCP 工具面把 AI 操作变成结构化调用；
- 长任务队列、取消、崩溃恢复、修订锁；
- 媒体 QA 自动化；
- 配方卡式动效文档；
- 明确区分“技术质检”与“艺术评审”。

**EAC 的弱点（不要照搬）**

- 广而浅：录制/剪辑/配音/配乐/设计/动效都做，但垂直深度有限；
- 逐帧截图渲染对长视频不经济；
- 大量模板需要外部生成、Blender 资产、字体或子合成运行时；
- 未见口播主体感知与遮挡避让；
- AGPL 与混合许可增加复用成本；
- 代码面/依赖面大，维护成本高。

**我们的优点（要守住）**

- 主体感知与遮挡预算；
- 载体退让与影子载体轨；
- SRT 权威、词级/句级锚点、逐词高亮；
- 18 项构建期校验与错误码；
- 阶段不可变快照与确定性红线；
- 691 项测试 + 真实素材端到端。

**我们的弱点（要补）**

- 模板只有 17 个可用形态，视觉词汇少；
- 用户/模型看不到模板长什么样，只能“盲写 → 重渲”；
- 没有 MCP/工具面，模型只能拼 CLI；
- 长任务无状态/取消/恢复；
- motionboard 可编辑但无版本/哈希保护；
- 媒体 QA 仍靠人工抽帧；
- 没有 catalog/provenance，未来引入外部模板会失控。

---

## 五、可借鉴的七个机制

| # | EAC 机制 | 我们的映射点 | 价值 | 工作量 |
|---|---|---|---|---|
| 1 | 内容 catalog + `renderable/status/requirements` | `templates/builtin.ts` + `templates/specs/*` 生成 catalog | 让模型/用户知道“有什么、能不能用” | 低 |
| 2 | 模板预览器 | Remotion `renderStill` 生成三帧联系表 | 消灭“盲写 JSON” | 低–中 |
| 3 | MCP/工具面 | 现有 CLI 外包一层 MCP server | 模型可靠操作 | 中 |
| 4 | 持久任务队列 | `jobs/<job>/pipeline-state.json` + status/cancel/resume | 长任务可观测、可中断 | 中 |
| 5 | 媒体 QA | `render-report.json` 增加解码/黑场/静帧/音频检查 | 出片可信 | 低 |
| 6 | 配方卡文档 | `templates/specs/*.md` 或 spec `_doc` 字段 | 模型会选、会用、不误用 | 低 |
| 7 | 设计体系/令牌 | `styles/packs/*.json` 样式包 | 扩视觉风格但不放开任意色值 | 中 |

补充可选项：EAC 的 `renderAt(t)`/`__timelines` 契约可作为未来“外部 HTML 模板适配器”的参考，
但不应成为主渲染路径；我们的 Remotion 内核更适合长视频。

---

## 六、优化方案（按优先级）

### P0 · 先让“选择”和“验收”可见

#### P0-1 模板目录 + 预览画廊

**问题**：现在 17 个模板形态只存在于代码和 SKILL 文本里；用户改 motionboard 时无法预览，
只能等一次完整渲染。PROGRESS 也把“没有 storyboard 编辑 UI”列为高优先级痛点。

**做法**

1. 新增 `templates/catalog.json`（或由脚本从 `builtin.ts` + `specs/*.json` 生成）：
   `id / family / scope / description / tags / params / minVisibleInFrames / previewFrames / status / license / provenance`。
2. 新增 `tools/build-template-gallery.mts`：
   - 用 Remotion `renderStill` 对每个模板在 **入场 / 中段 / 收尾** 三个时间点各渲一张；
   - 用示例参数（复用 `examples/demo` 或 `tools/template-fixtures.ts`）；
   - 输出 `out/template-gallery/<id>-<t>.png` 与离线 `gallery.html`（卡片 + 三帧 + scope/params）。
3. 新增 `npm run templates:gallery`。
4. catalog 成为 SKILL 与未来 MCP 的**唯一模板查询源**，避免模型从文档里背模板表。

**涉及**：`src/templates/builtin.ts`、`templates/specs/`、`src/cli.ts`、`tools/`、`docs/wiki/06-模板体系.md`。

**验收**

- 17 个模板全部有 3 帧预览，无 Placeholder；
- `gallery.html` 离线可开；
- catalog 中每个 `id` 都能通过 `assertRegistryValid()`；
- 两次生成的文件名/顺序稳定（内容可允许 GPU 微差）。

**风险**：示例参数需要逐模板准备；先做“每模板一组固定夹具”，不追求覆盖所有参数组合。

---

#### P0-2 渲染 QA + 联系表

**问题**：`render-report.json` 目前记录墙钟/尺寸/帧数，但没有自动判断“黑场/静帧/音频异常”；
真实素材出片仍靠人工抽帧。EAC 的 `qualityCheck` 正好补这一层。

**做法**

1. 新增 `src/core/media-qa.ts`（或 `tools/media-qa.mts`）：
   - 全解码；
   - 时长与 `durationInFrames/fps` 比对；
   - `blackdetect=d=0.25:pix_th=0.10`；
   - `freezedetect=n=-50dB:d=1`；
   - 音频 `volumedetect` / 峰值；
   - 失败只报 `warning`，解码/时长错误报 `error`。
2. `render` 完成后调用，写入 `render-report.json.qa = {errors, warnings, blackSegments, frozenSegments, audio}`。
3. 用 ffmpeg 在 9 个等距时间点抽帧生成 `05-render/contact-sheet.jpg`，供人工/多模态模型审查。

**涉及**：`src/stages/render.ts`、`src/core/media-qa.ts`、`tools/`、`docs/wiki/03-数据契约与目录产物.md`。

**验收**

- 正常成片 `qa.errors=[]`；
- 人为截断/黑场输入能被检出；
- contact sheet 始终产出，失败不阻断渲染但写 warning。

---

#### P0-3 MotionSpec 配方卡 + 目录标签

**问题**：我们的 spec 只有 `_note`；模型选模板时只看到 id，不知道“适用场景、能量、参数手感、已知坑”。
Shotcraft 的配方卡（`一句话 / 适用 / 时长 / 能量 / 参数表 / 已知坑`）是可直接借用的文档结构。[cite:9]

**做法**

1. 为每个 `templates/specs/*.json` 增加 `_doc`：
   ```jsonc
   "_doc": {
     "一句话": "…",
     "适用": ["强调数字", "结论句"],
     "能量": "中高",
     "参数表": [{ "参数": "sizePx", "典型值": 56, "手感": "…" }],
     "已知坑": ["空格需 nowrap", "长句需 fitScale"]
   }
   ```
   或使用同名 `.md` sidecar；若用 JSON，`validateMotionSpec` 需允许该键并做只读校验。
2. `build-template-gallery` 把 `_doc` 渲染进 gallery 卡片。
3. 更新 `.workbuddy/skills/storyboard/SKILL.md`：要求模型先按 `适用/能量` 选 intent，再读配方卡。

**验收**

- 8 个 spec 全部有配方卡；
- `npm test` 不回归；
- demo 的 motionboard 选择不因新增字段被 `assertMotionboardKeys` 误拒（`_doc` 属 spec 文件，不进 motionboard）。

---

#### P0-4 motionboard 哈希/修订守卫

**问题**：motionboard.json 现在是唯一可编辑意图层，但管线没有“这份绑定基于哪一版输入”的记录；
模型/人在渲染期间改写文件，可能产生“报告说通过、产物对不上”。

**做法**

1. `bind-report.json` 记录 `inputs: { motionboardHash, wordsHash, cuesHash, srtHash }`。
2. `storyboard.meta` 写入 `inputsHash`；`validate` 的 `assertStageOrderIsSane` 增加 hash 比对（保留 mTime 作为兜底）。
3. 可选 `revision` 字段：motionboard 顶层 `meta.revision`，绑定器写入 bind-report；重跑时若 revision 变小则拒绝。

**验收**

- 绑定后修改 motionboard 再 validate → 明确报“输入已变更，请重跑 storyboard”；
- `--force` 可显式覆盖；
- 现有 demo/e2e 不误伤。

---

### P1 · 让模型与长任务可靠

#### P1-1 MCP 工具层

> ⛔ **2026-10-27 裁决：不做。**
> 本项目**本身就是 skill 管线** —— 模型通过 `SKILL.md` 学习、通过 `npm run pipeline -- <stage>` 执行，
> 这就是既有的工具层。本节列的 9 个工具全部已有 CLI 对应（见 §11.1 的 P1-1 行）。
> 再加一层 stdio MCP server 会形成「CLI / MCP 双入口」：两套参数与错误语义，漂移了没人管，
> 而收益只是把「拼命令」换成「结构化调用」。
> 真正要补的是**可发现性**，落点是 SKILL.md（已补 `verify` / `determinism` / `status`·`cancel`·`resume`）。
> 以下原文保留，作为「若将来出现非 WorkBuddy 的 MCP 客户端」时的参考实现。

**问题**：模型现在读 SKILL、拼 `npm run pipeline -- ...`，再解析 stdout/日志；失败模式多、不可发现。

**做法**

新增 `src/mcp/server.ts`（或 `tools/mcp-server.mts`），stdio 模式，包一层现有 CLI/核心函数：

- `pipeline_status(job)`：阶段产物/时间戳/门控/最近报告；
- `templates_list()` / `template_read(id)`：读 catalog + 声明 + spec；
- `motionboard_get(job)` / `motionboard_put(job, content, revision)`：唯一可编辑意图层；
- `validate(job)`：返回结构化 report；
- `render_submit(job, options)` → job_id；`render_status(job_id)` / `render_cancel(job_id)`；
- `placeholders_list()` / `doctor()`。

工具描述必须写明：**不可用能力要报告、不得伪造产物、完成不等于艺术通过**（借 EAC 的 production instructions 姿态）。[cite:6]

**涉及**：`package.json` 新增 `@modelcontextprotocol/sdk`；`src/mcp/`；`docs/SETUP.md`。

**验收**

- MCP 客户端能列出 17 个模板、读 spec、提交 render、轮询终态；
- 不改变 CLI 行为；MCP 只是薄封装；
- 所有写操作默认限制在 `jobs/<job>/` 内。

---

#### P1-2 任务队列 / 状态 / 取消 / 恢复

**问题**：align 约 14–28 分钟、render 约 20–22 分钟；现在进程被杀后只能看日志，没有“当前到哪、能否取消/续跑”的结构化状态。

**做法**

1. `jobs/<job>/pipeline-state.json`：
   `{ stages: { align: {status, startedAt, finishedAt, exitCode, logPath, pid}, ... } }`。
2. 启动时把 `running` 标为 `failed`（崩溃恢复），与阶段快照的“已存在则跳过”配合。
3. `pipeline status/cancel/resume`：
   - `cancel` 对子进程发 abort；
   - `resume` 从第一个未完成阶段继续。
4. `align`/`render` 的 `spawnSync` 改为可中断的 `spawn` + 日志落盘。

**验收**

- kill 进程后 `status` 显示 failed 与最后阶段；
- `cancel` 能停止 ffmpeg/Remotion；
- `resume` 不重跑已完成阶段；
- 不破坏 `--force` 语义。

---

#### P1-3 精选 Shotcraft 镜头导入

> 🔴 **2026-10-27 裁决：走「借手法，不抄代码」路线。**
> 本节原文的「适配层 + 导入 5–8 个组件」**废置** —— 它与 2026-10-14 计划里已定的纪律
> 「**借手法，不抄代码**」直接冲突（把它的组件包进 `TemplateProps` 就是复制 + 修改代码），
> 且会同时引入 Apache-2.0 的署名/修改声明义务与「自研 22 个模板 vs 外来 8 个」的风格割裂。
>
> **新方向：Shotcraft 是研究材料，不是代码来源。**
>
> | 借（合法且要做的） | 不借（碰都不要碰） |
> |---|---|
> | 缓动曲线与**时值配比**（入场几帧、停留几帧、退场几帧） | 任何 `.tsx` 源码、组件签名、props 结构 |
> | 组件拆分方式、层级组织 | 硬编码色值、字体、`assets/` 里的任何素材（含音频，那是 Mixkit 另授权） |
> | 参数手感（哪些参数值得暴露、取值范围） | 品牌页面 / 示例内容 |
> | **配方卡的文档结构**（一句话/适用/时长/能量/参数表/已知坑，可直接学） | 它的 catalog/recipe 数据结构本身 |
>
> **产出形态**：先出手法卡片（一句话 / 借用点 / 我们的落点 / 差异说明），
> 再按我们的 `MotionSpec` 或 `.tsx` 契约**重写**；来源登记进 ATTRIBUTION（只登记"参考了哪个文件、
> 借了什么手法"，不复制内容）。
> **许可结论：不产生 Apache-2.0 义务**（未复制代码），但 ATTRIBUTION 登记仍是硬要求 ——
> 这是学术诚实，不是法律义务。
>
> **验收改为**：至少 3 个手法落地为自研模板，且每个都有配方卡与"与参考来源的差异"说明；
> 不要求 `vendor/shotcraft/LICENSE`（不 vendor 任何代码）。
>
> 以下原文保留，作为「若将来用户改判为允许复制代码」时的参考。

**问题**：我们只有 17 个模板形态，视觉重复度高。Shotcraft 是 **Apache-2.0 + Remotion TSX**，
与我们的技术栈和许可都兼容，是成本最低的扩词汇路径。[cite:8][cite:9]

**做法（分两步，不一次性导入 150 个）**

1. **适配层**：新增 `src/templates/shotcraft/` + `shotcraft-adapter.tsx`：
   - 把 Shotcraft 的 `1920×1080` 绝对坐标组件包进我们的 `TemplateProps`；
   - 按 `scope` 选择：全屏构图 → `fullscreen`；局部文本/数据卡 → `overlay-safe` + footprint 缩放；
   - `params` 映射到我们的 schema；颜色优先映射到令牌，保留其 recipe 中的品牌槽位作为 `style` 参数。
2. **精选首批 5–8 个**：优先 `文字与字卡`、`数据与指标`、`界面登场` 中不依赖品牌素材的镜头；
   避免 3D/Blender、品牌页面、外部素材依赖。
3. **许可与溯源**：`vendor/shotcraft/LICENSE`、`ATTRIBUTION.md`、`catalog.json` 逐条记录
   `sourceUrl / revision / license / author`；NOTICE 更新。

**验收**

- 至少 3 个镜头在 `examples/demo` 与一次真实素材 e2e 中渲染成功；
- 每个导入模板有 footprint/scope/params/配方卡；
- `npm test` 增加适配层测试；许可文件齐全。

**风险**

- 全屏构图不适合 overlay-safe，必须先分类；
- 组件内可能有硬编码色值/字体，需要令牌化或明确列为模板自有视觉；
- 不能把 Shotcraft 的“示例品牌页”直接当用户成片。

---

#### P1-4 样式包 / 设计令牌

**问题**：我们的 `COLOR` 是单一令牌集，视觉风格只有一套；但“禁止模型写颜色”是对的，不能放开。

**做法**

1. `styles/packs/*.json`：`colors / fonts / typeScale / radius / shadow / easing`。
2. `render` 阶段按 `source.json.stylePack` 或 `motionboard.meta.stylePack` 解析；
   `TemplateProps` 增加 `style`，组件从 `style.colors.brand` 等语义键取值。
3. 从 OpenDesign 的 152 套设计体系中**人工精选 6–10 套**（MIT 条目）转成 pack；
   不直接全量导入，避免不可控许可与风格噪声。[cite:10]
4. 校验层只允许 pack 内语义键，仍禁止 `#RRGGBB`。

**验收**

- 同一模板在两个 pack 下渲染出不同配色/字体，且 `validate` 通过；
- 未知 pack / 未知 token → ConfigError；
- 现有 demo 默认 pack 行为不变。

---

### P2 · 探索项（先验证再投入）

| 项 | 说明 | 触发条件 |
|---|---|---|
| P2-1 预览代理渲染 | `render --preview --range 10-20s --scale 0.5`，几分钟看到局部成片 | P0-1 仍不够时 |
| P2-2 外部 HTML 模板适配 | 把 `renderAt(t)`/`__seek(t)` 页面渲成 PNG 序列，作为 overlay 素材 | 需要 OpenDesign 动效且短时长 |
| P2-3 批量变体 | `--variants variants.csv`，一组数据渲多条 | 出现 A/B 或多平台需求 |
| P2-4 轻量 Web UI | 模板选择 + motionboard 表单编辑 + 预览，不做完整时间线 | P0-1/P1-1 稳定后 |

---

## 七、不建议照搬

| 项 | 原因 |
|---|---|
| 扩成“录制/配音/配乐/设计成品”全栈 | 与我们的垂直定位冲突，直接进入 EAC 的战场且无优势 |
| 让模型直接编辑 HTML/TSX 源码 | 违反“模型不写帧/坐标/颜色”的契约；可控性远低于 MotionSpec |
| 用 Playwright 逐帧截图做长视频主渲染 | 6667 帧 1080p60 的截图成本远高于 Remotion 并行渲染 |
| 全量导入 865 项内容 | 205 项需外部生成、9 项仅参考；大量条目不可离线渲染，只会制造“看起来很多”的假象 |
| 复制 EAC 的 AGPL 代码 | 与 MIT 许可不兼容；只能借机制，不能抄实现 |
| 导入 Motion Web / Onetake 非商业库 | CC-BY-NC / PolyForm Noncommercial，商业使用需授权 |
| 用 JSON 文件做大规模项目存储 | 我们的阶段目录快照更简单；只需补 hash/revision，不需要换存储 |

---

## 八、验收与度量

建议用 6 个指标判断优化是否有效，而不是“功能做完了”：

| 指标 | 现状 | 目标 |
|---|---|---|
| 首次看到模板效果的成本 | 需完整渲染（约 20 分钟级） | 画廊静态预览秒级；代理预览分钟级 |
| 模板形态数量 | 9 手写 + 8 spec | 首批增加到 15+，且每个有预览/配方卡 |
| 出片自动 QA 覆盖 | 人工抽帧 | 解码/时长/黑场/静帧/音频自动检查 |
| 模型操作失败可诊断性 | 读 stdout/日志 | MCP 结构化错误与状态 |
| 长任务可恢复性 | 阶段已存在则跳过 | 显式 status/cancel/resume + 崩溃标记 |
| 外部内容引入治理 | 无 catalog/provenance | 每条带 license/source/revision，NOTICE 可查 |

**全局验收**：`npm run typecheck` 0、`npm test` 全绿、`examples/demo` 端到端通过、
一次真实素材 kukini 复跑 validate 0 error。

---

## 九、风险与许可

1. **许可**：EAC 主体 AGPL-3.0，不能复制其实现；Shotcraft Apache-2.0 可引入但需保留
   LICENSE/NOTICE/ATTRIBUTION；OpenDesign 按条目许可（示例条目 MIT），引入前逐条核对。
2. **确定性**：新增预览/QA/任务状态不得引入 `Date.now()`/随机数到渲染树；
   时间戳只能进报告，不进画面。
3. **范围蔓延**：P0 四项先做；P1 的 Shotcraft/样式包在 P0 验收后再启动，
   避免“模板多了但选择/验收仍不可用”。
4. **维护成本**：外部模板导入必须配套 catalog、许可与回归测试，否则会变成不可维护的 vendor 垃圾场。
5. **数据时效**：EAC 调研基于 2026-10-18 快照；若后续版本变化，需重新核对工具面与契约。

---

## 十、证据索引

| 编号 | 来源 | 说明 |
|---|---|---|
| [cite:1] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/README.md | 定位、功能一览、内容库数量、边界 |
| [cite:2] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/docs/architecture.md | 架构、确定性要求、质量目标 |
| [cite:3] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/src/render-template.mjs | `renderAt/__seek/__timelines/__ready`、逐帧截图、确定性抽检 |
| [cite:4] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/src/store.mjs | state.json、崩溃恢复、`expectedRevision` |
| [cite:5] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/src/engine.mjs | 任务队列 `pump()`、取消、produce 编排 |
| [cite:6] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/src/tools.mjs | 工具清单、参数 schema、production instructions |
| [cite:7] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/src/catalog.mjs | 模板可渲染性判定、workflow recipes |
| [cite:8] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/src/shotcraft-library.mjs | Shotcraft 本地 catalog 读取、只读资源 API |
| [cite:9] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/vendor/video-shotcraft/catalog.json | 150 shots / 124 recipes / 59 recommended、配方与许可字段 |
| [cite:10] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/vendor/open-design/catalog.json | 865 项内容、152 设计体系、517 模板条目、可渲染性统计 |
| [cite:11] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/src/media/index.mjs | `qualityCheck()`：解码/时长/黑场/静帧/音频 |
| [cite:12] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/ui/TemplatePickerGallery.jsx | 模板库搜索/筛选/分页/选片单/预览 |
| [cite:13] | https://github.com/Ebony-Vinyl/EAC-design-world/blob/370eb4fab632bf698f69a1328d1fcffccf2c3f99/tests/ | 27 个测试文件（单元/媒体/集成/UI） |
| [cite:14] | `PROGRESS.md`、`docs/wiki/01-08` | 本地管线的阶段、契约、校验、模板、测试现状 |
| [cite:15] | `src/templates/index.tsx`、`src/core/errors.ts`、`src/core/spec.ts` | 9 个实现映射、27 个错误码、MotionSpec 属性 |

> 注：本文的“评分”是工程判断，不是基准测试；EAC 的运行时性能、真实素材成功率和模板实际可用比例未实测。

---

## 十一、执行进度（2026-10-22）

### 11.1 状态总览

| 项 | 状态 | 产物 / 验证 |
|---|---|---|
| **P0-1 模板目录 + 预览画廊** | ✅ 2026-10-22（10-26 复核数字已涨） | `npm run templates:gallery` → `out/template-gallery/gallery.html` + **57 张 PNG**（19 实现 × 3 帧，10-24 模板补齐后从 51 涨上来）+ `catalog.json`；**19 已实现**（原记 17/2 已随 `pointer-callout`、`whip-pan` 落地变为 19/0）；`tests/template-gallery.test.ts` 7 项 |
| **P0-2 渲染 QA + 联系表** | ✅ 2026-10-22 | `src/core/media-qa.ts`；`render-report.json.qa`；`05-render/contact-sheet.jpg`；`tests/media-qa.test.ts` 11 项 |
| P0-3 MotionSpec 配方卡 + 目录标签 | ✅ **2026-10-26 落地** | `SpecDoc` 契约进 `templates/types.ts`（`summary/fits/energy/params/pitfalls`）；11 个内置模板在 `builtin.ts` 写卡、8 份基线 spec 加 `_doc`；`deriveDeclaration` 透传 → `decl.doc` → `gallery` 卡片与 `catalog.json`；`META.description` **已删**（避免与 `doc.summary` 双真源）；storyboard skill 增「先读配方卡再选型」；`canonicalSpecHash` 剥离 `_doc`（补卡不破签章）；`tests/doc-recipe.test.ts` 7 项 |
| P0-4 motionboard 哈希/修订守卫 | ✅ **2026-10-26 落地（hash 部分，未做 revision 乐观锁）** | `core/stage-inputs.ts` 为唯一实现（字节 sha256，与 `hashStoryboardFile` 同语义）；`bind-report.inputs` 记两子 hash、`storyboard.meta.inputsHash` 记合成值；`validate` 的 `assertInputsUnchanged` 对拍，不一致 → `ConfigError` 指向重跑命令；旧产物无该字段时**跳过**（向后兼容）；`tests/inputs-hash.test.ts` 7 项，其中一条用 `utimesSync` 证明「mTime 版放过、hash 版拦住」 |
| P1-1 MCP 工具层 | ⛔ **不做（用户裁决 2026-10-27）** | 🔴 **本项目本身就是 skill 管线**：能力经 `SKILL.md` + `npm run pipeline -- <stage>` 暴露给模型，不另建 MCP server。核对后方案列的 9 个工具**全部已有 CLI 对应**：`pipeline_status`→`pipeline status`（P1-2）、`templates_list`/`template_read`→`catalog.json`（P0-3 带 `doc`）+ `npm run templates:gallery`、`validate`→CLI、`render_submit`→`render`、`render_status`/`cancel`→P1-2、`placeholders_list`→`npm run placeholders`、`doctor`→`npm run doctor`。<br>再加一层 server 的代价是**双入口**（CLI 与 MCP 各一套参数与错误语义，漂移无人管），而收益仅是「结构化调用」；本项目真正的痛点其实是**可发现性**，已落 SKILL.md（新增 `verify` / `determinism` / `status`·`cancel`·`resume`）。<br>⚠️ 例外：将来若有**非 WorkBuddy 的 MCP 客户端**要接，再按需薄封装，**不要提前建** |
| P1-2 任务队列 / 状态 / 取消 / 恢复 | ✅ **2026-10-26 落地（有意偏离原方案，见下）** | `core/pipeline-state.ts`：状态落 `jobs/<id>/pipeline-state.json`（**job 根目录**，不进任何阶段快照）；原子写（`.tmp` + rename，防中途被杀留下截断 JSON）；崩溃恢复判据是 **runnerPid 是否存活**而非时间阈值。CLI 新增 `status` / `cancel` / `resume`（`src/cli-state.ts`），阶段调度统一走 `runTracked` 包状态记录。<br>🔴 **偏离原方案**：原文要求「把 `spawnSync` 改为可中断的 `spawn`」。核对代码后**没这么做** —— `cancel` 由**另一个进程**发起，只需 pid + `taskkill /T /F` 杀整棵树（ffmpeg/whisper/chrome 都是树的子孙）；改成 async spawn 要把 `align` 整条链同步→异步（波及 cli、测试、stdio 语义），收益为零。<br>`resume` **刻意停在 render 之前**（那一步须人工看片，P1-a 闸），自动续跑到 render 只会撞闸。`status` 对 P1-2 之前的老 job 标「有产物·无记录」（`◌`），避免误导重跑。<br>验证：`tests/pipeline-state.test.ts` 9 项 + 真实子进程实测 cancel（taskkill 回执中文正常、进程确已终止）。<br>⚠️ 顺带修：`taskkill` 回执的 **GBK 乱码**（同 render `outputTail` 那个坑）→ 解码上提为 `core/child-output.ts` 唯一实现 |
| P1-3 精选 Shotcraft 镜头导入 | 🔶 **改道（用户裁决 2026-10-27）：借手法，不抄代码** | 原「适配层 + 导入 5–8 个组件」**废置** —— 与 2026-10-14 的「借手法，不抄代码」纪律冲突（包组件 = 复制+修改代码），且引入 Apache-2.0 署名义务与风格割裂。<br>**新路径**：Shotcraft 仅作研究材料，借**时值配比 / 缓动 / 参数手感 / 配方卡文档结构**，不碰 `.tsx` 源码、色值、字体、`assets/`；产出为手法卡片 → 按我们的契约重写 → 来源登记 ATTRIBUTION。<br>**许可结论：不产生 Apache-2.0 义务**（未复制代码）；ATTRIBUTION 登记仍保留（学术诚实）。验收改为「≥3 个手法落地为自研模板 + 每个有配方卡与差异说明」，不再要求 vendor LICENSE |
| P1-4 样式包 / 设计令牌 | ✅ **2026-10-27 落地（pack 内容自建，未导外部）** | `core/style-pack.ts` + `styles/packs/{dark,light}.json`；job 在 `00-input/source.json` 写 `stylePack`（缺省 `dark`）；`render` 解析后写进 `render-props.json`，经 `Overlay → TrackSequence → TrackBody → MotionItem` 传到 `TemplateProps.style`；三个新模板已改为 `style.colors.brand` 取值。<br>🔴 **未知包名直接 ConfigError**（不静默回退——回退会把「包名打错」变成「配色莫名不对」）。<br>🔴 **pack 内容自建、未导 OpenDesign**：那 152 套是否逐条 MIT 未经核实（原文写的是筛选条件不是全集属性），且 SPEC §5.5 已明确「外部 layout / 主题 token 体系不采纳」。先自建 2 套把机制跑通，零许可风险。<br>验收三条全过：同一模板两 pack 渲出不同（白底实测：dark 白字金线 / light 深墨深橙）；未知包报错；demo 默认不变（dark 与改造前 `tokens.ts` **逐字一致**，有测试钉住） |

> 🔴 **2026-10-26 复核结论（本段同日三次更正）**：**P0 四项全部落地**
> （P0-1 / P0-2 于 10-22，P0-3 / P0-4 于 10-26）；**P1-2 任务队列已于 10-26 落地**。
> **P1-1 已裁决不做**（2026-10-27：本项目即 skill 管线，能力走 `SKILL.md` + CLI，不另建 server）；
> **P1-3 / P1-4 仍未开工**。
> P2-1~P2-4 是探索项（原文已写明触发条件），不计入欠账。
> ⇒ 本方案当前的真实状态是「**P0 完成 4/4；P1 落地 1、裁决不做 1、剩 2**」。
>
> ⚠️ **本段曾经写错**：P0-3 / P0-4 落地后只改了上表、漏改本段，导致「表格说 ✅、结论说未动」
> 并存了半天。提醒后来的读者：**状态表与结论文是同一份事实的两处表述，改一处必须改两处**
> （与「同一概念两个真源」同源，只是这次的真源缺陷在我自己手里）。

### 11.2 P0-1 实际落地

- **目录真源**：`src/templates/gallery.ts`（从注册表 + `isImplemented()` 派生），
  快照写到 `out/template-gallery/catalog.json` —— **不把生成物提交进仓库**，
  避免“代码改了、手抄的 catalog 没改”的第二真源。
- **预览合成**：`src/remotion/gallery/TemplateGallery.tsx` 只渲染一个 item，
  但走 `MotionItem` 主链；背景是固定合成底板 + 主体剪影。
- **采样点**：f6 / f45 / f72（90 帧 @30fps）。f6 能拍到入场过程，
  f72 能拍到退场开始；f12 时多数模板已落定，三张图会一样。
- **确定性**：两次生成 51 张图中 50 张 SHA-256 一致；
  `cinematic/punch-in` f72 仅 1/255 GPU 抖动（mean diff ≈ 5.6e-6、显著像素比 0）。
- **验证**：浏览器实测 17 张实现卡各 3 图、2 张未实现占位、无 console/网络错误；
  `npm run typecheck` 0；全量测试 43 文件 / 709 项全过。

### 11.3 P0-2 实际落地

- **实现**：`src/core/media-qa.ts` + `src/stages/render.ts` 渲染后调用。
- **判据**：全片解码、时长对账（容差 `max(0.15, 2/fps)`）、
  `blackdetect`、`freezedetect`、`volumedetect`、9 帧联系表。
- **阻断语义（裁决）**：QA 是**事后报告**，不阻断渲染；解码/时长不符记 error，
  黑场/静帧/音频异常/联系表失败记 warning，工具缺失记 unavailable。
  代价：真正损坏的成片不会自动让 stage 失败，需要人读报告或后续再接严格模式。
- **真实运行**：用 `examples/demo` 副本跑完整 render（30s）→
  时长 30.000s vs 预期 30.000s；检出 1 段黑场 + 1 段整片静帧（占位底，符合预期）；
  `contact-sheet.jpg` 正常产出。
- **环境**：本机 PATH 上的 WinGet ffmpeg shim 无法被 Node `spawnSync`（`EFTYPE`）。
  已支持 `FFMPEG_BIN` / `FFPROBE_BIN` 绝对路径覆盖；不配时 QA 只记 unavailable，不阻断。

### 11.4 下一步

✅ **P0 批次已收口（2026-10-26）**：P0-1 / P0-2 / P0-3 / P0-4 全部落地。
其中 P0-3 顺带结掉了「视觉资产库纳入计划书」的搁置项（配方卡与它原是同一件事）。

✅ **P1-2 任务队列已落地（2026-10-26）**：`pipeline status` / `cancel` / `resume` +
`jobs/<id>/pipeline-state.json`（细节见 §11.1 对应行）。

⛔ **P1-1 MCP 工具层：不做（2026-10-27 用户裁决）**。本项目本身就是 skill 管线 ——
`SKILL.md` 教模型怎么用、`npm run pipeline -- <stage>` 就是执行入口，
方案列的 9 个工具全部已有 CLI 对应。再建 server 会形成双入口，收益小于维护成本。
**替代路径**：把可发现性做进 SKILL.md（已补 `verify` / `determinism` / `status`·`cancel`·`resume`）。

✅ **P1-3 / P1-4 均已落地（2026-10-27）**：P1-3 三个手法（marker-underline / outline-fill /
gradient-sweep）全部实现；P1-4 样式包机制跑通（2 套自建 pack）。
④ **P1-4 的 pack 内容仍可扩张**：机制已就绪，加一套风格只需往 `styles/packs/` 放一个 JSON，
   不涉及代码改动。外部风格导入需先逐条核实许可。

> 🔴 2026-10-26 备注：`P0-4` 只做了 hash 守卫，**未做**方案里的 `meta.revision` 乐观锁。
> revision 要求人工/模型每次改稿手动递增，属额外纪律负担；hash 已能覆盖「改过没重跑」这个真实事故。
> 若要 revision，另立裁决。
