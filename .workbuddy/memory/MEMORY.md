# 项目长期记忆 — video pipeline

## 项目身份

- **项目**：Remotion 视频动效工作流（在实拍粗剪视频上叠 motion-graphic overlay）。
- **根目录**：`C:\Users\63088\WorkBuddy\video pipeline`
  ⚠️ **路径含空格** —— 所有 shell 命令必须加引号，脚本里也用绝对路径 + 引号。
- **目标产物**：一个可运行的完整 Remotion 项目（自动起草 → 人工审 → 渲染导出）。

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
