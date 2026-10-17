# 项目长期记忆 — video pipeline

## 身份

- **Remotion 视频动效叠加管线**：在已拍摄/已粗剪、无文字无特效的实拍口播视频上叠 motion-graphic overlay。Node ≥22.19 / ESM / tsx，MIT。
- **两个工作区共用同一远端**：`G:\WorkbuddyProject\VideoPipeline`（长期记忆主维护机）与 `G:\VideoPipeline`（10-14 从 E 盘迁入，**当前活跃**）。
- 远端：`github.com/bill1994/FansticBVideoPipeline`（**PUBLIC**），main。`docs/proposals/` 与 `.workbuddy/memory/` 会随仓库公开。
- 🔴 **定位 = 「被模型读取的 skill pipeline」**：模型就是操作者，仓库**不调模型**；`03-storyboard/draft.json` 是模型产物的等价物。

## 命令

```bash
npm run pipeline -- <stage> --job <id> [--jobs-dir <dir>]   # align|perceive|storyboard|validate|render|init
npm run typecheck   # tsc --noEmit
npm test            # vitest 318 项 / 19 测试文件（+_ctx.ts 夹具）
npm run studio / npm run render:video   # 后者已内置 --gl=angle
```
demo（无需真实素材）：`pipeline storyboard|validate|render --job demo --jobs-dir examples`（storyboard 要带 `--draft`）。
预期 0 error / 2 warning（均 `W-F6-01`）。⚠️ 只在**不重跑 storyboard** 时成立（见雷区）。

## 结构

| 路径 | 职责 |
|------|------|
| `src/cli.ts` | 唯一入口；参数解析 + 阶段分发 + 语义化退出码（0/1/2/…/6/130） |
| `src/core/` | 契约与骨架：`types.ts` 数据契约 / `errors.ts` 项级码 / `exit-code.ts` 进程码 / `config.ts` 阈值与路径 / `bake.ts` 锚点→帧 / `schedule.ts` 两道闸+地板+动态T / `io.ts` job 目录+不可变快照守卫 / `report.ts` / `srt.ts` / `zh-normalize.ts` |
| `src/stages/` | 五阶段执行：`align`(后端选择)→`builtin-align`→`whisper-adapter`+`text-align`(DP) ；`perceive`(后端选择)→`builtin-perceive`→`shot-detect`(ffmpeg scdet)+`yunet`+`region-derive` ；`storyboard`(bake+schedule) / `validate` / `render`(启动闸+映射) |
| `src/validate/` | **17 项**构建期校验（纯 JSON→JSON）+ 2 条 extra（`W-D3-01`/`W-F6-01`）；`context.ts` 是唯一读盘入口 |
| `src/templates/` | 模板**声明**：`builtin.ts` **11 个** / `registry.ts` 注册与自检 / `types.ts` 双轴 family×scope |
| `src/remotion/` | 渲染层：`index→Root→Overlay`（双栈）+ `MotionItem`（全树唯一 `useCurrentFrame`）+ `carrier.tsx`（分段包裹）+ `caption.ts`（words.json 唯一入口）+ `tokens.ts`（颜色唯一来源）+ `templates/` **8 个实现** + 映射表 |
| `tests/` `tools/` | vitest；一次性探针（probe-yunet / probe-regions / probe-shots / probe-saliency 等 16 个） |
| `docs/` `.workbuddy/skills/` | 规格/裁决/提案/评审/变更/模板清单；五阶段执行期契约 |

## 当前状态（2026-10-17 收工，提交 `856c7c5`）

六道闸**四道半**：`01-align` ✅（whisper 时间 + SRT 文字权威 + DP，`alignedRatio` 真实测量）/
`02-perceive` ✅（内置三通道：ffmpeg `scdet` 切镜 → YuNet `face` → 人脸外扩 `handheld` → 无脸镜头显著性 `broll`；三素材 77 shot / 0 低置信）/
`03-storyboard` 🔶（管线通、不调模型）/ `04-validate` ✅（17 项）/ `05-render` 🔶（8/11 模板有真实实现）。
**硬阻断已拆**（未配 `PERCEIVER_CMD` 不再退出码 2）。错误码 26 条。

