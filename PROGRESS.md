# 项目进度 — Remotion 视频动效叠加管线

> 最近更新：2026-10-15
> 状态标记：✅ 完成 / 🔶 进行中 / ⛔ 明确不做 / ❌ 未做

---

## 一句话

在**已拍摄、已粗剪拼接、无任何文字与特效**的实拍口播视频上，自动叠加
motion-graphic overlay。五阶段管线骨架已跑通，`01-align` 已全通
（whisper 时间 + SRT 文字，真实素材实测通过），**模板真实实现已落地 5 个**
——「渲染出来是个灰框」这个致命问题**已解除**；距离「可发布成片」还差第二轮打磨。

---

## 二、用户第一次出片的路径（当前状态）

这是判断项目真实进展的唯一标准 —— 不是「代码写了多少」。

| 闸 | 状态 | 说明 |
|----|------|------|
| `00-input` 放素材 | ✅ | — |
| `01-align` 强制对齐 | ✅ | **两步全通**：whisper.cpp（时间）+ SRT（文字）+ 文本对齐 DP（`text-align.ts`）。真实素材实测 `alignedRatio=1.0`、8/8 cue、72 词、0 空洞/0 重叠/0 倒序 |
| `02-perceive` 主体检测 | ❌ | `PERCEIVER_CMD` 未配置 → 退出码 2 |
| `03-storyboard` 起草 | 🔶 | 管线通；「本仓库不内置模型调用」，用户须手写 `sim_max`/`confidence` |
| `04-validate` 校验 | ✅ | **17 项**（+#17 文本溢出），0 error / 2 warning（demo） |
| `05-render` 渲染 | 🔶 | **模板已不再是灰框** —— 5 个 `overlay-safe` 有真实实现；**第二轮打磨（缓动/质感）未做** |

**结论：六道闸过了三道半。「出片」从"完全没价值"变成"有产出但未打磨"。**

---

## 三、已完成的功能

### 3.1 管线骨架（✅）

五阶段 `align → perceive → storyboard → validate → render`，统一 CLI 入口，
阶段目录为不可变快照（下游不得回写上游）。

- **烘焙器**：锚点 `{anchor:"word:37", offset:"-8f"}` → `fromFrame` + `durationInFrames`
- **调度**：两道闸串联 + 动态阈值 T + 安全阀 + 产路地板
- **校验器**：构建期 **16 项**（纯 JSON→JSON）+ 渲染期兜底三类
- **单测**：**218 项全过**（12 文件：validate 40 / text-align 26 / srt 22 / zh-normalize 21 / schedule 19 / caption 19 / template-render 16 / params 17 / bake 14 / occlusion 10 / align-gate 9 / dtw-unit 5）

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

🔴 **这类退化能逃过全部现有防线**：16 项校验是纯 JSON→JSON（不读渲染产物）、
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
**而 16 项校验完全看不出来**（全是结构判定，不读渲染结果）。

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
| `docs/spec/SPEC-*.md` | 实现规格 v0.5（与真源冲突时以真源为准） |
| `docs/templates/2026-10-13-模板库首批清单.md` | 首批 10 个模板 + 契约值推导依据 |
| `docs/proposals/2026-10-14-后续提升优化计划书.md` | **D1–D7 优化方向** + 分批路线图 + 风险登记 |
| `docs/decisions/2026-10-13-裁决材料.md` | 4 项裁决的三视角评估（架构/QA/PM） |
| `docs/changelog/` | 按日变更记录 |
| `.workbuddy/skills/` | 五阶段执行期行为契约 |

**登记册纪律**：只追加 + 就地关闭；增补校验项**须先改登记册**，
不得只在正文里加 —— 这条纪律当天就抓到过两次漏同步。

---

## 四、已知问题（🔴 按严重度排序）

### 1. ⚠️ 模板只实现 5/10，且未打磨

已解除"完全无产出"，但：
- **剩余 5 个**：`annotation/pointer-callout`（依赖 perceive）、`carrier/split-frame`（D4 载体）、
  `cinematic/punch-in`（背景链）、`transition/whip-pan`（fullscreen 需人工确认）、
  `ambience/noise-grain`。分批时点见优化计划书 §4.6。
- **第一轮 ≠ 可发布**：计划书 D1 分两轮的依据是 C3（自己发布）。
  当前缓动曲线、时值配比、进出场质感均为**第一轮水平**，第二轮才打磨。
- **`DUR` 动画配比是 PLACEHOLDER**：文档只规定 `minVisibleInFrames`，未规定配比，
  取值属【实现期拟定】，**待真实素材调校**。

### 2. 🔴 tier2 载体退让是空操作

`occlusion.ts` 的两级退让原本都只抑制报错、不改数据（已修 tier1）。
tier2（自动切 carrier）**仍是空操作**，现在出 `W-D4-01` 诚实告警。

三个阻塞点：
- `StoryboardItem` 无处承载「已切载体、画面要缩进哪个框」
- `CARRIER_FALLBACK` 按 motion 索引，**放不下逐 item 几何**
- `split-frame` 表达不了「把这条 motion 挪出这张人脸」

