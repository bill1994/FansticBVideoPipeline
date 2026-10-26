# 项目长期记忆 — video pipeline

> 只放**跨机成立**的项目知识。本机路径/素材/`jobs/` 进度/环境坑 ⇒ 写 `.workbuddy/memory/LOCAL.md`（已 gitignore）。
> 真实数字见 `PROGRESS.md`，变更史见 `docs/changelog/`，裁决见 `docs/decisions/OPEN-DECISIONS.md` —— 本文件不复述它们，只留「不读会踩坑」的判断。

## 定位与命令

- Remotion 视频动效叠加管线：实拍口播粗剪上叠 motion-graphic overlay。Node ≥22.19 / ESM / tsx / MIT。
- 两工作区共用 **PUBLIC** 远端 `github.com/bill1994/FansticBVideoPipeline`（main）。
- 🔴 **定位 = 「确定性底座 + 可插拔起草稿来源」**：align/perceive/storyboard/validate/render 五阶段确定性；
  `03-storyboard/motionboard.json` 是**唯一可编辑意图层**（2026-10-21 Wave 5 整合，绑定器在调度前解析、产 `bind-report.json`），
  可由模型填表产出，**也可由内置生成器首跑产出**。「被模型读取/仓库不调模型」红线已于 **2026-10-20 由用户解除**。
- 🔴 **M-3（2026-10-23 用户裁决）：pacing 语义优先于复现**——`03-storyboard/pacing.json`（决定 motion 如何分布的节奏表）
  改由 **LLM 读文案语义判定**（decide/motion/signal 语义判据/reason），与 motionboard 同批产出；规则生成器
  （`rhythm.ts`+`rhythm-rules.ts`）**降级为无模型兜底先验**（不退役，可作 LLM 先验参考）。
  「同一 SRT 逐字节可复现」对 pacing 废止（仅兜底路径成立）；**渲染期确定性红线不变**（语义只在创作期，同 2026-10-22 提案原则）。
  ✅ 一致性校验已落地（10-24 契约层）：`buildContext` 三条结构断言（cue 索引 / motion id 已注册 / decide 对齐，ConfigError 退出码 2，不占 18 项）；
  刻意**不**校验「pacing 与 board 分布一致」——偏离先验正是语义路径的能力本身。
- `npm run pipeline -- <stage> --job <id> [--jobs-dir dir]`：init|align|perceive|storyboard|validate|**review**|render。
  cli 认 `--job/-j/--jobs-dir/--interval/--force/--dry-run/--no-subtitle`，**`--draft` 已废**。
  🔴 **P1-a 已落地（10-24）**：`review` 产 `06-review/preview-props.json` 起 Studio 看片；`must_review` 走 `renderGate` 硬闸
  （`acknowledgedReview` + storyboard hash 防漂移）；`composeRenderProps` 是 render/review 共用映射真源（别各写一份）。
  🔴 **P1-b 已落地（10-24）**：`npm run motion:accept` 六道验收（结构/注册/三帧/动效/lint/签章）+ `spec-loader` 验签
  —— custom-* 无签章或 hash 不符**拒装载**，签章 = 去 acceptance 后 canonical sha256；`genPrompt` 只进创作期生成器、binder/validate 零消费。
- `npm run typecheck && npm test`（**792 项 / 48 文件**，10-26 复核）；`npm run doctor`（换机第一步）；`npm run placeholders`（占位值唯一口径，`--check` 同步）。
- ⚠️ **阶段目录是不可变快照，但语义不对称**：align/perceive 存在即跳过（改代码须 `--force`）；storyboard/validate/render **每次重算**。
- ⚠️ **长任务别 `| tail`**：错误被吞成「渲染失败」四个字。重定向到日志再 grep。

## 结构

