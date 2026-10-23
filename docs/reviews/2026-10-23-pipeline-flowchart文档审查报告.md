# pipeline-flowchart.html 审查报告

> 审查对象：`G:/VideoPipeline/pipeline-flowchart.html`（《Remotion Overlay Pipeline · 全流程架构与流程图》，自标基准日 2026-10-23）
> 事实源：仓库代码（`src/cli.ts`、`src/stages/*`、`src/core/*`、`src/validate/*`、`src/remotion/*`、`src/templates/*`）+ `SKILL.md` / `README.md` / `PROGRESS.md` / `docs/proposals/2026-10-22-创作期动效生成与Studio审核闸.md` / `docs/decisions/PARAM-DECISIONS.md`
> 审查日：2026-10-23 · 方法：逐节点声明 ↔ 代码/规范交叉核实（含 `npm run placeholders --check`）

---

## 一、总体结论

文档的**主干结构与绝大多数节点描述与代码一致**，可作为流程认知材料使用。以下核心声明经核实全部准确：

- 五阶段（align → perceive → storyboard → validate → render）+ `init` 建骨架 + `06-review` 目录（`src/core/config.ts#STAGES`，含 `review: '06-review'`）
- 00-input：ffprobe 实测 → 写 source.json（四必填 + 分辨率）、已存在不改写、改 fps 全部烘焙作废（SKILL.md「新 job 引导」）
- 01-align：16kHz 单声道 wav、silencedetect 静音探测、whisper.cpp + SRT 文本权威 + 内置 DP（builtin-align）、M-1f 按 SRT 窗口铺词 + SRT↔音频一致性校验、`evaluateGate` 门控、`confirmed.json`（stage:"alignment"）人工放行、M-1g `--no-subtitle` 显式空产物（`src/stages/align.ts` 全文）
- 02-perceive：scdet 切分 / YuNet 人脸→外扩 handheld / 无脸镜头显著性 broll 框不到即退让 / safeArea 取 bbox 上部按 shot 并集 / 低置信不阻断走 W-F6-01 / 前置缺失阻断 / `frames/` 仅外部 `PERCEIVER_CMD` 产生（`src/stages/perceive.ts`）
- 03-storyboard：motionboard.json 唯一可编辑意图层、缺失时 `buildRhythmTable → generateMotionboard`、`pacing.json` 仅首跑、`bindMotionboard → bind-report.json`、`assertDraftItemKeys`、两道闸 + 产路地板、安全阀（sim_max 中位数 <0.4 ⇒ 整批 custom + must_review）、bake 锚点→帧并剥离 `_author`、M-1g 禁 word:/cue: 锚点与字幕模板（`src/stages/storyboard.ts`）
- 04-validate：`buildContext` 唯一读盘入口、18 项 + 2 条 extra（W-D3-01 / W-F6-01）、tier1/tier2 消解仅内存、人工审核队列（`decision.review==='must_review'`）、error ⇒ 阻断 / warning 不拦（`src/validate/index.ts`、`src/core/report.ts`）
- 05-render：`renderGate`（validate.ok + fullscreen D3 确认）、`assertVersionPinned` 锁 4.0.534、`resolveScene` 重算、`splitStacks` C6 双栈、`synthesizeCarrierTracks` 影子载体轨、`toCaptionData` 字幕唯一文本源、`resolveRenderSize`（manifest→ffprobe→default）、`render-props.json`、`out.mp4`、`render-report.json`（bytes/wallMs/尺寸/命令/qa 内嵌/manualOverrides）、`contact-sheet.jpg` 3×3、媒体 QA 不阻断（`src/stages/render.ts`、`src/core/media-qa.ts`）
- 评估区 A1–A5 / B1–B5 / C1–C4 / D1–D6 **全部与代码相符**（must_review 无硬闸、消解不落盘、pacing 失同步、alignedRatio 外部路径可选且记 0、overrides 只告警、无 review 命令、M-1d 未立闸、占位值 11 项未校准、余 2 模板、mTime 版时序守卫、qa 内嵌无独立文件、仅 align/perceive 跳过、13 个零消费者导出、no-subtitle 同形不同义）
- 规划区：提案 2026-10-22 确为 ACCEPTED 且未落地（P1-a review 命令 + must_review 硬闸 / P1-b prompt→MotionSpec 零 codegen）、占位值「11 项 / 18 数值」与 `npm run placeholders` 输出一致、F4 已有 3 条成片样本、VLM / Qwen3-ForcedAligner 探索项与 PROGRESS §五 阶段 3 一致

