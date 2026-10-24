# 项目进度 — Remotion 视频动效叠加管线

> 最近更新：**2026-10-19**（17:10 全量审计，只读复算，非转述）
> 状态标记：✅ 完成 / 🔶 进行中 / ⛔ 明确不做 / ❌ 未做
> 📄 本次审计报告：`docs/reviews/2026-10-19-全量进展审计报告.md`

---

## 一句话

在**已拍摄、已粗剪拼接、无任何文字与特效**的实拍口播视频上，自动叠加
motion-graphic overlay。**2026-10-18：首次用真素材（kukini 1080p60 / 6667 帧 / 48 cue）
跑通全部五阶段并产出成片**（218MB，墙钟 ≈20 分钟）。过程中修掉三个渲染层阻塞 bug
（视频路径、载体轨裁剪视频、载体轨嵌套叠加时间偏移），并把**字幕的时间、文字、高亮
全部改为以用户编辑的 SRT 为准**（`C2-6`）。

**2026-10-19 补充**：M-1f（按 SRT 窗口铺词 + SRT↔音频一致性校验）与 M-1g（无字幕模式）
落地，另**两条真素材出片**（`fast-0322` 259MB / `fast-0528` 256MB，均走 `--no-subtitle`）
⇒ **真素材成片累计 3 条**。同日完成全量审计，**整体完成度约 88%**
（功能层 100% / 质量层约 60%）。

**2026-10-22 补充**：P0-1 模板预览画廊（`npm run templates:gallery`，19 个已实现模板 × 3 帧）
与 P0-2 成片媒体 QA（`render-report.json.qa` + `contact-sheet.jpg`：解码/时长/黑场/静帧/音频）落地。

**2026-10-24 补充**：模板补齐 **11/11**（`pointer-callout` / `whip-pan` 落地，真渲抽帧确认），
D-B2 文本度量实测表落地（见 §3.1.5）。
距「可直接发布」还差：占位值校准（**11 项**）。（长文本溢出已随 D-B3 分档收口：>1.5× 升 error。）

---

## 二、用户第一次出片的路径（当前状态）

这是判断项目真实进展的唯一标准 —— 不是「代码写了多少」。

| 闸 | 状态 | 说明 |
|----|------|------|
| `00-input` 放素材 | ✅ | — |
| `01-align` 强制对齐 | ✅ | **两步全通**：whisper.cpp（时间）+ SRT（文字）+ 文本对齐 DP（`text-align.ts`）。kukini 实测 `alignedRatio=1.0`、均值置信度 0.9113、低置信 3.19%。⚠️ **已知缺陷**：whisper 会把跨静音的文本压进一个长分段（实测 8.39–15.13s 是 6.74 秒真静音，却被放进 9 个词），词时整体偏移最多 **7.06 秒**；字幕已不受影响（时间取 SRT）；`M-1f` 已在产物层按 SRT 窗口铺词（kukini 静义词 9→0），余 `M-1d` 门控阈值待校准 |
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
- **单测**：**792 项全过**（48 个测试文件，2026-10-25 复核；P1-a review +14 与契约同步，C2-5b +1，D-B3 +5，M-3 +7，P1-b +23：motion-accept 13 / spec-loader 5 / motionboard +3 / spec-contract +2 / 覆写护栏与终审 +5）。按文件：
  fit-text 14 / draft-keys 7 / review-queue 4 / video-size 6 / exit-code 5 / confirmed 18 / word-timeline 31 /
  template-render 36 / carrier-window 30 / caption 28 / text-overflow 33 / text-align 26 / srt 22 / bake 22 /
  zh-normalize 21 / validate 42 / schedule 19 / carrier 18 / yunet 17 / params-schema 17 / shot-detect 14 /
  split-frame 14 / placeholders 12 / region-derive 12 / doctor 11 / occlusion-tier 11 / subject-visible 10 /
  carrier-contract 10 / align-gate 15 / carrier-synth 7 / stage-io 6 / perceive-sampling 6 / dtw-unit 5 /
  whisper-path 3 / spec-contract 45 / spec-render 24 / motionboard 22 / motion-accept 12 / spec-loader 5 /
  rhythm-rules 34 / rhythm-table 31 /
  registry 6 / stage-order 5 / template-gallery 7 / media-qa 11 / text-metrics-measured 6

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

