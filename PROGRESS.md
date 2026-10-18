# 项目进度 — Remotion 视频动效叠加管线

> 最近更新：2026-10-18
> 状态标记：✅ 完成 / 🔶 进行中 / ⛔ 明确不做 / ❌ 未做

---

## 一句话

在**已拍摄、已粗剪拼接、无任何文字与特效**的实拍口播视频上，自动叠加
motion-graphic overlay。**2026-10-18：首次用真素材（kukini 1080p60 / 6667 帧 / 48 cue）
跑通全部五阶段并产出成片**（218MB，墙钟 ≈20 分钟）。过程中修掉三个渲染层阻塞 bug
（视频路径、载体轨裁剪视频、载体轨嵌套叠加时间偏移），并把**字幕的时间、文字、高亮
全部改为以用户编辑的 SRT 为准**（`C2-6`）。**模板真实实现 9/11**（余 `pointer-callout` / `whip-pan`）。
距「可直接发布」还差：对齐漂移的产物层修复（`M-1d` / `M-1e`）、占位值校准（8 个）、剩余 2 个模板。

---

## 二、用户第一次出片的路径（当前状态）

这是判断项目真实进展的唯一标准 —— 不是「代码写了多少」。

| 闸 | 状态 | 说明 |
|----|------|------|
| `00-input` 放素材 | ✅ | — |
| `01-align` 强制对齐 | ✅ | **两步全通**：whisper.cpp（时间）+ SRT（文字）+ 文本对齐 DP（`text-align.ts`）。kukini 实测 `alignedRatio=1.0`、均值置信度 0.9113、低置信 3.19%。⚠️ **已知缺陷**：whisper 会把跨静音的文本压进一个长分段（实测 8.39–15.13s 是 6.74 秒真静音，却被放进 9 个词），词时整体偏移最多 **7.06 秒**；字幕已不受影响（时间取 SRT），但**词级高亮**靠显示层重铺兜底（`M-1d` / `M-1e` 待决） |
| `02-perceive` 主体检测 | ✅ | **内置后端三通道齐备**：ffmpeg `scdet` 镜头切分 → YuNet 人脸（`face`）；人脸框外扩（`handheld`，不做物体检测——主物品是鞋子，而 COCO 80 类**没有 shoe**）；无脸镜头用经典显著性（`broll`），框不到即退让。抽帧**按帧号且每个 shot 至少 1 帧**。未配 `PERCEIVER_CMD` 也能跑。**三条真实素材**合计 77 shot（kukini 15 / 3月22日 29 / 5月28日 33），**0 低置信**（`real30` 尚未跑 perceive，不计入） |
| `03-storyboard` 起草 | ✅ | 管线通；模型只写 `motion` / `footprint` / `params`（禁写帧与坐标）。锚点支持 `word:N` / **`cue:N`（C2-6，字幕专用）** / `abs:`。kukini 实测：7 轨 / 55 条锚点 / 闸1 阈值 T=0.800 |
| `04-validate` 校验 | ✅ | **18 项**（+#18 载体变换后主体可见比）+ **2 条起草原生约束**；kukini 实测 **0 error / 11 warning**（demo 0 error / 2 warning）。tier1 平移消解、tier2 载体档均已真实施加 |
| `05-render` 渲染 | ✅ | 9 个模板有真实实现；**真素材成片已产出**（kukini 6667 帧 / 218MB / 墙钟 20–22 分钟）。通道方案 A 在画面上被证实：校验期平移的 footprint 确实改变了成片位置 |

**结论：六道闸全部打通，真素材可端到端出片。** 剩下的不是「能不能出」，而是
「字幕/对白精度、参数手感、剩下 2 个模板」这类**质量**问题。


---

## 三、已完成的功能

### 3.1 管线骨架（✅）

五阶段 `align → perceive → storyboard → validate → render`，统一 CLI 入口，
阶段目录为不可变快照（下游不得回写上游）。

- **烘焙器**：锚点 `{anchor:"word:37", offset:"-8f"}` → `fromFrame` + `durationInFrames`
- **调度**：两道闸串联 + 动态阈值 T + 安全阀 + 产路地板
- **校验器**：构建期 **18 项**（纯 JSON→JSON）+ **2 条起草原生约束**（记入 `summary.extra`：`W-D3-01` / `W-F6-01`）+ 渲染期兜底三类
- **单测**：**384 项全过**（23 文件：validate 41 / template-render 32 / carrier-window 30 / text-overflow 26 / text-align 26 / srt 22 / zh-normalize 21 / schedule 19 / caption 19 / yunet 17 / params 17 / split-frame 14 / shot-detect 14 / bake 14 / region-derive 12 / occlusion 11 / subject-visible 10 / carrier-contract 10 / align-gate 9 / perceive-sampling 6 / carrier 6 / dtw-unit 5 / whisper-path 3）

### 3.1.1 `01-align` 全通（✅ 2026-10-14）

**架构裁决（M-1 方案 b）**：文字权威归 SRT，时间戳由音频重新推导。