**但存在 2 处事实错误（1 高 1 中）、2 处数据流/范围描述不准（中/低）、4 处表述问题（低）**，详见下节。所有问题均为「文档与代码冲突」，按项目一贯口径**以代码为准**。

---

## 二、问题清单（按严重度）

### P1【高】01-align 节点：门控不过的退出码写错

- **位置**：§一 流程图，`01-align · 强制对齐 + 置信度门控` 节点「闸 / 决策」第一行：
  > 门控不过 ⇒ 退出码 2 阻断
- **实际**：门控不过时 `cli.ts` 返回 `EXIT.VALIDATION_FAILED` = **1**（`src/cli.ts:175-187`；`src/core/exit-code.ts:13` 定义「1 校验没过」，「2 参数错（含前置输入缺失、配置非法）」；`tests/exit-code.test.ts:32` 断言 `VALIDATION_FAILED === 1`）。
- **根因**：`SKILL.md`「各阶段什么时候该停」与 `src/core/config.ts#ALIGN_GATE.alignedRatioMin` 注释同样写着「退出码 2」——这是项目自身的文档遗留错误，流程图沿用了它。git 历史显示 `EXIT.VALIDATION_FAILED` 自初始提交即在 align 门控分支，「2」从未是事实。
- **建议修正**：改为「门控不过 ⇒ 退出码 1 阻断」。并建议同批修正 SKILL.md 与 config.ts 注释（见 §四 附带发现 A-1）。

### P2【中】03-storyboard 节点：命令含不存在的 `--draft` 参数

- **位置**：§一 流程图，`03-storyboard` 节点右上角 `.cmd`：
  > `pipeline -- storyboard [--draft]`
- **实际**：`cli.ts#parseArgs` 只识别 `--job/-j`、`--jobs-dir`、`--interval`、`--force`、`--dry-run`、`--no-subtitle`；传 `--draft` 会抛 `未知参数：--draft`（ConfigError ⇒ 退出码 2），**按图中命令原样执行会直接失败**。
- **根因**：`--draft` 是 Wave 5（motionboard.json 整合，2026-10-21）之前 `draft.json` 时代的参数，`README.md`「端到端跑通仓库自带的示例」与 `PROGRESS.md` §八 的示例同样残留；且 `examples/demo/03-storyboard/` 现存的是 `motionboard.json`，`draft.json` 已不存在（README/PROGRESS 的示例路径也已失效）。
- **建议修正**：改为 `pipeline -- storyboard --job <id>`（storyboard 无 --force，每次重算，与图中其它部分自洽）。

### P3【中】04-validate 节点：输入资料列入了 validate 并不读取的文件

- **位置**：§一 流程图，`04-validate` 节点「输入资料」：
  > `03-storyboard/{storyboard, template-snapshot}`
- **实际**：`buildContext`（`src/validate/context.ts:62-73`）只读 `storyboard.json` 与 `bake-report.json`（外加 00/01/02 的 source/words/align-report/shots/regions）；**不读 `template-snapshot.json`**——后者是 render 的输入（`src/stages/render.ts:223-226`，供浏览器 hydrate）。流程图 05-render 节点已正确列出它，此处属于重复且错位。
- **建议修正**：改为 `03-storyboard/{storyboard, bake-report}`。

### P4【低】05-render 节点：把规划中的能力写成现役输入

- **位置**：§一 流程图，`05-render` 节点「输入资料」末行：
  > `06-review/confirmed.json（fullscreen ack + must_review 清单）`
- **实际**：当前 render 只读 `stage:"render"` 记录的 `acknowledgedFullscreen` 与各记录的 `overrides`（`src/stages/render.ts:74,88,262`）；**「must_review 清单」是提案 P1-a 的规划字段，尚未落地**——文档自己在 planband 与 B1 已如实标注未落地，此处却混入现役输入清单。
- **建议修正**：改为 `06-review/confirmed.json（fullscreen ack；must_review 清单为 P1-a 规划，见下）`。

### P5【低】03-storyboard 节点：「两轨」只对生成器产出成立

- **位置**：§一 流程图，`03-storyboard` 节点「产出结果」：
  > `storyboard.json（绝对帧 + tracks，两轨）`
