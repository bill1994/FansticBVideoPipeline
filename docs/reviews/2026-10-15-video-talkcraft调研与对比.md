# video-talkcraft 调研与 VideoPipeline 多维对比

> 调研日期：2026-10-15
> 对标仓库：https://github.com/Vincentwei1021/video-talkcraft
> 本地项目：Remotion Overlay Pipeline（VideoPipeline，v0.2.0）
> 调研方式：拉取 GitHub API 元数据、main 分支完整目录树（1076 条目）、逐字阅读 README、LICENSE、SKILL.md（62KB）、`host-footage.md`、`semantic-annotation.md`、`.env.example`，以及 `timestamps_cpu.py`、`face_bbox.py`、`voice_trim.py`、`render_shots.mjs`、`card_match.py`、`motion_check.py` 的源码原文。本文所有事实均出自这些一手文件与提交历史。

## 一、核心判断

video-talkcraft 与 video-shotcraft 是同一作者的两个 skill：shotcraft 做产品宣传片，talkcraft 做口播解说片。**和 VideoPipeline 真正同场竞技的是 talkcraft**——它也处理口播、字级时间戳、人脸安全区、真实人物素材和竖屏成片，2026-10-15 已有约 1,505 stars、149 forks [C1]。

但两条管线的输入假设在第一公里就分叉了：

| | VideoPipeline | video-talkcraft |
|---|---|---|
| 起点 | **已经剪辑好的实拍成片 + 一份 SRT** | 口播稿文本 + 一条成品配音（人物素材/B-roll 可选） |
| 做什么 | 在原片**上层叠加** overlay，原片不动 | 以配音为骨架**从零组装**一条解说片 |
| 文本权威 | SRT（剪辑师的产物） | 口播稿（写作者的产物） |
| 主体关系 | overlay 必须避让原片里的真人脸、手持物、B-roll 主体 | 人物是被合成进来的素材（绿幕/数字人/普通实拍），不存在“图形压住原片主体”的通用问题 |

这个分叉决定了：talkcraft 的对齐、选卡、渲染、验收资产可以大量借鉴，但它的人物合成体系（抠像、角标、人物/B-roll 同屏规则）大部分不适用于我们；反过来，它**没有**我们的向量式遮挡预算、不可变阶段快照和 paramsSchema 契约，这些是我们要守住的差异。

许可证是另一条硬边界：talkcraft 采用 **PolyForm Noncommercial 1.0.0**，个人/教育/研究免费，任何商业使用须事先取得作者授权 [C3]。本文的建议一律是“学方法、读源码理解后在本仓库重新实现”，不包含复制其代码。

## 二、对标仓库画像（2026-10-15）

| 项 | 值 | 证据 |
|---|---|---|
| 创建时间 | 2026-08-22（截至调研日约 8 周龄） | GitHub API [C1] |
| 最新提交 | `a7c29ed`，2026-10-12（微信群二维码更新）；最后一次功能合入是 2026-09-22 PR #42 语义匹配 | commits API [C2] |
| Stars / Forks | 约 1,505 / 149 | GitHub API [C1] |
| 许可证 | PolyForm Noncommercial 1.0.0（非 Apache-2.0） | LICENSE 原文 [C3] |
| 主要语言 | HTML 2.87MB（108 个可跑 HTML 预览）、TypeScript 2.37MB、Python 282KB、JavaScript 166KB | languages API [C4] |
| 仓库规模 | 31,130 KB（约为 shotcraft 的六分之一） | GitHub API [C1] |
| 提交数 | 84 次（main 可见历史，2026-08-28 起） | commits API |
| 协作痕迹 | 大量提交带 `Co-Authored-By: Claude Opus 5 (1M context)`；有社区贡献卡（抖音关注卡） | 提交历史 |
| 配方卡 | 108 张（`references/cards/` 108 个 md + `template/cards/` 108 个自包含 tsx + `demos/` 108 个 HTML 预览） | 目录树统计 |
| 工作台 | `workbench/` 208 个 ts/tsx 文件：多轨时间线、schema 面板、透明通道导出、实时看板 | 目录树、README |
| 脚本 | 30 个 Python/Node 工具脚本，覆盖对齐、预剪、人脸、选卡、五类 lint、分段渲染、抽帧拼图 | 目录树、SKILL.md |