✅ **计数漂移已清零（10-17 傍晚）**：全仓**活文件**按实测校正 —— 17 项校验 / 318 单测 / **19 测试文件**（+`_ctx.ts` 夹具）/ 11 声明 / 8 实现 / 44 条 RESOLVED / **7 个占位值**。
改动位置：`package.json`·`cli.ts`·`report.ts`·`stages/validate.ts`·`errors.ts`·`validate/index.ts`·`tests/validate.test.ts`·README·PROGRESS·SKILL.md（**补了缺失的 #17 行**）·SPEC·登记册正文 5 处。
🔴 **纪律**：历史档案保留原数字不动（`docs/changelog/`、`.workbuddy/memory/` 日志、`docs/reviews/`、`docs/decisions/2026-10-13-裁决材料.md`、SPEC 版本历史行）——**「第 N 项」是条目身份，「当前 N 项」才是活计数**。

## 占位值（🔴 勿当结论）

`ALIGN_GATE` 0.60 / 30% + `alignedRatioMin` 0.8（**须一并校准**）；`DENSITY.maxItemsPerCue=3`（却能直接产 error）；
闸2 分档 0.8/0.5；`PERCEIVE.safeAreaTopRatio=0.6`；`HANDHELD_EXPANSION` 宽3×/高2.5×；显著性 `targetAreaRatio=0.35`；
`MIN_VISIBLE_RATIO=0.5`（D4-t2 派生，未实现）；`CARRIER_FALLBACK` 空（tier2 仍是空操作，只出 `W-D4-01`）。

## 裁决状态

- **D-A** ✅ `typography/center-emphasis@1.0` 已实装（首个遮挡型，否则 11 个声明无一能触发遮挡判定）。
- **D-B2** ✅ 选 C（批量真渲度量表）⏳ 未做；前置阻塞：本机缺图像量测管线（ffmpeg 无 `eq`、无 PIL）。
- **M-2** ✅ 全 Node（onnxruntime-node）+ RTMO-S 起步；**M-4** ✅ 不接受 VLM 替代检测 ⇒ **face fail-closed 至今一行实现都没有**（只做 `lowConfidence` 标记）。
- **D4-t2** ✅ 裁决（10-17）：Q1 `StoryboardItem.carrier?: { template, params }`；Q2 逐 item 显式声明、**废全局 map**；Q3 **cover 裁切分屏 + 主体锚定窗口**（中心 = shot 的 `safeArea` 中心，`ratio` 钳 0.3–0.7，`side` 只决定视频显在哪侧；裁切窗在校验期算好写入 `params.window`）。派生 `visibleRegion(params)` ⇒ `W-D2-02` 正确判据 = `|safeArea∩window|/|safeArea| ≥ 0.5`。**施工 P1–P4 未开始。**
- ⚠️ 10-17 曾把 `W-D2-02` 补成第 18 项，**当日撤回**（假设 split-frame 已有实现、punch-in footprint 全屏 ⇒ 对分屏误报、对放大漏报）。教训：**「规格写了」≠「我读懂了」**，carrier 类 `footprint` 是**视频位置**不是 overlay 位置。

## 文档真源层级（冲突时以此裁决）

乐享 KB（唯一活文档，给人读）> `docs/decisions/OPEN-DECISIONS.md`（**裁决真源**，48 RESOLVED；OPEN 仅 `C2-2` 阈值实测、`C2-3` BGM 分离倾向不做）> `docs/spec/SPEC-*.md`（v0.7）> `docs/changelog/` > `docs/proposals/`（未裁决前不含结论）。
另：`PROGRESS.md`（真实数字 + 后续计划）、`CONTRIBUTING.md`（接手 3 分钟，口径：裁决册 > PROGRESS > 其他）。

