# dsh-video-pipeline 对标分析 —— 与 remotion-overlay-pipeline 的差异与可借鉴点

> 数据截至：2026-10-21（clone 自 `github.com/439436269-ctrl/dsh-video-pipeline`，v0.1.1，MIT，浅克隆 30 层）
> 本仓版本：remotion-overlay-pipeline v0.2.0（commit `0687f31` 之后）
> 证据格式：`[dsh: 文件路径]` 指外部仓库文件，`[vp: 路径]` 指本仓文件。全文不引外部二手评价，全部结论出自两仓源码亲读。

## 0. 一句话总结

**两个仓解决的是同一张短视频生产地图上不相交的两段**：
`dsh-video-pipeline`（下称 dsh）管「**从选题到发布**」——AIGC 生成（TTS/生图/生视频）→ 合成 → 核验 → 多平台发布 → 数据复盘闭环；
本仓（下称 vp）管「**给实拍成片叠动效**」—— 对齐 → 感知 → 起草 → 校验 → 渲染。
执行哲学同源但位置相反：vp 把 LLM 关在「起草」的笼子里（模型只填表，代码执行一切）；
dsh 把 agent 放在驾驶位（skill 契约 + 原子脚本，agent 调度一切）。
**最值得搬的不是任何单个功能，而是它的「成片核验」与「数据复盘闭环」—— 这两块恰好填在 vp 的流程两端。**

## 1. 范围与方法

- 对比维度：定位与运行形态 / 管线阶段 / 质量闸 / 模板与动效体系 / 产物与可追溯 / 工程实践 / 运营闭环。
- 方法：dsh 全仓克隆后逐文件精读（README、lib/ 全部、19 个 skill 的 SKILL.md 逐个、tools/、test/、CHANGELOG、MEMORY.md）；
  vp 侧基于本会话内已完成的源码深读（Code Wiki `docs/wiki/`）与当日基线实测。
- 局限：dsh 的 `scripts/` 下 Python/mjs 脚本未逐行全读（只读了路径与 SKILL.md 契约层）；`test/` 只读了文件清单与 README 描述。涉及处已标注。

## 2. 定位与运行形态对比

| 维度 | dsh-video-pipeline [dsh: README.md:L1-30, package.json] | remotion-overlay-pipeline [vp: README.md, package.json] |
|------|----------------------------------------------------------|----------------------------------------------------------|
| 解决的问题 | 一条**跑通过的 AI 短剧生产流水线**装进 DeepSeek Harness：选题→配音→生图→生视频→合成→核验→发布→复盘 | 在**已拍摄、已粗剪、无文字特效的实拍视频**上自动叠加 motion-graphic overlay |
| 输入 | 诗题/题材（选题门） | 实拍视频 + SRT |
| 输出 | 竖屏成片 + 双平台封面 + 四平台发布链接 + 数据复盘报告 | 叠加动效后的成片 mp4 |
| 运行形态 | **cordis 插件（skill 包）**：`apply(ctx)` 向 `ctx.skills` 注册 provider，19 个 skill 随装随用，无运行时依赖；另有宿主中立版 `video-pipeline-skills`（Claude Code/Codex） | **CLI 代码管线**：`npm run pipeline -- <stage>`，Node/TS 直接执行 |
| 执行主体 | **agent 在环**：LLM 读 SKILL.md 调度，`scripts/`（py/mjs）是 agent 手里的原子工具 | **代码在环**：LLM 只在管线外写 draft（读 skill 起草），管线内零模型调用 |
| 渲染引擎 | ffmpeg（scale/xfade/concat/adelay/amix/ASS 烧字幕/loudnorm） | Remotion 4.0.534（React 组件、多轨重叠动效、--gl=angle） |
| 依赖外部 AI | 火山方舟 Seedream（文生图）/ Seedance（文生视频）/ TTS，按量计费 | 无（whisper.cpp + YuNet 本地推理；测量不用多模态大模型） |

> 观察（非断言）：dsh 的文风、DSH 环境、`tangshi-pipeline` 项目、10-20 提案里「DSH 自带 Node v24.21.0」的提法
> [vp: docs/proposals/2026-10-20 §1]，指向两仓很可能是同一作者的两条产线。本文按「兄弟仓交叉学习」组织，不影响结论。

## 3. 功能矩阵（同一维度同一标尺）

图例：✅ 完整实现 · ⚠️ 部分/初版 · ❌ 无 · 🔜 在 spec 中已规划

