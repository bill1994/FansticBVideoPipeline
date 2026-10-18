# 项目长期记忆 — video pipeline

## 身份

- **Remotion 视频动效叠加管线**：在实拍口播粗剪上叠 motion-graphic overlay。Node ≥22.19 / ESM / tsx，MIT。
- **两工作区共用远端** `github.com/bill1994/FansticBVideoPipeline`（**PUBLIC**，main）。
  `docs/proposals/` 与 `.workbuddy/memory/` 会随仓库公开。
- 🔴 **定位 = 「被模型读取的 skill pipeline」**：模型即操作者，**仓库不调模型**；`03-storyboard/draft.json` 是模型产物的等价物。

## 机器与工作区（🔴 本文件禁止写「本机」）

本文件**已被两台机的提交共同修改过**，任何「本机…」的表述都会在另一台机上读成假话。一律写绝对路径。

| 路径 | 素材 | 性质 |
|---|---|---|
| `G:\VideoPipeline` | ✅ `TestResources/` 3 段 mp4（`3月22日.mp4` 270M / `5月28日.mp4` 240M / `kukini.mp4` 681M）+ `10月6日.srt`；`jobs/` 4 个 | 10-14 从 E 盘迁入，**开发活跃机，唯一有素材的机器** |
| `G:\WorkbuddyProject\VideoPipeline` | ❌ 无 `jobs/`、无素材 | 曾作长期记忆主维护机 |

⚠️ **10-18 教训**：拉取后本文件被覆盖为 `WorkbuddyProject` 机视角，其中「本机 `jobs/` 空、素材在另一台机」两句在 `G:\VideoPipeline` 上**恰好相反**。已改为路径化表述 —— 后续同步别再写「本机」。