真渲实测（16 中文字 / `123456789`）：当时记录「4 个模板全部溢出」，
`stat-card` 甚至**溢出画面边界**。

🔴 **2026-10-24 D-B2 复核**：按**声明 footprint**，16 字 `tag-float`（427px < 576px）
与 9 位 `stat-card`（315px < 614px）实际放得下；上述两处「溢出」应来自被覆盖的 footprint。
详见 §3.1.5 与 `docs/templates/2026-10-24-文本度量实测表.md`。

⚠️ `whiteSpace: nowrap` 意味着溢出**既不折行也不缩放**
⇒ 模型填长文本会让成片出现跑出画面的文字，
**而 18 项校验完全看不出来**（全是结构判定，不读渲染结果）。

处置现状（2026-10-24）：**#17 构建期估算 warning（D-B）+ 渲染期 `fitScale`（P6）+
D-B2 逐模板实测系数**均已落地；剩「warning 升 error」待裁决。详见下方问题 6。

### 3.1.5 校验项 #17：文本溢出（✅ 2026-10-15 · D-B）

用户裁决**选方案 B（构建期校验）**。落地：`src/validate/text-metrics.ts` + `W-DB-01`。

**前置问题（必须先解决）**：字号原本硬编码在组件里（如 `kinetic-line.tsx` 的
`fontSize: 54`），校验器在 `src/validate/` 下**拿不到**。
⇒ 契约新增 `TemplateDeclaration.textMetrics`（`fontSizePx`/`paddingPx`/`slackRatio`），
作为**唯一真源**。🔴 不在校验器内另写字号表 —— 否则改组件字号会让判定静默失准
（同 `DUR.exit` 事故）。已加测试「契约字号 == 组件字号」防漂移。

**已定三个参数**（D-B 裁决，一并拍定）：CJK 1.0em / 拉丁数字 0.5em / 空格 0.3em；
余量 **15%**；**warning 不阻断**（同 `DENSITY.maxItemsPerCue` 教训：未校准判定当error 会伤害用户）。

**🔴 D-B2 实测复核（2026-10-24）—— 更正 2026-10-15 的两处结论**：

| 模板 | D-B2 实测文本宽 | 声明 footprint 下的结论 |
|---|---|---|
| `kinetic-line` | 16 字 864px（框 806 + 15% 余量） | 16 字不报、17 字报，边界正确 |
| `tag-float` | 16 字 384px + padding 40 + 边框 3 = **427px** | < 576px 框 ⇒ **放得下，不报是对的**；旧「撑破胶囊」来自被覆盖的 footprint |
| `stat-card` | 9 位 264px + padding 48 + 边框 3 = **315px** | < 614px 框 ⇒ **放得下**；真正的发现是数字系数被 0.5em **低估 33%**（实测 0.667） |

- **实测表**：`docs/templates/2026-10-24-文本度量实测表.md`（工具 `tools/measure-text-metrics.mts`，
  6 个文字模板 × CJK/数字 × 1/2/10 字，真实组件 + 像素包围盒）。
- **契约拆两把尺子**：`charWidthEm`（CJK，实测全 1.000）+ `latinWidthEm`（数字，实测 0.615–0.667）。
  一个系数乘两个基准（1.0 / 0.5）表达不了 —— 曾以为「调 0.5→0.6 会伤 CJK」，
  实际正确解法是**分字段**，不是折中调参。
- **当前实际价值**：守住明显超长（40+ 字 / 30 位数字），仍为 warning 不阻断；升 error 另立裁决。

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

### 3.1.7 模板预览画廊（✅ 2026-10-21 · P0-1）

改 motionboard 之前，先看见模板长什么样，不必等一次完整渲染。

- **命令**：`npm run templates:gallery` → `out/template-gallery/`
  （`gallery.html` + `images/<slug>-f{6,45,72}.png` + `catalog.json`）。
