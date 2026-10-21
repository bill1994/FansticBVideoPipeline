# motionboard × storyboard 整合 (motionboard-intent-binding) Spec v2

> Status: ALIGNED → IMPLEMENTED（2026-10-21 按 plan v2 实施完成：689/689 测试、typecheck 干净、demo 端到端与 baseline 复跑验证通过）
> Author: user
> Last updated: 2026-10-21
> v1 → v2：Wave 5 推翻「三分支 + draft 概念」，裁定 storyboard 与 motionboard **整合为单一可编辑文件**。

## Background

用户意图（Wave 5 原文要旨）：**模型读 skill → 拿到资源（SRT/align/perceive/节奏表底稿）→ 生成 motionboard → 人去看、
可修改增删 motion prompt → 下游机器消费**。draft（无论手写模板绑定还是 synth/bind 变体）**不是用户想要的概念**。

裁决链：
1. 三短板：文字提取生硬 / 选型单调 / 覆盖率不对（Wave 1）
2. ~~规则打底+模型精修落在 draft.json~~（Wave 2，废）
3. 基线先行（Wave 3，已完成：[docs/reviews/2026-10-21-节奏表基线报告.md](../../docs/reviews/2026-10-21-节奏表基线报告.md)）
4. draft 降级为派生物、模型作业上移意图层、意图=结构化枚举+提炼文案+note（Wave 4）
5. **整合（Wave 5）：motionboard 与 storyboard 合为一份文件的两个生命周期；draft 概念退役；
   绑定器 = storyboard 阶段调度前的解析步；条目支持 intent / 钉死 motion 混合；统一命名 motionboard.json（全量迁移，无兼容层）**

## In scope

- **统一契约 `03-storyboard/motionboard.json`**（唯一可编辑意图层；管线只在生成时写一次，此后只读）：
  ```jsonc
  { "meta": { "fps": 30, "version": "1.0" },
    "items": [
      // 意图条目（常态）：intent 与 motion 二选一
      { "_author": { "anchor": "cue:12", "offset": "-8f" },
        "intent": "number-emphasis", "featuredText": "三倍防泼水",
        "confidence": 0.8, "note": "卡片跳出感，别压鞋" },
      // 钉死条目（人工兜底）：直接指定模板
      { "_author": { "anchor": "cue:30" },
        "motion": "typography/kinetic-line@1.0",
        "params": { "text": "还有前掌的这个EVA" }, "confidence": 0.9 } ],
    "noMotionRanges": [] }
  ```
- **绑定器（调度前解析步）**：intent → 候选模板逐个过时长门控 → featuredText/机械提取填 params →
  区域感知 carrier 退路（复用 E-D4-01 修复）→ 全不满足记 `bind-report.json` no-fits 条目 + log.warn（不静默）；
  钉死条目直通（params 仍受 #16 校验）。解析后 intent 随 `_author` 在 bake 时「用完即弃」。
- **生成器改造**：内置节奏表生成器首跑（motionboard.json 不存在时）产出 **intent 形态**的 motionboard.json
  并当场绑定出完整预览（一次跑同时拿到成片蓝图 + 可改文件）；此后文件归用户/模型，重新从规则生成 = 删除该文件重跑。
- **CLI**：`--draft` 废弃；USAGE 更新。
- **迁移**：`examples/demo`（draft.json → motionboard.json 钉死形态）、相关 tests、CONTEXT.md、skill 文档同步。
- **skill 增补**：storyboard skill 增「motionboard 起草」节（读资源清单 + intent 词表 + featuredText 纪律）。

## Out of scope

- draft.json 兼容层（明确不做，干净切换）
- 绑定器内自动生成 MotionSpec（「生成」= 模板库扩充流程）
- pipeline 内调 LLM；自由文本进机器判定
- 数据复盘闭环（对标报告 Catch-up #2，另立）

## Assumptions

- 混合粒度合法：同一文件内 intent 条目与钉死条目可混用（人工兜底通道，替代旧手写 draft）。
- 绑定器纯函数：同一 motionboard.json 逐字节一致地产出（bind-report 同）。
- 模型只能选 intent 词表内的值；词表与候选映射是 core 内常量（启动期 registry 校验）。
- 人可写 params（人是操作者），但键集仍受 paramsSchema 约束（#16 兜底）。
- 下游（validate/render/C6/烘焙）契约零改动。

## Acceptance criteria

- **AC-1**：baseline-kukini 素材手写 motionboard.json → `storyboard` → `validate` **0 error**（含 E-D4-01 不复发）。
- **AC-2**：同一 motionboard.json 两次绑定，bind-report.json **逐字节一致**。
- **AC-3**：候选全被门控挡下 → bind-report 记 no-fits + stderr warn，该条目不产 MG（字幕轨恒在）。
- **AC-4**：溯源 —— bind-report 可查每条 `intent → motion id → 命中候选序`；钉死条目标记 pinned。
- **AC-5**：motionboard.json 不存在时生成器产出之（intent 形态）并同 run 绑定；已存在时管线**零改写**该文件。
- **AC-6**：intent 词表覆盖全部可绑定注册模板（fullscreen 除外）；映射缺失启动即抛 ConfigError。
- **AC-7**：`--draft` 已废弃（未知参数报错）；全量测试绿；demo 端到端可跑。

## Solution（sketch）

```
资源（SRT/words/cues + regions/shots + pacing.json 意图底稿）
        │ 模型读 skill ── 生成器首跑 ── 人改（三来源写同一文件）
        ▼
03-storyboard/motionboard.json          ← 唯一可编辑意图层（管线只读）
        │ runStoryboard：绑定器（调度前解析步）→ bind-report.json
        ▼
两道闸 → bake（锚点+intent 用完即弃）→ storyboard.json → validate → render
```

三短板修法归属不变：①文案提炼 → featuredText；②选型单调 → intent 词表+候选序；③覆盖率 → 模型增删条目。

## Edge cases & risks

| Category | Notes |
|---|---|
| intent 与 motion 同时出现 | 契约校验拒绝（二选一），ConfigError —— 不静默择一 |
| fps 不符 / 锚点非法 | 复用现有校验路径（storyboard fps 检查 + bake 锚点错误） |
| 生成器与绑定器词表漂移 | MOTIONBOARD_INTENTS 单一真源，生成器的 decideMotion 映射改为从词表派生 |
| 旧 demo/tests 引用 draft | 一次性迁移清单进 plan，迁完全量测试绿 |
| 无字幕模式 | 无 cue 仍拦生成器；手写 motionboard 只可用 abs: 锚点（同旧约束） |

## Open questions

- skill 落点默认「扩写 storyboard skill 增节」（最小改动）——实施前如有异议请提出。

## Core entities

| Entity | Type | 说明 |
|---|---|---|
| motionboard.json | 统一可编辑意图层 | intent/钉死混合条目；三来源共写；管线只读 |
| 绑定器 | 调度前解析步 | intent→模板；钉死直通；bind-report.json |
| bind-report.json | 过程产物 | 溯源（intent→motion→候选序/pinned/no-fits） |
| storyboard.json | 机器契约（不变） | 帧 + motion id + params；intent 已剥离 |

## Interview metadata

- Mode: default（grill）+ plan v2；Waves: 5；Status: PASSED
- Wave 5：整合 + 命名 motionboard.json（AskUserQuestion 已确认）
