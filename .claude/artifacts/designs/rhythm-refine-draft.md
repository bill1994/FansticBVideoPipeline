# 节奏表底稿 + 模型精修工作流 (rhythm-refine-draft) Spec

> Status: SUPERSEDED（2026-10-21 Wave 4：用户重申构想后架构重修 —— 精修上移到意图层，
> draft.json 降级为绑定器派生产物。现行 spec → [motionboard-intent-binding.md](motionboard-intent-binding.md)；
> 本文 Wave 1-3 的三短板结论与「基线先行」裁决已被新 spec 并入保留）
> Author: user
> Last updated: 2026-10-21

## Background

内置节奏表生成器（P1，2026-10-20 拉取）已落地：`storyboard` 阶段发现没有 draft.json 且未指定
`--draft` 时，走 `buildRhythmTable`（[core/rhythm.ts](file:///g:/VideoPipeline/src/core/rhythm.ts)）
→ 落 `pacing.json` → `synthDraft`（[core/rhythm-rules.ts](file:///g:/VideoPipeline/src/core/rhythm-rules.ts)）
→ 落 `draft.synth.json`。经源码分析与用户确认，存在三个短板：

1. **文字提取生硬** —— `extractExcerpt` 是「取命中词后的片段」，抄句子不是提炼；
   语义压缩是规则做不到的。
2. **选型单调/不当** —— 信号→模板是固定映射表（如 `repetition → tag-float`），
   兜底永远是 `kinetic-line`，与内容气质无关。
3. **覆盖率不对** —— 10 个信号全靠关键词表（`TURN_WORDS` 等），弱信号需 ≥2 个命中，
   命中率与方向（偏高/偏低）均未量化。

用户构想：模型读 skill + SRT 产出 storyboard/motionboard。项目哲学
（[proposal 2026-10-20 §4/§8](file:///g:/VideoPipeline/docs/proposals/2026-10-20-pipeline-test-and-motion-prompt-discussion.md)）：
**pipeline 不调模型，模型是调用方**。2026-10-21 裁决：**规则打底 + 模型精修**。

## In scope

- **基线量化（AC-1，第一步）**：在 kukini 真实素材上跑内置生成器，统计节奏表现状并落档报告
- **精修工作流规范**：把「读 pacing.json + draft.synth.json → 精修 → 落 draft.json」写成
  skill 可执行的作业手册（落点见 Open questions）
- **溯源约定**：精修后的 draft.json 用 `meta.confirmedBy` / `meta.confirmedAt`
  （现有契约字段，零代码改动）记录精修者与时间
- **规则层小扩（可选，视基线数据）**：信号词表、强弱门槛、候选映射表的扩充与校准

## Out of scope

- pipeline 内调用 LLM（违反「模型是调用方」哲学，2026-10-21 复确认）
- 自由动效代码生成（proposal §7.1 C 路线，已否决）
- 通用 MotionSpec 新契约 + 通用渲染器（proposal §7.1 A，将来另立议题）
- 覆盖率/选型的数字带取值（依赖基线数据，基线后另定）

## Assumptions

- **精修边界（待用户复核）**：模型可改 模板选型（限已注册库）/ params（含文案提炼）/
  增删 item；不可改 帧数、坐标、颜色、CSS（既有硬规则）。由 `assertDraftItemKeys` +
  validate 18 项兜底。**推论依据**：覆盖率短板的修法需要模型能增删 item。
- 精修发生在 pipeline 之外（模型作为调用方，与 2026-10-20 kukini 实跑方式一致）。
- `draft.synth.json` 是精修输入底稿；`pacing.json` 的 `signal` + `reason` 是模型的核对依据。
- 规则层保持纯函数纪律：禁时钟/随机数/磁盘，同一 SRT 产出逐字节一致的 pacing.json。

## Solution（sketch，非实施计划）

```
01-align（cue/词时间戳）
      │
      ▼
内置节奏表生成器（规则打底，已有代码）
  buildRhythmTable → pacing.json（判断记录：signal + reason）
  synthDraft       → draft.synth.json（底稿）
      │
      ▼
模型精修（pipeline 外；读 storyboard skill + pacing.json + 底稿）
  · 文案提炼：替代 excerpt 复读（修短板①）
  · 模板改选：在已注册库内换选（修短板②）
  · 增删 item：修覆盖率（修短板③）；自评 confidence 覆盖规则常量
  · 落 draft.json，meta.confirmedBy / confirmedAt 记溯源
      │
      ▼
storyboard（--draft）→ validate → render（链路不变）
```

基线执行注意（immutable snapshot 纪律）：kukini job 已有上一轮 storyboard 产物，
基线应复制 job 或建新 job 重跑 align 产物，不覆盖既有快照。

## Edge cases & risks

| Category | Notes |
|---|---|
| 固化陷阱 | 精修后 draft.json 存在 → 内置生成器不再触发（既有分支）。重跑基线需移开 draft.json；这既是坑也是特性（精修成果不被冲掉） |
| 覆盖率口径 | 「覆盖率不对」的方向未知（偏高/偏低）—— 基线报告先给分布，再定改进方向与数字带 |
| 精修非确定性 | 同一底稿多次精修结果不同属预期；用 confirmedBy 溯源 + validate 0 error + reviewQueue 审片通道兜底 |
| sim_max/confidence 失真 | 内置生成器写死规则常量；精修若不改 confidence，闸2 的「模型自评」语义失真 —— skill 必须写清让模型自评覆盖 |
| 无字幕模式 | no-subtitle job 无 cue，内置生成器已拦（ConfigError），精修工作流不适用 |
| 信号词表校准 | 词表/阈值改动须与覆盖率目标一并校准（同 ALIGN_GATE「不得分开拍」纪律） |

## Acceptance criteria

- **AC-1**：对 kukini 素材执行内置生成器（无 draft.json），`pacing.json` 每条 cue 均有
  `decide ∈ {motion, none}` 与非空 `reason`；基线指标 —— motion 覆盖率、too-short 率、
  no-template-fits 率、kinetic-line 降级占比、各信号命中次数 —— 落档为报告文件
- **AC-2**：按精修规范产出的 draft.json 通过 `storyboard --draft` + `validate`，**0 error**
- **AC-3**：精修后的 draft.json `meta.confirmedBy` 非空，且 storyboard.meta 回填一致（溯源闭环）
- **AC-4**：规则层任何改动后 `npm test` 全绿（rhythm-rules / rhythm-table 不回退），
  且同一 SRT 重跑 pacing.json 逐字节一致
- **AC-5**：精修前后对比：至少一个此前「原文复读」的 item 在精修版中被提炼文案替代
  （人工抽样确认，记录在基线报告的精修对比节）

## Open questions

- 覆盖率/选型的**数字带取值** —— 依赖 AC-1 基线数据，基线后另定（登记待办）
- 本裁决的记录落点：写项目的 [docs/decisions/OPEN-DECISIONS.md](file:///g:/VideoPipeline/docs/decisions/OPEN-DECISIONS.md)
  （项目裁决唯一真源惯例）还是独立 ADR 文件？—— 需用户拍板
- 精修 skill 落点：扩写 `.workbuddy/skills/storyboard/SKILL.md` 还是新增独立 skill 文件
- 精修边界假设（见 Assumptions 第一条）请用户显式确认

## Core entities (ontology)

| Entity | Type | Key fields | Relationship |
|---|---|---|---|
| RhythmTable | `pacing.json` | meta{fps,mode,version}; cues[]{cueIndex, fromFrame, durationInFrames, decide, motion?, reason, signal[], skipped?} | 由 01-align cues 生成；底稿的判断依据 |
| 底稿 draft.synth.json | SynthDraft | tracks[caption(layer 90) / motion(layer 60)]; items{_author.anchor, motion, params, sim_max, confidence} | 由 RhythmTable 合成；精修输入 |
| 精修稿 draft.json | DraftStoryboard | 同底稿结构 + 人工/模型调整 | 烘焙为 storyboard.json |

## Interview metadata

- Mode: default
- Waves: 3
- Final ambiguity: 22.5%
- Status: PASSED

### Clarity breakdown

| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| Goal | 0.8 | 0.40 | 0.32 |
| Scope | 0.75 | 0.25 | 0.1875 |
| AC | 0.75 | 0.25 | 0.1875 |
| Context | 0.8 | 0.10 | 0.08 |