- **覆盖**：19 个声明 = **19 个已实现 × 3 帧 = 57 张图**（2026-10-24 起无未实现项；占位块降级路径仍由单测守护）。
- **目录真源**：`src/templates/gallery.ts` 从注册表 + `isImplemented()` 派生，
  不手抄模板表；未来 MCP `templates_list` 直接复用。
- **预览合成**：`TemplateGallery` 只渲一个 item，但走 `MotionItem`（与成片同一条主链）；
  背景是合成底板 + 主体剪影，`center-emphasis` / `split-frame` 的遮挡/分屏形态因此可见。
- **确定性**：两次生成 57 张图里仅 `punch-in` f72 有 1/255 GPU 抖动
  （mean diff ≈ 5.6e-6、显著像素比 0），属内容稳定下的像素微差。
- **测试**：`tests/template-gallery.test.ts` 7 项（覆盖性 / 实现状态 / 三帧 / 必填参数 / 字幕夹具 / HTML 离线转义 / slug）。

### 3.1.8 成片媒体 QA + 联系表（✅ 2026-10-22 · P0-2）

`render` 完成后自动跑一次成片体检，报告写进 `05-render/render-report.json.qa`：

- **解码 / 时长**：全片解码 + `ffprobe` 时长对账（容差 `max(0.15, 2/fps)`）；不符记 error。
- **黑场 / 静帧**：`blackdetect` + `freezedetect`；未闭合到片尾的区间按 1 段计，并注明起点。
- **音频**：`volumedetect` 的 mean/max；静音或近满刻度记 warning；无音频流写 `audio:null`（不是 0）。
- **联系表**：9 个等距帧拼 3×3 → `05-render/contact-sheet.jpg`。
- **不阻断**：成片已产出，QA 是事后报告；ffmpeg/ffprobe 不可用只进 `unavailable`，不伪装成通过。
  Windows shim 无法被 Node spawn 时用 `FFMPEG_BIN` / `FFPROBE_BIN` 指向真实 exe。
- **实测**：demo 占位成片（30s、无素材底）被如实检出「1 段黑场 + 1 段整片静帧」，联系表正常产出；
  时长 30.000s vs 预期 30.000s。测试 `tests/media-qa.test.ts` 11 项。

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

### 1. ✅ 模板 **11/11**（2026-10-24 补齐）

- **`annotation/pointer-callout`**（anchored）：四角括线 + 中心锚点 + 左上 target 标签；
  footprint 即目标区域（不二次猜测主体位置）；`textMetrics` 已补，长 target 走 `fitScale`。
  状态仍 `experimental` —— 实现完成 ≠ 锚定质量已验证（依赖 perceive 区域质量）。
- **`transition/whip-pan`**（fullscreen）：方向性速度线 + 轻暗底，首尾强度归零；
  `direction` 支持 left/right/up/down，未知值回退 left。会触发 D3-a 人工确认闸（已实装）。
- **`carrier/split-frame`**：P1–P4 完成；⚠️ 仍 `experimental`（阈值未校准、真素材端到端未验）。
- **两轮打磨均已落地**：D1 第一轮（5 个）+ 第二轮（缓动曲线、时值配比、进出场质感、参数手感表），
  批次 2 与 D-A 于 2026-10-15～16 补齐至 8 个，真渲已抽帧确认形态两两可辨。
- **`DUR` 动画配比仍是 PLACEHOLDER**：文档只规定 `minVisibleInFrames`，未规定配比。
  第二轮已给出可用取值（见 §四 3），但**仍待真实素材调校**。

### 2. 🔴 对齐：词级时间曾最多漂 7.06 秒（`M-1f` 已修，`M-1d` 门控待校准）

**历史现象**：门控全过（均值 0.9113 / 低置信 3.19% / `alignedRatio=1.000`），
但某条 cue 的词被放进 **6.74 秒真静音**（8.39–15.13s，`volumedetect` 实测 −58dB），偏差 **−7.06s**。
修复前 kukini 48 条 cue 中 **14 条**词落点与 SRT 窗口覆盖率 <0.8（最低 0.182）。