它的八步流程在 `SKILL.md` 里：①口播稿 → ②配音预剪+字级时间戳 → ②-1 语义标注 → ③素材采集与体检 → ④SHOTBOOK 层矩阵分镜（preflight 闸）→ ⑤Remotion 实现（首镜先确认 + 工作台常开）→ ⑥分段渲染 + 三关验收 → ⑧响度归一交付 [C5]。

## 三、逐维度对比

### 3.1 输入模型与文本权威

talkcraft 的输入是口播稿（`script.json` 的 sentences）和成品配音，数字必须写汉字（“十九万七”不能写 197000，否则无法和读音对位）。人物素材是可选输入，规范要求时长与配音逐帧对齐、帧率等于成片帧率 [C6]。

VideoPipeline 的输入是已剪好的实拍视频加 SRT，文本权威天然在 SRT 侧——这对应对真实剪辑工作流。talkcraft 没有“SRT 与音频不一致怎么办”这一层，因为稿子在它这里就是真值；我们则专门用 DP 匹配和 `alignedRatio` 来检测这种不一致。这是我们更贴近真实后期现场的一点。

值得注意的反方向问题：talkcraft 有 **voice_trim（配音预剪）**，在做时间戳之前先剪掉口水词、结巴重说、过长停顿，并且同一条 EDL 可以剪人物视频保证音画同长；铁律是“只剪稿子里没有的插入段，ASR 听错的字永不剪”，dry-run 报告必须人工确认后才落盘 [C5]。我们的素材在进入管线前已经剪完，这步暂时不需要；但如果将来入口从“成片 + SRT”前移到“粗剪 raw”，这是现成可参考的设计。

### 3.2 字级对齐：双方最接近、也最值得逐项对照的一环

| 维度 | VideoPipeline | video-talkcraft |
|---|---|---|
| 后端 | whisper.cpp（segment 层，token 层 UTF-8 坏字节已绕开），small 模型 488MB | 默认 FireRedASR2-CTC int8（sherpa-onnx，767MB）；备选 faster-whisper small/int8（460MB）；另支持 Fish Audio TTS 直出时间戳 |
| 文本归一 | 繁简/全角归一 | 繁简归一 + **数字转汉字读法**（DIGIT2CN）+ **无声调拼音同音匹配**（zhconv + pypinyin） |
| 对齐算法 | cue↔segment 多对多 DP，相似度阈值 0.35（有真实分布依据：正确 0.655–1.0、半句漏听 0.455、错位 ≤0.154） | difflib 字符级序列对齐；CJK 逐字为锚，拉丁词与未匹配字符在相邻锚点间线性插值；偏离线性预期 >0.8s 的锚降级为插值 |
| 质检门控 | meanConfidence 0.60、低置信词占比 30%、alignedRatio 0.8（后两者待校准） | 每句 `match`（CJK 锚点覆盖率）< 0.90 标 `ok=false`，人工听该句；零时长 token 丢弃 |
| 长音频 | 未处理（素材 30s 级） | FireRed 在 ~200s 会内存平方爆炸，默认在 ≥0.3s 气口切 ≤75s 段、偏移加回；实测 193s 四段拼接后中位误差 10ms、p95 30ms |
| 精度实测 | 真实 30s 样本：8/8 cue、72 词、0 空洞/重叠/倒序；但注释承认 cue 内按字数均摊约 200ms/字，不足以支撑单字高亮 | 110s 中英混合片对照 GPU Qwen3 ForcedAligner 真值（n=472）：FireRed 中位 40ms/p95 100ms/最大 200ms/零误报；faster-whisper 中位 20ms/p95 140ms/最大 413ms/2 句边缘误报 [C7] |

三点直接相关的判断：

1. **我们的 karaoke-word 精度焦虑在它这里有了外部数据**。CTC 对齐器（FireRed）能把字级误差压到中位 40ms、最差 200ms；whisper 路线的尾部是 12 帧（413ms）。我们当前只信 whisper segment 再加 cue 内均摊，逐词高亮的精度天花板正是项目里挂着的隐患。talkcraft 的横评表给了“要不要为字级精度引入第二后端”一个量化参照系。
2. **拼音同音匹配和数字读法归一是我们 text-align DP 可以直接吸收的两个技巧**。whisper 把同音字写错是常态，只按字面相似度会丢锚点——这与我们 `zh-normalize` 的思路一脉相承，但我们没有音这一维。
3. 它的 767MB 模型和 Python 栈与我们轻栈、换机一次成功的目标冲突。faster-whisper 备选档（460MB、尾部差）与我们现有 whisper.cpp 重量相当，FireRed 是“质量优先时的可选后端”，不该成为默认。

