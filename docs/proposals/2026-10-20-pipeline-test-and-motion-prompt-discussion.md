# Pipeline 测试与 Motion Prompt 探讨记录（2026-10-20）

## 1. 本次测试概览

- 测试 job：`jobs/test-kukini`
- 使用素材：`TestResources/kukini.mp4` + `TestResources/10月6日.srt`
- 未使用：`3月22日.mp4`、`5月28日.mp4`
- 运行环境：DSH 自带 Node `v24.21.0`（系统 Node 为 `v21.2.0`，低于 Remotion 要求）

### 测试结果

| 阶段 | 结果 |
|---|---|
| align | 门控通过：均值置信度 `0.9113`，低置信词 `3.19%`，`alignedRatio = 1.000` |
| perceive | 15 个 shot / 24 个区域 |
| storyboard（demo draft） | 5 轨 / 8 条锚点，`T = 0.641` |
| validate（demo draft） | 0 error，0 warning，checked = 18 + 2 |
| render（demo draft） | 成功，`out.mp4` 183.4 MB，3337 帧，墙钟约 612s |

随后又使用按 SRT/align 生成的真实 draft `draft-kukini.json` 重新跑了一遍：

| 阶段 | 结果 |
|---|---|
| storyboard | 5 轨 / 63 条锚点，`T = 0.800` |
| validate | 0 error，24 warning（C3/C4 非阻断提示） |
| render | 成功，`out.mp4` 176.0 MB，墙钟约 648s |

---

## 2. 运行中发现的问题

1. **Node 版本环境不达标**  
   系统 Node 为 `v21.2.0`，低于 Remotion 要求的 `22.19+`。`npm run doctor` 会报 fail。本次使用 DSH 自带 Node `v24.21.0` 才跑通。

2. **渲染性能偏慢**  
   111 秒成片渲染约 612s / 648s，前几帧单帧耗时约 12s。产物正常，但性能数据值得记录为 F4 基准。

3. **storyboard 阶段无法自动生成起草稿**  
   仓库不内置模型调用。`storyboard.ts` 只读 `draft.json` 并烘焙，不会自己生成 motion。测试时复用了 demo draft，随后又按 skill 规则生成了真实 draft。

4. **人工审核队列有 must_review 项**  
   `typo-main/002` 与 `data-card` / `tag-float` 等因产路地板被抬到 `must_review`，需要人工看片确认。这不是 error。

5. **感知阶段有 6 个 shot 的 safeArea 为 null**  
   这些是无主体/B-roll 镜头，属于正常处理，但 `W-F6-01` 会进入 `summary.extra`。

6. **Node 子进程调用有弃用警告**  
   render 内部使用 `execFileSync('npx', ..., { shell: true })`，Node 给出 `DEP0190` 安全弃用警告。功能不受影响。

7. **产物体积较大**  
   `out.mp4` 约 176–183 MB / 3337 帧。

---

## 3. 成片字幕与 SRT 不匹配的原因

字幕文本数据本身是对的，不匹配的原因主要不是 align 错了，而是：

1. **文本来源是 SRT cue**  
   `caption/karaoke-word` 的文字取自 `01-align/words.json` 的 `cue.text`，也就是 SRT 原文。

2. **demo draft 只放了两条字幕动效，且每条只有 12 帧**  
   `caption-bar` 两条 item 的锚点分别是 `word:2` 和 `word:50`，烘焙后区间为：
   - `13–25` 帧
   - `762–774` 帧

   因此成片里字幕只在这些短窗口闪现，不会覆盖 SRT 的全部 48 行。

3. **这个 pipeline 的定位是 motion overlay，不是完整字幕渲染器**  
   它不会自动为每条 SRT cue 生成字幕 item。要得到全程字幕，需要起草稿里为每个 cue 声明 `caption/karaoke-word`，并使用 `cue:N` 锚点。

4. **高亮可能缺席，但内容不会变成别的句子**  
   如果词落点与 SRT 窗口漂移，`highlightSpan` 会返回 `null`，组件退化为整句不高亮，但显示的仍然是 `cue.text` 这一句 SRT 原文。

---

## 4. storyboard / draft 的哲学

### 4.1 仓库代码里，storyboard 阶段不调用模型

`src/stages/storyboard.ts` 只做：

- 读 `draft.json`
- 校验起草稿键
- 计算调度（T、routing、review）
- 把锚点烘焙成帧
- 落盘 `storyboard.json`

它不会联网、不会调用 LLM、不会自己决定 motion。