**根因两层**：① whisper 把跨静音的文本压进一个长分段（`8.14–20.46s`），DP 只能把词平摊；
② `alignedRatio` 的定义是「SRT 词对上 **token** 的比例」—— **衡量文本匹配，不衡量时间**，必然报 1.0。

**已判死**：加 `-ml 32 -sow` **无效**（分段仍是 `8.14–20.46s`），登记 `M-1e`。

**已修复（`M-1f` 2026-10-19，`M-1e` 随之关闭）**：不再约束 DP，改为**按 SRT 窗口、以字数权重把词铺回 cue 窗口并回写产物**
（`core/word-timeline.ts` 为唯一真源，`caption.ts` 只 re-export；`core/silence.ts` 供静音取证）。
kukini 实测：落进 6.74s 静音的词 **9→0**、`silentWordRatio` **5.9%→0.88%**、重铺 11 条 cue，
`alignedRatio` 与置信度未变（好数据没被修坏）。**字幕同时仍以 SRT 为准**（§3.1.6）。

⚠️ **门控（`M-1d`）2026-10-24 落地告警档**：告警线 `SILENCE.wordRatioWarnMax=0.02` 由单条完整素材定线
（健康 0.879% vs 病理 5.9% 的对数中点 ≈2.28%，向下取整），`align` 超过即告警但**不阻断**；
**阻断线未设** —— 需再补 2–3 条完整对齐素材。该线与静音探测参数绑定
（实测 `minDurationSec` 0.5→0.3 时同一健康素材占比 0.88%→2.97%，须同批重算）。
复合量 `reweigh-coverage-min=0.8` 的来源不明，修复后剩余 7/48 条为 0.714–0.900 的边缘抖动（非漂移）。

> **原第 2 项「tier2 载体退让是空操作」已于 2026-10-18 修复**（裁决 `D4-t3`）：
> `validate` 写的 `window` 原本在渲染层无消费者（`MotionItem` 不读 `item.carrier`，
> 而唯一读它的 `split-frame` 只在 motion 本身是载体时运行）。现由 `carrier-synth.ts`
> 折成**影子载体轨**接进背景链；并规定**只在 `params.window` 存在时合成**
> （声明 ≠ 生效，否则 tier1 已解决的情况会莫名切画面）。

### 3. ⚠️ 占位数值：**11 项 / 19 个数值**（唯一口径见 `docs/decisions/PARAM-DECISIONS.md`）

> 🔴 **本节的表格已移除（2026-10-18，D6.4）** —— 手抄的表必然漂移。
> 本节此前那张表同时犯了四个错：把 `DUR.enter/exit` 混进来（它是"已调优、待复核"，不是占位值）、
> 把 `ALIGN_GATE` 拆成两行、漏掉 `CONFIDENCE_BANDS` 与 `CARRIER_RATIO_DEFAULT`
> ⇒ 标题写「7」、表里 8 行、`MEMORY.md` 又按分组数出 8，**三方互不相等**。
>
> 现唯一口径：`npm run placeholders` 输出「11 项 / 19 个数值」，
> 明细**由代码生成**到 `docs/decisions/PARAM-DECISIONS.md`（真源 `src/core/placeholders.ts`）。
> 口径定义：**一项 = 一个需要独立做出的校准决定**（同进同退的几个数算一项）；
> 「数值个数」是另一口径，引用时必须说明指的是哪个。
> ⚠️ 10-19 新增 2 项（M-1f 引入）：`silence-thresholds`（5 个数，10-24 增 `wordRatioWarnMax`）/ `reweigh-coverage-min`（0.8）。
> ⚠️ 10-20 新增 1 项（节奏表生成器引入）：`rhythm-min-cue-frames`（`RHYTHM.minCueFramesForMotion` = 10）。
> 🔴 **`reweigh-coverage-min=0.8` 来源不明却已生效并写进产物** —— 11 项里唯一
> 「不知道凭什么」的阈值，**列为第一优先补依据**。

按「现在最该动」排序的三个（其余见生成文档）：