- **实际**：内置生成器产出确为两轨（`src/core/rhythm-rules.ts:866`：`caption` layer 90 / `motion` layer 60）；但 motionboard 允许模型/手写任意轨数——kukini 实测为 **7 轨**（`PROGRESS.md` §二）。「两轨」不是 storyboard.json 的固有属性。
- **建议修正**：删去「两轨」，或改为「（生成器产出为 caption + motion 两轨；手写 motionboard 可多轨）」。

### P6【低】00-input 节点：「AI 不手写 source.json」与相邻行并置易误读

- **位置**：§一 流程图，`00-input` 节点「输入资料」行：
  > 视频 raw.mp4 / SRT raw.srt（均用户放入；AI 不手写 source.json）
- **实际**：SKILL.md 的纪律是「**用户**从不手写 source.json；**AI 按 ffprobe 四步实测生成**（禁凭记忆/估算填写），已存在不改写」。本行与下一行「ffprobe 实测 → 写 source.json」并排时，易读成「AI 不写 source.json」，与 SKILL.md 相反。
- **建议修正**：改为「视频/SRT 由用户放入；source.json 由 AI 按 ffprobe 实测生成，禁凭记忆填写，已存在不改写」。

### P7【低】04-validate 节点：遗漏 buildContext 内置的两道结构闸

- **位置**：§一 流程图，`04-validate` 节点「闸 / 决策」行（现有内容只有「有 error ⇒ 退出码 1」「warning 不拦」）。
- **实际**：`buildContext` 在跑 18 项之前还有两道**结构断言**（均抛 ConfigError ⇒ 退出码 2，不占 18 项名额）：
  ① `storyboard.meta.alignmentConfidence` 与 align-report 的 `meanConfidence` 必须一致（`context.ts:85-100`，防伪造对齐置信度）；
  ② `assertStageOrderIsSane` 产物时序守卫（`context.ts:186-235`，下游不得比上游旧）。
  文档仅在 B5/D4 与 planband 提到 mTime 版时序守卫，流程图节点本身未体现这道真实存在的闸。
- **建议修正**：在 04 节点闸行补：「结构断言（alignmentConfidence 一致性 + 产物时序 mTime 守卫）不过 ⇒ 退出码 2」。

### P8【低】文末残留无指代句子

- **位置**：§二 E 节结论后的注：
  > 注：文中引用的"scene#57"指向本 skill 的"开发 Skill"场景……
- **实际**：全文不存在任何 `scene#57` 引用，该句无指代对象，属模板残留。
- **建议修正**：删除整句。

### P9【提示】header 声明的分析基准不完整