| 功能模块 | 子能力 | dsh | vp | 说明 |
|----------|--------|-----|----|------|
| 字幕/对齐 | 词级时间戳（whisper） | ❌ | ✅ | dsh 的字幕是 SRT 直接烧录，无对齐需求（配音由自己 TTS 生成，时间轴自定）[dsh: skills/video-compose/SKILL.md:L34] |
| | TTS 配音 + 多音字读音校正 | ✅（40+ 规则 pinyin_fix.py，新误读回写规则表） | ❌ | [dsh: skills/video-pipeline/SKILL.md:L26] |
| 画面感知 | 镜头切分 / 人脸检测 / 安全区 / 遮挡预算 | ❌（不需要：内容自己生成，无「别压住实拍主体」约束） | ✅（scdet + YuNet + 向量预算 face 0%/handheld 20%/broll 30%） | 问题域差异的根因，见 §5.1 |
| 动效体系 | 结构化模板契约（paramsSchema 逐项校验） | ❌（"模板" = prompt 配方：风格后缀逐字锚定，只许改前段 [dsh: skills/tangshi-pipeline/SKILL.md:L28]） | ✅（family×scope 双轴 + #16 校验 + MotionSpec/SpecRenderer） | |
| | 多轨重叠动效 | ❌（ffmpeg 线性拼接 + ASS 字幕，结构上无法表达） | ✅（C6 双栈，重叠是常态） | |
| | 动画驱动确定性 | ❌ 不适用（无程序动画） | ✅（推进权属于 frame，禁时钟/随机） | |
| 质量闸 | **构建期**结构化校验（错误码、可阻断） | ❌ | ✅（18 项 + E-*/W-* + 语义化退出码） | |
| | **成片核验**（输出侧自动验收） | ✅（media-verify 三件，见 §4.1） | ⚠️（渲染期兜底仅停留在报告说明，无自动化成片检查；render-report 只有墙钟/CPU） | **最大可借鉴点** |
| 合成 | 分镜+配音+SRT→成片（manifest 契约） | ✅（一条 manifest 进、一条成片出；字幕失败自动降级重试） | ❌（vp 不做拼接——输入已是粗剪成片） | 域不同 |
| 发布运营 | 封面/多平台上传/进度回写飞书 | ✅（4 平台并行，一平台一 agent；读回平台确认成功才回写） | ❌ | vp 止步成片 |
| | **数据复盘闭环**（播放数据→修正生产参数） | ✅（衰减分档/龄期窗/采样制度 → 修正选片权重与发布节奏 [dsh: skills/tangshi-pipeline/SKILL.md:L46-54]） | ❌（节奏表阈值全是 🔴 PLACEHOLDER，且**没有任何机制**回收真实反馈来校准） | **第二可借鉴点** |
| | 成本显性化（token 公式/价格表/成本基线） | ✅（research-cost-t195：4 折已死、S 镜头 480p+超分单集 ¥4.26→2.92） | ⚠️（render-report 记录墙钟/CPU，且 cpuPeakPercent=null 如实标注） | |

## 4. dsh 的工程亮点（含实现细节）

### 4.1 media-verify —— 成片核验原子三件 [dsh: skills/media-verify/SKILL.md:L1-45]

1. **astats 分窗能量**：按配音窗/静默窗分段核 RMS（配音窗 -18~-24dB，静默窗 -inf）——对「字幕/配音时间轴是否真的落在该落的地方」给出数值证据；
2. **audio-ncc 版本比对**：判线上视频是否本版文件（粗步进 80ms 找峰 → ±80ms 细扫 → ±16 微调，因为语音 NCC 峰很尖、单步长会跳峰造成假阴性；≥0.9 同版 / <0.3 异版）。曾实证「EP11 读音修复后线上 vs 新 TTS=1.000、vs 旧=0.065 → 证实四平台换血成功」；
3. **brightness 抽帧亮度**：均匀抽 N 帧 meanL，≥250 白屏 / ≤5 黑屏 → FAIL exit 2。

### 4.2 发布工程的「不可撤回」防线 [dsh: README.md:L130-146, CHANGELOG 0.1.0]

- 可复现导入器三模式（`--audit` 只报告 / `--write` 重建 / `--verify` 复扫门），脱敏规则**唯一真源**（scrub-rules.mjs）：85 文件 0 残留、33 脚本语法门、被剔除文件引用检查；
- `verify:artifact`：打包 → 解包 → **真实 import 解出来的入口**——「源码树测试通过不代表 tarball 能用，npm 包不可撤回」；
- provider 以 rank 600 报告候选：用户同名 skill（rank 100-500）胜出，**包不遮蔽用户资产**；
- 占位符系统：`{{TOKEN}}` 加载时按「配置 → 环境变量 → 内置默认值」替换，且**只替换 skill 正文**、scripts 不替换——边界一句话说清。

### 4.3 运营知识的数据化沉淀 [dsh: skills/tangshi-pipeline/SKILL.md:L46-54]