| 项 id | 为什么优先 |
|---|---|
| `density` | ~~🔴 唯一「占位值却直接产 error」~~ → **2026-10-24（C2-5b）已降级为 warning 不阻断**（`W-C2-5-02`）；数值校准仍待真实素材，升回 error 另立裁决 |
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

### 6. ✅ 长文本溢出：已由 #17（warning）+ 渲染期 fitScale + D-B2 实测兜底（2026-10-24）

- **构建期**：#17 估算 warning（D-B），CJK/数字分系数（D-B2 实测 1.0 / 0.615–0.667）。
- **渲染期**：`fitScaleFor` 按契约 `textMetrics` 等比缩小（下限 0.7），保证不出画面。
- **D-B2 更正**：旧「16 字 `tag-float` 撑破 / 9 位 `stat-card` 溢出画面」在声明 footprint 下
  不可复现（427px < 576px、315px < 614px），以实测表为准。
- **D-B3 分档（2026-10-24）**：>1.5× 升 **error `E-DB-01` 阻断**（fitScale 兜底失效点
  1/0.7≈1.43× 之外，几何必然）；1.15–1.5× 维持 warning。模型起草仍应遵守 SKILL.md 字数建议。

### 7. ⚠️ 零消费者导出 13 个（2026-10-18 审计）

`src/` 里导出了、但 **src/tests/tools 都没有任何引用**的符号。

⚠️ 这不等于「都该删」：其中 5 个是**查询 API**（给外部脚本/人用的入口），
其余 8 个疑似历史遗留。**已删 2 个明确重复的**（`validateJob` / `reportPath`），剩下的待逐个判断：

| 类别 | 符号 | 判断 |
|---|---|---|
| 错误码查询 | `CodeKey` / `isErrorCode` / `codesForItem` | 保留：`tools/` 与将来的 06-review UI 会用到 |
| 模板元信息 | `parseMotionId` / `listTemplates` | 保留：`getTemplate` 之外的另一条查询路径 |
| 内部辅助 | `targetRef` / `normalizeFrame` / `fillParent` / `loadAligned` / `dtwToMs` / `BUILTIN_WHISPER_VERSION` / `budgetSnapshot` / `scopeOf` | **待判**：可能只是"写的时候顺手 export" |

🔴 **同款病的第五次**：`assertNotWritingUpstream` 曾在此表里 —— 而它不只是"没人用"，
是**该用的人没接线**（见 §四 上级条目）。判这 13 个时先问一句：
**它是"没人需要的导出"，还是"本该被调用的守卫"？**

### 8. ⛔ 明确不做的

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
| 5c | ~~M-1f：按 SRT 窗口铺词~~ | 新增 `core/silence.ts` + `core/word-timeline.ts`；`srtFromSec/srtToSec` 贯穿 types→bake→caption；产物层回写治本。kukini 静义词 9→0 | ✅ 2026-10-19 |
| 5d | ~~M-1g：无字幕模式~~ | `--no-subtitle` 给「本来就不需要对齐」一条正路，产出**显式标记的空产物**而非静默伪造 | ✅ 2026-10-19 |
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
| 9 | **对齐产物层修漂移** | M-1f 已落地（按 SRT 窗口铺词 + 产物层回写），kukini 静义词 9→0；`M-1d` 告警档已落地（2% 告警线，不阻断），余阻断线待校准 | 🔶 产物层已解，告警档已落地，阻断线待校准 |
| 10 | **占位值校准（11 项 / 19 个数值）** | 🔴 尤其 `REWEIGH_COVERAGE_MIN=0.8`（**来源不明**却已生效）；`DENSITY.maxItemsPerCue` 占位阈值已随 C2-5b 降级为 warning 不阻断（2026-10-24）；`SILENCE.wordRatioWarnMax=0.02` 为单样本告警线，随 `M-1d` 阻断线一并复核 | ❌ 待做（完整对齐样本仅 1 条；另两条走 M-1g 无字幕，不给覆盖率/占比分布） |
| 11 | ~~剩余 2 个模板~~ | `pointer-callout` / `whip-pan` 已实现，真渲抽帧确认；模板 **11/11** | ✅ 2026-10-24 |
| 12 | **渲染基准量化（F4）** | 已有 3 条成片墙钟（6667 帧 1080p60 → 20–22 分钟 / 218MB；另两条 259MB / 256MB）⇒ 样本已够取中位数 | 🔶 3 条成片已就绪，待取中位数 |
| 13 | **组合场景验证模板** | 今天 3 个 bug 全是「单链正常、双链同时存在才暴露」⇒ 每个新机制都要问「和已有机制**同时**启用时还成立吗」 | 🔶 已成纪律 |
| 14 | **产物时序守卫升级为 hash 版** | 10-20 已落地 mTime 版（`context.ts#assertStageOrderIsSane`），能拦住「上游更新后下游没重跑」。⚠️ **mTime 会被 `cp`/解压/git checkout改写** ⇒ 更稳的是烘焙时把上游 hash 写进 `storyboard.meta` 再比对 | ❌ 待做（当前 mTime 版够用，hash 版更彻底） |