### 3.3 “哪里放 motion”的决策：我们靠人手填，它有需求侧结构层

这是两边差距最大、也最戳我们当前痛点的地方。我们的 `03-storyboard` 要求模型/人手在 draft 里填每个 item 的 `sim_max` 和 `confidence`，没有“这句话在做什么”的结构化产物。

talkcraft 在时间戳和分镜之间硬插了一步 **语义标注**（2026-09-22 定版，PR #42）[C8]：

- 从 timestamps.json 生成 `semantics.json` 骨架，逐句标四个字段：`sem`（26 词封闭词表：自我介绍/数据/对比/引用/号召…）、`weight`（main 主句才允许进新元素，sub 陪衬句只允许已有元素变化）、`entities`（数字带单位/人名/品牌/URL）、`need`（证据/身份/量化/对比/结构/强调）。
- `card_match.py` 读语义标注 + 每镜素材行 + 机器生成的卡索引，给每个主句出候选卡并打分排序：素材完全匹配 +2、位置匹配 +1、P0 卡 +0.5、前两镜用过 −2、开场/收尾专用卡用在中段 −1；硬过滤是“卡声明必需的输入类型本镜必须有”。agent 做最终选择，但只能选候选，或写明“语义偏离”的理由。
- `preflight.py` 在渲染前核覆盖率：自我介绍/号召/数据三类硬语义没有对应卡直接 FAIL；声明了视频/图片素材却没有承接卡（素材裸贴）直接 FAIL；任何一句归属镜头为空或时间落点对不上直接 FAIL。

这套机制起源于一次真实事故：“我是万里”被配了全库能量最低的文字卡，而库里的人名条就在货架上，三轮评审都没发现——因为评审只核“摆上去的对不对”，不核“该摆的在不在” [C8]。我们项目里“模型靠印象挑模板、选错没有机器拦”的风险与它完全同构，而我们现在只有 sim_max 调度，没有需求侧语义层。

### 3.4 分镜产物：Markdown 层矩阵 vs JSON 阶段快照

talkcraft 的分镜是一份人工/agent 写的 Markdown（SHOTBOOK）：每镜三面工作单、层矩阵、素材行、蒙皮行、选卡行、版式节奏表，再由一组 Python 脚本（`shotbook_parse.py` 等）正则解析并对账；节拍落 `beats.json`，绝对时间一律由 timing.json 查得、禁止手敲秒数，`beat_lint.py` 核词落点误差 ≤0.1s 和镜尾保护带 ≥0.5s [C5]。

我们的分镜是强类型 JSON 契约 + 锚点烘焙 + 不可变快照，16 项校验纯函数执行。可机器性上我们更硬：它的 SHOTBOOK 解析本质上是在用 lint 约束一份自由文本，解析器与 Markdown 写法之间靠大量“preflight FAIL 点名”维持；我们不需要这层胶水。

但它有两个我们没有的小而硬的时间纪律：镜尾 0.5s 保护带（动效落点距切镜太近会被转场吞掉，机器查）和“开镜不空台”（开场到首个锚点 >1.5s 必须有承载画面，advisory 但每条 WARN 要回答）。我们的校验里有 handoff gap 和 minVisible，但没有“动效落点 vs 镜头边界”的距离检查。

### 3.5 人物感知与安全区：它已落地，我们还是契约

talkcraft 的 `face_bbox.py` 只有 108 行，但完整可用 [C9]：

- OpenCV YuNet 人脸检测器，模型约 230KB，首次运行自动下载到 `~/.cache/koubo/`；
- 每秒采样一帧，取置信度最高的脸，输出逐帧样本、检出率、全时段并集 bbox；
- 安全区口径：并集框向上外扩 60%（含头发）、左右各 20%，再加 30px 余量；
- 文字/卡片/字幕及其背景在任何时刻不得进入安全区；人物换位时每个停靠形态各跑一次取并集。

它还在 `host-footage.md` 里给出了全套人物合成经验：CPU 绿幕键控配方（绿优势度 geq + despill + alpha 羽化，三轮迭代排序）、无绿幕候选（Vision 人像分割 / rembg / MediaPipe Selfie Segmentation）、VP9 alpha WebM 的坑（ffprobe 报 yuv420p 不代表没 alpha）、人物降级角标的方位死锁（下角、下三分之一带、竖屏必须左下避抖音栏）、连续两镜不许无人 [C6]。

