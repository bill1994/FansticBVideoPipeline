# Code Wiki —— Remotion Overlay Pipeline

> 本 Wiki 由 2026-10-21 对仓库全量源码的静态分析生成，对应版本 `0.2.0`（commit `0687f31` 之后）。
> 与 `docs/spec/`、`docs/decisions/` 的分工：SPEC 是**规格真源**、OPEN-DECISIONS 是**裁决真源**，
> 本 Wiki 是**代码现状的导读** —— 讲「代码现在长什么样、怎么跑、在哪找」。若三者冲突，以前两者为准。

## 项目一句话

在**已拍摄、已粗剪拼接、无任何文字与特效**的实拍口播视频上，按 SRT 字幕的词级时间锚点，
自动叠加 motion-graphic overlay（动效图形），最终经 Remotion 渲染出成片。

```
实拍视频 + SRT ──► 五阶段管线 ──► Remotion 工程 ──► 成片 mp4
```

## Wiki 目录

| # | 文档 | 内容 |
|---|------|------|
| 1 | [架构总览](01-架构总览.md) | 设计哲学、五阶段管线、不可变快照、C6 双栈、核心硬规则 |
| 2 | [模块职责](02-模块职责.md) | `src/` 五大目录（cli / core / stages / validate / templates / remotion）逐文件职责 |
| 3 | [数据契约与目录产物](03-数据契约与目录产物.md) | 核心类型定义、job 目录 `00-input..06-review` 每阶段吃什么吐什么 |
| 4 | [关键函数参考](04-关键函数参考.md) | 各模块导出函数/组件清单（名称 · 签名 · 职责） |
| 5 | [校验体系](05-校验体系.md) | 18 项构建期校验逐条说明 + 2 条 extra + 错误码表 |
| 6 | [模板体系](06-模板体系.md) | family × scope 双轴、注册表、内置模板、MotionSpec spec 驱动渲染 |
| 7 | [依赖关系](07-依赖关系.md) | 内部模块依赖图、外部 npm 依赖、外部工具（ffmpeg / whisper.cpp / YuNet） |
| 8 | [运行指南](08-运行指南.md) | 环境要求、安装、五阶段运行、示例 job、测试、预览、故障排查 |

## 代码地图（30 秒版）

```
src/
├── cli.ts            统一入口：init + 五阶段命令，参数解析与退出码映射
├── core/             类型契约、配置阈值、错误/退出码、IO 快照守卫、调度、烘焙、spec/rhythm
├── stages/           五个阶段的执行逻辑（align / perceive / storyboard / validate / render）
├── validate/         构建期 18 项校验（纯函数 JSON→JSON）
├── templates/        模板契约（family × scope）与注册表
└── remotion/         Remotion 渲染工程（Overlay 组件、载体链、模板组件、SpecRenderer）

templates/specs/      8 个 custom 模板的 MotionSpec JSON（fade-up、typewriter-cn 等）
tools/                doctor 自检、whisper 安装、各类探针脚本
tests/                vitest 测试（58 个测试文件 / 860 项）
examples/demo/        无需真实素材、可端到端跑通的示例 job
docs/                 spec / decisions / proposals / reviews / changelog
jobs/                 逐任务工作区（git 不入库）
```

## 最快上手

```bash
npm install

# 建一个 job
npm run pipeline -- init --job my-first
# 放入视频+SRT，填 00-input/source.json，然后按序：
npm run pipeline -- align      --job my-first
npm run pipeline -- perceive   --job my-first
npm run pipeline -- storyboard --job my-first
npm run pipeline -- validate   --job my-first
npm run pipeline -- render     --job my-first

# 预览
npm run studio
```

详细环境要求与常见问题见 [运行指南](08-运行指南.md)。
