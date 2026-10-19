# 项目长期记忆 — video pipeline

> **本文件只放跨机成立的项目知识**。
> 本机路径 / 素材 / `jobs/` 进度 / 本机环境坑 ⇒ 写 `.workbuddy/memory/LOCAL.md`（已 gitignore，各机独立）。
> 真实数字见 `PROGRESS.md`，变更史见 `docs/changelog/`，裁决见 `docs/decisions/OPEN-DECISIONS.md` —— **本文件不复述它们**，只留「不读会踩坑」的判断。

## 定位

- Remotion 视频动效叠加管线：在实拍口播粗剪上叠 motion-graphic overlay。Node ≥22.19 / ESM / tsx / MIT。
- 两工作区共用 **PUBLIC** 远端 `github.com/bill1994/FansticBVideoPipeline`（main）⇒ `docs/proposals/` 与 `.workbuddy/memory/` 随仓库公开。
- 🔴 **定位 = 「被模型读取的 skill pipeline」**：模型即操作者，**仓库不调模型**；`03-storyboard/draft.json` 是模型产物的等价物。

## 命令

```bash
npm run pipeline -- <stage> --job <id> [--jobs-dir <dir>]   # align|perceive|storyboard|validate|render|init
npm run typecheck && npm test
npm run doctor                  # 7 项环境自检（换机第一步；fail 都带具体做法）
npm run placeholders            # 占位值计数 + 重新生成 PARAM-DECISIONS.md（--check 只校验）
```

demo（无需真实素材）：`storyboard`（须带 `--draft`）→ `validate` → `render`，`--jobs-dir examples`。
⚠️ **阶段目录是不可变快照**：存在即跳过，改了对齐/感知代码后必须加 `--force`，否则白等。
⚠️ **长任务别 `| tail`**：会把错误吞掉，失败时只剩「渲染失败」四个字。一律重定向到日志再 grep。

## 结构（细节见 PROGRESS.md §二）

| 路径 | 职责 |
|------|------|
| `src/cli.ts` | 唯一入口：参数解析 + 阶段分发 + 语义化退出码（0/1/2/…/6/130） |
| `src/core/` | 契约 `types.ts` / 错误码 `errors.ts` / 锚点→帧 `bake.ts` / 两道闸+动态T `schedule.ts` / job 目录+快照守卫 `io.ts`（**`writeStageJson` 是唯一写盘入口**）/ **载体几何唯一真源 `carrier-window.ts`** / **占位值唯一真源 `placeholders.ts`** / 环境自检 `doctor.ts` |
| `src/stages/` | `align`→`builtin-align`→`whisper-adapter`+`text-align`(DP)；`perceive`→`builtin-perceive`→`shot-detect`(ffmpeg scdet)+`yunet`+`region-derive`；`storyboard`/`validate`/`render` |
| `src/validate/` | 构建期校验（纯 JSON→JSON）+ `context.ts` 唯一读盘入口 + `occlusion.ts` 消解唯一实现（含 `resolveScene` 单一入口） |
| `src/remotion/` | `carrier.tsx` **时间表渲染**（不嵌套）/ `carrier-synth.ts` **影子载体轨** / `MotionItem`（全树唯一 `useCurrentFrame`）/ `caption.ts`（字幕唯一入口）/ `tokens.ts`（颜色唯一来源） |

## 当前状态（2026-10-18）

**六道闸全通，真素材可端到端出片**（kukini 6667 帧 / 218MB / 墙钟 ≈21 分钟）。
`03-storyboard` 管线通但仍**不调模型**（模型即操作者）；`05-render` 模板 **9/11**。
剩下的不是「能不能出」，而是**质量**：`M-1d` 对齐产物层漂移 / 占位值校准 / 剩 2 个模板。
真实数字与待办见 `PROGRESS.md`（§五 是当前主战场）。当前 **449 单测 / 27 文件 / 18 项校验**。

## 🔴「定义了 ≠ 生效」的第五次：守卫函数存在但没人调

