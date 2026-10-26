# video-shotcraft 多维对比与 VideoPipeline 提升方案

> 调研日期：2026-10-15  
> 本地项目：`remotion-overlay-pipeline` v0.2.0  
> 对标仓库：https://github.com/Vincentwei1021/video-shotcraft  
> 结论适用范围：本文比较的是工程能力、产品形态与口播实拍 overlay 场景的适配度，不把两个定位不同的项目按“谁更像完整视频编辑器”作单一排名。

## 一、核心判断

两个项目都把 Remotion 放进 agent skill 工作流，但解决的问题不同。

| 项目 | 核心产物 | 强项形态 |
|---|---|---|
| VideoPipeline | 面向实拍口播视频的分阶段 overlay 管线 | 音轨对齐、词级锚点、阶段快照、结构校验、确定性渲染契约 |
| video-shotcraft | 面向 Claude Code / Codex 的产品宣传片制作能力库 | 镜头配方卡、调校过的 demo、工作台、声音设计、导出发布、画廊与社区验证 |

VideoPipeline 的壁垒在“测量”：SRT 文本权威、whisper 时间推导、词级锚点、遮挡预算和渲染前门控。video-shotcraft 的壁垒在“表达”：124 张镜头配方卡、150 个动态预览、可复制的调校参数、完整工作台和交付链路。后者在 2026-10-15 已有 11,168 stars、995 forks，Apache-2.0 许可，主分支最新提交为 2026-10-13 的 `13c74a7` [C1][C2]。

当前最需要警惕的是：VideoPipeline 的核心承诺“不遮挡主体”还没有内置 perceive 实现，tier2 载体退让也是空操作；5 个模板虽已从灰框推进到真实组件，但仍处于第一轮实现，换机环境与 demo 快乐路径也存在硬伤。换句话说，项目的底层判断是对的，工程骨架也比普通脚本更稳，但距离“每条真实口播素材都能产出可发布成片”还差感知、视觉打磨、环境移植和验收四层兑现。

建议的提升路线不是把 video-shotcraft 的工作台、剪映导出、发布脚本整套搬过来，而是借用它的三类经验：配方卡与参数真相、带帧号的独立审片、模板/实现/预览一致性门禁。VideoPipeline 应继续收窄在“实拍口播自动叠加 overlay”这条链路上，把词级时间与主体避让做成对方没有的差异化能力。

## 二、证据基准

### 2.1 本地项目核验

本次直接读取了 `README.md`、`PROGRESS.md`、`docs/`、`src/`、`tests/` 与配置文件，并运行了以下命令：

| 验证项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | 12 个测试文件、219 项测试全部通过 |
| `node -v` | v21.2.0，低于 `package.json` 要求的 Node.js 22.19.0；当前测试可跑，但不代表 Remotion 渲染环境受支持 |
| Git HEAD | `32bd088`，提交时间 2026-10-14 17:18:35 +0800 |
| 工作树状态 | 2026-10-15 的模板实现、tokens、caption、模板测试等文件仍有未跟踪或未提交改动 |

本地代码的关键事实包括：

- `perceive` 阶段仍只支持 `PERCEIVER_CMD` 外部命令；未配置时直接报错，不会伪造检测结果，见 [src/stages/perceive.ts](../../src/stages/perceive.ts)。
- 10 个模板声明完整，其中 5 个 `overlay-safe` 模板已有真实 Remotion 组件，另外 5 个进入显眼占位块，见 [src/templates/builtin.ts](../../src/templates/builtin.ts) 与 [src/remotion/templates/index.tsx](../../src/remotion/templates/index.tsx)。
- 内置 whisper 路径仍默认写死 `G:/VideoPipeline/whisper.cpp`，见 [src/stages/builtin-align.ts](../../src/stages/builtin-align.ts)。
- `CARRIER_FALLBACK` 为空，tier2 只返回“尚未实现”的状态，不改写 motion 或 footprint，见 [src/core/config.ts](../../src/core/config.ts) 与 [src/validate/occlusion.ts](../../src/validate/occlusion.ts)。
- README 推荐的 demo 重跑路径目前会被 draft 中两处已禁止的 `highlightColor` 拦住；该参数不在 `karaoke-word` 的 `paramsSchema` 内，见 [examples/demo/03-storyboard/motionboard.json](../../examples/demo/03-storyboard/motionboard.json)。
- 项目没有根 `SKILL.md`、`.env.example`、`SETUP.md`、`doctor` 命令、ESLint 配置和 GitHub Actions 工作流。