### 阶段 3 · 可选评估

- **创作期动效生成 + Remotion Studio 审核闸**（用户 10-22 提出）：无合适模板时按 prompt 生成新动效——随机性关在创作期（重掷自由、定稿冻结入库），渲染期确定性红线不改；渲染前加 Studio 人工审核，must_review 条目硬闸确认后才可渲染。提案：`docs/proposals/2026-10-22-创作期动效生成与Studio审核闸.md`（P1-a 审核闸 / P1-b 生成自动化）——提案头 Status: **ACCEPTED**（2026-10-22 四项待裁决问题经会话确认全部采纳；原文「待裁决」标记已过期，按提案为准） | 🔶 **P1-a 已落地（2026-10-24 合并）**：`review` 命令 + Studio 预览 + must_review 硬闸 + storyboard hash 防漂移；用法见 README。🔶 **P1-b 已落地（2026-10-24，创作期会话流程 + 验收命令 + loader 验签）**：`genPrompt` 契约（`MotionBoardItem` 可选字段，零机器消费）→ `npm run motion:accept` 六道验收 → `custom-*` 入库文件 loader 验签 → 生成流程入根 SKILL.md「创作期动效生成」节；三次裁决（文件名 `custom-` 前缀验签判据、重掷多版本以文件名并存、入库覆写护栏）见提案头注记与当日 changelog
- **M-3 语义 pacing（2026-10-23 裁决，2026-10-24 契约层落地）**：pacing 首选路径 = LLM 创作期语义判定（规则节奏表降级为兜底先验）。已落地：SKILL ×2 语义契约（`meta.source:'semantic'`，reason 自述依据与 board 同批落盘）+ `buildContext` 结构断言三条（cue 索引 / motion id 注册 / decide 对齐；ConfigError 不占 18 项）+ 复现性口径收窄至兜底路径。**剩：真实素材创作期实战检验**（等 T5 素材）
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
| 环境自检 | `npm run doctor` | **2026-10-18 新增**（D7.6）：7 项检查（Node / ffmpeg / ffprobe / whisper 二进制 / 模型名是否与运行时默认一致 / YuNet / 参数档案），每条 fail 都带可执行的 ↳ 做法 |
| 换机文档 | `docs/SETUP.md` | **2026-10-18 新增**（D7.4）：从零到跑通 + 故障排查，含「模型名两个默认值」这个真坑 |

---

## 七、当前真实数字

> 复核日期：**2026-10-24**（计数复核：单测 / 错误码 / 登记册 / 占位值按当前代码复算；
> 全量审计结论仍以 `docs/reviews/2026-10-19-全量进展审计报告.md` 为准）