**修复须先在登记册立一条承载字段的裁决。**

### 3. ⚠️ 三个占位数值从未实测

| 项 | 当前值 | 状态 |
|----|--------|------|
| 对齐门控 | 均值 < 0.60 或低置信词 > 30% → 阻断 | 🔴 待实测 |
| `alignedRatioMin` | 0.8 | 🔴 PLACEHOLDER，须与上一项**一并**校准 |
| 每 cue item 数 | 3 | 🔴 PLACEHOLDER，却直接产 error |
| `DUR.enter/exit` | 0.18 / 0.18 | 🔴 PLACEHOLDER（本日新增，待实测） |

> **`DENSITY.maxItemsPerCue = 3` 是个未校准的占位值，却会阻断真实素材**，
> 而项目没有编辑 UI，用户只能手改 JSON。这是「过度严格」最现实的伤害点。

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

**⚠️ 补实现后暴露的更深问题（已立待裁决 D-A）**：
当前 10 个模板**无一能真正触发遮挡判定** —— 声明 true 的 3 个全是载体类/fullscreen
（被 scope 规则排除），其余 7 个全声明 false。
这不是"补错了"，而是**模板集缺口**：真实口播里"压在人身上的大字"
这类**会遮挡主体的叠加模板**恰恰是高频需求。加模板是产品决策，**不擅自加**。

**连带修正**：原 13 项遮挡测试用声明 `false` 的 `kinetic-line` 驱动遮挡退让 ——
**前提自相矛盾**。已改用测试夹具 `makeOccludingItem()`，
并新增正向用例「同几何下 `false` 的 motion 不进判定」作为"字段确实被消费"的证据。

详见 `docs/decisions/OPEN-DECISIONS.md`「问题 9 审计」章节。

### 6. ⚠️ 长文本溢出会跑出画面，但校验器看不见

`whiteSpace: nowrap` + 模型可填长文本 ⇒ **成片出现跑出画面的文字**，
而 16 项校验全是结构判定，**完全看不出**。

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
| 2 | **模板实现（最小 5 个）** | D1 第一轮 | ✅ 2026-10-15 |
| 3 | **模板第二轮打磨到可发布** | 缓动曲线、时值配比、进出场质感 + 参数手感表 | 🔶 **现为第一优先** |
| 4 | **契约字段审计** | `occludesSubject`/`handoffIn` 零消费的处置（问题 9 / 1.6） | ❌ |
| 5 | **修 tier2 载体退让** | 须先立裁决（承载字段 + 键粒度 + 新载体模板） | ❌ |
| 6 | **接入 perceive** | MediaPipe（几 MB 级，非「重型」）；无它则「不遮挡主体」不可执行 | ❌ |

> ⚠️ **顺序再次变化**：模板实现已完成，第一优先现为**第二轮打磨**——
> C3（成片要能自己发布）意味着第一轮的"能看"不是终点。

### 阶段 2 · 补齐质量

| # | 事项 | 说明 |
|---|------|------|
| 7 | **C2-2 阈值实测** | 需真实素材；顺带校准 `alignedRatioMin` |
| 8 | **渲染基准量化（F4）** | 应在模板打磨后做 —— 现在量的是第一轮水平，会系统性偏小 |
| 9 | **复核 `DENSITY.maxItemsPerCue`** | 未校准的占位值当 error 用，伤害真实用户 |
| 10 | **其余 5 个模板** | 按计划书 §4.6 分批（批次 2 不依赖任何外部条件） |

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
| 换机 | 🔴 whisper 路径有硬编码默认值 | 见优化计划书 D7（用户已确认会换机） |

---

## 七、当前真实数字

```
校验项      17 项（构建期）+ 3 类（渲染期兜底）
错误码      26 条（E-*/W-*，+W-DB-01）
单测        249 项全过（13 文件）           ← 183 → 249（+66）
登记册      44 条 RESOLVED（+D-B）；**待裁决 D-A**（缺遮挡型叠加模板）、**D-B2**（逐模板度量表）
模板        10 个声明 / 5 个实现            ← 0 → 5（剩余 5 个分批，见 §4.6）
渲染映射    motion id → 组件映射表已建立     ← 此前不存在，这是灰框的病根
字幕通道    words.json 已接入 props         ← 此前渲染期无人读它
契约字段    occludesSubject 已补实现；handoffIn 已删除  ← 此前两个都零消费
占位数值    3 个（DUR 配比已第二轮调优；其余 3 个待实测）
手感表docs/templates/2026-10-15-参数手感表.md（已建）
测试文件    12 个
```

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

npm run typecheck
npm test
```

> `align` / `perceive` 未配置外部模型时**直接退出码 2**，绝不伪造结果 ——
> 一条静默产出的错误 storyboard，比一次显式失败危险得多。

---

> 本文档随代码演进更新。改动落在哪一步，就更新哪一节，不写「已完成」了事。
> 详细变更见 `docs/changelog/`，决策理由见 `docs/decisions/OPEN-DECISIONS.md`，
> 优化方向见 `docs/proposals/2026-10-14-后续提升优化计划书.md`。