### 2.2 对标仓库核验

video-shotcraft 的 GitHub API 元数据显示：仓库创建于 2026-07-19，默认分支 `main`，主要语言 TypeScript，仓库规模 199,138 KB，Apache-2.0 许可 [C1]。主分支最新提交 `13c74a7` 的时间为 2026-10-13 07:09 UTC，内容为 README、赞助信息与工作流动图更新 [C2]。

需要注意一个口径差异：GitHub API 的仓库描述仍写“152 shot recipe cards, 209 motion previews”，而 main 分支 README/SKILL 在 2026-10 改版后的口径为 124 张配方卡、150 个镜头样式 [C1][C3]。本文按 main 分支文档与目录口径分析，同时记录该元数据漂移。

## 三、项目画像对比

| 维度 | VideoPipeline | video-shotcraft |
|---|---|---|
| 目标素材 | 已拍摄、粗剪、无文字特效的中文实拍口播视频 | Web/桌面产品截图、产品文案、DOM 页面、可选真实视频素材 |
| 输入 | 视频 + SRT + source manifest + 模型起草 draft | 产品 URL/本地页面、截图、文案、品牌方向、镜头选择 |
| 输出 | Remotion 工程、render props、MP4 | MP4 双版本、Remotion 工程、工作台工程、剪映草稿、多平台发布入口 |
| 时间基准 | 人声词级锚点，锚点烘焙成帧 | 镜头时间表、相对帧表达式、BGM beat |
| 核心难点 | 对齐、主体避让、安全区、多轨重叠 | 镜头语言、视觉质感、节奏、声音设计、终检 |
| 自动化位置 | CLI 阶段管线；模型作为操作者读取分阶段 skill | 根 `SKILL.md` 编排 agent；八阶段制作流 |
| 当前资产深度 | 契约和规则厚，视觉模板刚完成第一轮 | 视觉资产、参考实现、画廊、工作台、导出链路成熟 |
| 部署形态 | 本地 Node CLI，单仓库 | 本地 agent skill + 多 package、Python 工具、GitHub Pages 画廊 |
| 社区状态 | 私有项目，无公开社区指标 | 2026-10-15 约 11,168 stars / 995 forks [C1] |

二者不是简单的“功能多寡”关系。video-shotcraft 可以教会 VideoPipeline 如何沉淀视觉经验，但它的 PageCam、网页截图三件套、产品宣传片工作台并不直接服务真人脸、手持物和字级口播避让。

## 四、功能矩阵

| 能力 | VideoPipeline | video-shotcraft | 对 VideoPipeline 的含义 |
|---|---|---|---|
| Remotion 渲染 | 有，锁定 4.0.534，`--gl=angle` | 有，模板与工作台钉在 4.0.484 | 双方都把 Remotion 作为确定性渲染底座 |
| 实拍视频输入 | 有，核心输入 | 支持较弱，主要通过 `ClipCard` 封装 mp4 | VideoPipeline 场景更聚焦 |
| SRT 解析 | 有，22 项 SRT 测试覆盖 | 无对应能力 | 这是本地项目的基础优势 |
| 音频强制对齐 | 有，内置 whisper.cpp segment + SRT 文本 DP 匹配 | 无 ASR/强制对齐阶段 | 应继续强化，不应被视觉模板工作稀释 |
| 字级/词级锚点 | 有 `word:N` 锚点和烘焙器；中文单字精度仍需量化 | 无 | 若精度不足，应先提供短语级高亮降级 |
| 人脸/手持物/B-roll 检测 | 有契约和预算，无内置实现 | 无此设计 | 这是 VideoPipeline 必须补齐的核心短板 |
| 遮挡预算 | 人脸 0%、手持物 20%、B-roll 30%，规则明确 | 不适用 | 规则领先，但未形成端到端能力 |
| tier1 平移避让 | 校验内存中会改写 footprint | 不适用 | 结果缺少进入最终 render props 的持久通道 |
| tier2 载体退让 | 声明但未实现 | 不适用 | 需先补数据契约与 split-frame 实现 |
| 模板声明 | 10 个 | 124 张镜头配方卡 | 不应追求数量，先把 10 个做深 |
| 模板真实实现 | 5 个第一轮实现，5 个占位 | 大量参考 demo 和精选预览 | 本地项目需要参数真相与样片层 |
| 模板参数契约 | `paramsSchema`、必填字段、未知键阻断 | CardDef、schema、workbench props | 本地契约更严格，可视化暴露不如对方 |
| 颜色令牌 | 有统一 tokens，禁止模型传颜色 | 部分组件存在硬编码颜色 | 应守住令牌制，不直接抄其颜色代码 |
| 静态 styleframe | 无 | 有，阶段 1 强制先做 HTML/CSS 风格帧 | 可增加低成本模板预览/时间轴预览 |
| 画廊与动态预览 | 无 | 有，150 个镜头样式预览与 library.json | 可先为 5 个模板生成静帧/短视频索引 |
| Agent 根入口 | 无根 `SKILL.md`，有 5 个阶段 skill | 根 `SKILL.md` 明确模式、路由与收尾 | 本地应补编排层 |
| 人工确认 | fullscreen 确认已接线；alignment/F6 确认缺少消费 | 共同创作模式有多个确认点 | 需要把确认记录真正接入阶段门控 |
| 浏览器编辑器 | 无 | Vite + Remotion Player 多轨工作台 | 当前不建议照搬，先做只读预览和安全参数表单 |
| SFX/BGM | 无 | 149 个 SFX、5 个 BGM、节拍分析 | 视觉链路稳定前不要提前扩张 |
| 剪映导出 | 无 | 有，macOS 实测，Windows 未真机验证 | 不适合近期引入，平台风险高 |
| 多平台发布 | 无 | 有第三方 Upload-Post API 脚本 | 与当前内部生产工具目标无关 |
| 像素 parity | 无 | 工作台导入版与原合成做同帧 PNG 对比 | 可借鉴到模板和确定性渲染验证 |
| CI | 无 | 单测、生成物一致性、workbench build、demo 首帧冒烟 | 本地至少应先有 `verify` 脚本，后续再接 CI |