对照我们的现状：`02-perceive` 只有 `PERCEIVER_CMD` 外壳，未配置即退出；我们的契约比它丰富（face/handheld/broll 三类 + 向量预算 0%/20%/30% + shot 级累积），但执行端是空的。适用度判断：

- **YuNet 检测器和安全区算法几乎可以平移**：230KB、CPU、Windows 可跑（opencv-python），比我们设想的 MediaPipe 全家桶更轻，且经它真实生产验证。输出形状需要适配我们的 regions.json 契约。
- **抠像、角标、人物/B-roll 同屏规则不适用**：它的人物是被合成进画面的独立素材，我们的人物就在原片里，不能抠、不能挪位置。我们要做的是让 overlay 绕开他，而不是重新摆他。
- 它的安全区只处理脸，我们还要手持物和 B-roll 主体——它的方法覆盖第一段，后两段仍需我们自建。

### 3.6 模板/卡片资产：108 个自包含实现 vs 10 声明 5 实现

| 维度 | VideoPipeline | video-talkcraft |
|---|---|---|
| 规模 | 10 个声明，5 个第一轮真实实现，5 个占位 | 108 张配方卡，每张配自包含 tsx 源码 + 可跑 HTML 预览 + 在线画廊 |
| 复用机制 | 模板注册表 + paramsSchema 契约 + 组件映射，模型只填参数，未知键 E-P1-01 阻断 | 卡是自包含 tsx，用时**复制进工程**改 CONFIG；`card_lint.py` 用相似度（≥0.55）核验工程里的卡确实来自母本，禁止凭卡名手写“神似版” |
| 选卡索引 | 无（计划中的 manifest） | 卡 frontmatter 五字段（输入/语义/素材形态/位置/props）机器生成 `cards-index.json`，两道过滤（输入类型 → 语义）；标 ◦ 的卡没有可换内容的 prop |
| 风格处理 | tokens 颜色令牌，模型禁写颜色 | 卡是中性 UI，进片必须按本片 G0 风格档“蒙皮”（改颜色/字体/材质，不改时序/缓动/几何/层级），每镜写蒙皮行，0.55 相似度就是给蒙皮留的余量 |
| 参数手感 | 计划在资产库计划书中做 | 每张卡 md 有“已知坑/落位自检”，选中后必须把条目抄进 SHOTBOOK 自检列 |

机制评价：它的“复制改皮”模式比我们的契约绑定粗，会产生大量代码副本（108 个 tsx 分散在库和每个工程里）；但它用 card_lint 相似度闸把“复制了还乱改运动命门”这件事变成了机器可检的。我们的 paramsSchema 路线在自动化程度上更先进——模型不用碰代码。它真正领先的是资产厚度和“卡经验强制带入分镜”的纪律，以及 ◦ 标记这种诚实的能力边界标注。

### 3.7 渲染：单合成直出 vs 分段母版制

talkcraft 的 `render_shots.mjs` 实现了分段渲染母版制 [C10]：

- 按镜头切段，段内单进程连续渲染（多 tab 并发会产生周期性光栅相位抖动），段间可并行 4 路；
- 视频段全部 muted，音轨整条单独渲一次再混入——每段各带 AAC 拼接会因编码器前导延迟逐段错位；
- 段边界取整规则与 Sequence 一致，每段 ffprobe 实数帧数必须等于期望帧数，拼装总帧数不等即 FAIL；
- 改一个镜头只重渲该段及邻段（lead/tail 交叠 12–16 帧），201s 竖屏片实测：全片首渲 13 分钟降到 9 分钟，改一镜出有声新片 53 秒，43 张静帧抽样从 11 分钟降到约 1 分钟。

我们每周只做几条短视频，分段并行的吞吐收益不是主要矛盾，但里面三条纪律与未来 F4 渲染基准直接相关：帧数断言、音轨不分段、编码参数显式打印（它还实测过 jpeg95 对 png 的 PSNR 47.9dB）。我们现在 render 失败只抛一个笼统错误、E-RT 三个码定义了没有实现，这一层的差距比渲染速度更值得补。

### 3.8 验收体系：三关 + 独立审片，把“时域缺陷”机器化

这是它最重、也最成体系的一层。我们 16 项校验全是构建期 JSON→JSON，它的闸直接作用于渲染产物：

