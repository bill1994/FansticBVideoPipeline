# 项目长期记忆 — video pipeline

## 项目身份

- **项目**：Remotion 视频动效工作流（在实拍粗剪视频上叠 motion-graphic overlay）。
- **根目录**：`C:\Users\63088\WorkBuddy\video pipeline`
  ⚠️ **路径含空格** —— 所有 shell 命令必须加引号，脚本里也用绝对路径 + 引号。
- **目标产物**：一个可运行的完整 Remotion 项目（自动起草 → 人工审 → 渲染导出）。
- **形态**：Node/TypeScript 工程（Node ≥ 22.19，ESM，tsx 直跑 TS）。MIT。

## 常用命令

```bash
npm run pipeline -- <stage> --job <id> [--jobs-dir <dir>]   # align|perceive|storyboard|validate|render|init
npm run typecheck        # tsc --noEmit
npm test                 # vitest（69 项）
npm run studio           # Remotion Studio
npm run render:video     # 已内置 --gl=angle
```

demo（无需真实素材，端到端跑通）：
```bash
npm run pipeline -- storyboard --job demo --jobs-dir examples --draft examples/demo/03-storyboard/draft.json
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run
```
预期：0 error / 2 warning（都是 W-F6-01）。

## 代码结构

| 路径 | 职责 |
|------|------|
| `src/core/` | 类型契约、错误码、报告、**调度**（两道闸+地板+动态T）、**烘焙**（锚点→帧）、IO |
| `src/validate/` | 14 项构建期校验（纯函数） |
| `src/templates/` | 模板契约（双轴 family × scope）与注册表 |
| `src/stages/` | 五阶段执行逻辑 |
| `src/remotion/` | C6 双栈映射（背景链串联 / 叠加栈并列） |
| `.workbuddy/skills/` | 五阶段 Skill（执行期行为契约） |

- **`align` / `perceive` 不内置模型**，走 `ALIGNER_CMD` / `PERCEIVER_CMD` 环境变量契约；
  未配置**直接退出码 2**，绝不伪造结果。
- **`03-storyboard/draft.json` 是「模型产出」的等价物** —— 仓库不调模型。

## 数值占位（🔴 勿当结论）

| 项 | 值 | 状态 |
|----|----|------|
| 对齐门控 | 均值 0.60 / 低置信词 30% | 文档初值，待实测 |
| 闸2 confidence 分档 | high 0.80 / mid 0.50 | **占位值**（真源只给组合矩阵） |
| 每 cue item 数 | 3 | **占位值**（真源只写「超阈值」） |
| `CARRIER_FALLBACK` 映射 | 空 | 默认不可用 → 报 `E-D4-01`；填表才启用自动载体降级 |

## 文档缺口（实现期发现，**未擅自改文档**）

1. D3 fullscreen 人工确认、E5 禁配段相交 —— **都不在 F2 的 14 项表内**；
   已分别编为 `W-D3-01` / `E-E5-01` 并计入 `summary.extra`。
2. **`offset:"-8f"` 与 C2-5 时序校验冲突**：负偏移必然把 `fromFrame` 推到词起点之前 →
   必报 `E-C2-5-01`。当前照字面执行 C2-5，demo 用 `+2f`。**待裁决。**


## 文档真源层级（冲突时以此裁决）

| 层 | 位置 | 地位 |
|----|------|------|
| 1 | 乐享 KB《Remotion 视频动效工作流 — 进度总结》 | **唯一活文档**（给人读） |
| 2 | `docs/decisions/OPEN-DECISIONS.md` | **裁决唯一真源**，40+ 条 |
| 3 | `docs/spec/SPEC-remotion-overlay-workflow.md` | 实现规格，**与层 2 冲突时以层 2 为准** |
| 4 | `docs/changelog/` | KB 侧变更记录 |

- KB 文档：`entry_id = cc6a8c8fa38e4fa68d59e4141d747c71`，`space_id = 57d1ad38cf8f4617ba18729f7661972d`。
- 乐享是 v2 MCP：`company_domain = https://lexiangla.com` 是顶级域 → 访问链接必须带 `?company_from=<company.code>`。
- 本地 `docs/Remotion视频动效工作流-进度总结-2026-10-12.md` 是**早间过期快照**，仅历史留档，别拿它当依据。

## 约定

- **Spec 文件名不带版本号**（`SPEC-remotion-overlay-workflow.md`），版本只写文内标题 —— 避免每次改版都要改文件名/引用。
- 设计结论未落到字段级细节时，Spec 里标 `🟡TBD`，**不得凭常识填**；先去登记册查证，查不到就保持开放。
- **Skill 放 `.workbuddy/skills/<name>/SKILL.md`**（项目级），已通过 `!.workbuddy/skills/` 入库。5 个 = align / perceive / storyboard / validate / render，按管线阶段切，**不做巨型 skill**。
- Skill 是**自包含**的（不指向 Spec）：§10.2 明确说 Skill 要精简到只保留「必须遵守」的部分 —— 塞整份 Spec 会挤掉素材本身的信息。代价是局部重复，属有意为之。
- 文档只规定目录里**有哪些数据**、不点名文件名。自拟的文件名一律标【实现期拟定，文档未点名】，**别把实现建议伪装成文档结论**。
- 分支代号：A 素材与前提 / B 感知与对齐 / C 时间轴模型 / D 构图与遮挡 / E 渲染架构 / F 工程化与闭环。**六分支已于 2026-10-12 全部封口。**
- 时间坐标：**帧是真相**（`fromFrame` + `durationInFrames`）；模型只写锚点 `{anchor:"word:37", offset:"-8f"}`，由烘焙器解析成帧。
- `.workbuddy/` 不是缓存，勿删；其下 **`memory/` 与 `skills/` 入 git**，其余忽略。

## git

- 仓库已初始化（`main` 分支），提交人 FansticB。**远程未配置。**
- 全局 git 走 PortableGit；代理 `http://127.0.0.1:13145`。
- `.gitignore`：忽略 `.workbuddy/*`（保留 `memory/`）、媒体大文件、`jobs/`、`node_modules`、`out`。

## 已知雷区

- **乐享预签名 URL 必须整串复制**：截断 `filename%3D"..."` 之后的 `%3B%20filename%2A%3Dutf-8%27%27...` 会直接 `SignatureDoesNotMatch`（403）。与代理无关。
- 乐享 HTML `<table>` **不能逐格替换**，必须整表删掉重建为 GFM 表；GFM 表**行数上限 10**（含表头）。
- Git Bash 下 `python -c` 传含反引号的多行串会失败 —— 写临时 `.py` 文件再执行。