- **位置**：文档头部第二行 `sub`：「分析基准：G:/VideoPipeline 代码（src/cli.ts, src/stages/*, src/core/*, src/validate/*）+ SKILL.md / README.md / PROGRESS.md」。
- **实际**：文中 render 侧细节（影子载体轨、字幕通道、模板快照 hydrate）与「模板 9/11」结论实际出自 `src/remotion/*` 与 `src/templates/*`；提案结论出自 `docs/proposals/2026-10-22-*`。已核对这些结论**均正确**，此处仅基准声明不完整。
- **建议修正**：补列 `src/remotion/*`、`src/templates/*`、`docs/proposals/2026-10-22-创作期动效生成与Studio审核闸.md`。

---

## 三、核实通过的关键数字（防后续改错）

| 文档声明 | 核实结果 |
|---|---|
| 校验 18 项 + 2 条 extra（W-D3-01 / W-F6-01） | ✅ `DOCUMENTED_CHECK_ITEMS.length=18`、`EXTRA_CHECKS=['W-D3-01','W-F6-01']` |
| 占位值 11 项 / 18 数值 | ✅ `npm run placeholders --check` OK；PARAM-DECISIONS.md 计数一致 |
| 剩余 2 模板 pointer-callout / whip-pan，均无外部阻塞 | ✅ `BUILTIN_TEMPLATES` 11 声明 / `IMPLEMENTED` 9；PROGRESS §四.1 |
| Remotion 锁 4.0.534 | ✅ `REMOTION_VERSION='4.0.534'`，package.json 四包同版本 |
| 联系表 3×3 | ✅ `media-qa.ts` `tile=3x3`、9 等距帧 |
| 3 条成片样本（F4） | ✅ PROGRESS §七（kukini 218MB / fast-0322 259MB / fast-0528 256MB） |
| 提案 2026-10-22 ACCEPTED、P1-a/P1-b 未落地 | ✅ 提案头 `Status: ACCEPTED`；cli.ts 无 review 命令 |
| 安全阀 sim_max 中位数 <0.4 | ✅ `SAFETY_VALVE_MEDIAN=0.4` |
| 单测/错误码等数字未被本文引用 | — （PROGRESS §七：712 项 / 43 文件 / 27 错误码，2026-10-23 复核） |

---

## 四、附带发现（非流程图引入，但会导致同类错误复发）

- **A-1（同 P1 根因）**：`SKILL.md`「align 门控不过 → 退出码 2」与 `src/core/config.ts` `ALIGN_GATE.alignedRatioMin` 注释「退出码 2」均为错误表述（实为 1）。建议随 P1 同批修正。
- **A-2**：`README.md`「端到端跑通示例」与 `PROGRESS.md` §八仍教 `storyboard --draft .../draft.json`（flag 与文件均已不存在）；且 README 该段自相矛盾——预期写 `summary.checked = 17`，同段注释又说「清单内的 18 项」（实为 18）。
- **A-3**：`package.json` description 仍写「17 项构建期校验」（现为 18 项）。
- **A-4**：`README.md` 阶段表与 `SKILL.md`「两条操作纪律」称阶段目录「存在即跳过」，实际仅 align/perceive 如此——流程图 C2 已正确指出此不对称，建议源头文档同步修正措辞。

---

## 五、修正清单（按优先级）

1. 【必改】P1：01-align 节点「退出码 2」→「退出码 1」（并修 SKILL.md、config.ts 注释）
2. 【必改】P2：03-storyboard 节点命令去掉 `[--draft]`
3. 【应改】P3：04-validate 输入 `template-snapshot` → `bake-report`
4. 【建议】P4 / P5 / P6 / P7 / P8 / P9 按上文「建议修正」表述
5. 【源头】A-1 ~ A-4 随批修正 README / PROGRESS / package.json，避免下一份文档继续沿袭

> 审查结论：流程图**无需结构性重绘**；完成 P1、P2 两项必改后，文档与代码的一致性可达「可作为对外流程说明」的水位。评估区（A/B/C/D/E）的 20 条结论本次全部复核为**真**，无需撤回。

---

## 六、修复记录（2026-10-23 执行）

> 范围说明：除报告列出的 P1–P9 与 A-1–A-4 外，执行时全库复扫了同一错误类的其余落点（项目「修一处 ≠ 修一类」纪律），共修 **19 个文件**。历史档案（`docs/proposals/2026-10-13-*`、`docs/decisions/2026-10-13-裁决材料.md`、`docs/reviews/2026-10-19*`、`.claude/artifacts/`、版本化 SPEC）按惯例保留原样未动。

### 6.1 流程图本体（`pipeline-flowchart.html`）

| 编号 | 修改 | 对应问题 | 验证 |
|---|---|---|---|
| P1 | 01-align 闸行「退出码 2」→「退出码 1（EXIT.VALIDATION_FAILED）」 | 与 `cli.ts:186` / `exit-code.ts:13` / `tests/exit-code.test.ts:32` 冲突 | 与代码逐字核对 |
| P2 | 03-storyboard 命令去掉 `[--draft]` | cli.ts 无此参数 | **实测**：带 `--draft` 跑 demo ⇒「未知参数：--draft」退 2；去掉后 storyboard 成功烘焙（5 轨 / 8 锚点） |
| P3 | 04-validate 输入 `template-snapshot` → `bake-report` | `buildContext`（context.ts:62-73）不读前者 | 与代码核对 |
| P4 | 05-render 输入 confirmed.json 标注「must_review 清单为 P1-a 规划，未落地」 | 把规划能力写成现役输入 | 与 render.ts:74/88/262 核对 |
| P5 | 产物行「两轨」→「生成器产出 caption+motion 两轨，手写 motionboard 可多轨」 | 只对生成器成立（kukini 实测 7 轨） | demo 实测产出 **5 轨**，佐证原表述不成立 |
| P6 | 00-input 输入行改「source.json 由 AI 按 ffprobe 四步实测生成，禁凭记忆填写，已存在不改写」 | 原表述与 SKILL.md 纪律并置易误读 | 与 SKILL.md「新 job 引导」核对 |
| P7 | 04-validate 闸行补「buildContext 结构断言不过 ⇒ 退出码 2」 | 遗漏真实存在的两道结构闸 | 与 context.ts:85-100/186-235 核对 |
| P8 | 删除文末「scene#57」残留句 | 全文无指代 | grep 确认无残留 |
| P9 | header 补基准 `src/remotion/*`、`src/templates/*`、10-22 提案 | 基准声明不完整 | — |
| 附加 | C2 行加注「源头措辞已于 2026-10-23 修正」；footer 加修订行 | C2 引用的旧文档表述已被修 | — |

HTML 结构验证：标签配平（div/span/table/tr/td/th/p/ul/li/h2/h3 全部开闭相等）、6 个流程节点齐全、23055 字节。

### 6.2 源头文档与代码注释（同一错误类的其余落点）

| 文件 | 修改 | 对应问题 |
|---|---|---|
| `SKILL.md` | 门控退出码 2→1；「存在即跳过」改为不对称语义（align/perceive 跳过、03/04/05 每次重算） | A-1 / A-4 |
| `src/core/config.ts` | `ALIGN_GATE.alignedRatioMin` 注释退出码 2→1 并注明笔误历史 | A-1 同类 |
| `src/core/types.ts` | `alignedRatio` 门控项注释退出码 2→1 | A-1 同类 |
| `src/core/placeholders.ts` | align-gate 越界后果「退出码 2」→「1」，**重跑 `npm run placeholders` 重新生成** `PARAM-DECISIONS.md`（`--check` 通过） | A-1 同类（生成文档真源） |
| `README.md` | demo 命令去 `--draft`；`checked = 17`→18；快照语义不对称化 | A-2 / A-4 |
| `PROGRESS.md` | §八两处 demo/真素材命令去 `--draft`；快照语义不对称化；单测活计数 709→712（rhythm-rules 33→34、rhythm-table 29→31，来自 10-22 词表回填，changelog 已记 712/712） | A-2 / A-4 / 计数漂移 |
| `package.json` | description「17 项构建期校验」→18 项 | A-3 |
| `CONTRIBUTING.md` | demo 命令去 `--draft`；测试数 384/23→712/43；模板 8/3→9/2（余 pointer-callout/whip-pan）；perceive「未接入」叙事改为已实现（2026-10-17）；更新日期 | A-2 同类 + 过期数字 |
| `docs/wiki/02、04、08、README` | 选项清单/parseArgs/命令示例/option 表去除 `--draft`；运行指南「align 退出码 2」排查行→1；快照措辞不对称化 | A-1/A-2/A-4 同类 |
| `.workbuddy/skills/validate/SKILL.md` | 时序守卫修复示例命令去 `--draft` | A-2 同类（执行期 skill 契约） |
| `docs/decisions/OPEN-DECISIONS.md` | M-1c 行追加「🔴 补正（2026-10-23）」：门控退出码实为 1，原文「2」为早期笔误 | 防止裁决真源继续传播错误（沿用 C2-6/B2-fix 就地补正惯例，原文保留） |
| `tests/validate.test.ts` | 文件头注释「当前 17 项」→18 项 | 计数漂移同类（仅注释） |

### 6.3 验证汇总

1. **静态核对**：全部修改处与代码/规范逐条比对；复扫 `--draft` / 「门控退出码 2」/ 「存在即跳过」在活文档中零残留（仅历史档案与裁决册补正说明中存在）。
2. **demo 端到端实测**（临时副本，不污染 `examples/`）：
   - `storyboard --draft x` ⇒ 退出码 2（「未知参数」）——证明原文档命令确实不可执行；
   - `storyboard`（无 --draft）⇒ 退出码 0，烘焙 5 轨 / 8 锚点；
   - `validate` ⇒ 退出码 0；`render --dry-run` ⇒ 退出码 0。README/CONTRIBUTING/wiki 中修正后的 demo 命令链可原样跑通。
3. **工程验证**：`npm run typecheck` 零错误；`npm test` **43 文件 / 712 项全过**；`npm run placeholders -- --check` OK（PARAM-DECISIONS 与注册表一致）。
4. **未改动任何判定逻辑**：本次全部为文档/注释修正，`src/` 无行为变更（3 个注释文件 + 1 个生成文档真源的字符串），故测试结果与修复前一致即是「无新缺陷」的证据。