| 闸 | 脚本 | 量什么 |
|---|---|---|
| 画面健康 | `motion_check.py` | ffmpeg freezedetect（n=0.003、d=0.8，逐帧平均像素差 >0.3% 才算动）抓静止段；并发光栅抖动；带人物素材时同窗对照源片，把素材自带噪声降为 WARN |
| 音效 | `sfx_check.py` | 纯音效轨逐 cue 峰值 ≥−45dBFS（在场）；混入成片后做掩蔽分级，超半数被人声盖住判 FAIL，并结合气口数判断门槛是否数学上不可达 |
| 词锚 | `beat_lint.py` | 节拍对时间戳误差 ≤0.1s、镜尾保护带 ≥0.5s |
| 卡片保真 | `card_lint.py` | 工程内卡与库母本相似度 ≥0.55 |
| 契约 | `workbench_contract_lint.py` | 六个拆解文件导出齐全、PARAMS 与镜头对账 |
| 母版前预检 | `freeze_probe.py` | 不渲整片，每镜 3 个时点渲相隔 0.8s 的两帧判静止，45 个采样点与整片 freezedetect 一致率 98% |
| 评审经济性 | `qa_extract.py` + `contact_sheet.py` | 每句抽 2 帧 + 锚点帧，拼成 3×4 网格给评审 subagent，160 张散帧的评审从约 16 万 token/21 分钟降到约 4 万/7 分钟 |

审片制度同样具体：评审者必须是全新上下文的 subagent，禁止制作者自评、禁止 fork 制作对话、禁止对同一评审做 followup；等待以落盘 REVIEW.md 为准而不是完成通知；出 P0/P1/P2，修完 P0+P1 才交付；机器闸全过后只做 1 轮审片，用户可选续审，封顶 3 轮 [C5]。交付前还有两遍 loudnorm（I=−15、TP=−1.5、LRA=11、48kHz AAC 192k），并对归一后的 delivery.mp4 重跑音效可听度检查。

我们的 16 项校验加 219 个测试在“结构正确性”上比它硬（它没有等价的纯函数测试矩阵，`render_shots` 只有少量单测），但在“渲出来的东西时域上是否健康、音效是否真的听得见、审美是否过关”上我们目前几乎空白，独立终检也只停留在计划书里。

### 3.9 工作台与实时看板

它的工作台 208 个源文件，从 shotcraft 移植后又往前走了两步 [C5]：

- **制作中就开**：合成骨架一搭完（不全片做完），工作台就接入并显示七轨（字幕/转场/镜头/幕底/配音/音效/进度），镜头状态（占位/已实现/已渲/已过闸/过期）按盘上产物自动推导，agent 只用 `pipeline_state.mjs --pass/--issue` 补人工判定；
- **七轨拆解 + overrides.json**：用户在 schema 面板改的参数写进 overrides.json，agent 永不改它，渲染读同一份；节奏命门（词锚时刻、时长、缓动、几何比例、层级）不暴露；
- **右键导出透明通道**：任一动效片段可导出 ProRes 4444 MOV / VP9 alpha WebM，自动去掉卡根层幕底与人物占位，供剪映/PR/AE 叠加；
- 半成品不盖页：Vite 报错只在右下角提示，画面停在上一版。

对我们：工作台整体仍应维持“暂不做”的结论（操作者是模型、维护成本高、bash 软链接体系偏 macOS）。但两个思想便宜且可借：状态按盘上产物自动推导而不是靠人记；用户参数与工程默认值分层（对应我们已规划的 `safeToEdit`）。

### 3.10 环境、依赖与跨平台

它用 `runtime/` 统一依赖：所有工程的 node_modules 软链到同一份（约 760MB，含 190MB 无头浏览器），版本只钉一处，升级时冒烟渲一帧、不过自动回滚；工程目录里不跑 npm install [C5]。Python 3.10+、ffmpeg、767MB 的 FireRed 模型、可选 Fish Audio API Key。整套操作以 bash/软链为主，文档实测环境是 macOS。

我们是 4 个运行时依赖、单一 Node 栈、Windows 真机实测，轻得多。它的统一依赖思路值得借（我们正好有换机需求和 Remotion 全家桶同版本自检），但 bash 软链接方案在 Windows 上不可直接照搬；我们的 doctor + setup 脚本路线更合适。

### 3.11 许可证

VideoPipeline 是 MIT。talkcraft 是 PolyForm Noncommercial 1.0.0：用它产出的视频归创作者，但工具本身的商业使用需要授权 [C3]。区别要分清：

