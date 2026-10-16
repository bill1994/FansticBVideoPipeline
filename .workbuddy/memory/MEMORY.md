# 项目长期记忆 — video pipeline

## 项目身份

- **项目**：Remotion 视频动效工作流（在实拍粗剪视频上叠 motion-graphic overlay）。
- **根目录**：`G:\WorkbuddyProject\VideoPipeline`（2026-10-15 从 `C:\Users\63088\WorkBuddy\video pipeline` 迁入；新路径**无空格**，命令仍建议绝对路径 + 引号）。
  ⚠️ **旧路径 C 盘已废弃** —— 只余空目录壳（0 文件，待 WorkBuddy 重启后清理），脚本/文档勿再引用。
- **目标产物**：一个可运行的完整 Remotion 项目（自动起草 → 人工审 → 渲染导出）。
- **形态**：Node/TypeScript 工程（Node ≥ 22.19，ESM，tsx 直跑 TS）。MIT。

## 常用命令

```bash
npm run pipeline -- <stage> --job <id> [--jobs-dir <dir>]   # align|perceive|storyboard|validate|render|init
npm run typecheck        # tsc --noEmit
npm test                 # vitest（269 项 / 15 文件）
npm run studio           # Remotion Studio
npm run render:video     # 已内置 --gl=angle
```

demo（无需真实素材，端到端跑通）：
```bash
npm run pipeline -- storyboard --job demo --jobs-dir examples --draft examples/demo/03-storyboard/draft.json
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run
```
预期：0 error / 2 warning（**均为 `W-F6-01`**，demo 故意标低置信以演示 F6 人工兜底；checked = 17）。

⚠️ **但这只在「不重跑 storyboard」时成立** —— 见下方「已知雷区」的 demo 夹具坑：
`draft.json` 带 `highlightColor`，重跑 `storyboard` 后 validate 会报 2 个 `E-P1-01` 阻断。

## 代码结构

| 路径 | 职责 |
|------|------|
| `src/core/` | 类型契约、错误码、报告、**调度**（两道闸+地板+动态T）、**烘焙**（锚点→帧）、IO、SRT 解析与繁简归一 |
| `src/validate/` | **17 项**构建期校验（纯函数；#17 文本溢出为 warning 档） |
| `src/templates/` | 模板契约（双轴 family × scope）与注册表（**11 个模板声明**，含 D-A 新增 `typography/center-emphasis`） |
| `src/stages/` | 五阶段执行逻辑（含内置对齐器：whisper-adapter / text-align / builtin-align） |
| `src/remotion/` | C6 双栈映射 + **8 个**模板真实实现（`templates/`）+ 令牌层 / 字幕通道 / **载体链分段包裹**（`carrier.tsx`） |
| `tools/` | 一次性探针脚本（render-probe / setup-whisper / slice-srt / probe-* 等） |
| `.workbuddy/skills/` | 五阶段 Skill（执行期行为契约） |

- **`align` 双后端**（2026-10-14 起）：配 `ALIGNER_CMD` → 外部对齐器；未配置 → **内置对齐器**
  （whisper.cpp 出时间 + SRT 文本权威 + text-align 合成，`alignedRatio` 首次成为真实测量值）。
  默认查找「**仓库根 / whisper.cpp**」（**D7 已修**：`resolveWhisperCppRoot()`，不依赖 cwd；`WHISPER_CPP_PATH` 可覆盖）——
  本机未装时按提示跑 `tools/setup-whisper.mts`；whisper 缺失时退出码 2。
- **`perceive` 仍不内置**（模型接入方案讨论中），走 `PERCEIVER_CMD` 契约；未配置**直接退出码 2**，绝不伪造结果。
- **`03-storyboard/draft.json` 是「模型产出」的等价物** —— 仓库不调模型。

## 数值占位（🔴 勿当结论）