### 4.2 `.workbuddy/skills/storyboard/SKILL.md` 是起草规范

它描述的是：**如何起草** `draft.json`——挑模板、填文字、写锚点、不写帧数/颜色/CSS。  
起草者可以是人，也可以是外部模型；仓库只负责把已经写好的 draft 烘焙、校验、渲染。

### 4.3 模型是调用方，代码是被调用方

依赖方向是：

```
模型（操作者）  →  调用  →  pipeline 代码（工具）
```

而不是：

```
pipeline 代码  →  调用  →  模型 API
```

“仓库不内置模型调用”强调的是这个依赖方向，不是否认模型参与流程。

### 4.4 生成真实 draft 的实践

按 skill 规则，基于 `01-align/words.json` 的 48 条 cue 和词序号，生成了 `draft-kukini.json`，包含：

- `bg-punch`：`cinematic/punch-in@1.0`
- `data-card`：`data/stat-card@1.0`
- `typo-main`：`typography/kinetic-line@1.0`
- `typo-secondary`：`typography/tag-float@1.0`
- `caption-bar`：48 条 `caption/karaoke-word@1.0`，每条锚定 `cue:N`

这次 validate 通过（0 error），render 成功，成片里字幕不再是 demo 的两个短闪现，而是 48 条 cue 各对应一条字幕。

---

## 5. 是否用到了 Remotion

用了，最终成片就是 Remotion 渲染出来的。

render 阶段调用：

```bash
npx remotion render src/remotion/index.ts Overlay out.mp4 \
  --props=.../render-props.json \
  --public-dir=.../00-input \
  --gl=angle --log=verbose
```

- Remotion 工程入口：`src/remotion/index.ts`
- Composition 名称：`Overlay`
- 最终 `out.mp4` 由 Remotion 的 Chrome Headless Shell + FFmpeg 生成

前面的 align/perceive/storyboard/validate 只是为 Remotion 准备数据与 props。

---

## 6. Motion Graphic 生成逻辑当前由谁完成

当前仓库**没有**内置“自动挑词 → 写 MG 提示词 → 自由组装 motion”的流程。

### 6.1 谁决定哪里做 motion

不在代码里，而在 draft 阶段的人/模型。

- `align` 只把 SRT 变成词级时间戳 + cue
- `perceive` 只给出 shot / safeArea / region
- `storyboard` 代码不会自己判断“这句话该不该做动效”
- 它只读 `draft.json`，然后烘焙/校验

### 6.2 有没有“根据画面写 motion 提示词”

没有自由文本提示词这一步。

这个项目不是“文本 → 生成任意 motion graphic 代码”的系统，而是**模板驱动**系统：

- motion 必须是 `family/subtype@version`
- 模板定义在 `src/templates/builtin.ts`
- 每个模板有固定 `paramsSchema`
- 模型/人只能填表，不能写坐标、帧数、颜色、CSS

### 6.3 有没有“自由组装 motion”

没有完全自由组装。

- 有 `custom` 产路，但仍然是模板体系内的 `custom/*` 家族
- 所有几何、帧号、z 序、进出场都由模板/烘焙器/校验器决定
- 不能手写 CSS/动画帧

### 6.4 storyboard skill 在干嘛

`.workbuddy/skills/storyboard/SKILL.md` 是起草规范，相当于给 LLM/人类的作业手册：

- 可以读 SRT/align/perceive 的产物
- 挑模板
- 填 `text` / `value` / `boxed` 等 params
- 写 `_author.anchor`（`word:N` / `cue:N` / `abs:`）
- 填 `sim_max` / `confidence`
- 不能写坐标、帧数、颜色、CSS

它描述的是“人/模型如何起草”，不是 pipeline 自动执行的步骤。

---

## 7. 如果希望做到“motion prompt → 生成 motion”，如何规划

### 7.1 三种可能的生成层级

#### A. 生成“动效方案”（最现实）

模型不生成代码，而是生成结构化 motion spec，例如：

```json
{
  "motion": "emphasis",
  "target": "word:12",
  "durationInFrames": 24,
  "footprint": [0.05, 0.7, 0.4, 0.16],
  "params": {
    "enter": "scale-in",
    "exit": "fade-out",
    "highlightToken": "brand",
    "intensity": 0.8
  }
}
```

然后由通用 motion 引擎解释执行。

- 优点：可控、可校验、可渲染
- 缺点：需要设计新的通用 motion spec 和渲染器

#### B. 生成“模板参数”（当前已支持）

模型从固定模板库选一个，填 params。