| 路径 | 职责 |
|------|------|
| `src/cli.ts` | 唯一入口。语义化退出码 0/1/2/3/4/5/6/130；🔴 **align 门控不过 = 退出码 1（VALIDATION_FAILED）**，SKILL.md / config.ts 已于 10-23 一并更正（别再复制旧口径「2」） |
| `src/core/` | `types.ts` 契约 / `errors.ts` 错误码（**28 条**）/ `bake.ts` 锚点→帧 / `schedule.ts` 两道闸+动态T / `io.ts`（**`writeStageJson` 唯一写盘入口**，内含 `assertNotWritingUpstream`）/ `carrier-window.ts` 载体几何真源 / `placeholders.ts` 占位值真源 / `confirmed.ts` 06-review 记录唯一入口（含 `acknowledgedReview`）/ `motion-accept.ts` 签章验收 / `silence.ts`+`word-timeline.ts`（M-1f） |
| `src/stages/` | `align`（builtin-align = whisper.cpp + SRT + DP；外部 `ALIGNER_CMD` 可选）/ `perceive`（scdet + YuNet + region-derive）/ `storyboard` / `validate` / **`review`（Studio 看片闸）** / `render` / `render-props.ts`（render+review 共用映射） |
| `src/validate/` | `context.ts` 唯一读盘入口（`buildContext`，内含 `alignmentConfidence` 一致性断言 + `assertStageOrderIsSane` **mTime 版**时序守卫）+ `occlusion.ts` 消解唯一实现（`resolveScene`） |
| `src/remotion/` | `carrier.tsx` 时间表渲染（不嵌套）/ `carrier-synth.ts` 影子载体轨 / `MotionItem`（全树唯一 `useCurrentFrame`）/ `caption.ts` 字幕唯一入口 / `tokens.ts` 颜色唯一来源 |

## 真源层级（冲突时以此裁决）

`docs/decisions/OPEN-DECISIONS.md`（裁决真源）> `docs/spec/SPEC-*.md` > `docs/changelog/` > `docs/proposals/`（未裁决前不含结论）。
OPEN 清单：`C2-2` / `C2-3` / `M-1d`（`M-1f` 已落地、`M-1e` 由其收敛关闭，`M-4` 已 RESOLVED）。
⚠️ **裁决总数别引用**（历史 44/48 两口径矛盾，机械计数 38–45）。`PROGRESS.md` = 真实数字；`CONTRIBUTING.md` = 接手 3 分钟。

## 最贵的教训（不读会踩坑）

- 🔴 **四层假绿**：算了只拼进 `detail` 字符串 / 改内存对象跨进程无通道 / 施加变换未验证终态 / 单测全绿画面是错。
  判据：凡「改变产物」的判定，必须能回答「成片里哪儿变了」。
- 🔴 **同一概念只允许一个真源（犯四次）**：split-frame 百分比相对父容器（当时只修它一个，其余 6 个模板继续错三个月，2026-10-21 才修掉的 P0）/ `clampScale` 上提 / 校验顺序耦合 / 容器被缩成 `w²/h²`。
  **修一处 ≠ 修一类：发现坐标系/真源类问题必须全库扫同类模式**（`grep 'footprintStyle(item)'`）。
  免疫例外：`punch-in`/`noise-grain` footprint `[0,0,1,1]` 无影响；`split-frame` 的负 margin 抵消是**主动正确**的，别顺手"统一"。
- 🔴 **真渲纪律**：「单测全绿 + 静态断言全绿」≠ 画面正确。量测：`remotion still` 抽帧 + 纯 Node 解 PNG 像素级量；
  「视频在不在」用像素判断（根容器 `0,0,0` / 占位底 `16,20,24`）；探针脚本未入库，换机重建。
- 🔴 **三个渲染 bug 全是「两条链同时存在」才暴露**：video 须写 `public/<name>` + `--public-dir=<00-input>`；载体窗外补无变换透传；
  `<Sequence from>` 相对父级 ⇒ 载体时间轴**拍平**成原子窗口（`composeCarrierTimeline`）。验证要问「组合下还成立吗」。