| 模块 | 作用 |
|------|------|
| `whisper-adapter.ts` | whisper.cpp 接入；`DTW_FRAME_MS = 10`（`t_dtw` 单位是 10ms 帧，非毫秒） |
| `text-align.ts` | **核心**：SRT cues + whisper segments → `words[]` + `alignedRatio` |
| `builtin-align.ts` | 内置对齐后端，补上「`ALIGNER_CMD` 外部脚本从没人写」的空缺 ⇒ `alignedRatio` 第一次是真实测量值 |
| `align.ts` | 后端选择：配 `ALIGNER_CMD` 走外部（向后兼容），否则走内置 |

**DP 打分公式**（三个坑全部被实测证伪，勿改回）：
```ts
const score = cur + sim;                    // 纯相似度，不加任何长度补偿
if (j < m && dp[i][j+1] < cur - 0.5) ...    // 跳过 segment 罚分 0.5
```
- ✅ 正确校准依据：正确匹配 0.655–1.000、**半句听漏的正确匹配 0.455**、错位匹配 ≤0.154 ⇒ 阈值 **0.35** 落空隙中央

**为什么必须做匹配而非纯均摊**：纯均摊会让 M-1c 门控失效 —— `alignedRatio` 无「匹配」动作则无从计算，门形同虚设。

**末段外溢**：whisper 末段标到 30960ms（超音频 960ms），须在**毫秒层**用 `maxEndMs` **压缩**（不是裁掉）⇒ 末词恰落 900 帧且 72 词一个不少。
⚠️ 直接夹帧会丢掉末段真实词条，且 `E-C6-01`（item 结束帧超 Composition）是项目**最高危**项，Remotion 会静默截断。

### 3.1.2 模板真实实现（✅ 2026-10-15 · D1 第一轮）

**病根不是"没写模板"，是"没有 id → 组件映射表"。**
`getTemplate()` 只返回**声明**（纯数据），从 `motion id` 到 React 组件之间一片空白，
于是所有 motion 渲染出**逐像素相同**的灰框。

🔴 **这类退化能逃过全部现有防线**：18 项校验是纯 JSON→JSON（不读渲染产物）、
typecheck 通过、原有 183 项单测无一断言渲染产物、成片能正常导出不报错。
⇒ **只有直接断言渲染输出的测试能兜住它**（已补，见下）。

| 层 | 文件 | 作用 |
|----|------|------|
| 令牌 | `remotion/tokens.ts` | **颜色的唯一来源**。P1 禁模型写颜色，若组件各自内联色值 = 令牌层零消费 + 换肤改 N 处 + "禁颜色"只禁了 params，等于自欺 |
| 字幕通道 | `remotion/caption.ts` | `01-align/words.json` → props → `karaoke-word`。**全树唯一的 SRT 文本入口** |
| 契约 | `remotion/templates/contract.tsx` | 组件统一 props；`frame` 作 prop 传入 |
| 实现 | `remotion/templates/<5 个>.tsx` | 首批 5 个 `overlay-safe` |
| 映射 | `remotion/templates/index.tsx` | `motion id → 组件` + 占位块 + 启动期自检 |

**已实现的 5 个**（`overlay-safe`，均不依赖 perceive）：

| 模板 | 形态 | 关键特征（须与同族肉眼可辨不同） |
|------|------|------|
| `caption/karaoke-word` | 底部字幕带 | 逐词高亮，说到哪个字哪个字变亮 |
| `typography/kinetic-line` | 中部大字 | 瞬时强调，4 种入场预设，带左侧竖条 |
| `typography/lower-third` | 左下横条 | 身份条，**贴左滑入**、双行、方角 |
| `typography/tag-float` | 右上胶囊 | 气泡，**上浮**、圆角、带尖角、单行 |
| `data/stat-card` | 数字卡片 | 大号数字 + 单位，**scale 落定** |

**两条设计决策**（有理由，非随手）：
1. **未实现 ≠ 画成别的**：落占位块 + `data-template-missing="1"`，
   视觉**故意做丑**（黄斜纹虚线框）。`validate` 不知道渲染层实现情况，
   这条信息只在成片里 ⇒ 必须显眼，不许伪装成已完成。
2. **`stat-card` 刻意不做 digit roll**：`value` 是字符串且校验项明确「不判语义」，
   渲染期**无从判断该不该滚、滚几位** ⇒ 没语义依据的动画就是猜。

**组件不调 `useCurrentFrame()`**：`frame` 由 `MotionItem` 作 prop 传入。
整个渲染树只读一次时钟 ⇒ ① 可直接 `renderToStaticMarkup` 单测、
② 能断言「不同帧产出不同 DOM」（"动效真在动"唯一可靠的自动化判据）、③ 纯函数。

**顺带补上的真缺口**：`karaoke-word` 刻意不吃 `params.text`（P1：字幕来自 SRT），
但渲染期**原本没有任何地方读 `words.json`** ⇒ 它此前不是"没写"，是**写不了**。
只补组件不接通道，会渲染出一段空字幕带，而校验全绿、单测全过。

**探针抓到的第二个缺陷**：4 个模板**只入场不出场**（`DUR.exit` 只有字幕模板在用），
表现为「弹一下 → 定住 38 帧 → 突然消失」。这与问题 9 **同款病**（定义了没人用）。
已修为共用 `enterExitProgress()`，且各模板出场方向按物理直觉分别设计
（`lower-third` 向左推出、`tag-float` 下沉、`stat-card` 缩小），不是统一淡出。