`validate/occlusion.ts` 的架构论证写着「`io.ts` 的不可变快照守卫（`guardSnapshot` 会直接拒绝
04 阶段回写 03）」—— 而 `guardSnapshot` **这个函数从来不存在**，同作用的
`assertNotWritingUpstream` **零调用**（连测试都没有）。结论侥幸对（方案 A 本身绕开了写回），
但**论证前提是假的**。

🔴 **判据升级**：不只看「字段有没有消费者」，还要看**注释/文档里声称承重的机制**是否真的接线。
本项目的五次同款：`occludesSubject`（补实现）、`handoffIn`（删）、`DUR.exit`（补）、
字号真源（上提）、快照守卫（接线）。

✅ 已于 10-18 修复：`writeStageJson()` 成为**所有 stage 落盘的唯一入口**，
内含 `assertNotWritingUpstream`；`tests/stage-io.test.ts` 断言「越权时**一个字节都不落盘**」
（不是写完再抛）。

## 🔴 四层假绿教训（本项目最贵的经验）

| 层 | 病 | 状态 |
|---|---|---|
| 1 | 算了却只拼进 `detail` 字符串 | 10-13 已修 |
| 2 | 改了**内存对象**，跨进程无通道（`render` 独立进程重读 JSON） | 10-17 已修（通道方案 A） |
| 3 | 施加了变换，但**未验证终态**（施加后仍超预算却报成功） | 10-17 已修（补终判） |
| 4 | 组件单测 + 静态断言全绿，但**画面是错的**（CSS 坐标系） | 10-17 已修 |

**判据：凡涉及「改变产物」的判定，都必须能回答「成片里哪儿变了」。**

## 🔴 同一个概念只允许一个真源（已犯三次）

| # | 症状 | 修法 |
|---|---|---|
| 1 | split-frame 分界线落在 0.75（偏差 25%） | `clip-path` 百分比**相对父容器**，而 `MotionItem` 已按 footprint 缩窄 ⇒ 组件内反向抵消；⚠️ 抵消量也相对父宽，**必须除以 footprint 尺寸** |
| 2 | `params.scale=3.0` 判据按 3.0 算、渲染实际用 1.6 | 钳制常量只存在于组件里 ⇒ 上提 `core/carrier-window.ts`，两边共用 `clampScale()` |
| 3 | 校验期顺序耦合（#12 改 footprint 后 #17 读到改后的值） | 明知并记录；`render` 侧复用同一份 `resolveScene` |

🔴 **发现手段**：跨层探针对账（渲染期实际值 vs 判据推算值）比单测更灵。
🔴 **写断言前先跑一遍拿真实值**，别纯手算 —— 两次几何算错都伪装成「代码有 bug」。

## 🔴 真渲纪律（最高优先级）

- 🔴 **「单测全绿 + 静态断言全绿」≠ 画面正确**。split-frame 的 10 项测试全绿，真渲抽帧却量到分界在 0.75。`punch-in` 用 `transform: scale()` 相对自身算所以恰好正确 ⇒ **只有部分模板会露馅，更危险**。
- **量测法**：`remotion still` 抽帧 + 纯 Node 解 PNG（zlib + PNG 反滤波）像素级量。
- 🔴 **「视频在不在」用像素判断，不用眼睛**：根容器背景 `0,0,0`，占位底 `16,20,24`，素材画面是任意真实值。靠这条才区分出「视频没挂载」与「素材开头本来就黑」。
- 🔴 **探针脚本多半未入库**（`out/` 被 gitignore）⇒ 换机重跑需重建。

## 🔴 三个渲染 bug：全是「两条链同时存在」才暴露（2026-10-18）

真素材首跑前 `jobs/` 全停在 01/02，而 demo 是 `hasVideo:false` ⇒ **「有真实视频」这条路径从未被执行**。