## 约定 / 雷区

- **帧是真相**：模型只写锚点 `{anchor:"word:37", offset:"-8f"}`，烘焙器解析成帧；负偏移＝抢拍**合法**（下界是锚定词所在 cue 起点，C2-5a）。
- **新增字段/令牌/配置后立刻问「谁读它」** —— 10-15 一天撞见三例（`occludesSubject` / `handoffIn` / `DUR.exit`）。
- **推进实现后回头改计划书状态** —— 10-17 发现 `docs/proposals/2026-10-14-后续提升优化计划书.md` 仍按「未做」描述 D1/D2/D7（已加文首「实施状态回写」横幅 + §5.1/§5.2 实测值）。**每完成一条 D 项，先更新横幅**。
- 增补校验项**须先改裁决册**；新错误码同时进 `errors.ts` 的 `CODES`。
- 确定性红线：全树仅 `MotionItem` 读时钟；禁 `Date.now()`/`Math.random()`（用 `mulberry32`）/CSS animation/`<Series>`/显式 z-index。
- 🔴 **demo 夹具坑**：`draft.json` 曾带 `highlightColor` 而模板声明刻意不含 ⇒ 手改快照能骗过 validate，重跑 storyboard 就红（已修；**别手改下游快照**）。
- **改文档计数时区分活计数与条目身份**（「当前 16 项」要改，「第 16 项」不能改）。
- 🔴 环境铁律：pip **阿里源**（清华源 TLS 挂）；npm 大包「curl 下 tgz → cache add → 离线装」；`onnxruntime-node@1.30.0` 实测 **288MB**；模型落 `perceive-models/`（gitignore，换机重下，sha256 `ebafce4e…`）。
- `PROGRESS.md §七` 的 ffmpeg `EBUSY` 在新工作区**不复现**（ffmpeg 9.0.2 gyan.dev）⇒ 属特定安装方式问题，勿当通用坑。

## git

- 仓库级 noreply 身份（`29155565+bill1994@…`）；`gh auth setup-git` 做凭证，**别用 GCM**。
- 🔴 **代理只走环境变量 `HTTP_PROXY`/`HTTPS_PROXY`，勿写死端口**（宿主每会话换端口）；直接 `git push`。偶发 502/连不上→重试即通。
- 双工作区并行提交会产生「同内容不同 hash」的重复提交：先建 `backup/` 分支，`git diff` 为空再 `reset --hard origin/main`。
- 两边都会写 `.workbuddy/memory/` 日期日志 ⇒ **拉取时先查同名日志冲突、需合并**；`MEMORY.md` 只本机维护。

## 下次开工点

**D4-t2 施工**：~~P1 改契约~~ ✅ **2026-10-17 傍晚完成**（`StoryboardItem.carrier` + 废除全局 `CARRIER_FALLBACK` + 引用合法性结构检查 + 328 测）
→ **P2**：实现 `split-frame.tsx`（cover 裁切分屏 + 主体锚定窗口 + `visibleRegion(params)`）
→ **P3**：`resolveOcclusion` 真正写入 `item.carrier` → **P4**：以 `visibleRegion` 重立 `W-D2-02`（判据 `|safeArea∩window|/|safeArea| ≥ 0.5`）。

其余待办：第 4/5 批模板（`pointer-callout` 主体框已就绪 / `whip-pan` 无阻塞）、face fail-closed、`D-B2` 度量表、根 `SKILL.md`、参数决策档案、渲染基准量化（F4）。

**P1 定下的口径（后续 P2–P4 别推翻）**：`carrier.template` 的引用合法性走**结构检查**（`assertStructuralIntegrity` 抛 `ConfigError` → 退出码 2），**不占 17 项校验名额** —— 理由与 `handoffTo` 指向不存在 track 同类：配置写错 ≠ 内容没做好，报成校验项会让返修方向从一开始就错。