详见 `docs/changelog/2026-10-15-D1模板实现.md`。

⚠️ **真渲验证已完成**（1920×1080@30，5 个模板全部抽帧确认）：
字幕逐词高亮、强调词大字、左下身份条、右上胶囊气泡、右下数字卡
**形态两两可辨**，「10 个模板渲染结果逐像素相同」确认解除。

### 3.1.3 第二轮打磨：缓动 + 参数手感表（✅ 2026-10-15 · D1 第二轮）

**发现：第一轮全程线性插值。** 30fps 下 60 帧 motion 的入场只有 10 帧，
linear 在第 2 帧才走 10% ⇒ 观众看到的是"缓慢爬升"。
这是廉价感的**第二大来源**（第一大是"没有出场"，已在第一轮修）。

| 项 | 第一轮 | 第二轮 | 依据 |
|---|---|---|---|
| 入场曲线 | linear | **expo-out** `cubic-bezier(0.16,1,0.3,1)` | 实测 t=0.2 已走完 75%，读作"弹出" |
| 出场曲线 | linear | **cubic-in** | 比 expo-in 温和；expo-in 末段会让字幕像"被吸走" |
| `DUR.enter` | 0.18 | **0.16** | 入场要利落（观众在等信息） |
| `DUR.exit` | 0.18 | **0.22** | 出场慢一点，"消失"才不突兀 |

🔴 **刻意不用 `back-out`（回弹）**：实测 t=0.5 处达 **1.087（超调 8.7%）**，
元素会短暂越出 `footprint` —— 而 `footprint` 语义是「取全动画期最大包围盒」，
**超调属契约违反**，不是视觉细节。已固化为单测（单调不减 + 上界为 1）。

**参数手感表**（`docs/templates/2026-10-15-参数手感表.md`）：
借鉴 1「双层结构」的落地 —— 契约表说"有哪些参数"，手感表说
"调到多少、什么手感、越界会怎样"。含实测时值表与两条调参纪律。

### 3.1.4 🔴 手感表实测纠正了初稿的错误（长文本溢出）

初稿我写「kinetic-line >6 字就溢出」，真渲 16 字才发现：
**806px 的框能放约 14 个中文字** —— 我低估近 3 倍。

真渲实测（16 中文字 / `123456789`）：**4 个模板全部溢出**，
`stat-card` 甚至**溢出画面边界**。

⚠️ `whiteSpace: nowrap` 意味着溢出**既不折行也不缩放**
⇒ 模型填长文本会让成片出现跑出画面的文字，
**而 18 项校验完全看不出来**（全是结构判定，不读渲染结果）。

两条处置（渲染期自适应 / 构建期校验）**均未实施、待裁决**，
理由见手感表 §7 与下方问题 6。

### 3.1.5 校验项 #17：文本溢出（✅ 2026-10-15 · D-B）

用户裁决**选方案 B（构建期校验）**。落地：`src/validate/text-metrics.ts` + `W-DB-01`。

**前置问题（必须先解决）**：字号原本硬编码在组件里（如 `kinetic-line.tsx` 的
`fontSize: 54`），校验器在 `src/validate/` 下**拿不到**。
⇒ 契约新增 `TemplateDeclaration.textMetrics`（`fontSizePx`/`paddingPx`/`slackRatio`），
作为**唯一真源**。🔴 不在校验器内另写字号表 —— 否则改组件字号会让判定静默失准
（同 `DUR.exit` 事故）。已加测试「契约字号 == 组件字号」防漂移。

**已定三个参数**（D-B 裁决，一并拍定）：CJK 1.0em / 拉丁数字 0.5em / 空格 0.3em；
余量 **15%**；**warning 不阻断**（同 `DENSITY.maxItemsPerCue` 教训：未校准判定当error 会伤害用户）。

**🔴 实测暴露的盲区（如实记录）**：一套通用系数**套不住差异巨大的字重与容器**。

| 模板 | 真渲实测 | 估算 vs 阈值 | 能否捕获 |
|---|---|---|---|
| `kinetic-line` | 16 字铺满框 | 864 vs 904 | ❌ 差 40px（余量吃掉），17 字才报 |
| `tag-float` | 16 字撑破胶囊 | 384 vs 616 | ❌ **远低估** |
| `stat-card` | `123456789` 溢出画面 | 198 vs 651 | ❌ **严重低估** |

⚠️ **刻意不调系数让它"看起来对"** —— 把 0.5em 调到 0.6em 能救 `stat-card`，
但会让 CJK 正文误报；**误差只是从漏报变成误报，总量没减少**。
已立 **待补 D-B2（逐模板实测度量表）**，倾向「批量真渲测出「字号×字数」表」。

**当前实际价值**：守住「**明显超长**」量级（`tag-float` 40 字、`stat-card` 20 字必报），
对 CJK 大字判定接近可信；⚠️ 挡不住粗体数字/圆角容器的轻微溢出。

### 3.1.6 🔴 真素材端到端首跑（✅ 2026-10-18）—— 抓出 3 个渲染层 bug

详见 `docs/changelog/2026-10-18-真素材端到端首跑.md` 与 `docs/changelog/2026-10-18-cue字幕与影子载体轨.md`。