- **方法论、数据格式、阈值思想、算法思路**（拼音匹配、安全区外扩比例、freezedetect 参数、响度目标值、分段渲染纪律）不受版权保护，可以学、可以自己实现；
- **它的代码、卡片文案、tsx 母本不能直接抄进一个可能商用的工具**；若仅个人学习使用可以，但若 VideoPipeline 未来用于商业制作，直接复制存在授权风险；
- 它调用的第三方模型另有许可：YuNet 来自 opencv_zoo（Apache-2.0），FireRedASR2 模型有自己的模型许可，接入前要各自核实。

## 四、综合评分（以“实拍口播自动叠加 overlay”为场景，5 分制）

| 维度 | VideoPipeline | video-talkcraft | 说明 |
|---|---:|---:|---|
| 场景贴合 | 5.0 | 2.5 | 它从稿+配音重组成片，人物是合成素材；我们直接吃剪辑师的成片+SRT |
| 对齐工程化 | 3.5 | 4.5 | 它有双后端、同音/数字归一、切段、对照 GPU 真值的精度表；我们有 SRT 权威与门控，字级精度手段较少 |
| “放哪里”决策 | 2.0 | 4.5 | semantics.json + card_match + 覆盖闸 vs 我们手填 sim_max/confidence |
| 主体感知 | 1.5 | 4.0 | 它有 230KB YuNet 落地脚本和安全区口径；我们只有外部契约；但它不处理手持物/B-roll |
| 模板资产厚度 | 2.5 | 5.0 | 5 个第一轮实现 vs 108 卡三件套 + 画廊 |
| 契约严谨度 | 4.5 | 3.5 | 强类型 JSON 快照/16 项纯函数校验 vs Markdown 分镜 + 正则解析 + lint 群 |
| 渲染产物验收 | 2.0 | 5.0 | 静止/抖动/音效/词锚/保真/静帧预检/拼图评审全有，我们只到构建期 |
| 渲染效率 | 2.5 | 4.5 | 分段母版 + 帧数断言 + 53s 改镜出片；短视频场景下差距权重低 |
| 后期可编辑 | 1.0 | 4.5 | 七轨工作台 + overrides + 透明通道导出 |
| 轻量与换机 | 4.0 | 2.0 | 4 依赖 vs 760MB node_modules + 767MB 模型 + Python + bash 软链 |
| Windows 适配 | 3.0 | 2.0 | 我们实测但有 G 盘硬编码；它 macOS 导向 |
| 许可自由度 | 5.0 | 3.0 | MIT vs PolyForm Noncommercial |
| 审美方法论 | 3.0 | 5.0 | G0 风格档、排版九项、版式轮换、镜头三面工作单成文且机器对账 |
| 单人自动化程度 | 3.0 | 4.5 | 它的 agent 从稿到交付全流程有闸；我们 storyboard 起草仍大量靠手 |

## 五、双方 SWOT

### 5.1 VideoPipeline

| | 正向 | 负向 |
|---|---|---|
| 内部 | SRT 权威 + DP 对齐 + alignedRatio 门控；不可变阶段快照；16 项强类型校验与 219 测试；paramsSchema 把模型挡在坐标/颜色/帧数之外；向量遮挡预算覆盖脸/手持物/B-roll；MIT；单 Node 栈 | perceive 空壳、tier2 空操作、5 模板未打磨、字级精度天花板低、无渲染产物验收、无选卡语义层、demo 漂移、G 盘硬编码、人工放行回路未接线 |
| 外部 | talkcraft 证明了口播方向的市场（8 周 1.5k stars）；YuNet 等第三方组件小且许可宽松；用户每周几条的节奏允许精做 | talkcraft 在选卡、验收、模板厚度上成熟得多，且同一作者快速迭代；若其未来支持“成片+SRT 直接叠加”入口，与我们正面重叠 |

### 5.2 video-talkcraft

| | 正向 | 负向 |
|---|---|---|
| 内部 | 字级对齐双后端且有精度实测；语义选卡闭环；108 卡三件套；渲染产物六闸 + 独立审片；分段母版；工作台七轨与透明通道；方法论文档密度极高且全部机器对账 | PolyForm 非商业许可；环境重（Python + 767MB ASR + 760MB node_modules）、bash/软链偏 macOS；SHOTBOOK 靠 Markdown 解析，胶水脚本多（preflight 单文件 46KB）；卡片复制模式产生代码副本；8 周龄、单人 + agent、规则多来自少量样片 |
| 外部 | 口播解说需求被验证；与 shotcraft 共享品牌与画廊流量；Fish Audio 等 TTS 生态降低配音门槛 | 强绑定“稿+配音从头做”范式，吃不到“已剪成片加 overlay”的工作流；人物合成依赖绿幕/数字人素材质量；商业授权模式可能限制团队采用 |