## 五、工程与架构维度对照

| 维度 | VideoPipeline | video-shotcraft | 判断 |
|---|---|---|---|
| 分层清晰度 | core、validate、templates、remotion、stages 分层明确 | Markdown skill、demos、assets、template、workbench、gallery、publish 多域并存 | VideoPipeline 更容易维护单一链路 |
| 阶段快照 | 每阶段独立目录，下游不回写上游 | 八阶段方法论主要靠 agent 遵守 | VideoPipeline 的机器约束更硬 |
| 错误码 | E/W 编号清楚，但部分退出码和实现不一致 | 终检规则和审美规则编号清楚 | 双方都受益于编号化，本地需修退出码漂移 |
| 数据契约 | 类型集中，模板参数严格校验 | CardDef、WORKBENCH manifest、镜头时间表分工更细 | 本地契约应按消费者拆分，删除或实现零消费字段 |
| 运行时依赖 | 4 个运行时依赖，栈轻 | template、workbench、Python、ffmpeg、uv、puppeteer 等多栈 | 轻栈是 VideoPipeline 应守住的优势 |
| 版本锁定 | Remotion 精确锁定，但 devDependency 中的官方包仍有浮动范围 | 相关 package 内 Remotion 同版锁定，CI 覆盖 | 本地应把官方扩展包也纳入自检 |
| 确定性 | 禁用随机数和运行时钟，组件由 frame 驱动 | 同样禁用 `Date.now()` / `Math.random()`，有 mulberry32 | 双方都有防御规则，均缺少双渲染像素 diff 证明 |
| 测试 | 219 项单元/SSR 测试，逻辑覆盖强 | 根单测不多，但有 build、首帧冒烟、legacy、parity 等门禁 | 本地测试深，对方测试形态更完整 |
| 跨平台 | 目标是 Windows，但存在 G 盘默认路径与 ffmpeg 环境问题 | macOS 优先，Linux 有说明，Windows 剪映链路未验证 | 本地只要修好安装路径就有场景优势 |
| 文档资产 | SPEC、ADR、proposal、changelog、stage skills 丰富，但计数与状态已有漂移 | README、SKILL、配方卡、审美规则、终检文档、多语言 README 完整 | 本地需要文档同步测试，不靠记忆维护 |
| 社区成熟度 | 私有研发项目 | 高关注度、issue、PR、showcase、画廊 | 对方提供经验，不构成短期直接竞争压力 |

### 5.1 综合评分

评分只针对“实拍口播自动叠加 overlay”这一场景，5 分代表该维度在当前目标下成熟度高。

