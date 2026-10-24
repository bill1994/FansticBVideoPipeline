---
name: storyboard
description: >-
  Remotion motion-graphic overlay 管线的第 3 步「storyboard」。当感知完成、需要按词级锚点起草 storyboard.json
  （含 motion 选型、footprint、接力关系与 routing/review 决策字段）时使用。负责生成并烘焙 storyboard。
  不用于对齐、感知、校验或渲染。
agent_created: true
---

# storyboard —— 起草与烘焙 storyboard.json

> **管线位置**：第 3 步 / 共 5 步
> **上游**：`01-align/`（词级时间戳）+ `02-perceive/`（安全区 / footprint 基线）—— **只许引用这两级**
> **下游**：`03-storyboard/storyboard.json`（烘焙后，`fromFrame` 已是绝对帧）

## 何时触发

- `perceive` 完成（`02-perceive/` 就绪）时。
- 重跑代价最低的一步：返修通常只重跑本阶段及其后（`validate` / `render`），所以**迭代都发生在这里**。

## 0. 你写的是 motionboard（意图层），不是模板绑定（Wave 5 整合）

你要产出的文件是 `03-storyboard/motionboard.json` —— **唯一的可编辑意图层**。
缺失时内置生成器会按节奏表产出 intent 底稿；你的工作是**精修它**：

```jsonc
// 意图条目（常态）：绑定器按受控词表解析模板，你只表达创意意图
{ "_author": { "anchor": "cue:12", "offset": "-8f" },
  "intent": "number-emphasis",        // 词表：number-emphasis / contrast-turn / question / enum /
                                      // repetition-term / closing-verdict / definition / keypoint
  "featuredText": "三倍防泼水",        // 提炼短语（不是原句复读）；缺省时绑定器机械提取
  "confidence": 0.8,                  // 你的自评（闸2 输入）
  "note": "卡片跳出感，别压鞋" }       // 人读备注，不进任何判定

// 钉死条目（兜底）：确切知道要哪个模板时直接写 motion + params
{ "_author": { "anchor": "cue:30" },
  "motion": "typography/kinetic-line@1.0",
  "params": { "text": "还有前掌的这个EVA" }, "confidence": 0.9 }
```

**可读的资源**：`01-align/words.json`（cues/词时间戳）、`02-perceive/shots.json` 与
`regions.json`（安全区/遮挡预算）、`03-storyboard/pacing.json`（规则生成的意图底稿，
含每条 cue 的 signal 与 reason —— 在它的基础上增删改，别从零重写）。

**语义 pacing（M-3，2026-10-23 裁决；首选路径）**：规则词表只抓得到结构信号
（enum／question／number…），抓不到反讽、铺垫、高潮、口头禅 —— 而 pacing 正是
motionboard 分布的判据。因此你（模型）应当**按语义判读每条 cue**，产出
`decide`／`motion`／`signal`（语义判据，自由文本）／`reason`（自述依据），
与 motionboard **同批落盘** `pacing.json` 并写 `meta.source: 'semantic'`。
`reason` 不是装饰 —— 它是「pacing 决定 motionboard 分布」因果的人工对账凭据。
纪律：
- `motion` 必须是已注册模板 id（自造 id 会被 `validate` 结构断言拦下，退出码 2）；
- `cueIndex` 必须真存在于 `words.json` 的 cues（SRT 修订后重跑 storyboard）；
- `decide:'none'` 的条目不带 motion 字段（不做的原因写 `skipped` 或 `reason`）；
- 规则底稿是**先验参考**，可以合法偏离 —— 语义优先于规则（M-3）；
- 渲染期确定性一字不改：语义判读只发生在创作期，board 定稿后全链路确定性。

**看模板长什么样**：`npm run templates:gallery` → `out/template-gallery/gallery.html`
（19 个已实现模板各 3 帧 + scope / footprint / 参数 / 标签）。选 intent 或钉死模板前
先看画廊，不要凭 id 猜形态；未实现的模板在画廊里明确标注，不要选。

**纪律**：intent 与 motion 二选一；featuredText 必须是提炼短语；`note` 不进任何判定；
禁写坐标/帧数/颜色/CSS。绑定失败（候选全不满足时长门控）会在 `bind-report.json`
记 no-fits 并告警 —— 看到后换 intent 或删条目，不要硬塞。