## 六、建议借鉴清单（按优先级，含许可处理）

总原则：talkcraft 是非商业许可，下列全部按“读源码理解原理 → 在 MIT 代码库里独立实现”执行，参考来源登记到资产库计划的 `ATTRIBUTION.md`；第三方模型（YuNet 等）按各自许可单独接入。

### 6.1 第一优先：用已验证的小模型补 perceive（对应主计划 D2）

1. 把感知后端候选从“MediaPipe 全家桶”改为“**YuNet 人脸（230KB）先行**”：每秒采样、最高置信度脸、全时段并集、上 60%/左右 20%/+30px 的安全区口径直接对照实测后采用。输出映射到我们已有的 `regions.json`（kind=face），手持物/B-roll 仍走后续方案。
2. 安全区文档里它踩过的坑同步纳入：人物换形态要按停靠状态各取并集；检测率低要报错而不是静默给空区。

### 6.2 第一优先：给 storyboard 加需求侧语义层（补上“放哪里”的决策）

3. 在 `01-align` 与 `03-storyboard` 之间引入一版轻量 `semantics` 产物：按 cue（不是它的按句）标语义类、main/sub、实体、画面需求；词表按口播 overlay 场景收缩（我们不需要“号召关注”这类全片编排语义，需要强调/数据/身份/对比/引用/步骤等）。
4. 选卡从“模型凭印象”改为“候选 + 理由 + 偏离说明”：候选生成吃语义 × 模板 manifest × perceive 可行域（人脸区占哪些象限），模型只选候选或写明理由。这正是资产库计划书 §3.1 成片工序里 a/b 两个分支的机器化。
5. validate 增加覆盖类判定：硬语义（身份/数据）无对应 item 时至少 warning，先不照搬它的全 FAIL 力度，等真实素材验证。

### 6.3 第二优先：把对齐精度补到字级（解开 karaoke-word 的隐患）

6. text-align DP 增加两个匹配键：无声调拼音（同音容错）与数字汉字读法归一；保留 0.35 阈值的现有校准。
7. 对齐报告增补每句覆盖率指标（对标它的 match 0.90 思路），与我们的 alignedRatio 分层：整段门控不变，新增 cue 级标记供人工听核。
8. 立项评估 FireRedASR2-CTC 作为可选对齐后端（不是默认）：决策依据直接引用它 110s 横评（FireRed 最差 200ms/零误报 vs whisper 最差 413ms），门槛是模型体积与 Windows 上的 onnxruntime 部署成本；长音频切段策略（气口切 ≤75s）只有素材变长后才需要。

### 6.4 第二优先：验收闸延伸到渲染产物（对应主计划 D5）

9. 新增渲染后体检（独立脚本，ffmpeg）：freezedetect 静止段检测、帧数与 durationInFrames 断言、黑场/空白 canvas 检测——后者正是我们 Remotion 4.0.x 的已知风险点。
10. 母版前静帧探针：不渲整片，每镜采样时点渲双帧判静止；我们已有 SSR 逐帧测试，这步把它推进到真实浏览器像素。
11. QA 抽帧 + 拼图：按 cue 抽帧拼 3×4 联系表，供干净上下文的独立评审使用；评审结论必须带帧号，一轮修 P0/P1 即交付，封顶三轮。
12. 落地 E-RT-01/02/03 三个定义了但没实现的渲染期错误码，替换现在笼统的 ConfigError（当前渲染失败实际退出码是 2，与文档承诺的 4 不符）。

### 6.5 第三优先：时间纪律与交付规范

13. 校验增加镜尾保护带：item 落点距 cue/镜头边界 <0.5s 报 warning；增加开镜空台检查（首个锚点过晚时 warning 并要求说明承载画面）。
14. 交付响度规范：成片两遍 loudnorm（I=−15、TP=−1.5、48kHz），写进 render Skill；等声音层立项时再接 sfx 两查（在场/掩蔽）。
15. 分段渲染只做设计预留：短视频周更节奏下不实施并行渲染，但帧数断言和音轨单渲纪律现在就写进渲染器，避免以后返工。

### 6.6 持续：审美与模板纪律吸收

