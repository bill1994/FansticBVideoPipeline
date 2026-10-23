# Context

## Glossary

| Term | Meaning | Notes |
|---|---|---|
| 节奏表 (RhythmTable) | `03-storyboard/pacing.json`：按 cue 判定「配不配 motion、配哪个」的判断记录，带 `signal` 与人读 `reason` | 🔴 **2026-10-23 起改由 LLM 语义判定**（裁决 M-3：语义优先于复现）——模型读文案按语义定分布，与 motionboard 同批产出；规则生成器（[src/core/rhythm.ts](src/core/rhythm.ts) + [rhythm-rules.ts](src/core/rhythm-rules.ts)）**降级为无模型兜底先验**，「同一 SRT 逐字节可复现」仅对兜底路径成立 |
| motionboard | `03-storyboard/motionboard.json`：**唯一的可编辑意图层**（Wave 5 整合裁决）—— intent / 钉死 motion 混合条目 + featuredText + note + confidence | 三来源共写：生成器首跑产出底稿、模型读 skill 精修、人工增删改；管线除首跑生成外只读；draft.json/draft.synth.json 概念已退役（2026-10-21 Wave 5） |
| intent（动效意图） | 受控词表的结构化意图值（如 number-emphasis / closing-verdict） | 绑定器的匹配键；自由文本**不进**机器判定（P0 可复现）；词表真源 [src/core/motionboard.ts](src/core/motionboard.ts)（规划中） |
| 绑定器 (binder) | storyboard 阶段**调度前的解析步**：intent → 候选模板逐个过时长门控 → 填 params → 区域感知 carrier 退路 → 产 bind-report.json | 纯函数可复现；钉死条目直通；`sim_max` = 候选档位；意图随 `_author` 在 bake「用完即弃」 |
| storyboard.json | 机器契约（不变）：帧 + motion id + params | motionboard 的派生产物；validate/render 只认它 |
| 精修 (refine) | 模型层工作：在意图底稿上写/改 intent、提炼文案（featuredText）、增删条目、自评 confidence；**2026-10-23 起含 pacing 语义判定**（M-3） | 见 [.claude/artifacts/designs/motionboard-intent-binding.md](.claude/artifacts/designs/motionboard-intent-binding.md) v2 与 [.claude/artifacts/plans/motionboard-intent-binding.md](.claude/artifacts/plans/motionboard-intent-binding.md) |
| 强信号 / 弱信号 | 节奏表的信号强度分档：强信号单命中即可出 motion；弱信号需 ≥2 个同时命中 | 定义在 [src/core/rhythm-rules.ts](src/core/rhythm-rules.ts) `STRONG_SIGNALS` |