**为什么此前一直没暴露**：`jobs/` 下 4 个 job 全停在 01/02，而 demo job 是 `hasVideo: false`
（走占位底）⇒ **「有真实视频」这条代码路径从未被执行过**。

| # | bug | 症状 | 修法 |
|---|---|---|---|
| 1 | `<OffthreadVideo>` 的 src 路径 | 渲染到 2836 帧崩，**或全程黑帧且不报错** | 静态服务把 URL 映射到 bundle 目录，实测只有 `public/<name>` 命中 ⇒ `video: 'public/'+basename` + `--public-dir=<00-input>` |
| 2 | 载体轨把视频裁在自己的时间窗内 | 只要有一个载体类 item（如 `punch-in`），**其区间外整段视频消失**（6517 帧纯黑） | `CarrierTrack` 窗口前后补**无变换透传** |
| 3 | 载体轨**嵌套**会叠加时间偏移 | 影子载体轨单独存在时分屏正常；一旦外层还有 `punch-in`，**加了等于没加**（SSIM `1.000000`） | 把时间轴**拍平**：`composeCarrierTimeline` 切成原子窗口，`CarrierTimeline` 逐窗渲染，视频任一时刻只渲一次 |

🔴 **三个 bug 的共同点**：**两条路径/两条链同时存在时才暴露**。
验证时要问「这套机制在**组合**下还成立吗」，不能只验单条。

**字幕线（同轮，用户反馈驱动，`C2-6`）**：拆分粒度本就来自用户的 SRT（逐字比对 0 差异），
错的是三处 —— ① 时间取词落点（漂 7.06s）；② 文字用「窗口内的词」拼（时间一对齐就拼错句）；
③ 高亮由词时驱动（漂了就缺）。现统一为：**时间用 SRT、文字用 `cue.text`、高亮按字数权重重铺**。

### 3.2 三条硬规则的代码化

| 规则 | 实现方式 |
|------|---------|
| **帧是真相** | 模型只写锚点，帧由烘焙器算；锚点用完即弃 |
| **不让模型手算帧** | 校验项 #16 按 `paramsSchema` 校验参数，禁止自造键/ 帧 / 颜色 |
| **确定性红线** | 禁 `Date.now()` / `Math.random()`；唯一伪随机源是 `mulberry32`；**全树仅一处读时钟** |

### 3.3 文档体系（✅）

| 文件 | 作用 |
|------|------|
| `docs/decisions/OPEN-DECISIONS.md` | **裁决唯一真源**，42 条 RESOLVED |
| `docs/spec/SPEC-*.md` | 实现规格 v0.6（与真源冲突时以真源为准） |
| `docs/templates/2026-10-13-模板库首批清单.md` | 首批 10 个模板 + 契约值推导依据 |
| `docs/proposals/2026-10-14-后续提升优化计划书.md` | **D1–D7 优化方向** + 分批路线图 + 风险登记 |
| `docs/decisions/2026-10-13-裁决材料.md` | 4 项裁决的三视角评估（架构/QA/PM） |
| `docs/changelog/` | 按日变更记录 |
| `.workbuddy/skills/` | 五阶段执行期行为契约 |

**登记册纪律**：只追加 + 就地关闭；增补校验项**须先改登记册**，
不得只在正文里加 —— 这条纪律当天就抓到过两次漏同步。

---

## 四、已知问题（🔴 按严重度排序）

### 1. ⚠️ 模板 9/11，剩余 2 个**已无外部阻塞**（2026-10-17 更新）

已解除"完全无产出"，剩下的是工作量与施工顺序，**不再是依赖问题**：
- ✅ **`carrier/split-frame`**：**P1–P4 全部完成**（2026-10-17）—— P1 契约 + P2 实现
  （cover 裁切分屏 + 主体锚定窗口，几何真源 `core/carrier-window.ts` 含 `visibleRegion`）
  + P3 tier2 真正接线（**通道方案 A**：`render` 侧重算消解 + 写入 `carrier.params.window`）
  + P4 以 `visibleRegion` 重立 `W-D2-02`（第 18 项）。
  🔴 同日真渲抽帧抓到并修掉坐标系 bug（分界曾落在 0.75 而非 0.5，偏差 25%）。
  ⚠️ 仍 `experimental`：`MIN_VISIBLE_RATIO` 等阈值未校准、真素材端到端未验。
- **`annotation/pointer-callout`**：**主体框已由内置 perceive 产出**，可开工（依赖已解除）。
- **`transition/whip-pan`**（fullscreen）：**确认闸已实装**，无外部阻塞。
  ⚠️ **2026-10-16 更正计划书 §4.6 的一处时点判断**：计划书把第 5 批写作「等 06-review 流程就绪」，
  但 `renderGate()` 里的 fullscreen 人工确认闸（D3-a：读 `06-review/confirmed.json` 的
  `acknowledgedFullscreen`，未确认即拒绝启动）**已完整实装** ⇒
  `whip-pan` 的前置条件**事实上已满足**，它只是「排在最后」，不再被任何外部条件阻塞。
- **两轮打磨均已落地**：D1 第一轮（5 个）+ 第二轮（缓动曲线、时值配比、进出场质感、参数手感表），
  批次 2 与 D-A 于 2026-10-15～16 补齐至 8 个，真渲已抽帧确认形态两两可辨。