## 铁律 1：模型只填表，不写代码

只做两件事：**挑模板 + 填文字**。

**禁止**写坐标、帧数、颜色、CSS。所有几何与帧号由 `footprint` 模板默认值、锚点烘焙器、模板 `paramsSchema` 决定。

### 1.1 `params` 怎么填（会被逐项校验）

模板声明的 `params` 契约由**两个正交字段**表达：

| 字段 | 回答什么 |
|------|---------|
| `paramsSchema`（`Record<string,string>`） | **有哪些键** + 每个键的**值类型** |
| `requiredParams`（`string[]`，**可省略**） | 哪些键**必填**。**省略 = 全部可选** |

> 为什么必填不塞进 `paramsSchema`：它是扁平表，装不下 required。
> 也**不要**期待 `default` —— 有自然默认值的键（如 `enter` / `subtitle` / `unit` / `boxed`）
> 本来就**不标必填**，模型不用为默认值做无谓决策。

**首批模板的必填键**

| 模板 | 必填 | 可选 |
|------|------|------|
| `typography/kinetic-line` | `text` | `enter` |
| `typography/lower-third` | `title` | `subtitle` |
| `typography/tag-float` | `text` | — |
| `data/stat-card` | `value` | `unit` |
| `annotation/pointer-callout` | `target` | — |
| `caption/karaoke-word` | **无必填** | `boxed` |

### 1.2 两条不许越的界

**① 不得给 `caption` 类模板写 `text`。**

字幕文本的权威来源是 **SRT**，而渲染层直读 `item.params.text`。
模型一旦能写 `text`，字幕就有了**第二个来源** —— 与语音对不上，
而**时序校验只看帧区间、任何校验项都拦不住**。
要改字幕请改 **SRT 或 `01-align/words.json`**，不是改 `params`。
违反即 `E-P1-01`（未知键）。

**③ 🔴 字幕类 item 必须「一条 cue 一个」（2026-10-18 实测补充）。**

`caption/karaoke-word` 渲染的是 **item 窗口内出现的全部词**
（`wordsInWindow(caption, fromFrame, durationInFrames)`），不是「当前这一句」。

> 反例（真素材首跑踩到）：用一条 item 覆盖 8–31 秒 ⇒ 成片里字幕糊成 **3–5 行文字墙**，
> 因为她把窗口内十几条 cue 的词全画出来了。

正确写法 —— **锚 `cue:N`，不要写 `durationInFrames`**：

```jsonc
{ "_author": { "anchor": "cue:5" }, "motion": "caption/karaoke-word@1.0",
  "footprint": [0.1, 0.86, 0.8, 0.1], "params": { "boxed": true } }
```

时长由烘焙器取该 cue 的整段长度（C2-6）。48 条 cue ⇒ 48 个 caption item ⇒
storyboard 里能一眼看出「这条字幕覆盖哪一句」，而这正是 `cue:` 存在的理由。

**② 不得自己写颜色。**

`caption/karaoke-word` 原先声明的 `highlightColor` **已摘除**（P1）——
Spec 附录 A 第 1 条硬约束明文「禁写坐标 / 帧数 / **颜色** / CSS」，
留着它等于让模型能硬编码色值。高亮色由**渲染期按命名令牌解析**（`'brand'` / `'accent'`），
**不经 params**。违反同样落 `E-P1-01`。

**填错的后果**（三条码**全是 error，不设 warning 档**）：

| code | 含义 | 触发 |
|------|------|------|
| `E-P1-01` | 含模板未声明的键 | 自造参数、给 caption 写 `text`、写颜色 |
| `E-P1-02` | 缺必填键 | 该填的没填 |
| `E-P1-03` | 值类型不符 | `scale: "1.08"` 而不是 `1.08`；`NaN` / `Infinity` 也会被拒 |

**不做隐式转换** —— `"1.08"` ≠ `1.08`。校验器不替模型做决策。

> 完整判定口径见 [`.workbuddy/skills/validate/SKILL.md`](validate/SKILL.md) 与 Spec §2.11。

## 铁律 2：写锚点，不手算帧

**真相层 = 帧**，但模型不碰它。模型只写**作者语法层**：