| # | 症状 | 修法 |
|---|---|---|
| 1 | 渲染到 2836 帧崩，**或全程黑帧且不报错** | Remotion 静态服务把 URL 映射到 **bundle 目录**，只有 `public/<name>` 命中 ⇒ `video:'public/'+basename` + `--public-dir=<00-input>` |
| 2 | 有载体类 item 时**窗外整段视频消失**（6517 帧纯黑） | `CarrierTrack` 窗口前后补**无变换透传** |
| 3 | 影子载体轨「加了等于没加」（SSIM 1.000000） | `<Sequence from>` 是**相对父级**偏移，嵌套后内层起点 9232 > 成片 6667 ⇒ 时间轴**拍平**成原子窗口 |

🔴 **验证时要问「这套机制在**组合**下还成立吗」**，不能只验单条。

## 🔴 对齐：`alignedRatio` 结构上看不见时间空洞（`M-1d` / `M-1e`）

- 实测：门控全过（均值 0.9113 / 低置信 3.19% / `alignedRatio=1.000`），但某 cue 整整**早了 7.06 秒**，词被塞进 **6.74 秒真静音**（`volumedetect` −58dB）。
- 根因两层：① whisper 把跨静音的文本压进一个长分段（8.14–20.46s）⇒ DP 只能平摊；② `alignedRatio` 的定义是「SRT 词对上 **token** 的比例」—— **衡量文本匹配，不衡量时间**，所以必然报 1.0。
- 🔴 **whisper 参数路线已判死**：`-ml 32 -sow` 无效（分段不变）。
- 正解（待裁决，见 `M-1f`）：**按 SRT 窗口铺词**——实测文本归属已 100% 正确、错的只是词落点，
  且 SRT 边界与音频静音天然吻合（留白 7.083s vs 实测 6.736s），故不必改 DP。
- 🔴 **撤回一条自己造的「铁律」**（2026-10-19，用户追问后核查原文）：此前多处写
  「判据不能拿 SRT 时间戳当基准（违反 B2-fix）」—— **B2-fix 原文里没有这句话**。
  它是我在登记册转写时添加的过度推断，被后续文档反复引用成了铁律。
  真实 B2-fix 是「C2 承诺词级锚点而 B3 无 ASR 环节」这个**架构缺口**，
  原文说的是「Whisper **只需出时间戳**，可强制对齐到 SRT 文本」。
  ⇒ **SRT 时间戳在本工作流可直接当权威**（输入契约本就是「用户的 SRT + 同一份视频」，
  N-6 担心的跨剪辑版本错位不成立；实测整体平移 0 即最优）。
- 🔴 **教训**：写裁决条目时，**分清「审核/裁决结论」与「自己补的实施细节」**——
  后者会被后续文档反复引用升格为「铁律」，最终自己把自己绑住。
  引用前应回原始出处核实，不能引用二手转述。
- 损伤范围工具：`tools/probe-align-drift.mjs`（逐 cue 比对 SRT 起点与词落点，>1s 即报）。

## 🔴 字幕：时间 / 文字 / 高亮都必须以 SRT 为准（`C2-6`）

用户原话：「字幕拆开后看得不连贯，能不能按我给的 SRT 那样拆」。

**先核事实**：`cues[]` 文本与 SRT 逐字比对 **0 差异** —— 「怎么拆」本来就是 SRT 的，错的是时间与文字来源。

| 层 | 病 | 修法 |
|---|---|---|
| 时间 | 帧区间取**词落点**（词平摊在静音里 ⇒ 早 7.06s） | `Cue` 增 `srtFromSec/srtToSec`；`cue:N` 锚点改取 SRT 时间 |
| 文字 | 用「窗口内落进的词」拼句 | 改取 **`cue.text`**；词只经 `highlightSpan` 定位高亮 |
| 高亮 | 由词时驱动，漂了就缺 | `highlightWords`：覆盖率 **≥0.8 不动，<0.8 按「顺序 + 字数权重」重铺**回 SRT 窗口 |

🔴 **时间与文字必须一起改**：只改时间不改文字，窗口里会落进**别的句子**的词 ⇒ 错得更离谱。
降级：词对不上原文 ⇒ **整句不高亮，但内容仍对**。宁可不高亮，不显示错句子。