- **`DUR` 动画配比仍是 PLACEHOLDER**：文档只规定 `minVisibleInFrames`，未规定配比。
  第二轮已给出可用取值（见 §四 3），但**仍待真实素材调校**。

### 2. 🔴 对齐：词级时间会漂，最多 7.06 秒（`M-1d` / `M-1e` 待决）

**现象**：门控全过（均值 0.9113 / 低置信 3.19% / `alignedRatio=1.000`），
但某条 cue 的词被放进 **6.74 秒真静音**（8.39–15.13s，`volumedetect` 实测 −58dB），偏差 **−7.06s**。
kukini 48 条 cue 中 **8 条**词落点与 SRT 窗口覆盖率 <0.8（最低 18%）。

**根因两层**：① whisper 把跨静音的文本压进一个长分段（`8.14–20.46s`），DP 只能把词平摊；
② `alignedRatio` 的定义是「SRT 词对上 **token** 的比例」—— **衡量文本匹配，不衡量时间**，必然报 1.0。

**已判死**：加 `-ml 32 -sow` **无效**（分段仍是 `8.14–20.46s`），已登记 `M-1e`。

**已缓解**：字幕完全不受影响（时间/文字/高亮都改以 SRT 为准，见 §3.1.6）——
但这是**显示层**兜底，产物层的词时依旧错。

**正解（待裁决）**：用 `ffmpeg silencedetect` 约束 DP，**禁止把词放进静音段**。
需先定「静音阈值 / 最短时长」，并用 2–3 条素材验证「不会把正常短停顿误判成静音」。

> **原第 2 项「tier2 载体退让是空操作」已于 2026-10-18 修复**（裁决 `D4-t3`）：
> `validate` 写的 `window` 原本在渲染层无消费者（`MotionItem` 不读 `item.carrier`，
> 而唯一读它的 `split-frame` 只在 motion 本身是载体时运行）。现由 `carrier-synth.ts`
> 折成**影子载体轨**接进背景链；并规定**只在 `params.window` 存在时合成**
> （声明 ≠ 生效，否则 tier1 已解决的情况会莫名切画面）。

### 3. ⚠️ 占位数值：**8 项 / 12 个数值**（唯一口径见 `docs/decisions/PARAM-DECISIONS.md`）

> 🔴 **本节的表格已移除（2026-10-18，D6.4）** —— 手抄的表必然漂移。
> 本节此前那张表同时犯了四个错：把 `DUR.enter/exit` 混进来（它是"已调优、待复核"，不是占位值）、
> 把 `ALIGN_GATE` 拆成两行、漏掉 `CONFIDENCE_BANDS` 与 `CARRIER_RATIO_DEFAULT`
> ⇒ 标题写「7」、表里 8 行、`MEMORY.md` 又按分组数出 8，**三方互不相等**。
>
> 现唯一口径：`npm run placeholders` 输出「8 项 / 12 个数值」，
> 明细**由代码生成**到 `docs/decisions/PARAM-DECISIONS.md`（真源 `src/core/placeholders.ts`）。
> 口径定义：**一项 = 一个需要独立做出的校准决定**（同进同退的几个数算一项）；
> 「数值个数」是另一口径，引用时必须说明指的是哪个。

按「现在最该动」排序的三个（其余见生成文档）：

| 项 id | 为什么优先 |
|---|---|
| `density` | 🔴 **唯一「占位值却直接产 error」**：偏严会阻断真实素材，而项目没有 storyboard 编辑 UI，用户只能手改 JSON |
| `min-visible` | 卡着 `W-D2-02` 从 warning 升 error |
| `align-gate` + `confidence-bands` | 必须**同批**校准，分开调会留下一道看着齐全、实则测不到的门 |


### 4. ⚠️ `p` 不是可信度

实测：纯音调输入下whisper 输出 `[_BEG_]`、`(`、`字`、`J` 等噪声 token，
**而 `p` 高达 0.9996**。它衡量「模型对自身解码有多自信」，
**测不到「SRT 与音频是否对得上」** —— 后者由 `alignedRatio` 负责。

### 5. 🔴 契约字段审计：两个零消费字段已处置（✅ 2026-10-15 · 问题 9）

`occludesSubject`（10 模板全声明）与 `handoffIn`（2 个声明）此前**消费数为 0**，
而登记册明写「D 的判定结果会以 `occludesSubject` 参与 error 判定」
⇒ **文档说它承重，代码里没人读**。

🔴 **处置不是"看着像就一起处理"，而是先实测「能否从别处推导」再分诊**
——两个字段看着同类，实际一个该补、一个该删：

| 字段 | 实测推导性 | 处置 |
|---|---|---|
| `occludesSubject` | `fullscreen` 下 `whip-pan`=true 而 `noise-grain`=false ⇒ **不可推导** | ✅ **补实现** |
| `handoffIn` | 与 `paramsSchema.enter` 语义重复，而后者能填且真消费 | ⛔ **删除字段** |

**`occludesSubject` 的消费**：`collectHits()` 增加过滤 ——
声明不遮挡主体的模板不进遮挡预算判定（放在**进预算之前**而非之后降级：
不遮挡的模板本就不该消耗遮挡额度）。