```jsonc
"_author": { "anchor": "word:37", "offset": "-8f" }
```

- `anchor` 粒度默认 **词级**（`anchorMode: word`），来自 `01-align/` 的逐词时间戳
- `offset` 是帧偏移

**三种锚点语法**（C2-6 起）：

| 写法 | 起点 | 隐式时长 | 用在哪儿 |
|------|------|---------|---------|
| `word:N` | 第 N 个词的起点 | 该**词**的区间长度 | 默认；文字/数据类按词落点 |
| `cue:N` | 第 N 条 cue 的起点 | 该 **cue** 的整段长度 | 🔴 **字幕类必须用它** |
| `abs:<帧\|秒s>` | 手写帧号 | 模板 `minVisibleInFrames` | 逃生口，不承担抢拍 |

> 显式 `durationInFrames` **永远优先**于隐式时长。但字幕类**不要**手写它 —— 那是手算帧。

- **偏移可为负 —— 负偏移＝抢拍，合法且有意为之**。边界只有一条：**不得早于锚定词所在 cue 的起点**
  > 这条边界是**修正过的**。原先写成「必须落在目标词区间内」，那样负偏移永远非法，抢拍就只能靠 `abs:` 手写帧号 —— 而写死帧号后就失去了「跟着词走」的能力，改一句文案锚点全废。区间下界因此从**词起点**改为 **cue 起点**（C2-5a）。
- `abs`（绝对帧/秒）是**逃生口**，用于真正需要写死帧号的场景，**不承担抢拍**
- **一次性烘焙**：resolver 在生成时把锚点解析成 `fromFrame` + `durationInFrames` 落盘，**锚点用完即弃**
- **不设 guard 文本快照** —— 重剪罕见，砍掉防错位机制
- 编辑页双显示：`帧 372｜ = word:37 −8f`

烘焙后 `_author` **必须剥离**（它只在编辑期可见）。

## 铁律 3：禁跨级引用

storyboard 只能引用 `01-align/` 与 `02-perceive/` 的产物。
**不得引用 `05-render/` 的成片** —— 那会形成环路，且让 storyboard 依赖下游。

## 数据结构（顶层 3 字段）

```jsonc
{
  "meta": {
    "fps": 30,                      // 顶层固化；改 fps 必须重新烘焙
    "anchorMode": "word",           // word | cue，默认 word
    "alignmentConfidence": 0.83,    // 来自 01-align
    "confirmedBy": "人工署名",
    "confirmedAt": "ISO 时间"
  },
  "tracks": [ /* 见下 */ ],
  "noMotionRanges": [ { "fromFrame": 0, "durationInFrames": 90, "reason": "片头实拍空镜" } ]
}
```

**track**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 轨标识 |
| `layer` | integer | 是 | z 序（越大越上）。**与 track 正交** |
| `handoffTo` | string \| null | 否 | **track 级**有向边，声明接力目标 |
| `items` | array | 是 | 轨内 items **允许重叠**（这是特性，不是错误） |

**item**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `_author` | object | 编辑期 | 锚点；**烘焙后剥离** |
| `fromFrame` | integer | 是 | 绝对帧 |
| `durationInFrames` | integer | 是 | 时长（帧） |
| `motion` | string | 是 | `family/subtype@version`，如 `typography/kinetic-line@1.0` |
| `footprint` | `[x,y,w,h]` | 是 | 归一化 0–1 矩形，**落盘时必带** |
| `exclusive` | string | 否 | 互斥组名（如 `lower-third`）。**默认不互斥** |
| `footprintAnimates` | boolean | 否 | `true` → 相交检测由 error 降为 warning |
| `params` | object | 视模板 | 由模板 `paramsSchema`（有哪些键 / 值类型）+ `requiredParams`（哪些必填）决定，见 §1.1 |
| `carrier` | object | 🔴 **不是模型可填字段** | 载体退让声明（D4-t2）：`{ template, params }`，**校验期写入或人工返修手填**。起草稿里**不要写它** —— 与 `_author` 同理。 |

> 🔴 **`carrier` 与 `_author` 同属「非模型产出」**：前者由遮挡退让（D4 ② 号档）在校验期写入，
> 后者由模型写、烘焙后剥离。**模型只填 `motion` / `footprint` / `params` 这三样。**
> 填了 `carrier` 而模板未注册或不是载体类 ⇒ 结构错误 → **退出码 2**。