- 这其实已经是“模型生成 motion 形式”的弱版本
- 限制：只能选已有模板，不能发明新视觉形式

#### C. 生成“自由动效代码”（高风险）

模型直接生成 Remotion/React/CSS 代码。

- 优点：形式无限
- 缺点：安全、确定性、校验、渲染稳定性全部崩塌；与项目现有硬约束直接冲突

### 7.2 建议新增的流程

当前流程：

```
align → perceive → storyboard(draft) → validate → render
```

新流程：

```
align → perceive → motion generation → storyboard → validate → render
```

其中 `motion generation` 负责：

1. 读取 SRT / cues / words / shots / safeArea
2. 根据 prompt 或自动策略，生成 motion spec
3. 本地强校验
4. 失败则重试 / 人工介入
5. 落盘为 draft/storyboard 输入

### 7.3 需要新增的模块

1. **Motion Spec 契约**  
   定义 LLM 可生成的 motion 类型：emphasis / enter / exit / transform / data / caption / ambient 等，每个 type 有固定 params schema。

2. **Motion Generator**  
   独立阶段，负责构造 prompt、调用 LLM、解析 JSON、本地校验、重试。

3. **Motion Validator**  
   校验生成的 motion：type 是否合法、params 是否符合 schema、anchor 是否存在、duration 是否合理、是否遮挡主体、是否溢出 footprint、是否违反确定性红线。

4. **通用 Motion Renderer**  
   Remotion 侧需要一个解释器，把 motion spec 转成实际组件。这比当前模板注册表复杂，但比自由代码安全。

### 7.4 主要问题

1. **LLM 无法真正“看画面”**  
   它只能根据 bbox / safeArea / 文本推理，不能真正判断构图。遮挡、节奏、审美仍需人工审片。

2. **非确定性**  
   同样的 prompt 可能每次生成不同 motion。需要固定 model version、temperature、seed，并做 golden case 回归。

3. **校验复杂度高**  
   生成的 motion 可能引用不存在的 anchor、使用非法 params、遮挡主体、溢出 footprint、违反确定性红线。必须有强校验 + 重试 + 人工介入。

4. **渲染稳定性**  
   自由生成的 motion 可能导致布局抖动、性能问题、空白 canvas、z-index / transform 层叠上下文问题。

5. **成本与延迟**  
   每条 cue 都调用 LLM，prompt 很大，成本高。需要分块、缓存、增量生成。

6. **数据隐私**  
   SRT 文本、对白、视频元数据会发送到 LLM API。

7. **模板生态不足**  
   当前只有 12 个 family。如果要支持“生成形式”，需要先扩展 primitive 库。

### 7.5 建议的折中路线

不要一步跳到“prompt → 自由 motion 代码”，而是：

1. 先扩展模板库（primitive 化）
2. 让 skill 允许模型组合 2–3 个 primitive
3. 用严格 schema + validate 保证可控
4. 保留人工审片闸门

这样既给模型更多生成空间，又不破坏项目现有的确定性、校验链和 Remotion 渲染稳定性。

---

## 8. 与项目哲学的关系

当前项目哲学是：

> 模型是操作者，但只能从模板库选模板、填参数；不能发明新 motion 形式。

如果要实现“motion prompt → 生成 motion”，就需要改变这个哲学，至少新增一层：

> 模型可以生成 motion spec，但输出必须是可校验的数据，不是自由代码。

这不是小改动，而是一个新的子系统：**LLM draft generator + 强校验 + 重试 + 人审闸门**。

---

## 9. 下一步可选方向

1. **保持现有架构，只加强 skill**（推荐，符合原设计）  
   补根 SKILL.md、模板样例、few-shot 示例，让模型更可靠地起草。

2. **新增外部 draft 生成器**（真正自动化）  
   一个独立工具，调用 LLM 生成 draft，本地强校验，失败重试，最终仍走 storyboard/validate/render。

3. **先设计 motion spec 契约**  
   在动代码之前，先把“模型能生成什么”定义清楚，作为 RFC。

---

## 10. 待研究的问题

- 哪些 cue 必须 caption？
- 哪些词值得 emphasis？
- 数据点从哪里来（SRT 文本里没有数字时怎么办）？
- 每个 cue 最多几个 motion？
- 失败时允许人工介入几次？
- 是否允许 LLM 生成新的 primitive 组合？
- motion spec 的最小可渲染单元是什么？

这些规则一旦写进 skill / generator，自动化才不会变成“LLM 随便填表”。