```
校验项      18 项（构建期）+ 3 类（渲染期兜底）   ← validate-report.summary.checked=18
错误码      28 条（E-*/W-*，+W-DB-01 / +E-DB-01）  ← src/core/errors.ts#ALL_CODES.length
单测        792 项全过（48 个测试文件）  ← 449 → … → 756（P1-a review +14 等） → 757（C2-5b +1） → 762（D-B3 +5） → 769（M-3 契约层 +7） → 779（P1-b 六道验收 +10 / genPrompt +3 / 验签 +5） → 782（覆写护栏 +3） → 792（文件名派生 +2 / 终审加固 +1 / 签名后体积 +1）
测试文件    48 个 `.test.ts(x)` + 1 个共享夹具 `tests/_ctx.ts`
契约字段    occludesSubject 已补实现；handoffIn 已删除；item.carrier 已立契约（D4-t2）
            anchor 语法：word:N / cue:N（C2-6）/ abs:<帧|秒s>
登记册      53 条表格行含 RESOLVED（`grep -cE '^\|.*RESOLVED'` 可复算，2026-10-24）
            OPEN：C2-2（待实测）/ C2-3（倾向不做）/ M-1d（共 3 条；
                  M-1f 已落地、M-1e 由其收敛关闭，M-4 已 RESOLVED）
模板        11 个声明 / 11 个实现      ← 2026-10-24 补齐 pointer-callout、whip-pan
            画廊 19 个已实现 × 3 帧 = 57 张（无未实现项）
背景链      2 个实现：punch-in（放大）/ split-frame（裁切分屏）
            机制：src/remotion/carrier.tsx **时间表渲染**（不再嵌套）+ carrier-synth.ts 影子载体轨
遮挡判定    tier1 平移 + tier2 载体档**都真实施加**（真渲验证：分屏 + 主体锚定成立）
            首个遮挡型模板 center-emphasis 落地（D-A）
渲染映射    motion id → 组件映射表已建立     ← 此前不存在，这是灰框的病根
字幕通道    words.json 已接入 props，且字幕的**时间/文字/高亮全部以 SRT 为准**（C2-6）
            + M-1f 词时重铺（覆盖率 <0.8 时铺回 SRT 窗口）+ M-1g 无字幕模式
占位数值    **11 项 / 19 个数值** —— **唯一口径：`npm run placeholders`**
            ⚠️ 10-19 新增 2 项（M-1f 引入）：`silence-thresholds`(5，含 M-1d 告警线) / `reweigh-coverage-min`(0.8)
            ⚠️ 10-20 新增 1 项（节奏表生成器引入）：`rhythm-min-cue-frames`(10)
            🔴 `reweigh-coverage-min=0.8` **来源不明**却已生效 ⇒ 第一优先补依据
            明细由代码生成到 docs/decisions/PARAM-DECISIONS.md（真源 src/core/placeholders.ts）
手感表      docs/templates/2026-10-15-参数手感表.md（已建）
成片基准    3 条真素材成片（kukini 218MB / fast-0322 259MB / fast-0528 256MB）
            ⚠️ **CPU 峰值不采集**（execFileSync 拿不到子进程 rusage，2026-10-19 裁决明确放弃）；
            墙钟/帧数/大小/画面尺寸见 `05-render/render-report.json`
成片 QA       `render-report.json.qa`：解码 / 时长 / 黑场 / 静帧 / 音频 / `contact-sheet.jpg`（P0-2）
整体完成度  约 88%（功能层 100% / 质量层约 60%）
工程健康    typecheck exit 0 · 792 项全过（48 文件）· placeholders --check OK
```

**真素材端到端实测（2026-10-19 复核）**：

```
【e2e-perceive（kukini，10-18 跑通）】
素材        1920×1080 / 59.94fps / 6667 帧 / 48 条 cue（110.9s）
align       alignedRatio 1.000 / 均值置信度 0.9113 / 低置信 3.19%
            silentWordRatio **0.00877**（M-1f 铺词后从 5.9% 压到 0.88%）
            ⚠️ 3.19% 的低置信与 silentWordRatio 均达标 ⇒ align 门控通过
perceive    15 shot（8 有 safeArea / 7 无脸走 broll）
storyboard  7 轨 / 55 条锚点 / 闸1 T=0.800
validate    18 项 + 2 条原生约束 → 0 error / 11 warning
render      218 MB / 20–22 分钟

【fast-0322（10-19，M-1g 无字幕模式）】
align       mode=no-subtitle / words 与 cues 为空 / silentWordRatio=null / gatePassed=true
            ⚠️ alignedRatio=0 是**显式空产物**，不是对齐失败，不可用于校准
validate    0 error / 2 warning（含 W-D3-01）
render      259 MB→ 06-review/confirmed.json已产出（fullscreen 人工确认闸走通）

【fast-0528（10-19，同上路径）】
validate    0 error / 4 warning
render      256 MB → 06-review/confirmed.json 已产出

【real30】🔴 **停在 align 阶段内部** —— 只有 whisper 探针中间产物，
            既无 words.json 也无 align-report.json ⇒ **可用于校准的只有 3 条，不是 4 条**
```