🔴 **边界语义在三个地方各写了一遍**（bake 时长 / `wordsInWindow` / cue 数据本身），必须同口径：
cue 时长用**半开区间** `[from, toFrame)`；`wordsInWindow` 用**严格大于**。两处错一次，字幕就串上一句的句尾。

## 🔴 载体轨：不能嵌套，时间轴必须拍平

- `<Sequence from={x}>` 是**相对父级**偏移 ⇒ `reduce` 嵌套包裹会让内层起点累加，直接超出成片长度。补 `from={0}` 无效。
- 修法：`composeCarrierTimeline(tracks, total)` 取所有载体 item 起止帧作切点切成**原子窗口**，每窗最多挂一个变换；`CarrierTimeline` 外层 `from={0}`、逐窗 `from={w.from}`。
- 副产品：首轮「载体窗外视频消失」在结构上不可能复发。
- ⚠️ **边界**：两载体时间真重叠时取「数组靠前者优先」，外层变换在该窗被丢弃。要「放大 + 分屏」同时生效**应先立裁决**。

## 占位值：8 项 / 12 个数值（🔴 唯一口径在代码里）

**别再手数**：`src/core/placeholders.ts` 是唯一真源，`npm run placeholders` 输出计数并生成
`docs/decisions/PARAM-DECISIONS.md`（该文档**由代码渲染，禁止手改**；`--check` 可校验是否分叉）。

- 粒度定义：**一项 = 一个需要独立做出的校准决定**（同进同退的几个数算一项）；「数值个数」是另一口径，引用须说明。
- 历史教训：`MEMORY 8 / PROGRESS 7 / 代码标记 3 处` 三方互不相等 —— 根因是**没人规定粒度和收录判据**。
  详见 `PARAM-DECISIONS.md` §五「明确排除」：`DUR` 是"已调优待复核"不是占位，
  `MATCH_MIN_SIMILARITY` 是实测校准过的**正面样板**，两者都曾被误计入。
- 优先级最高的三个：`density`（**唯一占位值却直接产 error**，且无编辑 UI）/ `min-visible`（卡着 `W-D2-02` 升 error）/
  `align-gate` + `confidence-bands`（必须同批）。

## P1–P4 定下的口径（后续别推翻）

- 🔴 `visibleRegion` **必须认两种裁切源**：`window`（分屏）与 `scale > 1`（放大裁边）。只实现 window 一支 = 对放大完全漏报。
- 🔴 两者并存取**交集**，不是「window 优先」—— 后者静默忽略 scale 裁边。
- 🔴 `scale` 必须过 `clampScale()`（`[1.0, 1.6]`，常量在 `core/`），否则判据比渲染更狠 ⇒ 误报。
- ⚠️ scale 分支取**目标值（最坏帧）**，非当前帧 —— 方向保守（可能误报、不会漏报），已拍板保持。
- 查 shot `safeArea` 按**时间相交**，不按「item 起始帧落在 shot 内」—— item 可横跨两个 shot。
- 🔴 消解只在内存里改写 + **由 `render` 侧重算**传递，不落新阶段产物（`guardSnapshot` 禁 04 写 03）；`render` 必须用 `ctx.storyboard`，否则改写又蒸发。
- 🔴 **`resolveScene` 必须在 render 侧跑一次且幂等**；消解逻辑唯一一份在 `validate/occlusion.ts`，render **复用而非复制** —— 分叉会让报告对成片说谎。
- 🔴 **施加 ≠ 成功**：tier2 必须有终判（施加后按展示条重算遮挡率）。
- `window` **刻意不进 `paramsSchema`** —— 校验期写入的系统字段，进表模型就能填它。
- split-frame **刻意无进出场**（窗口随帧变化会动摇判据）⇒ 渲染测试用具名豁免 + 反向断言。
- ⚠️ `W-D2-02` / `W-D4-01` 码串沿用旧值保可追溯，**语义以代码注释为准**；类归属变更须走裁决册。

## 约定 / 雷区