| 维度 | VideoPipeline | video-shotcraft | 说明 |
|---|---:|---:|---|
| 场景贴合 | 5.0 | 2.0 | 对方服务产品宣传片，并非口播避让 |
| 音轨与语义对齐 | 4.0 | 1.0 | 本地已有 SRT + whisper + DP，但中文单字精度仍需量化 |
| 主体感知与避让 | 2.0 | 1.0 | 本地规则明确但实现缺失；对方不以该问题为目标 |
| 视觉模板资产 | 2.5 | 5.0 | 对方有配方卡、demo、预览、审美档案 |
| 动效可发布度 | 2.5 | 4.5 | 本地 5 个模板刚完成第一轮，对方已有完整样片和模板 |
| Agent 编排 | 3.0 | 5.0 | 本地有阶段 skill，缺根入口和模板选择预览 |
| 结构校验 | 4.0 | 3.5 | 本地 16 项构建期校验更严格 |
| 审美验收 | 2.0 | 4.5 | 对方有审美规则、静帧验收、独立上下文审查 |
| 自动化测试与门禁 | 3.5 | 4.0 | 本地单测多但无 CI/E2E；对方 CI 和冒烟更完整 |
| 编辑与交付 | 1.0 | 5.0 | 对方已有工作台、剪映导出和发布脚本 |
| 轻量与易安装 | 3.0 | 2.0 | 本地栈轻，但 G 盘路径、模型下载和 Node 版本拉低体验 |
| Windows 适配 | 3.0 | 2.0 | 本地以 Windows 为实际环境，但尚未形成一次成功安装 |
| 文档与知识沉淀 | 4.0 | 5.0 | 本地 ADR 很强，视觉参数知识不足且已有漂移 |
| 社区与外部验证 | 1.0 | 5.0 | 公开关注度差距明显 |

## 六、双方 SWOT

### 6.1 VideoPipeline

| 内部/外部 | 正向 | 负向 |
|---|---|---|
| 内部 | SRT 权威、音频时间推导和词级锚点构成清晰差异化；阶段快照、16 项校验、219 项测试让核心数据不易悄悄出错；渲染模板遵守 frame 时钟和颜色令牌，长期可维护性好 | perceive 无内置实现；5 个模板仍需真素材打磨；tier2 未实现；环境路径写死；人工放行回路不完整；demo 与文档已有漂移 |
| 外部 | 口播短视频、知识类视频、产品讲解视频都需要字幕/字卡自动避让；video-shotcraft 验证了 agent + Remotion skill 的接受度；姊妹项目 video-talkcraft 证明口播方向也有市场关注 | video-talkcraft 已覆盖字级对齐、人脸安全区、透明通道等更相近能力；用户对动效质感的预期会被 shotcraft 类项目抬高；模型与 Remotion 版本变化可能带来维护成本 |

### 6.2 video-shotcraft

| 内部/外部 | 正向 | 负向 |
|---|---|---|
| 内部 | 配方卡、参考实现、预览、终检规则、工作台和导出形成完整制作系统；CI 能抓生成物漂移、编译失败和 demo 首帧崩溃；社区关注度高，样例反馈充足 | 仓库约 194 MiB，多 package、多语言工具链，维护面大；核心提交集中在少数作者；质量部分依赖 agent 按 SKILL 执行；单测数量不多 |
| 外部 | Claude Code/Codex 用户和独立开发者需要快速产品宣传片；GitHub Pages 画廊降低理解成本；产品视频与社媒发布天然相连 | 网页截图地基不适合真人实拍避让；macOS 偏心、Windows 剪映链路未验证；Remotion 公司许可、第三方发布 API 和逆向剪映格式都可能带来长期成本 |

## 七、VideoPipeline 的关键问题

### 7.1 demo 快乐路径当前不可复现

README 声称示例 storyboard、validate、dry-run 可以得到 0 error / 2 warning。但按当前 draft 重跑时，两处 `highlightColor` 会触发 `E-P1-01`。这会让第一次验证项目的人在第一组命令处失败，也说明示例缺少跨阶段集成测试。

### 7.2 主体避让仍停留在规则层

`perceive` 没有内置检测后端，核心卖点“不遮挡主体”无法在真实视频上端到端执行。tier1 的平移只发生在校验器构造出的内存对象中；`validate` 写出的报告不包含改写后的完整场景，随后的 `render` 会重新 `buildContext`，没有读取这份平移结果。tier2 则明确不改写数据。

因此，当前遮挡系统同时存在三个断点：没有检测结果、没有持久 placement plan、没有 carrier 渲染实现。

### 7.3 5 个模板解决了灰框问题，但还没有解决发布问题