> ⚠️ **D4-t2 的 P1 没有新增校验项**：`item.carrier` 的引用合法性属**结构错误**
> （`ConfigError` → 退出码 2，与 `handoffTo` 指向不存在 track 同类），**不占 18 项名额**。
> 加校验项须先改登记册，而本次改的是契约不是清单。
>
> ⚠️ **占位值「有几个」曾有三个口径**（MEMORY 8 / 本文 7 / 代码里 `PLACEHOLDER` 标记仅 3 处），
> 根因是**代码没有统一的标记机制**。**2026-10-18 已建**（D6.4）：
> `src/core/placeholders.ts` 为唯一真源，`npm run placeholders` 渲染本页引用的数字与明细文档。
> 计数与口径定义见该文件头，别在这里另起一套数法。
>
> 🔴 **2026-10-19 审计发现 4 处本文数字滞后**（单测 / 占位值 / 错误码 / 出片条数），
> 方向一致：代码往前走、本文停在 10-18。`placeholders --check` 通过说明真源没漂，
> **漂的是手抄本** —— 这正是「一个概念只允许一个真源」的价值所在。
> 详见 `docs/reviews/2026-10-19-全量进展审计报告.md`。

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

# 0. 环境自检（换机必跑；每条 ❌ 后面都跟了具体做法）
npm run doctor

# 一次性准备 whisper（M-1 第一步）
node --experimental-strip-types tools/setup-whisper.mts base
# ⚠️ setup 脚本默认装 base，而运行时默认找 small ——
#    用 base 就必须 export WHISPER_MODEL=base，否则 align 找不到模型。
#    doctor 会检查这一项。详见 docs/SETUP.md §4。

# 无需真实素材的端到端 demo
npm run pipeline -- storyboard --job demo --jobs-dir examples
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run

# 真素材全流程（示例：jobs/e2e-perceive）
npm run pipeline -- align      --job e2e-perceive     # 约 14 分钟（whisper small）
npm run pipeline -- perceive   --job e2e-perceive
npm run pipeline -- storyboard --job e2e-perceive
npm run pipeline -- validate   --job e2e-perceive
npm run pipeline -- render     --job e2e-perceive     # 约 20–22 分钟（6667 帧 1080p60）

npm run typecheck
npm test

# 模板预览画廊（P0-1）：19 个已实现模板 × 3 帧 → out/template-gallery/
npm run templates:gallery
```

> `align` / `perceive` 未配置外部模型时**直接退出码 2**，绝不伪造结果 ——
> 一条静默产出的错误 storyboard，比一次显式失败危险得多。

🔴 **阶段目录语义不对称**：`align` / `perceive` 已有产物会**跳过**（`align` 会打印「沿用」）；`storyboard` / `validate` / `render` 每次重算。
改了对齐/感知代码后必须加 **`--force`** 才会重跑 —— 否则你会以为代码没生效。
（2026-10-18 踩过：改完 `builtin-align` 重跑，`words.json` 时间戳纹丝不动，白等 14 分钟。）

🔴 **长任务别用 `| tail`**：`npm run pipeline -- render | tail -20` 会把错误吞掉，
失败时只能看到「渲染失败」四个字。一律重定向到日志文件再 `grep`。

---

> 本文档随代码演进更新。改动落在哪一步，就更新哪一节，不写「已完成」了事。
> 详细变更见 `docs/changelog/`，决策理由见 `docs/decisions/OPEN-DECISIONS.md`，
> 优化方向见 `docs/proposals/2026-10-14-后续提升优化计划书.md`。