**`handoffIn` 删除的三条理由**：① 零消费；② 与 `enter: 'from-left'` 语义重复，
而 `enter` 在 paramsSchema 内（模型能填）且渲染期真消费；③ 🔴 **它连模型都填不了**
—— 不在 paramsSchema 中，校验项 #16 只校验 `params`、碰不到模板声明本身。
替代方案：将来若需区分接力入场，应**扩展 `enter` 枚举**，而非平行加字段。

**⚠️ 补实现后暴露的更深问题（已裁决 D-A 并于 10-16 落地）**：
补实现时发现当时 10 个模板**无一能真正触发遮挡判定** —— 声明 true 的 3 个全是载体类/fullscreen
（被 scope 规则排除），其余 7 个全声明 false。
这不是"补错了"，而是**模板集缺口**：真实口播里"压在人身上的大字"
这类**会遮挡主体的叠加模板**恰恰是高频需求。
⇒ 已立 D-A 并在 2026-10-16 裁决 **A1**，`typography/center-emphasis@1.0` **已实装**
（`layer: 70`、footprint 落画面中部与主体区重合）——遮挡判定链路首次具备可触发路径。

**连带修正**：原 13 项遮挡测试用声明 `false` 的 `kinetic-line` 驱动遮挡退让 ——
**前提自相矛盾**。已改用测试夹具 `makeOccludingItem()`，
并新增正向用例「同几何下 `false` 的 motion 不进判定」作为"字段确实被消费"的证据。

详见 `docs/decisions/OPEN-DECISIONS.md`「问题 9 审计」章节。

### 6. ⚠️ 长文本溢出会跑出画面，但校验器看不见

`whiteSpace: nowrap` + 模型可填长文本 ⇒ **成片出现跑出画面的文字**，
而 18 项校验全是结构判定，**完全看不出**。

真渲实测 16 中文字：`kinetic-line`/`lower-third`/`tag-float` 均溢出，
`stat-card` 溢出画面边界。真实阈值约 13–14 中文字（比初稿估计宽 3 倍）。

两条处置**均未实施**，待裁决（详见手感表 §7）：
A 渲染期自适应 / B 构建期校验（需先改登记册）。
**当前依赖模型遵守 SKILL.md 的字数建议 —— 这是纪律，不是强制。**

### 7. ⛔ 明确不做的

| 项 | 理由 |
|----|------|
| 降噪 / 响度归一 / BGM 分离 | F5：低置信→阻断→人工已覆盖 |
| 双语字幕对齐 | 用户素材为纯中文；且 (a) 方案技术上不成立 |
| `under-subject` scope 的模板 | 依赖 perceive 主体框，模型未接入。**诚实留空优于占位** |
| `brand` / `rhythm` / `sfx` 家族 | 需品牌资产或音频节拍分析，输入未落地 |
| **数字滚动（digit roll）** | `value` 是字符串且校验明确「不判语义」⇒ 渲染期无从判断滚几位。需先立数字语义裁决 |

---

## 五、后续计划（按优先级）

### 阶段 1 · 让管线真能用（最高优先）

| # | 事项 | 说明 | 状态 |
|---|------|------|------|
| 1 | ~~align 第二步：文本对齐 DP~~ | 已由 `text-align.ts` + `builtin-align.ts` 完成 | ✅ 2026-10-14 |
| 2 | ~~模板实现（最小 5 个）~~ | D1 第一轮 | ✅ 2026-10-15 |
| 3 | ~~模板第二轮打磨~~ | 缓动曲线、时值配比、进出场质感 + 参数手感表 | ✅ 2026-10-15 |
| 4 | ~~契约字段审计~~ | `occludesSubject` 补实现 / `handoffIn` 删除（问题 9） | ✅ 2026-10-15 |
| 5 | ~~接入 perceive（face 通道）~~ | 内置后端上线：镜头切分（ffmpeg `scdet`，阈值 10 实测无漏检/无过检）+ YuNet 人脸检测 → shot 级并集 → `safeArea`（主体 bbox 上部 60%）。未配 `PERCEIVER_CMD` 不再退出码 2。真实素材实测 15 shot / 12 有主体 | ✅ 2026-10-17 |
| 5b | ~~补 `handheld` / `broll` 两通道~~ | **handheld**：人脸框外扩成「上半身＋手部」区域，**不做物体检测** —— 主讲解物品是鞋子而 COCO 80 类无 shoe，且用户判断「只要上半身不被遮挡」即够；**broll**：仅无脸镜头用经典显著性（零模型），框不到即退让；有脸 shot 不产 broll（实测会框到背景噪声）。⚠️ `HANDHELD_EXPANSION` 与显著性 `targetAreaRatio` 均为占位值 | ✅ 2026-10-17 |
| 6 | ~~修 tier2 载体退让~~ | **D4-t2**（10-17）定契约与几何，**D4-t3**（10-18）补上「渲染层没人消费 `carrier`」这一环：`carrier-synth.ts` 折成影子载体轨。真渲验证：分屏 + 主体锚定成立 | ✅ 2026-10-18 |
| 7 | ~~真素材端到端出片~~ | kukini 6667 帧跑通五阶段；抓出 3 个渲染层 bug（视频路径 / 载体轨裁视频 / 载体轨嵌套偏移） | ✅ 2026-10-18 |
| 8 | ~~字幕按 SRT 切分与定时~~ | `cue:N` 锚点（C2-6）；时间/文字/高亮全部改以 SRT 为准 | ✅ 2026-10-18 |