- **帧是真相**：模型只写锚点 `{anchor:"word:37", offset:"-8f"}`，烘焙器解析成帧；锚点语法 `word:N` / `cue:N` / `abs:<帧|秒s>`。**负偏移＝抢拍合法**（下界是锚定词所在 cue 起点，C2-5a）。
- **新增字段/令牌/配置后立刻问「谁读它」** —— 一天撞见三例（`occludesSubject` / `handoffIn` / `DUR.exit`）。零消费者的字段要**先判能否从别处推导**，再决定补实现还是删。
- **推进实现后回头改计划书状态**：每完成一条 D 项，更新 `docs/proposals/2026-10-14-后续提升优化计划书.md` 文首横幅。
- **改文档计数时区分活计数与条目身份**（「当前 16 项」要改，「第 16 项」不能改）。历史档案（changelog / memory 日志 / reviews / SPEC 版本历史）保留原数字。
- 增补校验项**须先改裁决册**；新错误码同时进 `errors.ts` 的 `CODES`。**`CODES` 键名不可与已删配置同名**，但错误码字符串要保留以保可追溯。
- 确定性红线：全树仅 `MotionItem` 读时钟；禁 `Date.now()`/`Math.random()`（用 `mulberry32`）/CSS animation/`<Series>`/显式 z-index。
- 🔴 **demo 夹具坑**：手改下游快照能骗过 validate，重跑 storyboard 就红。**别手改下游快照。**
- 长文本溢出：`whiteSpace: nowrap` + 模型可填长文本 ⇒ 溢出**既不折行也不缩放**，而校验全是结构判定看不出来。真实阈值约 13–14 中文字（`stat-card` 更窄）。当前依赖模型遵守 SKILL.md 字数建议 —— **这是纪律，不是强制**。
- Git Bash：`python -c` 传含反引号多行串会失败 → 写临时 `.py`；git 输出中文路径需 `core.quotepath=false`。

## 真源层级（冲突时以此裁决）

`docs/decisions/OPEN-DECISIONS.md`（**裁决真源**）> `docs/spec/SPEC-*.md`（v0.7）> `docs/changelog/` > `docs/proposals/`（未裁决前不含结论）。
OPEN 清单：`C2-2` 阈值实测 / `C2-3` BGM 分离倾向不做 / `M-1d` 静音-词门控 / `M-1e` whisper 漂移对策 / `M-4` 未落。
⚠️ **裁决总数别引用**（历史上 44 / 48 两个口径互相矛盾，机械计数得 38–45 区间）—— 只引 OPEN 清单。
另：`PROGRESS.md` = 真实数字 + 计划；`CONTRIBUTING.md` = 接手 3 分钟（裁决册 > PROGRESS > 其他）。

## git

- 仓库级 noreply 身份；`gh auth setup-git` 做凭证，**别用 GCM**（wincredman 校验会失败）。
- 🔴 **代理只走环境变量 `HTTP_PROXY`/`HTTPS_PROXY`，勿写死端口**（宿主每会话换端口）。曾用 `-c http.proxy=…:4436` 连续 5 次失败而 curl 却通 —— **别用 curl 通推断 git 通**。偶发 502 → 重试即通。
- 双工作区并行提交会产生「同内容不同 hash」重复提交：先建 `backup/pre-pull-<date>`，`git diff` 为空再 `reset --hard origin/main`。
- 🔴 **`.workbuddy/memory/` 的两类内容别混**（2026-10-18 结构性修复）：
  **项目知识**（本文件）跨机共享；**本机状态**（`LOCAL.md`，已 gitignore）各机独立。
  此前两者混在 `MEMORY.md` 里 ⇒ 两台机互相覆盖，还写出「本机 `jobs/` 空」这种在另一台机上恰好相反的话。
- 🔴 **改完记忆立刻提交**：不提交就是等着下次 `ff` 被覆盖。
- 两边都写同日日志 ⇒ 每条记录**开头标注执行机绝对路径**，冲突时人工合并（先例 10-12/13/15）。