- 🔴 **对齐结构盲区**：`alignedRatio` 只衡量文本匹配、不衡量时间（门控全过但某 cue 词早 7.06s 落进 6.74s 真静音）。
  `M-1f` 按 SRT 窗口铺词 + `checkSrtAudioAgreement`；`silentWordRatio` 超过 `SILENCE.wordRatioWarnMax`（2%）只告警不阻断（`M-1d` 阻断线待校准；该线与静音探测参数绑定）。
  **SRT 时间戳可直接当权威**（B2-fix 原文：「Whisper 只需出时间戳，可强制对齐到 SRT 文本」；「不信任 SRT 时间戳」是我转写时加的过度推断，已撤回）。
- 🔴 **字幕 C2-6**：时间/文字/高亮都以 SRT 为准（`cue.text` + `highlightSpan`）。cue 时长半开区间 `[from,toFrame)`；`wordsInWindow` 严格大于。
- 🔴 **占位值：11 项 / 19 数值**（2026-10-26 复核）。唯一口径 `src/core/placeholders.ts` + `npm run placeholders`。
  ⚠️ 「`density` 是唯一占位却直接产 error」**已不成立**：C2-5b（10-24）降为 `W-C2-5-02`，现无占位值直接阻断。
  `reweigh-coverage-min=0.8` **考古结案**（M-1f-a）：自诞生起无数值推导（首现 `60b22d9`，与 `alignedRatioMin` 同值疑为呼应），
  重定线等 ≥2 条完整对齐素材、按分布空隙数据驱动，**禁手感调参**（每动 0.05 改 3–12 条判定）。
- 🔴 **「定义了 ≠ 生效」第五次**：`occludesSubject`（补实现）/ `handoffIn`（删）/ `DUR.exit`（补）/ 字号真源（上提）/ 快照守卫（接线）。
  判据：注释/文档里声称承重的机制，必须真的接线。
- **P1–P4 口径（别推翻）**：`visibleRegion` 认 `window`+`scale>1` 两种裁切源取**交集**；`scale` 必须过 `clampScale()`（[1.0,1.6]）；
  safeArea 按**时间相交**；消解只在内存改写 + **render 侧重算**（`resolveScene` 幂等，render 复用不复制）；`window` 刻意不进 `paramsSchema`；
  split-frame 刻意无进出场（渲染测试用具名豁免 + 反向断言）。
- **约定/雷区**：帧是真相（锚点 `word:N`/`cue:N`/`abs:<帧|秒s>`，负 offset 抢拍合法）；新增字段先问「谁读它」；
  改文档计数区分**活计数与条目身份**；确定性红线（禁 `Date.now()`/`Math.random()`/CSS animation/`<Series>`/显式 z-index，随机用 `mulberry32`）；
  demo 夹具别手改下游快照；**#17 已分档（D-B3，10-24）**：>1.5× → `E-DB-01` 阻断、1.15–1.5× 仍 `W-DB-01`。
  1.5 是物理线而非审美线：`fitScale` `minScale=0.7` 只能救 est/available ≤ ≈1.43×，再超必然跑出 footprint。
  D-B2 实测 CJK 1.0em / 数字 0.615–0.667（`latinWidthEm`），证据见 `docs/templates/2026-10-24-文本度量实测表.md`。
- 🔴 **模板 11/11（2026-10-24）**：`pointer-callout`（anchored，footprint 即目标区域，仍 experimental）/ `whip-pan`（fullscreen，触发 D3-a 确认闸）；画廊 19 实现 ×3=57 张。
- **git**：代理端口以实测为准。**2026-10-26 实测**：`HTTP_PROXY=4512` 对 curl 通、**git 走它挂**（`schannel: server closed abruptly`）；
  可用组合 = `git -c http.proxy=http://127.0.0.1:11933 -c http.sslBackend=openssl`（11933 亦通；13145/7890/1080 全死）。
  Windows `fetch` 偶发 `unpack-objects failed` ⇒ `-c fetch.unpackLimit=1`；双工作区先建 backup 再 `reset --hard`；
  🔴 **改完记忆立刻提交**；`.workbuddy/memory/` 项目知识跨机共享、`LOCAL.md` 本机独立。