5 个 `overlay-safe` 组件已经让字幕、强调字、下三分之一、胶囊标签和数字卡片产生不同画面，这是关键进展。但当前仍缺：

- 真浏览器下的 5 个模板逐帧视觉确认；
- 进入、停留、退出的时值手感表；
- 供模型选模板的静态图/动态预览；
- 字号、对比度、安全区、最小有效字高等可量化审美断言；
- 独立审片报告。

### 7.4 换机使用会被环境问题阻断

内置对齐器默认查找 `G:/VideoPipeline/whisper.cpp`，线程数固定为 8，缺少 `.env.example`、`SETUP.md` 和 `doctor`。当前审计环境 Node.js 版本还低于项目要求。对于“会换电脑跑”的使用方式，这比增加新模板更优先。

### 7.5 人工确认没有形成完整回路

对齐门控失败时，CLI 提示写 `06-review/confirmed.json`，但 storyboard 只检查 `align-report.json` 中的 `gatePassed`，没有消费 alignment 阶段的确认记录和 overrides。F6 低置信主体的人工补框同样缺少读入方。真正接线的只有 fullscreen 确认。

### 7.6 文档和代码计数已有漂移

README 仍有旧测试数量，CLI/validate 注释仍出现“15 项”口径，部分文档还写着 align 没有内置实现。ADR 体系是本项目的优势，但一旦计数、状态和路径靠人工维护，优势会变成误导。

## 八、提升方案

### 8.1 设计原则

1. 不照搬完整工作台、剪映导出和发布链路，避免在核心链路未通前扩大维护面。
2. 借方法论，不直接抄组件代码；若复制 Apache-2.0 代码，必须保留许可与修改声明。video-shotcraft 部分组件的硬编码颜色也不符合本项目的 tokens 规则。
3. “测量”和“选择”继续分层：时间戳、bbox、遮挡率走确定性算法或专用模型；模板选择、文案层级、审美判断由读取 skill 的模型完成。
4. 所有自动避让必须产生可审计、可重放、能进入渲染的数据，不停留在 warning 文本里。
5. 模板数量让位于真实成片质量；10 个首批模板全部可发布之前，不扩张 BGM、SFX、发布器和复杂多轨编辑器。

### 8.2 P0 先恢复可信的最小闭环

| 事项 | 具体做法 | 完成判据 |
|---|---|---|
| 保护当前 D1 成果 | 梳理未跟踪的 `caption.ts`、`tokens.ts`、`src/remotion/templates/`、模板测试和探针文件；在用户明确需要时再提交，避免继续叠加新改动 | 模板实现与测试有可恢复的版本点 |
| 修复 demo 漂移 | 从 draft 的 karaoke 参数中移除 `highlightColor`，重新烘焙 storyboard，使 README 的三命令恢复为 0 error / 2 warning | 临时 job 中连续运行 storyboard、validate、render `--dry-run` 成功 |
| 增加跨阶段集成测试 | 测试复制 demo fixture 到临时目录，执行三阶段命令，断言错误数、warning 码、render props 中的双栈与 caption 数据 | 以后 draft、schema、fixture 任一处漂移都会失败 |
| 更新过期口径 | 同步 README、CLI help、validate 注释、demo README 中的 15/16 项、测试数量、align 内置状态 | 文档搜索不到旧计数和“align 无内置实现”表述 |
| 修正渲染退出码 | 为渲染失败定义独立错误类型，返回退出码 4；参数缺失仍返回 2；中断信号保留 130 | 模拟 Remotion 启动失败时退出码与文档一致 |
| 建立本地 verify 命令 | 新增 `npm run verify`，串行跑 typecheck、test、demo 三阶段 dry-run、禁用 API 静态扫描 | 一条命令能判断当前工作树是否可继续开发 |

P0 的目标不是增加功能，而是让“现有成果可信”。当前 219 项测试只能证明单元行为，不能证明 README 的第一条快乐路径仍成立。

### 8.3 P1 让 5 个模板达到可发布水平