| 项 | 值 | 状态 |
|----|----|------|
| 对齐门控 | 均值 0.60 / 低置信词 30% | 文档初值，**待实测**（登记册 C2-2 仍 OPEN） |
| 对齐门控 `alignedRatioMin` | 0.80 | 🔴 **占位值**（M-1c 新增）；**须与均值一并校准，不得分开拍** |
| 闸2 confidence 分档 | high 0.80 / mid 0.50 | **占位值**（真源只给组合矩阵） |
| 每 cue item 数 | 3 | **占位值**（真源只写「超阈值」） |
| `CARRIER_FALLBACK` 映射 | 空 | 默认不可用 → 报 `E-D4-01`；**填表也只抑制报错（出 `W-D4-01`），成片不会真正退让**（10-13 更正；修 tier2 须先立登记册裁决） |

## 文档缺口与待裁决

**已裁决并回写（2026-10-13）**：
1. D3 fullscreen 人工确认 → 裁决 **D3-a**：落在 render 启动闸，`validate` 只出 `W-D3-01` 预告（在 extra）。
   E5 禁配段相交 → **并入清单为第 15 项**（`E-E5-01`；不再计入 extra）。
2. **`offset:"-8f"` 时序冲突** → 裁决 **C2-5a**：C2-5 区间下界由「词起点」改为
   「**锚定词所在 cue 的起点**」——负偏移＝抢拍、**合法**（demo 已改回负偏移，作为回归证据）。

**⏳ 进行中（2026-10-16）**：
- **perceive 检测后端深度研究**（Node 环境·人脸/人体/手部选型）——Phase 1 中断待续；
  任务卡与已有材料发现见 `.workbuddy/memory/2026-10-16.md`（含 **YuNet-ONNX 待验证点**、
  四候选全景：YuNet / onnxruntime-node+RTMO 系 / MediaPipe Tasks Vision / Python sidecar）

**⏳ 当前活跃待裁决（2026-10-16 状态，详见 `CONTRIBUTING.md` §5 与登记册）**：
- **D-A**：✅ 已裁决（10-16）→ 选 A1，`typography/center-emphasis@1.0` **已实装**（首个遮挡型叠加模板）
- **D-B2**：✅ 已拍板（10-15）：选 C（批量真渲实测）—— **实施待做**，前置阻塞：本机**缺图像量测管线**
  （自带 ffmpeg 无 `eq`、无 PIL）⇒ 需先定量测方案
- **M-2**：✅ 已定案 —— **全 Node（`onnxruntime-node`）+ RTMO-S 起步**（Apache-2.0；YOLO26n-pose 为 AGPL 注意边界）
- **M-4**：✅ 已拍板（10-15）：不接受「用 VLM 替代检测」的降级（#12/#14 保留测量）
- **D4 tier2 载体退让**：仍 OPEN，**须先立登记册裁决**（承载字段 + 键粒度 + 新载体模板）⇒ 阻塞第 3 批 `carrier/split-frame`


## 文档真源层级（冲突时以此裁决）

| 层 | 位置 | 地位 |
|----|------|------|
| 1 | 乐享 KB《Remotion 视频动效工作流 — 进度总结》 | **唯一活文档**（给人读） |
| 2 | `docs/decisions/OPEN-DECISIONS.md` | **裁决唯一真源**，40+ 条 |
| 3 | `docs/spec/SPEC-remotion-overlay-workflow.md` | 实现规格，**与层 2 冲突时以层 2 为准** |
| 4 | `docs/changelog/` | KB 侧变更记录 |
| 5 | `docs/proposals/` | **待裁决议题 + 方案对比 + 落地计划**（未裁决前不含结论）|

- **待裁决项命名**：用带前缀的编号（已有 `M-1`~`M-4` 用于模型选型），**裁决后必须回写登记册**。
- 仓库根目录另有：`PROGRESS.md`（项目进度与真实数字）、`CONTRIBUTING.md`（接手开发 3 分钟指南；其口径：真源优先级 `OPEN-DECISIONS` > `PROGRESS.md` > 其他）。

- KB 文档：`entry_id = cc6a8c8fa38e4fa68d59e4141d747c71`，`space_id = 57d1ad38cf8f4617ba18729f7661972d`。
- 乐享是 v2 MCP：`company_domain = https://lexiangla.com` 是顶级域 → 访问链接必须带 `?company_from=<company.code>`。
- 本地 `docs/Remotion视频动效工作流-进度总结-2026-10-12.md` 是**早间过期快照**，仅历史留档，别拿它当依据。