16. “改皮不改命门”与我们的 tokens/safeToEdit 完全同构，纳入配方卡规范；卡的“已知坑”必须随选中带入 storyboard 自检列的做法，纳入根 SKILL.md。
17. 版式轮换判据（同一呈现卡连用 3 镜、占比超 1/3 机器告警）可作为密度校验从“每 cue item 数”升级为“跨 cue 模板多样性”的参考。
18. 首镜先确认：在 05-render 全片前，对第一个含 overlay 的 cue 出单段有声预览给用户确认，再渲全片——这比它的样板镜制度轻，但能拦住“做完 13 镜再改风格”的返工。

### 6.7 明确不借鉴

- 绿幕键控、人物角标化、人物/B-roll 同屏规则、OffthreadVideo transparent 合成链路——人物是被合成素材的前提不成立；
- Fish Audio TTS 接入与 .env API key 流程——我们的入口不含配音生成；
- runtime/ 软链接统一依赖与 Workbench 七轨编辑器——Windows 换机场景与模型操作者定位都不支持；
- Markdown SHOTBOOK + 正则解析体系——我们的强类型 JSON 契约更优，不退化；
- 108 卡的数量与具体卡片内容——继续按资产库计划书的 custom 晋升通道，由真实点位需求驱动扩卡。

## 七、给两个现有计划的增补条目

本次调研结论应回写两处既有文档，不另起计划：

| 落入文档 | 增补内容 |
|---|---|
| 主优化计划书 D2（perceive） | 后端首选改为 YuNet 230KB 先行（opencv_zoo Apache-2.0），MediaPipe 降为手持物/B-roll 候选；安全区外扩参数采用实测口径先跑后调 |
| 主优化计划书 D5（质量验收） | 新增 freezedetect 体检、帧数断言、静帧探针、QA 拼图、一轮独立审片制度；E-RT 错误码落地；镜尾保护带与开镜空台检查 |
| 主优化计划书 D6（决策资产） | 字级精度目标引用 talkcraft 横评数据立参照线（FireRed 中位 40ms/尾 200ms；whisper 尾 413ms）；FireRed 作为可选后端进入待评估决策点 |
| 资产库纳入计划书 | 语义层 manifest 字段预留（sem/weight/entities/need）；选卡候选生成纳入资产生产十步的第 1 步需求确认；许可纪律增加 PolyForm NC 项目“只学方法不抄码”的明确条款 |
| D7（换机） | 不采用 runtime 软链方案；Python 侧依赖（若引入 YuNet 的 opencv-python）纳入 doctor 与 SETUP 清单，模型 230KB 可随 setup 脚本下载并校验 |

## 八、来源

[C1] GitHub API：Vincentwei1021/video-talkcraft 仓库元数据（2026-10-15 查询）— https://api.github.com/repos/Vincentwei1021/video-talkcraft
[C2] GitHub API：main 最新提交 `a7c29ed`（2026-10-12）— https://api.github.com/repos/Vincentwei1021/video-talkcraft/commits/main
[C3] LICENSE 原文：PolyForm Noncommercial License 1.0.0，Copyright (c) 2026 Vincent Wei — https://github.com/Vincentwei1021/video-talkcraft/blob/main/LICENSE
[C4] GitHub API：语言构成 — https://api.github.com/repos/Vincentwei1021/video-talkcraft/languages
[C5] SKILL.md（62KB，八步流程、首镜确认、分段渲染、六闸与三关验收、工作台、交付响度）— https://github.com/Vincentwei1021/video-talkcraft/blob/main/SKILL.md
[C6] references/host-footage.md（输入规格、CPU 抠像、人脸安全区、人物/B-roll 同屏）— https://github.com/Vincentwei1021/video-talkcraft/blob/main/references/host-footage.md
[C7] scripts/timestamps_cpu.py（四后端横评、切段、归一与门控，文件头注释）— https://github.com/Vincentwei1021/video-talkcraft/blob/main/scripts/timestamps_cpu.py
[C8] references/semantic-annotation.md 与 PR #42（语义标注、选卡候选、覆盖闸的起因与规则）— https://github.com/Vincentwei1021/video-talkcraft/blob/main/references/semantic-annotation.md
[C9] scripts/face_bbox.py（YuNet 230KB、采样、并集与安全区外扩）— https://github.com/Vincentwei1021/video-talkcraft/blob/main/scripts/face_bbox.py
[C10] scripts/render_shots.mjs（分段母版、音画三纪律、帧数断言、实测提速数字）— https://github.com/Vincentwei1021/video-talkcraft/blob/main/scripts/render_shots.mjs
[C11] README.md（2026-10-12 版，能力、依赖、实测数据表）— https://github.com/Vincentwei1021/video-talkcraft/blob/main/README.md