发布节奏与选片权重不是拍脑袋，是**五轮真实数据复盘**的产物：单平台单日 ≤20 条、主波 12:00–15:00、22:00 后晚波实测全地板、首发后 0-24h 生死线、30h 补量硬截止、进池判定锚定同一龄期窗——并且明确记录「原始数据不随包发布，要用同口径请用采集脚本对自己的账号重跑」（可复现口径，不出口数据）。

### 4.4 记忆与确认门纪律 [dsh: MEMORY.md:L1-25, skills/video-pipeline/SKILL.md:L40-48]

MEMORY.md 条目式只追加、不写凭据；两道人工确认门（**门① 报价确认后才动 API 花钱；门② 发布是外部可见动作，不能省**）；「生成图必须目视检查，不能只看代码跑通」（修掉 4 个真实渲染缺陷后写的规矩）。

## 5. 差异点的根因分析

### 5.1 为什么 dsh 没有遮挡/对齐，vp 没有发布/复盘

问题域决定的，不是能力差距：

- **vp 的约束是「不破坏已有画面」**——所以必须有对齐（词在哪）、感知（主体在哪）、遮挡预算（别压脸）、锚点烘焙（帧是真相）。dsh 的画面从第一帧就是自己生成的，这些约束不存在。
- **dsh 的约束是「外部可见 + 真金白银」**——所以必须有报价门、发布确认门、平台风控、数据复盘。vp 的产物不出本机，这些约束不存在。

### 5.2 同一哲学谱系的两极

两仓其实共享同一条纪律基因（很可能是同一作者的进化痕迹）：
「**契约唯一真源 + 两处实现必漂移**」（dsh: 风格后缀逐字锚定 [dsh: tangshi-pipeline L28]；vp: textMetrics/占位值注册表/carrier-window 唯一真源）
、「**实测结论才可入册**」（dsh: 每条运营规则标注来自第几轮复盘；vp: 占位值 🔴 标注 + 实测依据写进 config 注释）
、「**降级/消解必须留痕**」（dsh: 字幕失败降级重试且 README 记录；vp: W-D2-01/W-D4-01 逐条对账）。

分歧在 LLM 的位置：vp 的立场是「测量 vs 选择」——逐词时间戳、bbox 属于测量，容差 ±33ms，多模态模型误差大一个数量级，所以测量归代码，LLM 只做选择（挑模板/填文字）。
dsh 的立场是「agent 即操作员」——整条链都是 LLM 的手，但用 skill 契约 + 原子脚本 + 确认门把每一步的输出形状钉死。
**两者不矛盾：vp 的 motionboard spec（模型读 skill 产意图）本质上就是在向 dsh 的组织方式靠拢一步。**

### 5.3 质量闸的位置互补

- vp：**输入/构建侧**全量校验（18 项，渲染前阻断）——但渲染之后只有墙钟/CPU 记录，**成片本身没有任何自动化验收**。而 vp 自己的 README 就警告过「漏了 --gl=angle 可能产出空白 canvas」[vp: README.md:L134] ——这正是 dsh brightness 一条命令就能抓的缺陷。
- dsh：**输出侧**采样核验（抽帧/分窗）——但构建期没有任何结构化校验（manifest 写错了到合成时才炸）。
- 结论：**两者拼起来才是完整的「构建期阻断 + 成片验收」**。

## 6. 可借鉴清单（差异化 playbook）

### 6.1 Catch-up（他有我无，按价值排序）

| # | 借鉴项 | 落到 vp 的哪里 | 具体做法 | 优先级 |
|---|--------|----------------|----------|--------|
| 1 | **成片核验步**（借 media-verify） | render 阶段尾部或 06-review 新原子命令（如 `npm run pipeline -- verify-output --job x`） | ① brightness 抽帧亮度：抓空白 canvas / 全黑帧（vp 的 --gl=angle 历史风险自动验收）；② astats 分窗：抽 2-3 个 cue 窗验证字幕/配音对位；③ 产物完整性（时长 vs durationInFrames、体积）。结果落 `06-review/output-verify.json`，FAIL 阻断交付 | **高**（成本低、直接堵真实事故） |
| 2 | **数据复盘闭环**（借 tangshi-data-review 的结构） | 新增可选 skill/脚本：采集成片的平台表现 → 修正节奏表/intent 词表权重 | 与 motionboard spec 的 Open question「覆盖率数字带取值」直接闭环：占位值（minCueFramesForMotion、信号强弱门槛）的校准数据源就是它。口径可复现、原始数据不进仓（同 dsh 纪律） | **高**（中期；motionboard 落地后价值最大） |
| 3 | **发布/封面自动化**（借 quad-platform-publish） | 可选下游 skill，不进主管线 | vp 止步成片；若成片要投放，直接复用 dsh 的四平台方法论与确认门设计 | 低（域不同，按需） |

### 6.2 Differentiate（我强，保持并可作为对外输出）