| 事项 | 具体做法 | 完成判据 |
|---|---|---|
| 真实渲染验收 | 用 Remotion still 分别截取每个模板的入场、中间、退出帧，再渲染一条包含 5 个模板的短视频 | 5 个模板都有真实浏览器证据，不再只依赖 SSR 差异 |
| 模板配方卡 | 每个模板记录适用语义、所需参数、典型时长、footprint、失败样式、参数调大调小的后果 | 模型可以只读卡和预览选择模板，不靠组件源码猜效果 |
| 模板预览索引 | 生成机器可读 `template-manifest.json`，字段包含 id、版本、状态、预览路径、适用 cue、是否依赖 perceive | 根 skill 能按场景筛选模板，未实现模板不会被选为正式方案 |
| 参数手感表 | 为 `boxed`、`enter`、`title/subtitle`、`value/unit` 等参数记录默认值、建议区间和越界后果 | 二次调参有可检索依据，不靠记忆 |
| 审美断言 | 把字幕有效字高、对比度、最小停留帧长、退出位移动画、安全区边距写成可自动执行的测试 | 可量化的审美问题不再靠人工逐条发现 |
| 独立终检 | 定义 `06-review/frame-review.json`，由未参与制作的上下文按帧号输出问题；没有帧号的“感觉不好”不进入阻断 | 至少在一条真实素材上完成一次带证据的终检 |

video-shotcraft 最值得借的是“卡给语义，demo 源码保存调校过的参数真相”。VideoPipeline 不必一次做 124 张卡，但首批 5 个模板必须从“能渲染”升级为“可选择、可调参、可验收”。

### 8.4 P1 同步解决换机一次成功

| 事项 | 具体做法 | 完成判据 |
|---|---|---|
| 去除绝对路径 | whisper 默认目录改为相对仓库根解析，不再默认 `G:/VideoPipeline/whisper.cpp` | `src/` 中生产代码的盘符绝对路径数量为 0 |
| 集中环境声明 | 增加 `.env.example`，列出 `WHISPER_CPP_PATH`、`WHISPER_MODEL`、`ALIGNER_CMD`、`PERCEIVER_CMD` 的含义与缺省行为 | 新机器不需要从源码里找环境变量 |
| 增加 doctor | `npm run doctor` 检查 Node 版本、ffmpeg、whisper 可执行文件、模型 sha256、项目目录、Remotion 版本 | 开跑前报告缺什么，不在阶段中途失败 |
| 完善安装文档 | 写 Windows 从零安装步骤，包含 ffmpeg、whisper.cpp、模型下载、续传和校验 | 照文档可在新机器准备环境 |
| 版本自检补全 | 把 `@remotion/install-whisper-cpp` 也纳入同版检查，`package.json` 读取路径相对模块位置解析 | 官方包版本漂移会在启动前暴露 |

### 8.5 P1 校准门控并接通人工放行

| 事项 | 具体做法 | 完成判据 |
|---|---|---|
| 阈值样本校准 | 选 5-10 条不同语速、噪声、口误情况的真实素材，记录 mean confidence、alignedRatio、低置信词比例和人工判断 | 每个阈值有分布依据，参数级决策写入文档 |
| 降级密度规则 | 在 `maxItemsPerCue=3` 校准前，把它从硬 error 调整为 warning，或按模板类型设不同密度 | 未校准值不会直接阻断真实素材 |
| alignment 放行接线 | storyboard 读取 `06-review/confirmed.json` 的 alignment 确认与 overrides，并把放行原因写入 storyboard meta | 门控失败后存在受支持、可审计的继续路径 |
| F6 人工补框接线 | 允许 review 阶段提供人工修正的 region 文件，并在 perceive 结果中标记来源与置信度 | 低置信主体不再只有提示，没有入口 |
| 字级精度评估 | 量化当前中文逐字高亮的中位误差和 P95 误差；若不满足目标，默认改成短语/cue 级高亮 | `karaoke-word` 的视觉速度与音频误差匹配，不伪造单字精度 |

### 8.6 P2 补齐主体感知和 placement plan

#### 8.6.1 先做技术验证

在正式接入前，用同一组真实素材比较两条路线：

- Node / WebAssembly 侧的 MediaPipe Tasks Vision；
- Python MediaPipe 或同等专用视觉模型 sidecar。

比较项包括 Windows 安装成本、CPU 耗时、face/hand/pose 输出质量、许可证、模型体积、是否需要 GPU、失败时是否能产出明确错误。结论写入 ADR，再决定是否新增运行时依赖。不要为了“保持 Node 单栈”而选择 Windows 安装不稳定的方案，也不要为了快速实现引入无法维护的大型 Python 环境。

#### 8.6.2 固化感知产物契约

perceive 内置后端应继续输出已有的 `shots.json` 与 `regions.json`，每个区域至少包含：

- `kind`：face、handheld、broll；
- `box`：归一化坐标；
- `confidence` 与 `source`：模型、版本、抽样帧；
- `shotId` 与时间范围；
- `lowConfidence` 与人工修正状态。