`G:\VideoPipeline\jobs\` 实际进度（**没有任何 job 跑过 03/04/05**）：

| job | 已有阶段 |
|---|---|
| `e2e-0322` / `e2e-0528` / `e2e-perceive` | `00-input` + `02-perceive` |
| `real30` | `00-input` + `01-align` |

## 命令

```bash
npm run pipeline -- <stage> --job <id> [--jobs-dir <dir>]  # align|perceive|storyboard|validate|render|init
npm run typecheck && npm test   # tsc --noEmit / vitest 384 项 / 23 文件
```
demo（无需真实素材）：`storyboard`（须带 `--draft`）→ `validate` → `render`，`--jobs-dir examples`。
预期 0 error / 2 warning（均 `W-F6-01`）。⚠️ 仅在**不重跑 storyboard** 时成立（见雷区）。

## 结构

| 路径 | 职责 |
|------|------|
| `src/cli.ts` | 唯一入口：参数解析 + 阶段分发 + 语义化退出码（0/1/2/…/6/130） |
| `src/core/` | `types.ts` 契约 / `errors.ts`（**26 条**项级码）/ `exit-code.ts` / `config.ts` / `bake.ts` 锚点→帧 / `schedule.ts` 两道闸+地板+动态T / `io.ts` job 目录+不可变快照守卫 / `carrier-window.ts` **载体几何唯一真源** / `report.ts` / `srt.ts` / `zh-normalize.ts` |
| `src/stages/` | `align`(后端选择)→`builtin-align`→`whisper-adapter`+`text-align`(DP)；`perceive`(后端选择)→`builtin-perceive`→`shot-detect`(ffmpeg scdet)+`yunet`+`region-derive`；`storyboard`/`validate`/`render` |
| `src/validate/` | **18 项**构建期校验（纯 JSON→JSON）+ 2 条 extra（`W-D3-01`/`W-F6-01`）；`context.ts` 唯一读盘入口；`occlusion.ts` 消解唯一实现（含 `resolveScene` 单一入口） |
| `src/templates/` | 声明：`builtin.ts` **11 个** / `registry.ts` 自检 / `types.ts` 双轴 family×scope |
| `src/remotion/` | `index→Root→Overlay`(双栈) / `MotionItem`（全树唯一 `useCurrentFrame`）/ `carrier.tsx` / `caption.ts` / `tokens.ts` 颜色唯一来源 / `templates/` **9 个实现** |
| `tests/` `tools/` | vitest **23 文件 / 384 项**；探针 16 个（probe-yunet / -regions / -shots / -saliency …） |
| `docs/` `.workbuddy/skills/` | 规格/裁决/提案/评审/变更 + 五阶段执行期契约 |

## 当前状态（2026-10-18 · `b4935ba` · 工作区干净）

六道闸「四道半」：`01-align` ✅ / `02-perceive` ✅（内置三通道：ffmpeg `scdet` → YuNet `face` → 人脸外扩 `handheld` → 无脸镜头显著性 `broll`；三素材 77 shot / 0 低置信）/ `03-storyboard` 🔶（管线通，不调模型）/ `04-validate` ✅ / `05-render` 🔶（**9/11** 模板有实现）。
**硬阻断已拆**（未配 `PERCEIVER_CMD` 不再退出码 2）。

- ✅ **计数**：18 项校验 / **384 单测 / 23 文件** / 11 声明 / 9 实现 / 26 条码 / 8 个占位值。
- ✅ **通道方案 A 已落地**：`resolveScene(ctx)` 为消解单一入口，`render` 侧重算后用 `ctx.storyboard` 生成 props。
- ✅ **P3 已接线**：tier2 真正写入 `carrier.params.window`（主体锚定），遮挡率按**施加后**重算 + 终判。
- ✅ **P4 已重立 `W-D2-02`（第 18 项）**：判据换源为 `visibleRegion(params)`，该函数已认
  `window`（分屏）与 `scale`（放大）**两种裁切源** ⇒ D2-2 撤回理由②已消解。
- ✅ **split-frame 坐标系 bug 已修**（真渲抽帧抓出，见「真渲纪律」）。
- ✅ **D4-t2 施工 4/4 完成**（P1 契约 → P2 实现 → P3 接线 → P4 重立）。
- ✅ **10-18 拉取后复验**：typecheck 零输出 / 384 项全绿 /
  `validate --job demo --jobs-dir examples` → `checked=18 项 + 2 条起草原生约束, warning=2`。

## 🔴 四层假绿教训（本项目最贵的经验，务必记住）

| 层 | 病 | 状态 |
|---|---|---|
| 1 | 算了却只拼进 `detail` 字符串 | 10-13 已修 |
| 2 | 改了**内存对象**，跨进程无通道（`render` 独立进程重读 JSON） | 10-17 已修（方案 A） |
| 3 | 施加了变换，但**未验证终态**（如载体施加后仍超预算却报成功） | 10-17 已修（补终判） |
| 4 | 组件单测 + 静态断言全绿，但**画面是错的**（CSS 坐标系） | 10-17 已修 |

**判据：凡涉及「改变产物」的判定，都必须能回答「成片里哪儿变了」。**

## 🔴「两处各写一套算法」—— 本项目第三次同款病（根治口诀）

**同一个概念只允许有一个真源。** 三次实例：

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | split-frame 分界线落在 0.75（偏差 25%） | `clip-path` 百分比相对父容器，`MotionItem` 已按 footprint 缩窄 | 组件内反向抵消父级定位撑回满画面；⚠️ 抵消量也相对父宽，**必须除以 footprint 尺寸** |
| 2 | `params.scale=3.0` 时判据按 3.0 算、渲染实际用 1.6 | 钳制常量只存在于 `punch-in.tsx` | 常量上提 `core/carrier-window.ts`，两边共用 `clampScale()` |
| 3 | 校验期顺序耦合（#12 改写 footprint 后 #17 读到改后的值） | 校验项之间存在隐式顺序依赖 | 明知并记录；`render` 侧复用同一份 `resolveScene` |

🔴 **发现手段**：跨层探针对账（渲染期实际值 vs 判据推算值）比单测更灵 ——
`carrier-window.test.ts` 现导入 `punchInScale` 做跨模块对账。
🔴 **写断言前先跑一遍拿真实值**，别纯手算 —— 两次几何算错都伪装成「代码有 bug」。

## 🔴 真渲纪律（最高优先级）

- 🔴 **「单测全绿 + 静态断言全绿」≠ 画面正确**。P2 的 10 项 split-frame 测试全绿，
  真渲抽帧却量到分界落在 **0.75**（期望 0.5，偏差 25%）。
- **根因**：`clip-path` / `position` 的百分比**相对父容器**，而 `MotionItem` 先按
  `item.footprint` 撑出定位 div ⇒ 坐标系错位。`punch-in` 用 `transform: scale()`
  相对自身算所以恰好正确 ⇒ **只有部分模板会露馅，更危险**。
- **修法**：先反向抵消父级 footprint 定位撑回满画面。⚠️ 抵消量也相对父宽，
  **必须除以 footprint 尺寸**：`-fp[0]/fp[2]`、`1/fp[2]`（第一版就漏了这个除法）。
- **量测法**：`remotion still` 抽帧 + 纯 Node 解 PNG（zlib + PNG 反滤波）像素级量分界线。
- 🔴 **探针脚本未入库**：`out/make-split-frame-probe.mjs` 在 `out/` 下，被 `.gitignore` 忽略
  ⇒ 只存在于做过那次真渲的机器，换机重跑需重建探针（`out/frames/` 里的抽帧同理）。
- ⚠️ 那次真渲用的是占位底（当时机器无素材）⇒ **验证的是几何不是观感**。
  真正素材在 `G:\VideoPipeline\TestResources\`，端到端观感尚未验证。

## 占位值（🔴 勿当结论；8 个，通道通了 ⇒ 优先级上升）

`ALIGN_GATE` 0.60/30% + `alignedRatioMin` 0.8（**须一并校准**）；闸2 分档 0.8/0.5；`DENSITY.maxItemsPerCue=3`（却能直接产 error）；
`PERCEIVE.safeAreaTopRatio=0.6`；`HANDHELD_EXPANSION` 宽3×/高2.5×；显著性 `targetAreaRatio=0.35`；`CARRIER_RATIO_DEFAULT=0.5`；
`MIN_VISIBLE_RATIO=0.5`（D4-t2 派生，**判据已于 P4 实装**，但阈值未校准 ⇒ `W-D2-02` 只能是 warning 档）。
`CARRIER_FALLBACK` 全局表**已删**（P1）⇒ 未声明载体报 `E-D4-01`。

## 裁决状态

- **D-A** ✅ `typography/center-emphasis@1.0` 已实装（首个遮挡型）。
- **D-B2** ✅ 选 C（批量真渲度量表）⏳ 未做；阻塞：缺图像量测管线（该机 ffmpeg 无 `eq`、无 PIL）。
- **M-2** ✅ 全 Node（onnxruntime-node）+ RTMO-S 起步；**M-4** ✅ 不接受 VLM 替代检测 ⇒ **face fail-closed 至今零实现**（只做 `lowConfidence` 标记）。
- **D4-t2** ✅ 裁决（10-17）：Q1 逐 item 显式 `carrier`、**废全局 map**；Q3 **cover 裁切分屏 + 主体锚定窗口**（中心 = shot `safeArea` 中心，`ratio` 钳 0.3–0.7，`side` 只决定视频显在哪侧；裁切窗校验期算好写入 `params.window`）。派生 `visibleRegion(params)` ⇒ `W-D2-02` 判据 = `|safeArea∩window|/|safeArea| ≥ 0.5`。
- ⚠️ 10-17 曾把 `W-D2-02` 补成第 18 项、**当日撤回**，10-17 晚又以新判据重新入册。教训：**「规格写了」≠「我读懂了」** —— carrier 类 `footprint` 是**视频位置**不是 overlay 位置。
- ⚠️ **裁决总数不要再引用**：旧记录一处写「44 RESOLVED」、另一处写「48」，两者相互矛盾且未核
  （登记册状态列有三种格式混排，机械计数得 38–45 区间）。**只引 OPEN 清单**即可。

## 下次开工点

**D4-t2 已 4/4 完成**，下一步两条线：

1. **占位值校准（8 个）** —— 尤其 `MIN_VISIBLE_RATIO=0.5`，校准后 `W-D2-02` 才能升 error。
2. **真素材端到端验证** —— 素材在 `G:\VideoPipeline\TestResources\`，但 `jobs/` 里 4 个 job
   **全部只跑到 01/02，没有一个跑过 03/04/05**。这是最容易出第四层假绿的环节：
   需要拿真素材产出 `storyboard` → `validate` → `render` → **抽帧看画面**。

⚠️ 老记录说此步「受阻于本机 jobs/ 空、素材在另一台机」—— 在 `G:\VideoPipeline` 上**该阻塞不成立**，
素材就在手边，缺的只是没跑过。

其余待办：第 4/5 批模板（`pointer-callout` 主体框已就绪 / `whip-pan` 无阻塞）、face fail-closed、`D-B2` 度量表、根 `SKILL.md`、F4 渲染基准量化。

## P1–P4 定下的口径（后续别推翻）

- 🔴 **`visibleRegion` 必须认两种裁切源**：`window`（split-frame 分屏）与 `scale > 1`
  （punch-in 放大裁边）⇒ 可见区 `[(1-1/s)/2, (1-1/s)/2, 1/s, 1/s]`。
  只实现 window 那一支 = D2-2 撤回理由②「对放大完全漏报」原样留着。
- 🔴 **两者并存时取交集**（`intersectRects`），不是「window 优先」—— 后者会静默忽略 scale 的裁边 ⇒ 漏报。
- 🔴 **scale 必须过 `clampScale()`**（`[1.0, 1.6]`，常量在 `core/`），否则判据比渲染更狠 ⇒ 误报。
- ⚠️ **scale 分支取目标值（最坏帧），非当前帧** —— `punchInScale` 有进出场，中段帧 scale 小于目标值。
  方向**保守**（可能误报、不会漏报），**已拍板保持现状**。
- ⚠️ scale 可见区是**纯几何推导**（占位底铺满画面，真渲量不到黑边），真实素材下须复核。
- 查 shot `safeArea` 按**时间相交**，不按「item 起始帧落在 shot 内」—— item 可横跨两个 shot。
- `W-D2-02` 与 `W-D4-01` 的码串都沿用旧值保登记册可追溯，**语义以代码注释为准**。
- `W-D2-02` 的类归属（「载体可见性类」）**未经登记册裁决**，变更须走 `OPEN-DECISIONS.md`。
- 改写**只在内存 + 由 render 侧重算**传递，不落新阶段产物（`guardSnapshot` 本就禁止 04 写 03）；
  `render` 必须用 `ctx.storyboard` 而非单独 `readJson`，否则改写又蒸发。
- 🔴 **`resolveScene` 必须在 render 侧跑一次**，且**幂等**（已在预算内不重复平移）。
- 消解逻辑**唯一一份**在 `validate/occlusion.ts`，render 复用而非复制 ⇒ 校验与渲染几何逐位一致。
  分叉会让报告对成片说谎。
- 🔴 **施加 ≠ 成功**：tier2 必须有终判（施加后按展示条重算遮挡率），否则应报 `E-D2-01` 而非谎称成功。
- `window` **刻意不进 `paramsSchema`** —— 校验期写入的系统字段，进表模型就能填它。
- 载体几何**只此一份实现**（`core/carrier-window.ts`），validate 与 remotion 都从它取。
- split-frame **刻意无进出场**（窗口随帧变化会动摇 `W-D2-02` 的判据）⇒ 渲染测试用
  `STATIC_LAYOUT_TEMPLATES` 具名豁免 + 两条反向断言。

## 文档真源层级（冲突时以此裁决）

乐享 KB（唯一活文档，给人读）> `docs/decisions/OPEN-DECISIONS.md`（**裁决真源**；OPEN 仅 `C2-2` 阈值实测、`C2-3` BGM 分离倾向不做）> `docs/spec/SPEC-*.md`（v0.7）> `docs/changelog/` > `docs/proposals/`（未裁决前不含结论）。
另：`PROGRESS.md`（真实数字 + 后续计划）、`CONTRIBUTING.md`（接手 3 分钟：裁决册 > PROGRESS > 其他）。

## 约定 / 雷区

- **帧是真相**：模型只写锚点 `{anchor:"word:37", offset:"-8f"}`，烘焙器解析成帧；**负偏移＝抢拍合法**（下界是锚定词所在 cue 起点，C2-5a）。
- **新增字段/令牌/配置后立刻问「谁读它」** —— 10-15 一天撞见三例（`occludesSubject`/`handoffIn`/`DUR.exit`）。
- **推进实现后回头改计划书状态**：每完成一条 D 项，先更新 `docs/proposals/2026-10-14-后续提升优化计划书.md` 文首状态横幅。
- **改文档计数时区分活计数与条目身份**（「当前 16 项」要改，「第 16 项」不能改）。历史档案（changelog / memory 日志 / reviews / SPEC 版本历史行）保留原数字不动。
- 增补校验项**须先改裁决册**；新错误码同时进 `errors.ts` 的 `CODES`。**`CODES` 键名不可与已删配置同名**（会误导），但错误码字符串要保留以保可追溯。
- 确定性红线：全树仅 `MotionItem` 读时钟；禁 `Date.now()`/`Math.random()`（用 `mulberry32`）/CSS animation/`<Series>`/显式 z-index。
- 🔴 **demo 夹具坑**：`draft.json` 曾带 `highlightColor` 而模板声明刻意不含 ⇒ 手改下游快照能骗过 validate，重跑 storyboard 就红（已修）。**别手改下游快照。**
- 🔴 环境铁律：pip **阿里源**（清华源 TLS 挂）；npm 大包「curl 下 tgz → cache add → 离线装」；`onnxruntime-node@1.30.0` 实测 **288MB**；模型落 `perceive-models/`（gitignore，换机重下，sha256 `ebafce4e…`）。参照 venv `~/.workbuddy/binaries/python/envs/default`。
- `PROGRESS.md §七` 的 ffmpeg `EBUSY` 在 `G:\VideoPipeline` **不复现**（ffmpeg 9.0.2 gyan.dev）⇒ 特定安装方式问题，勿当通用坑。
- Git Bash：`python -c` 传含反引号多行串会失败 → 写临时 `.py`；git 输出中文路径需 `core.quotepath=false`。

## git

- 仓库级 noreply 身份（`29155565+bill1994@…`）；`gh auth setup-git` 做凭证，**别用 GCM**。
- 🔴 **代理只走环境变量 `HTTP_PROXY`/`HTTPS_PROXY`，勿写死端口**（宿主每会话换端口）；直接 `git push`。曾用 `-c http.proxy=127.0.0.1:4436` 连续 5 次失败而 curl 却通 —— **别用 curl 通推断 git 通**。偶发 502 → 重试即通。
- 双工作区并行提交会产生「同内容不同 hash」重复提交：先建 `backup/pre-pull-<date>`，`git diff` 为空再 `reset --hard origin/main`。
- 两边都写 `.workbuddy/memory/` 日期日志 ⇒ **拉取时查同名日志冲突并合并**（先例 10-12/13/15）。
- 🔴 **`MEMORY.md` 名义上「只本机维护」，实际上已被远端提交过** —— 10-18 拉取即被另一台机视角整体覆盖。
  故：① 内容一律**路径化**、不写「本机」；② 拉取前先 `git log --oneline -- .workbuddy/memory/MEMORY.md`
  看它是否被动过；③ 改完若要留，就得提交（否则下次 ff 又被覆盖）。