| 优势 | 对 dsh 的潜在输出方向 |
|------|------------------------|
| 18 项构建期校验 + 错误码体系 | dsh 的 manifest/合成参数目前无结构化校验；E-*/W-* + 纯函数校验器思路可直接移植到 video-compose 的 manifest |
| 遮挡向量预算 / 安全区 | 若 dsh 将来做「生成画面上叠字幕/贴片」，vp 的 safeArea 概念可平移（平台 UI 遮挡正是 dsh 已踩的坑：MarginV=90 避开 @账号区 [dsh: video-compose SKILL.md:L34]——这就是一维版的「不遮挡」） |
| 确定性渲染（frame 驱动、可复现逐帧） | dsh 的 image-to-video zoompan 依赖 ffmpeg 参数确定性，无逐帧语义；Seedance 生成是黑盒——vp 的可复现渲染是它没有的能力 |

### 6.3 Innovate（两边都没有，交叉机会）

1. **两仓拼全链**：dsh 生成成片 → vp 叠 overlay 动效 → dsh 发布复盘。vp 的 align 阶段对 dsh 的配音 wav 天然友好（TTS 出的时间轴比 whisper 更准，可跳过对齐或作交叉验证）。
2. **vp 的起草工作流做成 dsh 式 skill 包**（宿主中立）：motionboard spec 已定「模型读 skill + SRT/align 产物 → 产意图」——dsh 的「总入口 + 编排 + 原子」三层结构与占位符机制正是现成的组织范式；vp 现有 `.workbuddy/skills/` 是手工维护、绑定单一宿主的，可借鉴其 `authored/` + 可复现导入器 + rank 不遮蔽设计。
3. **确认门语义对齐**：dsh 的门①（花钱前确认）与门②（外部可见前确认）映射到 vp：渲染（算力成本）前的启动闸已有（validate/fps/版本锁），但「数据复盘触发的重新生产」若落地，需要同款确认门防失控。

### 6.4 不建议搬的部分（诚实清单）

- **agent 在环替代代码管线**：违背 vp 的 P0 确定性与「测量 vs 选择」分工；dsh 自己也为此付出了代价（确认门、采样核验、目视检查规矩都是给 agent 自由度的补偿机制）。
- **ffmpeg 合成替代 Remotion**：xfade/ASS 结构上表达不了多轨重叠动效与组件化模板（这正是 vp README 硬约束 3 的同款论证）。
- **运营节奏规则照抄**：那些数字（≤20 条/日、30h 截止）是 dsh 项目在唐诗内容上的实测，换个内容品类不可迁移——**学方法论（闭环结构），不抄数值**。这条与 vp 自己的占位值纪律同源。

## 7. 行动建议（按 vp 当前路线图接入）

1. **本周可做**：Catch-up #1 成片核验原子（brightness + 时长核对是纯 ffmpeg/ffprobe，半天量级；astats 分窗可复用 vp 已有的 silence.ts ffmpeg 集成经验）。产出进 06-review，作为 validate 之外的输出侧第二道闸。
2. **motionboard 落地时做**：Catch-up #2 的采集端（数据复盘）——它给 intent 词表与节奏阈值提供校准闭环，是「效果一般」问题的终局答案。
3. **随 spec Open questions 一并拍板**：vp 的起草 skill 是否走 dsh 的包工程（authored/ + 导入器 + 宿主中立）——若是，Innovate #2 直接并入 motionboard 的 skill 落点决策。

## 附录：证据索引（dsh 仓）

| 结论 | 证据 |
|------|------|
| 19 skill 结构与定位 | [dsh: README.md:L3, L57-80]；[dsh: tools/scrub-rules.mjs:L20-40] |
| cordis 插件形态 / rank 600 / 无运行时依赖 | [dsh: lib/index.js:L1-69]；[dsh: lib/provider.js:L86-135]；[dsh: README.md:L36-37] |
| 五段流水线与两道确认门 | [dsh: skills/video-pipeline/SKILL.md:L40-48] |
| media-verify 三件与判读阈值 | [dsh: skills/media-verify/SKILL.md:L12-45] |
| video-compose manifest 契约 / 字幕避让平台 UI / 降级重试 | [dsh: skills/video-compose/SKILL.md:L18-45] |
| 数据复盘修正选片权重与发布节奏 | [dsh: skills/tangshi-pipeline/SKILL.md:L46-54, L56-72] |
| 脱敏复扫门 / verify:artifact / npm 不可撤回 | [dsh: README.md:L130-146, L186]；[dsh: tools/verify-artifact.mjs:L59-88] |
| MEMORY 纪律 / 目视检查规矩 | [dsh: MEMORY.md:L1-25] |
| 版本演进（0.1.0 首发 → 0.1.1 文档与工具） | [dsh: CHANGELOG.md 全文] |