> ✅ **硬阻断已解除（2026-10-17）**：此前缺 `02-perceive` 产物时 `validate` **直接拒绝启动**、
> 而 `perceive` 本身未配 `PERCEIVER_CMD` 即退出码 2 ⇒ **真实素材在 `01-align` 之后无路可走**。
> 内置后端上线后这条路通了。剩余缺口不再是「无路可走」，而是**感知覆盖不全**：
> `handheld`（手持讲解物品）与 `broll`（B-roll 主体）两通道未实现（见 5b）。

### 阶段 2 · 补齐质量（当前主战场）

| # | 事项 | 说明 | 状态 |
|---|------|------|------|
| 9 | **对齐产物层修漂移** | 用 `silencedetect` 约束 DP，禁止词入静音段。显示层已兜底，产物层未修（`M-1d` / `M-1e`） | ❌ 待裁决（需 2–3 条素材校准阈值） |
| 10 | **占位值校准（8 个）** | 尤其 `MIN_VISIBLE_RATIO=0.5`（挡着 `W-D2-02` 升 error）与 `DENSITY.maxItemsPerCue`（占位值却产 error） | ❌ 待做（现在有 4 条素材可用） |
| 11 | **剩余 2 个模板** | `annotation/pointer-callout`（主体框已就绪）/ `transition/whip-pan`（fullscreen 闸已实装），**无外部阻塞** → 11/11 | ❌ 待做 |
| 12 | **渲染基准量化（F4）** | 已有首条：6667 帧 1080p60 → **墙钟 20–22 分钟 / 218MB**。待多次取样取中位数 | 🔶 1/3 |
| 13 | **组合场景验证模板** | 今天 3 个 bug 全是「单链正常、双链同时存在才暴露」⇒ 每个新机制都要问「和已有机制**同时**启用时还成立吗」 | 🔶 已成纪律 |

### 阶段 3 · 可选评估

- shot 级 VLM 兜底（替代 F6的人工兜底）—— 需先用官方文档核实模型能力
- Qwen3-ForcedAligner 等专用对齐模型 —— ⚠️ 单次上限 5 分钟，
  长视频需切片，且引入 PyTorch 栈与「可复现性」立法意图冲突

---

## 六、环境要求

| 项 | 要求 | 备注 |
|----|------|------|
| Node.js | **22.19+ / 24+** | Remotion 官方硬要求 |
| Remotion | 锁 `4.0.534`（`--save-exact`，**禁 `^`**） | 4.0.x 每 2–3 天一版，不锁必然漂移 |
| ffmpeg | `align` 阶段必需 | 抽 16kHz 单声道 wav |
| GPU 配置 | **必须显式 `--gl=angle`** | 漏了可能产出**空白 canvas** |
| whisper.cpp | `1.5.5`（首个支持 `t_dtw` 的版本） | Windows 走预编译二进制，**无需 cmake / Python** |
| 模型 | `whisper.cpp/ggml-base.bin`（148MB） | ⚠️ 走 `tools/setup-whisper.mts`，含 hf-mirror 自动降级 |
| 换机 | ✅ whisper 路径按「仓库根相对」解析 | 2026-10-15 修（D7）：`WHISPER_CPP_PATH` 可覆盖；`src/` 零盘符路径有单测兜底 |
| 渲染静态目录 | `--public-dir=<job>/00-input` | **2026-10-18 新增**：`<OffthreadVideo>` 的 src 由 Remotion 静态服务解析到 **bundle 目录**，实测只有 `public/<name>` 这种写法命中；`render` 阶段已自动带上该参数 |

---

## 七、当前真实数字

> 复核日期：**2026-10-18**（全部为当场可复算的命令输出，不是转述）

```
校验项      18 项（构建期）+ 3 类（渲染期兜底）
错误码      26 条（E-*/W-*，+W-DB-01）
单测        432 项全过（25 文件）   ← 318 → 328 → 359 → 364 → 374 → 384 → 403 → 404
                                       → 407 → 411（cue 锚点 / 影子载体轨 / 时间表）
                                       → 417（字幕按 SRT）→ 420（高亮重铺）→ 432（占位值注册表）
测试文件    25 个（24 个测试 + 1 个共享夹具 tests/_ctx.ts）
契约字段    occludesSubject 已补实现；handoffIn 已删除；item.carrier 已立契约（D4-t2）
            anchor 语法：word:N / cue:N（C2-6）/ abs:<帧|秒s>
登记册      47 条表格行含 RESOLVED（`grep -cE '^\|.*RESOLVED'` 可复算；+C2-6 / +D4-t3）
            OPEN：C2-2（待实测）/ C2-3（倾向不做）/ M-1d / M-1e（对齐漂移）/ M-4 未落
模板        11 个声明 / 9 个实现      ← 剩余 pointer-callout、whip-pan（均无外部阻塞）
背景链      2 个实现：punch-in（放大）/ split-frame（裁切分屏）
            机制：src/remotion/carrier.tsx **时间表渲染**（不再嵌套）+ carrier-synth.ts 影子载体轨
遮挡判定    tier1 平移 + tier2 载体档**都真实施加**（真渲验证：分屏 + 主体锚定成立）
            首个遮挡型模板 center-emphasis 落地（D-A）
渲染映射    motion id → 组件映射表已建立     ← 此前不存在，这是灰框的病根
字幕通道    words.json 已接入 props，且字幕的**时间/文字/高亮全部以 SRT 为准**（C2-6）
占位数值    8 项 / 12 个数值 —— **唯一口径：`npm run placeholders`**
            明细由代码生成到 docs/decisions/PARAM-DECISIONS.md（真源 src/core/placeholders.ts）
手感表      docs/templates/2026-10-15-参数手感表.md（已建）
成片基准    6667 帧 1080p60 → 墙钟 20–22 分钟 / 218 MB（F4 首条，待多次取样）
```