验收时用人工标注的抽样帧比较 bbox，不用演示截图替代。建议先以“人脸绝不可压、手持物和 B-roll 控制在预算内”为目标，不追求逐帧跟踪。

#### 8.6.3 新增 placement plan

建议在 04-validate 阶段写出 `placement-plan.json`，作为可渲染的派生事实：

```json
{
  "schemaVersion": "1.0",
  "placements": [
    {
      "ref": "track-a/003",
      "action": "nudge",
      "originalFootprint": [0.10, 0.20, 0.30, 0.18],
      "resolvedFootprint": [0.10, 0.42, 0.30, 0.18],
      "reason": "face-overlap-budget",
      "confidence": 0.93,
      "requiresReview": false
    }
  ]
}
```

render 只消费 `validate-report.ok=true` 且与 storyboard hash 对应的 placement plan：

- `nudge` 在预算内自动生效；
- `carrier` 必须有 carrier 模板与渲染变换，默认进入 review；
- `manual-region` 标记人工修正来源；
- plan 与 storyboard 版本不一致时拒绝渲染。

这一步能修复当前 tier1 只在校验过程中临时移动、最终渲染却重新读取原 footprint 的断裂。

#### 8.6.4 实现 carrier/split-frame 与背景链

split-frame 应表达源视频被缩放到哪个载体框、留白区域放什么 overlay、主体裁切边界如何计算。punch-in 则作为 footage transform 独立实现。只有在背景链真实改变视频画面后，tier2 才能从 warning 变成解决方案。

### 8.7 P2 补齐根 skill 和模型选择契约

根 `SKILL.md` 应回答模型五个问题：

1. 当前 job 处于哪一阶段，上一阶段产物是否存在；
2. 什么情况下必须停，不允许降级硬跑；
3. 每类 cue 应优先选哪些模板；
4. 模板需要什么参数，哪些字段绝不能由模型填写；
5. 渲染后如何截取帧号、如何写独立审查报告。

根 skill 不直接复制 5 个阶段 skill，而应做索引和路由。模板选择数据放在 manifest，视觉判断引用预览图，规则仍留在阶段 skill。

### 8.8 P3 扩张顺序

| 顺序 | 能力 | 前置条件 | 不提前做的原因 |
|---|---|---|---|
| 1 | `ambience/noise-grain`、`cinematic/punch-in` | 背景链与 fullscreen 规则稳定 | 属于视觉层增强，但不应早于 P0/P1 |
| 2 | `carrier/split-frame` | placement plan 与数据裁决完成 | 它是 tier2 的执行载体 |
| 3 | `annotation/pointer-callout` | perceive 区域稳定 | 没有目标框会变成装饰箭头 |
| 4 | `transition/whip-pan` | fullscreen review 流程完整 | 全画面转场必须有确认闸 |
| 5 | 只读时间轴/模板预览页 | template manifest 与静帧产物稳定 | 先让模型选对，再考虑人工微调 |
| 6 | SFX/BGM | 视觉节奏稳定、词级时间可信 | 音频会增加节奏耦合，不宜先做 |
| 7 | 剪映/透明通道/外部发布 | 内部成片链路稳定且确有跨工具需求 | video-shotcraft 的 Windows 剪映链路仍未验证 |

## 九、不建议照搬的部分

| video-shotcraft 能力 | 不建议近期照搬的原因 | 可借的部分 |
|---|---|---|
| 完整浏览器工作台 | 维护成本高，当前痛点是自动出片而不是多人剪辑 | WORKBENCH manifest 的消费者分层、安全参数与节奏命门分离 |
| 124 张镜头卡整库引入 | 大多数镜头假设输入是网页截图/DOM，不服务真人避让 | 卡片结构、“已知坑”、参数调手感、参考实现指向 |
| 剪映导出 | 依赖 pyJianYingDraft，格式随剪映变化，Windows 未真机验证 | 干净底片、原生字幕轨、独立音频轨的分层思路 |
| 多平台发布脚本 | 需要第三方 API 与平台凭据，和当前内部工具无关 | dry-run、幂等查询、防重复发布的错误处理思想 |
| PageCam 2.5D | 地基是网页截图和 layout.json，不是连续实拍 | 相机参数、缓动和“未使用新特性时输出等价”的兼容性测试 |
| 直接复制 Caption/DigitRoll 代码 | 契约不匹配，且部分颜色硬编码，Apache-2.0 还要求修改声明 | 只借运动曲线、数字运动和组件拆分方式 |
| BGM 节拍优先 | VideoPipeline 的第一时间基准是人声词点 | 画面锁定后再做声音、相对帧表达式 |