## 约定

- **Spec 文件名不带版本号**（`SPEC-remotion-overlay-workflow.md`），版本只写文内标题 —— 避免每次改版都要改文件名/引用。
- 设计结论未落到字段级细节时，Spec 里标 `🟡TBD`，**不得凭常识填**；先去登记册查证，查不到就保持开放。
- **Skill 放 `.workbuddy/skills/<name>/SKILL.md`**（项目级），已通过 `!.workbuddy/skills/` 入库。5 个 = align / perceive / storyboard / validate / render，按管线阶段切，**不做巨型 skill**。
- Skill 是**自包含**的（不指向 Spec）：§10.2 明确说 Skill 要精简到只保留「必须遵守」的部分 —— 塞整份 Spec 会挤掉素材本身的信息。代价是局部重复，属有意为之。
- **新增字段 / 令牌 / 配置后，立刻问「谁读它」** —— 2026-10-15 一天撞见三例同款病（`occludesSubject` / `handoffIn` / `DUR.exit`）；「定义了」不等于「被用了」。
- 文档只规定目录里**有哪些数据**、不点名文件名。自拟的文件名一律标【实现期拟定，文档未点名】，**别把实现建议伪装成文档结论**。
- 分支代号：A 素材与前提 / B 感知与对齐 / C 时间轴模型 / D 构图与遮挡 / E 渲染架构 / F 工程化与闭环。**六分支已于 2026-10-12 全部封口。**
- 时间坐标：**帧是真相**（`fromFrame` + `durationInFrames`）；模型只写锚点 `{anchor:"word:37", offset:"-8f"}`，由烘焙器解析成帧。
- `.workbuddy/` 不是缓存，勿删；其下 **`memory/` 与 `skills/` 入 git**，其余忽略。

## git

- 仓库：`main` 分支，**已推送到 <https://github.com/bill1994/FansticBVideoPipeline>**（**PUBLIC**）。
- **远端由两个工作区并行使用**：本机（`G:\WorkbuddyProject\VideoPipeline`）与另一环境（`G:\VideoPipeline`，2026-10-14 从 E 盘迁入）。
  两边都会写 `.workbuddy/memory/` 的日期日志 → **拉取时先检查有没有同名日志冲突、需合并**（先例：10-12 / 10-13 / 10-15 均已合入同一文件）；
  ⚠️ **`MEMORY.md` 只有本机在维护**（最后更新于 10-13，另一环境 10-14/15 未改过）——长期记忆的校准靠本机自己。
  2026-10-15 本机已 pull 对齐至 `697d9de`（远端那台当日做了大量开发：5 模板实现、对齐器、校验项 17 等）。
- **本仓库用 noreply 身份**：仓库级 `user.email = 29155565+bill1994@users.noreply.github.com`
  （全局仍是 gmail，**没动**）。2026-10-13 首次推送前用 `filter-branch` 把 8 个提交的作者+提交者全改过。
- 凭证：`gh auth setup-git` → `credential.https://github.com.helper = gh auth git-credential`
  （**不要用 GCM**，它在 wincredman 校验处会失败）。
  ⚠️ **两台机的 gh 路径不同**：`G:\WorkbuddyProject\VideoPipeline` 那台在
  `~/.workbuddy/binaries/gh/bin/gh.exe`；**本工作区（`G:\VideoPipeline`，2026-10-16 实测）在
  `C:\Program Files\GitHub CLI\gh.exe`**，便携版已不存在。
- 代理：**本工作区（2026-10-16 起）走环境变量 `HTTP_PROXY`/`HTTPS_PROXY = http://127.0.0.1:4436`**，
  旧的 `13145` 端口已不再监听。`git fetch` 偶发 `CONNECT tunnel failed, response 502`，**重试即通**（瞬时，别改配置）。
- **双工作区并行提交会产生「同内容不同 hash」的重复提交**（2026-10-16 实测：本地 `f81706d` 与远端 `697d9de`
  内容逐字节相同）。处理：先建 `backup/pre-pull-<date>` 分支，确认 `git diff <本地> <远端>` 为空后 `reset --hard origin/main`。