**motion 命名空间**：`family/subtype@version`（如 `typography/lower-third@1.2`）。
**版本锁定** → 升级不破坏旧 storyboard。

- **family（12 类，可无限扩）**：`caption`（**必备**）/ `typography` / `data` / `annotation` / `carrier` / `brand` / `ambience` / `cinematic` / `transition` / `rhythm` / `sfx` / `custom`
- **scope（6 值，固定枚举）**：`under-subject` / `overlay-safe` / `anchored` / `subject-transform` / `footage-transform` / `fullscreen`
  - 载体类：`subject-transform` / `footage-transform`（作用于实拍视频本身）
  - 叠加类：`overlay-safe` / `under-subject` / `anchored` / `fullscreen`（作用于画面之上）

> scope 由模板声明，**不由模型写**。模型只挑 `family/subtype`。

**接力（hand-off）**：只写在 **track 层** 的 `handoffTo`。
**禁止写在 item 层** —— item 层会产生循环引用，且重排 item 顺序时引用全断。
交接的视觉连续性**不硬编码**：接收方模板用自身的 `params.enter` 声明如何入场。
接力**不强制首尾相接**，允许 gap（gap 常带来呼吸感）。

> 🔴 **`handoffIn` 字段已于 2026-10-15 删除**（问题 9 审计：零消费、与 `params.enter` 语义重复、
> 且不在 `paramsSchema` 内连模型都填不了）。此处原文写「接收方用 `handoffIn` 声明入场」，
> 与实现相反 —— 已更正为 `params.enter`。

**禁配段（`noMotionRanges`）**：模型起草时**跳过**这些区间。不需要外部素材契约，不需要 `media` 字段、alpha 通道处理、fps 对齐。

## 铁律 4：调度走两道闸 + 产路地板

**每个 item 有 4 个决策字段**：`sim_max` / `confidence` / `routing` / `review`。

🔴 **但起草稿与产物的形状不同**（2026-10-19 澄清，实测过的两种写法）：

| 阶段 | 位置 | 谁填 |
|---|---|---|
| **意图底稿 `motionboard.json`** | intent 条目只填 `confidence`（绑定器按候选档位赋 `sim_max`）；钉死条目可带 `sim_max` —— 它们是闸1/闸2 的**输入** | 模型 / 绑定器 |
| **产物 `storyboard.json`** | `item.decision.{ sim_max, confidence, routing, review }` —— 四个值都是**输出** | 烘焙器（`core/schedule.ts`） |

即：模型**不写** `routing` / `review`（那是算出来的），也不要自己套一层 `decision` 对象。
烘焙完成后 `sim_max` / `confidence` 会从顶层剥离，四个值统一挪进 `decision`。

> 🔴 **警告：item 顶层多写的字段不会被拦**（2026-10-19 实测）。
> 当前**没有**「未知 item 字段」校验项 —— 起草稿里多写 `routing` / `review` / `handoffIn` 之类，
> 会经 `{...item}` 原样落进 `storyboard.json`，全链路无报错。
> 只有 `params` 内部有键名校验（`E-P1-01`），item 顶层没有。模型请只填该填的。

**闸1 路由**：`sim_max ≥ T` → `template` 产路 / `custom` 产路。决定「走哪条产路」。
**闸2 审核强度**：按 `confidence` 只调制人工介入强度（`auto` / `alternatives` / `must_review`），**不改变产路**。

两道闸串联，**闸2 不许回头改产路** —— 目的是避免同一模糊点被双重惩罚。

**产路地板（review 的最终取值）**

```
闸2 输出    = f(confidence)              # 闸2 对产路一无所知
最终 review = max(闸2输出, 产路地板(routing))
```

| routing | review 地板 | 闸2 调节能力 |
|---------|-------------|--------------|
| `template` | `auto` | 完全保留 |
| `custom` | `must_review` | 失效（被地板锁死） |

| routing ＼ confidence | 低 | 中 | 高 |
|-----------------------|-----|-----|-----|
| `template` | must_review | alternatives | auto |
| `custom` | must_review | must_review | must_review |

**动态阈值 T**

```
T = clamp( 间隙锚, 约束于 配额锚分位 )
```