## 十、姊妹项目 video-talkcraft 的提醒

video-shotcraft 不是最贴近 VideoPipeline 的同作者项目。`video-talkcraft` 明确面向 voiceover-driven explainer videos，2026-10-15 有 1,505 stars、149 forks，GitHub 标记许可证为 Other/NOASSERTION [C9]。公开描述显示它包含字级语音同步、talking-head、109 个动效配方卡等能力；其 README 还提到人脸安全区、实拍人物素材、透明通道和分段渲染。

这对 VideoPipeline 有两层含义：

1. 口播方向已被验证，VideoPipeline 不应退回到泛用视频生成器或普通动效库。
2. 后续应单独精读 video-talkcraft 的对齐、人脸框和透明通道设计，但因其许可证不是 Apache-2.0，只能做方法研究，不能默认复制代码。

## 十一、目标指标

| 指标 | 当前值 | 近期目标 | 中期目标 |
|---|---:|---:|---:|
| 类型检查 | 通过 | 通过 | 通过 |
| 自动化测试 | 219 项 | 增加 demo 跨阶段集成测试 | 增加视觉断言与 placement 测试 |
| 模板实现 | 5/10 第一轮 | 5/10 可发布 | 10/10 可渲染，按依赖分批完成 |
| 模板预览 | 0 | 5 个模板均有静帧 | 10 个模板均有静帧或短视频 |
| 真实渲染确认 | 不完整 | 5 个模板真实浏览器验收 | 每条真实素材自动抽帧审查 |
| perceive 外部配置依赖 | 必须配置 | 完成技术选型 | 内置后端可跑，外部命令仍可覆盖 |
| 生产代码盘符绝对路径 | 2 处默认 G 盘 | 0 | 0 |
| doctor 自检 | 无 | Node/ffmpeg/whisper/model 可检 | 包含 perceive 与渲染环境 |
| 未校准且硬阻断的阈值 | 存在 | 密度规则先降级 | 全部阈值有样本依据 |
| placement plan | 无 | nudge 可渲染 | carrier 可渲染、可审查 |
| 根 SKILL.md | 无 | 完成编排入口 | 模板选择和帧审流程闭环 |
| 本地 verify 命令 | 无 | 有 | 可作为提交前固定验证 |

## 十二、结论

VideoPipeline 不应试图成为“小一号的 video-shotcraft”。后者已经证明自己擅长产品宣传片的视觉表达，而 VideoPipeline 的机会在于把口播音频、词级时间、主体检测、安全区、模板参数和 Remotion 渲染串成一条可重复的机器管线。

短期最重要的不是扩功能，而是修复 demo、保护已完成的 5 个模板、解决换机环境、让真实渲染和独立审片成立。中期再补 perceive 与 placement plan，把“不遮挡主体”从文档规则变成渲染结果。只要这条窄链路稳定，模板数量不必追平 124 张卡，VideoPipeline 也能在口播视频场景里形成 video-shotcraft 不具备的优势。

## 外部来源

[C1] [GitHub API: Vincentwei1021/video-shotcraft](https://api.github.com/repos/Vincentwei1021/video-shotcraft)  
[C2] [GitHub API: video-shotcraft main 最新提交](https://api.github.com/repos/Vincentwei1021/video-shotcraft/commits/main)  
[C3] [video-shotcraft GitHub 仓库](https://github.com/Vincentwei1021/video-shotcraft)  
[C4] [video-shotcraft PR checks 工作流](https://github.com/Vincentwei1021/video-shotcraft/blob/main/.github/workflows/pr-checks.yml)  
[C5] [video-shotcraft SKILL.md](https://github.com/Vincentwei1021/video-shotcraft/blob/main/SKILL.md)  
[C6] [video-shotcraft 制作流水线文档](https://github.com/Vincentwei1021/video-shotcraft/blob/main/references/pipeline.md)  
[C7] [video-shotcraft 工作台契约](https://github.com/Vincentwei1021/video-shotcraft/blob/main/references/workbench.md)  
[C8] [video-shotcraft 剪映导出文档](https://github.com/Vincentwei1021/video-shotcraft/blob/main/references/jianying-export.md)  
[C9] [GitHub API: Vincentwei1021/video-talkcraft](https://api.github.com/repos/Vincentwei1021/video-talkcraft)