- `.gitignore`：忽略 `.workbuddy/*`（**保留 `memory/` 与 `skills/`**）、媒体大文件、`jobs/`、`node_modules`、`out`、`.vitest-cache/`。
- **`docs/proposals/` 与 `.workbuddy/memory/` 都会随仓库公开** —— 写这两处时按「会被公开」的标准写。

## 已知雷区

- 🔴 **demo 夹具坑（2026-10-16 发现并修复）**：`examples/demo/03-storyboard/draft.json` 里两条
  `caption/karaoke-word` 曾带 `highlightColor: "#ffd166"`，而模板声明按 P1 硬约束**刻意不含该键**。
  当时已提交的 `storyboard.json` 里这两个键是**手工删掉的**（错层修复）⇒ 直接 `validate` 是 0 error，
  但**照 PROGRESS §八 的顺序先 `storyboard` 再 `validate` 会重新烘焙出该键 → 2 × `E-P1-01` 阻断**。
  已修：删 `draft.json` 的该键（draft 才是模型产物等价物），重烘焙后 storyboard.json **逐字节相同**，
  validate 回到 0 error / 2 warning。demo README 已补两条纪律（不写颜色键 / 不手改下游快照）。
  **教训：幂等产物出现"直接跑是绿的、按文档重跑就红"，说明某处被手改了 —— 先查 draft 与快照是否同源。**
- 🔴 **缺 `02-perceive` 产物时 `validate` 直接拒绝启动**（实测，非静默放过）——
  阶段目录是不可变快照，"缺即为前置未跑"。叠加 `perceive` 阶段未配置即退出码 2
  ⇒ **真实素材在 `01-align` 之后无路可走**，这是当前唯一硬阻断点（perceive 为第一优先的依据）。
- **文档数字漂移（2026-10-16 已统一）**：此前 `PROGRESS.md` §三/§四 写「16 项校验」「218 项单测」，
  §七 写「268 项」，README/SPEC 亦停在 16 项；实际 = **17 项 / 269 项 / 15 文件 / 11 声明 / 8 实现**。
  ⚠️ 残留的「16 项」只应出现在 **2026-10-12 时间戳章节**（历史记录，按「只追加」纪律不动）。
  引用数字前先跑 `npm test` 核一遍。
- **改文档计数时区分两种引用**：「**当前** 16 项」是活计数（要改）；「**第 16 项**」是条目身份（不能改）。
- **乐享预签名 URL 必须整串复制**：截断 `filename%3D"..."` 之后的 `%3B%20filename%2A%3Dutf-8%27%27...` 会直接 `SignatureDoesNotMatch`（403）。与代理无关。
- 乐享 HTML `<table>` **不能逐格替换**，必须整表删掉重建为 GFM 表；GFM 表**行数上限 10**（含表头）。
- **`block_fetch_page(render_mode="markdown")` 下，HTML 表格标记（`</table>`/`</td>`）不可匹配** —— 那些标记不在 block 文本里。
  但**原生表格的单元格文本可以匹配**。要改表格**结构**（增/删行）必须走 `render_mode=mdx` + `replace_blocks`。
- **改一处会让别处的匹配产生歧义**：新文本若仍包含旧子串，同类替换会变成 `match_count=2`。
  解法是先用 `replace_all_matches=true` 统一改，再回来清理多余尾巴。
- **代码块里的 `|` 匹配不上**（`|` 与 `\|` 都试过）。绕法：改用不含 `|` 的锚点。
- `update_content` 的 dry_run **遇第一条 matched=false 即中止**，后面的不再报 —— 排查时一次只探一条。
- Git Bash 下 `python -c` 传含反引号的多行串会失败 —— 写临时 `.py` 文件再执行。
- **git 输出里的中文路径**：默认 `core.quotepath` 会转成八进制转义（如 `"docs/changelog/2026-10-15-D1\346\250\241..."`，脚本读取直接 ENOENT）。
  一次性覆盖：`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=false git …`（勿写进仓库配置）。