**真素材端到端实测（kukini，2026-10-18）**：

```
素材        1920×1080 / 59.94fps / 6667 帧 / 48 条 cue（110.9s）
align       alignedRatio 1.000 / 均值置信度 0.9113 / 低置信 3.19%（门控通过）
            已知缺陷：词时最多漂 7.06s（8 条 cue 覆盖率 <0.8）
perceive    15 shot（8 有 safeArea / 7 无脸走 broll）
storyboard  7 轨 / 55 条锚点 / 闸1 T=0.800
validate    18 项 + 2 条原生约束 → 0 error / 11 warning
                49→4  W-C3-01（字幕起点恰在词边界；改用 SRT 时间后自然消退）
                54→6  W-C4-01（footprint 相交；半开区间消掉相邻 cue 的 1 帧重叠）
                1     W-D2-01（tier1 平移消解 handheld 遮挡 25.1% → 9.3%）
render      218 MB / 20–22 分钟
```

> ⚠️ **D4-t2 的 P1 没有新增校验项**：`item.carrier` 的引用合法性属**结构错误**
> （`ConfigError` → 退出码 2，与 `handoffTo` 指向不存在 track 同类），**不占 18 项名额**。
> 加校验项须先改登记册，而本次改的是契约不是清单。
>
> ⚠️ **占位值「有几个」曾有三个口径**（MEMORY 8 / 本文 7 / 代码里 `PLACEHOLDER` 标记仅 3 处），
> 根因是**代码没有统一的标记机制**。**2026-10-18 已建**（D6.4）：
> `src/core/placeholders.ts` 为唯一真源，`npm run placeholders` 渲染本页引用的数字与明细文档。
> 计数与口径定义见该文件头，别在这里另起一套数法。

### 已知环境问题（非项目 bug）

```
npm run align → ffmpeg 抽音轨失败：spawnSync ffmpeg EBUSY
```
Windows + scoop shim 与 Node `spawnSync` 的兼容问题（bash 里 `ffmpeg` 正常，
Node 子进程报 EBUSY，真实 exe 全路径同样）。**未改 `extractAudio` 兜底** ——
环境问题不污染项目代码。临时绕法：手工 `ffmpeg -y -i raw.mp4 -vn -ac 1 -ar 16000 -f wav audio.wav` 后走后续步骤。

---

## 八、怎么跑

```bash
npm install

# 一次性准备 whisper（M-1 第一步）
node --experimental-strip-types tools/setup-whisper.mts

# 无需真实素材的端到端 demo
npm run pipeline -- storyboard --job demo --jobs-dir examples --draft examples/demo/03-storyboard/draft.json
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run

# 真素材全流程（示例：jobs/e2e-perceive）
npm run pipeline -- align      --job e2e-perceive     # 约 14 分钟（whisper small）
npm run pipeline -- perceive   --job e2e-perceive
npm run pipeline -- storyboard --job e2e-perceive --draft jobs/e2e-perceive/03-storyboard/draft.json
npm run pipeline -- validate   --job e2e-perceive
npm run pipeline -- render     --job e2e-perceive     # 约 20–22 分钟（6667 帧 1080p60）

npm run typecheck
npm test
```

> `align` / `perceive` 未配置外部模型时**直接退出码 2**，绝不伪造结果 ——
> 一条静默产出的错误 storyboard，比一次显式失败危险得多。

🔴 **阶段目录是不可变快照**：已存在的阶段会**跳过**（`align` 会打印「沿用」）。
改了对齐/感知代码后必须加 **`--force`** 才会重跑 —— 否则你会以为代码没生效。
（2026-10-18 踩过：改完 `builtin-align` 重跑，`words.json` 时间戳纹丝不动，白等 14 分钟。）

🔴 **长任务别用 `| tail`**：`npm run pipeline -- render | tail -20` 会把错误吞掉，
失败时只能看到「渲染失败」四个字。一律重定向到日志文件再 `grep`。

---

> 本文档随代码演进更新。改动落在哪一步，就更新哪一节，不写「已完成」了事。
> 详细变更见 `docs/changelog/`，决策理由见 `docs/decisions/OPEN-DECISIONS.md`，
> 优化方向见 `docs/proposals/2026-10-14-后续提升优化计划书.md`。