| 项 | 值 |
|----|-----|
| 配额锚 | 期望走库比例 **70%–90%** |
| 间隙锚 | 分数排序后的最大间隙（elbow） |
| 硬边界 | `T_min = 0.50` / `T_max = 0.80`（是**边界**，不是取值） |
| 安全阀 | 整批 `sim_max` 中位数 < 0.4 → **整批转 custom + 人审**，禁止降阈值硬套库 |
| 样本少 | `N < 8` → 退化固定 `T = 0.65`；`N ≥ 8` → 用 elbow |

> 「95% 走库」是方针修辞，不是阈值参数。

**必须单测覆盖的 5 组用例**

1. `template` × `confidence 高` → `auto`
2. `template` × `confidence 中` → `alternatives`
3. `template` × `confidence 低` → `must_review`
4. `custom` × 任意 `confidence` → `must_review`
5. `custom` × `confidence = 0.99` → 仍须 `must_review`（地板锁死验证）

## 必须停条件

**无常规阻断。** 但两种情况必须停下报人：

| 情形 | 处置 |
|------|------|
| 整批 `sim_max` 中位数 < 0.4（安全阀） | **整批转 custom + 人审**，不得降阈值硬套库 |
| 需要 `fullscreen` 类 motion | `fullscreen` 必然覆盖全画面，**一律人工确认**，无自动放行规则（载体模式生效时例外）。**确认落点在 render 启动闸**（D3-a）：起草时照常写，但该 item 必须被 `06-review/confirmed.json` 的 `acknowledgedFullscreen` 覆盖，否则渲染起不来 |
| `routing = custom` 的任一条 | 地板已把 `review` 抬到 `must_review`，**不许绕过** |
| `params` 填出 `E-P1-01/02/03` 任一条 | 本阶段**无放行档** —— 校验器是只读的，不代改。回填正确的键与类型后重跑 |

## 产物（落 `03-storyboard/`）

| 文件 | 来源 | 内容 |
|------|------|------|
| `storyboard.json` | 【文档指定】 | 烘焙后，`_author` 已剥离，`fromFrame` 为绝对帧 |
| `bake-report.json` | 【实现期拟定，文档未点名】 | 锚点→帧的解析记录：哪些锚点用了哪个词的哪个帧 |

> 文档对 `03-storyboard/` 的规定只有 `storyboard.json` 一项（F1）。`bake-report.json` 是本 Skill 为可追溯性补的建议文件，可调整。

## 失败与退出码

| 情形 | 处置 |
|------|------|
| `02-perceive/` 缺失 | **停**，退出码 `1` |
| 参数错（未知 family / 未知 scope / 版本号非法） | 退出码 `2`，不猜 |
| 锚点解析失败（引用了不存在的词号） | 退出码 `1`，指明是哪个 item |
| 超时 / 中断 | 退出码 `5` / `130` |

**禁止**：锚点是帧的真相来源，解析不出来时**不许**随手填一个 `fromFrame` 糊过去。

## 落盘检查清单

- [ ] 顶层恰好 3 个字段：`meta` / `tracks` / `noMotionRanges`
- [ ] `meta.fps` 已固化；`anchorMode` 与 `alignmentConfidence` 与 `01-align/` 一致
- [ ] 全部 `_author` 已剥离，全部 item 都有 `fromFrame` + `durationInFrames`
- [ ] 每个 item 都带 `footprint`（归一化 0–1）
- [ ] `handoffTo` 只出现在 track 层，**item 层零出现**
- [ ] 起草未落入 `noMotionRanges` 任何区间
- [ ] 每个 item 的 `params` 键**全部**在 `paramsSchema` 内（零自造参数）
- [ ] `requiredParams` 里的键**全部**已填
- [ ] `params` 值类型与声明一致；数字**没有**写成字符串，没有 `NaN` / `Infinity`
- [ ] `caption` 类 item 的 `params` **没有** `text`，也**没有**任何颜色键
- [ ] 全部 item 都有 `sim_max` / `confidence` / `routing` / `review` 齐全，且 `review` 满足产路地板
- [ ] 未引用 `05-render/` 的任何产物（禁跨级引用）
- [ ] 未修改 `01-align/` / `02-perceive/`（不可变快照）
