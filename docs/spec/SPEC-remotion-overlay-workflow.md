# Remotion 视频动效工作流 — Spec（v0.6）

> 状态：**结构已定稿 / 数值待实测**
> 生成日期：2026-10-12（v0.1 骨架）｜修订：2026-10-12（v0.2 消 TBD）｜2026-10-13（v0.3 补三处缺口 · v0.4 术语表 · v0.5 补参数契约与 align 权威源）｜2026-10-16（v0.6 同步 #17 文本溢出与全篇计数）｜2026-10-17（v0.7 记 #18 安全区覆盖的增补与撤回，D2-2 REVERTED）
> 依据：乐享《Remotion 视频动效工作流 — 进度总结（2026-10-12）》
> 　　`entry_id = cc6a8c8fa38e4fa68d59e4141d747c71`｜`space_id = 57d1ad38cf8f4617ba18729f7661972d`
> 　　引用章节：§3 / §4 / §5.3 / §5.5 / §7 / §8 / §9 / §10.3 / §10.4 / §10.5
> **配套真源**：`docs/decisions/OPEN-DECISIONS.md`（本文件与登记册冲突时，**以登记册为准**）

**v0.6 相对 v0.5 的变化**：同步已落登记册的 **D-B** 裁决 ——
① 校验清单由 **16 项增补为 17 项**（#17「文本溢出 footprint」，`W-DB-01`，warning 档，判据见 §2.3）；
   全篇计数一并更正（§2.1 / §2.3 / §2.5 / 本页头部）。
② ⚠️ **#17 的类归属未经登记册裁决** —— 登记册只写「新增构建期校验项 #17」，未指定类。
   本表由【整理时归入「工程与遮挡类」】，**如要变更须走登记册**。
③ 同步说明 #17 的已知局限（系数对粗体数字 / 圆角容器严重低估）与待补 **D-B2**。

**v0.5 相对 v0.4 的变化**：同步两条已落登记册的裁决 ——
① 校验清单由 **15 项增补为 16 项**（#16「参数契约」，P1 裁决，判据见 §2.3 / §2.11），
   模板契约同步扩 `requiredParams`（§3.2），`caption/karaoke-word` 摘除 `highlightColor`；
② **M-1 / M-1c**：`align` 的文本权威归 **SRT**（方案 b），`align-report.json` 补
   `textSource` / `alignedRatio` 两个**必填**字段，且 `alignedRatio` **同时是门控项**（§5.1.1 / §4.6）。
提案与逐处依据见 `docs/proposals/2026-10-13-模型选型与分工.md`（§8 该文原写「`01-align` 契约不需要改」，已纠正）。

**v0.3 相对 v0.2 的变化**：补齐实现期暴露的三处缺口 ——
① 校验清单由 **14 项增补为 15 项**（E5 禁配段相交，判据见 §2.10）；
② D3 fullscreen 的确认落点定为 **render 启动闸**（§2.10 / §5.4.1），`confirmed.json` 补 `stage: render` 与 `acknowledgedFullscreen`（§5.2）；
③ 时序校验的区间下界由「词起点」改为「**锚定词所在 cue 的起点**」（C2-5a，§1.5 / §2.2 #1），负偏移＝抢拍成为合法写法。
提案与逐处依据见 `docs/proposals/2026-10-13-三处缺口修改方案.md`。

**v0.2 相对 v0.1 的变化**：清除 3 项可查证的 `🟡TBD`（顶层字段名 / meta 字段 / 错误码命名），新增附录 A（§5.3 机制决策表）；剩余 4 项属**数值实测类**，非文档缺口，保持开放。

---

## 0. 本文件的定位

| 产物 | 读者 | 回答的问题 | 状态 |
|------|------|-----------|------|
| 登记册 `OPEN-DECISIONS.md` | 自己 / 未来的我 | 为什么这么定？否决了什么？ | 已成型（40+ 条） |
| **Spec（本文）** | 实现者（人或模型） | 照着做：字段是什么、校验怎么判、目录怎么建 | **v0.2 结构定稿** |
| Skill | 模型（执行时读） | 做这一步该遵守什么、何时必须停 | 未生成 |

**使用约束**：本 Spec 只描述「照着做」的内容，不承担追溯职责。任何**带 `🟡TBD` 标记**的条目 = 进度文档未给出字段级细节、需回登记册核对后补全，**不得凭常识填**。

### 0.1 范围核对（对 §10.3「Spec 该包含什么」）

进度文档 §10.3 点名 Spec 必须含 4 章，本文件逐条对应：

| §10.3 要求 | 来源 | 本文件位置 | 覆盖 |
|-----------|------|-----------|------|
| ① 数据契约：storyboard.json 完整 schema（顶层 3 字段 + track/item + 4 项新增 + noMotionRanges） | B6 + C6 | §1 | ✅ |
| ② 校验规格：**各项**的输入 / 判定条件 / error-warning 级别 / **失败错误码** | F2 | §2（§2.5 定义错误码） | ✅ 当前 17 项 |
| ③ 模板契约：命名规则 + 6 scope + paramsSchema + D2 区域预算表 | B6 双轴 | §3（§3 契约 / §2.6 预算表） | ✅ |
| ④ 调度逻辑：`review = max(闸2, 产路地板)` + 动态阈值 T + 5 组单测 | N-3 + B5 | §4 | ✅ |
| （§10.3 外，Spec 生成时并入）§5.3 机制决策表 | N-5 / F7 | **附录 A** | ✅ |

> §10.5「剩余待办三件」中，**Spec 生成**即本文件；**C2-2 阈值校准**与**渲染基准量化**为实测项，依赖本文件落地，不属文档缺口。

---

## 1. 数据契约（来源 B6 + C6）

### 1.1 顶层结构

```jsonc
{
  "meta": { },              // 见 1.2 —— 承载 anchorMode / alignmentConfidence / confirmedBy / confirmedAt / fps
  "tracks": [ ],            // 见 1.3
  "noMotionRanges": [ ]     // 见 1.4
}
```

> **✅ 已核实（v0.2）**：顶层确为这 3 个字段。
> 来源：进度文档 §10.3 第 1 章「顶层 3 字段 + item/track 结构 + footprint / minVisibleInFrames / handoffTo / handoffIn + noMotionRanges」；§7.4「`anchorMode: word | cue` / `alignmentConfidence + confirmedBy` / `fps`」；登记册「待落地的产物元数据字段」一节。
> 即：**1 个元数据容器 + 2 个数组**。v0.1 的结构推断无误，此处由推断升格为确认。

### 1.2 meta（顶层元数据）

来源：§7.4「顶层元数据与调度逻辑」+ 登记册「待落地的产物元数据字段」。

| 字段 | 类型 | 取值 | 来源 | 说明 |
|------|------|------|------|------|
| `fps` | number | 整数 | C6 | **顶层固化**。改 fps 会让已烘焙帧号语义漂移 → 必须重新烘焙 |
| `anchorMode` | enum | `word` \| `cue` | C2-1 / C2-4 | 书写粒度，**默认 `word`**。产出物必须带，否则事后无法区分某片是哪个精度出的 |
| `alignmentConfidence` | number | 0–1 | C2-2 / C2-4 | 强制对齐的整体置信度 |
| `confirmedBy` | string | 人工署名 | C2-4 | 审计链。**实际落盘在 `06-review/confirmed.json`，meta 中仅作关联**（F1 设计点 3） |
| `confirmedAt` | string | ISO 时间 | C2-4 | 同上 |

> **✅ 已核实（v0.2）**：meta 的字段全集 = `anchorMode` / `alignmentConfidence` / `confirmedBy` / `confirmedAt` / `fps`，**共 5 个，无第六条**。
> 来源：§7.4 原句「`anchorMode: word | cue` / `alignmentConfidence + confirmedBy` / `fps`」；登记册 §「待落地的产物元数据字段（storyboard.json 顶层）」三条（`anchorMode` (C2-4) ／ `alignmentConfidence` + `confirmedBy`/`confirmedAt` (C2-4) ／ `fps` (C6)）；登记册 C2-4 行「产出物顶层须带 `anchorMode` / `alignmentConfidence` / `confirmedBy` / `confirmedAt`」。
> **jobId 不入 meta** —— 它是 **F1 目录层**概念（`jobs/<jobId>/`），通过路径关联，不进文件；`confirmedBy`/`confirmedAt` 亦然（落 `06-review/confirmed.json`）。**素材指纹/版本字段：真源中不存在，不设。**

### 1.3 track / item 结构

来源：§4.1（C1）+ §4.7（C6）。

**track**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 轨标识 |
| `layer` | integer | 是 | z 序（越大越上）。**与 track 正交** |
| `handoffTo` | string \| null | 否 | **track 级有向边**，声明接力目标。只在 track 层，**禁止放 item 层**（会循环引用） |
| `items` | array | 是 | 轨内 items **允许重叠** |

**item**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `_author` | object | 编辑期 | `{ anchor: "word:37", offset: "-8f" }`；**烘焙后剥离** |
| `fromFrame` | integer | 是 | 绝对帧（真相层） |
| `durationInFrames` | integer | 是 | 时长（帧） |
| `motion` | string | 是 | `family/subtype@version`，如 `typography/kinetic-line@1.0` |
| `footprint` | `[x,y,w,h]` | 是 | 归一化 0–1 矩形，落盘时必带 |
| `exclusive` | string | 否 | 互斥组名（如 `lower-third`）。**默认不互斥** |
| `footprintAnimates` | boolean | 否 | `true` → 相交检测从 error 降为 warning |
| `params` | object | 视模板 | 🟡TBD：由模板 `paramsSchema` 决定，具体键待模板落地后回填 |

```jsonc
{
  "tracks": [
    {
      "id": "typo-a", "layer": 60,
      "items": [{
        "_author": { "anchor": "word:37", "offset": "-8f" },
        "fromFrame": 372, "durationInFrames": 96,
        "motion": "typography/kinetic-line",
        "footprint": [0, 0.72, 0.42, 0.18],
        "exclusive": "lower-third"
      }]
    },
    {
      "id": "typo-b", "layer": 60, "handoffTo": "data-c",
      "items": [{
        "fromFrame": 396, "durationInFrames": 120,
        "motion": "typography/tag-float",
        "footprint": [0.5, 0.1, 0.3, 0.2]
      }]
    }
  ]
}
```

### 1.4 noMotionRanges（禁配段）

来源：§8.6（E5）。

```jsonc
"noMotionRanges": [ { "fromFrame": 0, "durationInFrames": 90, "reason": "片头实拍空镜" } ]
```

- 模型起草时**跳过**这些区间
- 校验期：任何 motion 与禁配段相交 → **error**（**校验项 #15**，码 `E-E5-01`）
- **不需要**外部素材契约、media 字段、alpha 通道处理、fps 对齐
- 只读 storyboard 自身即可判定 → 满足 §2.10 的三条准入判据，故完整进入构建期清单

### 1.5 时间坐标规则（C2）

- **真相层 = 帧**：最终落盘 `fromFrame` + `durationInFrames`
- **作者语法层 = 锚点 + 帧偏移**：模型写 `{anchor:"word:37", offset:"-8f"}`，**不让模型手算帧**
- **偏移可为负 —— 负偏移是「抢拍」，合法且有意为之**。约束是**不得早于锚定词所在 cue 的起点**（C2-5a）
  > 这条不是补充说明，而是**修掉的一处矛盾**：C2-5 原文把区间写成「目标词区间」，而 `-8f` 必然把 `fromFrame` 推到词起点之前 —— 按那个写法，本 Spec 自己的示例就会被判成错位。修法是把区间下界从**词起点**改为**cue 起点**。若把负偏移一刀切禁掉，抢拍只能靠 `abs:` 手写帧号，那就违背了「不让模型手算帧」这条铁律。
- **一次性烘焙**：resolver 生成时解析锚点 → 帧，锚点用完即弃
- **不设 guard 文本快照**
- 编辑页**双显示**：`帧 372｜ = word:37 −8f`
- `abs`（绝对帧/秒）作为手写逃生口 —— 定位收窄为「真正需要写死帧号的场景」，不承担抢拍

---

## 2. 校验规格（来源 F2 · 构建期为主 + 渲染期兜底）

> **本清单是「活清单」**，当前 **17 项**（时间轴类 9 + 工程与遮挡类 7 + **参数契约类 1**）。
> 第 15 项于 2026-10-13 增补（E5 禁配段相交，见 §1.4）—— 它三条判据与其余各项完全同质，属编表时漏收。
> **第 16 项**于 2026-10-13 增补（**参数契约 / `paramsSchema` 校验**，P1 裁决，判据见 §2.11）——
> 此前 `paramsSchema` 只被定义与注册、**校验器侧零引用**。
> **第 17 项**于 2026-10-15 增补（**文本溢出 footprint**，D-B 裁决 → 方案 B，判据见 §2.3 表内说明）——
> 登记册 `D-B` 记录为「新增构建期校验项 #17」，**未指定其所属类**；
> 本表由【整理时归入「工程与遮挡类」】（它与 #12–#14 同属几何/版面量测），
> ⚠️ **该归类未经登记册裁决，如要变更须走 `OPEN-DECISIONS.md`**。
> **第 18 项曾于 2026-10-17 增补、同日撤回**（`W-D2-02`「motion footprint 未包住安全区」，
> **D2-2**）—— 判据「`footprint` 须包含 `safeArea`」**不成立**：
> `carrier/split-frame@1.0` 只有声明、无渲染实现，`footprint` 语义未定（缩放后视频位置？裁剪后剩余半边？）；
> `cinematic/punch-in@1.0` 确实是放大裁切，但其 `footprint` 为全屏 `[0,0,1,1]`
> ⇒ 该判据**对分屏可能误报、对放大完全漏报**。正确判据须基于变换参数（`scale` / `inset`）
> 推算「变换后可见区域」，与 **D4 载体语义**一并裁决后再立。
> **增补须先走 `docs/decisions/OPEN-DECISIONS.md`，不得只在正文里加而不同步登记册。**
>
> **有一条规则刻意不在本清单内**：D3 的 fullscreen 人工确认。原因见 §2.10。

### 2.1 分层

| 阶段 | 可判条件 | 覆盖 |
|------|----------|------|
| **构建期**（纯 JSON→JSON，不渲染） | 只读 `03-storyboard/` + `01-align/` + `02-perceive/` | **全部校验项（当前 17 项）** |
| **渲染期兜底** | 需实际渲染才暴露 | 字体未加载、Canvas 未挂载（delayRender 超时）、GPU 上下文创建失败 |

- 校验器是**纯函数**，逐项独立判定，产出 `04-validate/validate-report.json`（error / warning 分组）
- **有 error 则阻断，不进渲染**
- **优先级**：安全区判定（D）**优先于** exclusive 组判定（C4）

### 2.2 时间轴类（9 项）

| # | 校验项 | 判定 | 来源 |
|---|--------|------|------|
| 1 | 时序校验：帧须落在 `[锚定词所在 cue 起点, 该词 endFrame]` | 否则 error | C2-5 / **C2-5a** |
| 2 | 密度校验：每 cue item 数超阈值 | error | C2-5 |
| 3 | footprint 同组相交 | error | C4 |
| 4 | footprint 异组相交 | warning | C4 |
| 5 | 主从冲突 | **自动放行**（由 scope 枚举推导，非白名单） | C4 |
| 6 | 最小可见时长不足 | error | C3 |
| 7 | 落在词级边界 | warning | C3 |
| 8 | 跨越 subject-transform 裁切边界 | error | C3 |
| 9 | 接力 gap > 1.5s | warning | C5 |

### 2.3 工程与遮挡类（7 项）

| # | 校验项 | 判定 | 来源 |
|---|--------|------|------|
| 10 | composition 尾部截断 | error（**不可省**） | C6 |
| 11 | footprintAnimates 降级 | error → warning | C3 |
| 12 | 遮挡分级预算超预算 | error | D2 |
| 13 | 载体自动降级（三级退让） | 见 §4.2 | D4 |
| 14 | B-roll 主体遮挡 | ≤30% 预算 | D2 |
| **15** | **禁配段相交** | 任何 motion 与 `noMotionRanges` 相交 → error | **E5**（2026-10-13 增补）|
| **17** | **文本溢出 footprint** | `估算文本宽 > footprint 宽 × (1 + 15%)` → **warning（不阻断）**；系数 CJK 1.0em / 拉丁数字 0.5em / 空格 0.3em；字号取自模板声明的 `textMetrics`（**唯一真源**，不得在校验器内另写） | **D-B**（2026-10-15 增补，方案 B）|

> ⚠️ **第 17 项的已知局限（如实记录）**：一套通用系数套不住差异巨大的字重与容器 ——
> 真渲实测 `tag-float` 与 `stat-card` 的溢出**被严重低估**（详见
> `docs/templates/2026-10-15-参数手感表.md` §7）。已立 **D-B2（逐模板实测度量表）** 待实施。
> 当前实际价值 = 守住「**明显超长**」量级。

### 2.3.1 参数契约类（1 项）

| # | 校验项 | 判定 | 来源 |
|---|--------|------|------|
| **16** | **`params` 按 `paramsSchema` + `requiredParams` 校验** | 三条码全 error，**不设 warning 档** | **P1**（2026-10-13 增补）|

> **为什么单列一类**：前 15 项判的都是「时间轴与几何」，输入是帧号与矩形；
> 第 16 项判的是「模型填的表对不对模板」，输入是 `params` 与模板声明。
> 混进「工程与遮挡类」会让那一类的判据看起来不统一，也不好定位是哪一类出错。

### 2.4 C4 几何判定矩阵

| 条件 | 判定 | 理由 |
|------|------|------|
| 相交 + 同 exclusive 组 | **error** | 同类抢位 |
| 相交 + 不同 exclusive 组 | **warning** 不拦 | 几何相交 ≠ 视觉打架 |
| 不相交 | **通过**（即便同组） | 规则不应误伤 |

> footprint 取**全动画期最大包围盒**；声明 `footprintAnimates:true` 时相交检测由 error 降为 warning。

### 2.5 错误码约定

**✅ 已定（v0.2）**：进度文档 §10.3 第 2 章明确要求「校验规格」须给出**每项的输入、判定条件、error/warning 级别、失败错误码** —— 即错误码命名是 **Spec 的职责**，不属登记册未决项（登记册确实未定义，故此处为 Spec 自定）。
**命名规则**

```
E-<source>-<nn>    error     例：E-C4-01（同组 footprint 相交）
W-<source>-<nn>    warning   例：W-C5-01（接力 gap > 1.5s）
```

- `<source>` 取**决策编号**（`C2-5` / `C3` / `C4` / `C5` / `C6` / `D2` / `D4` / `E5` / `P1` / `D3` / `F6`），保证每条 error 都能一键回溯到裁决理由
- `<nn>` 在**同一 source 内**从 01 起递增，顺序 = §2.2 / §2.3 表格行序
- 同一个校验项若可产出两种级别（如第 11 项 `footprintAnimates` 降级），**共用同一 `<nn>`，仅前缀区分 E / W**

**错误码全表**

| # | 校验项 | error | warning |
|---|--------|-------|---------|
| 1 | 时序校验：帧须落在 `[锚定词所在 cue 起点, 该词 endFrame]` | `E-C2-5-01` | — |
| 2 | 密度校验：每 cue item 数超阈值 | `E-C2-5-02` | — |
| 3 | footprint 同组相交 | `E-C4-01` | — |
| 4 | footprint 异组相交 | — | `W-C4-01` |
| 6 | 最小可见时长不足 | `E-C3-01` | — |
| 7 | 落在词级边界 | — | `W-C3-01` |
| 8 | 跨越 subject-transform 裁切边界 | `E-C3-02` | — |
| 9 | 接力 gap > 1.5s | — | `W-C5-01` |
| 10 | composition 尾部截断 | `E-C6-01` | — |
| 11 | footprintAnimates 降级 | `E-C3-03` | `W-C3-02` |
| 12 | 遮挡分级预算超预算 | `E-D2-01` | — |
| 13 | 载体自动降级（三级退让后仍冲突） | `E-D4-01` | — |
| 14 | B-roll 主体遮挡 > 30% | `E-D2-02` | — |
| **15** | **motion 与禁配段相交** | **`E-E5-01`** | — |
| **16** | **`params` 含模板未声明的键** | **`E-P1-01`** | — |
| **16** | **`params` 缺必填键** | **`E-P1-02`** | — |
| **16** | **`params` 值类型与声明不符** | **`E-P1-03`** | — |
| **17** | **估算文本宽 > footprint 宽 × 1.15** | — | **`W-DB-01`** |

> 第 16 项的**三条码共用同一 `<source>`（P1）与同一序号段（01–03）**，顺序 = §2.11 的判定顺序。
> **三条全是 error，没有 warning 档。**
>
> 第 17 项**只有 warning 档、无 error 码**（D-B 裁决：未校准的估算值当 error 用会伤害真实用户；
> 实测校准后再考虑升档）—— 故上表该行无 error 码。

**不在 17 项内、但同样会出现在报告里的条目**

| 项 | 级别 | code | 说明 |
|----|------|------|------|
| shot 主体未确（F6 兜底） | warning | `W-F6-01` | **不阻断** |
| fullscreen 需人工确认（D3） | warning | `W-D3-01` | **不阻断**；硬停在 render 启动闸，见 §2.10 |

- 第 5 项（主从冲突）**无错误码** —— 它不校验、直接放行，不产 report 条目
- 上表两条 warning 不进 `summary.checked` 的计数，另记入 `summary.extra`（见 §2.9）

**与进程级退出码的关系（两套并存，不混用）**

参照进度文档 §5.3「八个可直接抄的机制」之三 —— **语义化退出码**：

```
0 可交付 / 1 校验没过 / 2 参数错 / 3 版式✗ / 4 渲染失败 / 5 排队超时 / 6 内部错误 / 130 中断
```

| | 项级错误码（本表） | 进程级退出码（§5.3） |
|---|---|---|
| 粒度 | 单条校验项 | 一次 CLI 调用 |
| 载体 | `04-validate/validate-report.json` 的 `code` 字段 | 进程 `$?` |
| 用途 | 定位「哪条规则没过、为什么」 | 定位「这一步整体是什么结局」 |
| 关系 | 有 error → 进程退出码必为 `1`；退出码 `1` 必伴随 ≥1 条 `E-*` | — |

### 2.6 D2 区域分级预算表

| 区域 | 遮挡预算 | 判定方式 |
|------|----------|----------|
| 人脸 / 头肩 | **0%** | person bbox 上部 + 关键点检测 |
| 手持物 | **≤ 20%** 面积 | 手部关键点邻域 + 局部显著性 |
| B-roll 主体 | **≤ 30%** 面积 | shot 级显著性峰值区 |
| 其余区域 | 无限 | — |

**校验方式**：不判「有没有相交」，而是算「从各级区域各拿了多少遮挡额度」，**总和超预算才报错**。

### 2.7 安全区推导三原则（D）

1. 安全区 **≠ 主体 bbox**，取 **bbox 上部**（腿部以下可压）
2. **按 shot 取并集**，不逐帧跟随（否则动效跟着人飘）
3. 主体不在场的 shot → **安全区为空**（全画面可行域）

### 2.8 D 分支回填 C4 的约束

| motion 类型 | footprint 约束 | 判定 |
|-------------|----------------|------|
| overlay-safe / under-subject | 须**避开**各级区域 | 超预算 → error |
| subject-transform / footage-transform | 须**包住**安全区 | 未包住 → warning |
| fullscreen | — | **一律人工确认** |

### 2.9 报告契约（`04-validate/validate-report.json`）

错误码的载体，也是「有 error 则阻断」的判据。
```jsonc
{
  "jobId": "2026-10-12-demo",
  "ok": false,                       // 无 error 才为 true（warning 不影响）
  "summary": { "error": 2, "warning": 3, "checked": 16, "extra": ["W-D3-01", "W-F6-01"] },
  "items": [
    {
      "code": "E-C4-01",
      "level": "error",              // error | warning
      "check": "footprint-overlap-same-group",
      "source": "C4",                // 决策编号，可回溯登记册
      "stage": "build",              // build | render
      "targets": ["typo-a/000", "typo-b/001"],   // trackId/itemIndex
      "frames": [372, 468],          // 相关帧区间，便于直接跳 Studio
      "message": "同一 exclusive 组 lower-third 内 footprint 相交",
      "hint": "错开 fromFrame 或缩短 durationInFrames"
    }
  ]
}
```

- `items` 按 `level` 再按 `code` 排序，保证同一输入产出**逐字节一致**的报告（可入 git diff）
- `hint` 是给人看的修法提示，**不进机器判定**
- **`summary.checked` = 实际执行的「文档校验项」数**（当前 16）。它**不等于**「全部执行的规则数」—— 不在清单内但会产条目的码另记在 `summary.extra`（`W-D3-01` / `W-F6-01`）。两个数字加起来才是全貌，**不要把 `checked` 读成「全跑完了」**
- 渲染期兜底（字体未加载 / Canvas 未挂载 / GPU 上下文失败，§2.1）用同结构，`stage: "render"`，`code` 前缀 `E-RT-*` / `W-RT-*`

### 2.10 一条刻意不在校验清单内的规则（D3）

`fullscreen` 类 motion 必然覆盖全画面，D3 规定**一律人工确认、不设自动放行规则**。
但它**不进构建期校验清单** —— 判据是 §2.1 的三条：

| 判据 | D3 是否满足 |
|------|------------|
| 输入在本阶段可读 | ❌ **不满足** —— 确认记录产在 `06-review/confirmed.json`，而构建期只读 `03`/`01`/`02` |
| 纯结构化判定 | ⚠️ 勉强 —— 人工确认是**流程闸**，不是数据判定 |
| 渲染前就该阻断 | ✅ |

三条没全中，所以另找落点：

| 层 | 做什么 |
|----|--------|
| `validate` | 出 `W-D3-01` **预告**，**不阻断** |
| `render` 启动闸 | **硬拦**：存在未确认的 fullscreen → 拒绝启动（见 §5.4.1）|
| `06-review/confirmed.json` | 记录 `acknowledgedFullscreen: string[]`（见 §5.2）|

> 这条判据同时是**本清单的准入规则**：某个规则该不该进那 16 项，就看三条是否全中。
> 全中 → 进；未全中 → 另找落点，并在本表说明。**例外只应该有 D3 这一条。**

### 2.11 第 16 项「参数契约」的判定口径（P1）

**输入**：`item.params`（模型填的表）+ 模板声明的 `paramsSchema` / `requiredParams`。
**产出**：`E-P1-01` / `E-P1-02` / `E-P1-03`，**三条全 error，不设 warning 档**。

| code | check | title | 判定 |
|------|-------|-------|------|
| `E-P1-01` | `params-unknown-key` | params 含模板未声明的键 | `params` 里的键不在 `paramsSchema` 中 |
| `E-P1-02` | `params-missing-required` | params 缺必填键 | `requiredParams` 里的键没出现在 `params` 中 |
| `E-P1-03` | `params-type-mismatch` | params 值类型与声明不符 | 实得值与声明类型不符（含非有限数值）|

**判定顺序固定 `01 → 02 → 03`。** 理由：**未知键最能指出模型对模板的理解偏差**，
先报它，同一个 item 的其他问题才不会被埋掉。

**三条必须照抄的边界**

1. **`'number'` 额外要求 `Number.isFinite`。** `NaN` / `Infinity` 的 `typeof` 也是 `'number'`，
   裸 `typeof` 会放行 —— 而它们在插值时产生 NaN，**污染整条画面**。
2. **不做隐式转换。** `scale: "1.08"` ≠ `scale: 1.08`。校验器不做模型该做的事；
   把字符串悄悄转成数字等于替模型做决策，由渲染期去猜也一样。
3. **不判语义。** `stat-card` 的 `value: "999%"` 数值可疑但**结构正确**，校验器只验结构。
   语义真伪需人工或后续 VLM。

**不剔除非法 item。** 校验器是**纯函数**且**逐项独立判定**（§2.1）：剔除会让报告随
「哪几项先跑」而变，并吞掉其他项的真实问题。

> **为什么三条全 error**：现有的 warning 档（`W-C4-01` 几何相交、`W-F6-01` 等人补）
> **都有正当的不拦理由** —— 几何相交视觉上可能没问题、主体未确只是提示。
> 参数写错没有这类理由：**要么崩，要么静默错渲**。

**准入自查**（三条全中 → 进清单）

| 判据 | 是否满足 |
|------|---------|
| 输入在本阶段可读 | ✅ 模板声明与 item 均在 `03` |
| 纯结构化判定 | ✅ 键存在性 + 类型比对 |
| 渲染前就该阻断 | ✅ |

**契约侧的前置改动（与本项同批落地，P1）**

`TemplateDeclaration` 新增 **`requiredParams?: string[]`**，**省略 = 全部可选**。
理由：`paramsSchema: Record<string,string>` 是**扁平表，装不下 required**。
故拆成两个正交字段 —— 键存在性查 `paramsSchema`，是否必填查 `requiredParams`。
**刻意不把值类型改成对象 `{type, required?, default?}`**：`default` 是**渲染期**的事，
塞进校验层属职责混淆，且 10 个已声明模板全要迁移。详见 §3.2。

---

## 3. 模板契约（来源 B6 双轴）

### 3.1 双轴

**轴 A｜family（命名空间，可无限扩，12 类）**

`caption`（**必备**）/ `typography` / `data` / `annotation` / `carrier` / `brand` / `ambience` / `cinematic` / `transition` / `rhythm` / `sfx` / `custom`

**轴 B｜scope（枚举，固定 6 值）**

`under-subject` / `overlay-safe` / `anchored` / `subject-transform` / `footage-transform` / `fullscreen`

**scope 天然二分**（驱动 C4 主从放行 + C6 双栈分离）：
- **载体类**：`subject-transform` / `footage-transform` —— 作用于实拍视频本身
- **叠加类**：`overlay-safe` / `under-subject` / `anchored` / `fullscreen` —— 作用于画面之上

### 3.2 模板声明契约

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | `family/subtype@version` |
| `family` | enum | 12 类之一 |
| `subtype` | string | 自由命名 |
| `version` | semver | **版本锁定 → 升级不破坏旧 storyboard** |
| `scope` | enum | 6 值之一 |
| `layer` | integer | 默认 z 序（track 声明可覆盖） |
| `occludesSubject` | boolean | 是否遮挡主体 |
| `paramsSchema` | `Record<string,string>` | 参数契约，**模型只填表不写代码**。扁平表：键 → 值类型 |
| `requiredParams` | `string[]`（**可选**） | **必填参数键**。**省略 = 全部可选**（P1，见下注） |
| `status` | enum | `core` \| `experimental` \| `custom` |
| `footprint` | `[x,y,w,h]` | 默认占位矩形，item 可覆盖 |
| `minVisibleInFrames` | integer | 该 motion 的最小可见时长 |
| `handoffIn` | object | 模板参数：如何承接入场 |

**为什么 `requiredParams` 是独立字段，而不是 `paramsSchema` 的一个属性（P1）**

`paramsSchema` 是 `Record<string, string>` 的**扁平表**，装不下 required。
故拆成**两个正交字段**：键存在性查 `paramsSchema`，是否必填查 `requiredParams`。

**刻意不把值类型改成对象 `{ type, required?, default? }`**，两条理由：

- `default` 是**渲染期**的事，塞进校验层属**职责混淆**
- 10 个已声明模板会**全部迁移**，diff 远大于收益

校验项 #16（§2.11）需要三个事实：**存在 / 必填 / 类型** —— 上述两个字段恰好给全。

**首批模板的必填标注**（只标**无自然默认值**的）：

| 模板 | `requiredParams` | 说明 |
|------|------------------|------|
| `typography/kinetic-line` | `['text']` | `enter` 有默认值，可选 |
| `typography/lower-third` | `['title']` | `subtitle` 可选 |
| `typography/tag-float` | `['text']` | — |
| `data/stat-card` | `['value']` | `unit` 可选 |
| `annotation/pointer-callout` | `['target']` | 无 target 则标注无指向对象 |
| `caption/karaoke-word` | **无必填** | 字幕的一切都来自 SRT |

### 3.3 待落地新增 4 项（进 Spec 的模板契约）

1. `footprint` —— 归一化矩形，模板默认值，item 可覆盖
2. `minVisibleInFrames` —— 最小可见时长
3. `handoffTo` —— **track 级**字段，声明接力目标
4. `handoffIn` —— **模板参数**，声明如何承接入场

### 3.4 命名与版本

- 命名空间 `family/subtype@version`（如 `typography/lower-third@1.2`）
- **版本锁定** → 升级不破坏旧 storyboard

### 3.5 首批清单与扩补纪律

**首批 10 个模板已定** —— 见 [`docs/templates/2026-10-13-模板库首批清单.md`](../templates/2026-10-13-模板库首批清单.md)，
含每个模板的契约值（`layer` / `occludesSubject` / `footprint` / `minVisibleInFrames`）与推导依据。

要点四条（细节见该文档）：
- **`under-subject` 首批为空** —— 依赖 perceive 主体框，模型未接入；**诚实留空优于占位**
- **`scope` 与 `occludesSubject` 是两个独立维度** —— `ambience/noise-grain` 是 fullscreen 但不遮挡主体
- **依赖未落地输入的模板标 `experimental`** —— 首批 2 个（pointer-callout / split-frame）依赖 perceive
- **`caption/karaoke-word` 的 `paramsSchema` 是 `{ boxed: 'boolean' }`**
  —— **无 `text`**（字幕文本来自 SRT）、**无任何颜色键**（P1 摘除原 `highlightColor`）。
  颜色改由渲染期按**命名令牌**（`'brand'` \| `'accent'`）解析，不经 params：
  附录 A 第 1 条硬约束明文「禁写坐标 / 帧数 / **颜色** / CSS」，
  留着 `highlightColor` 等于让模型能硬编码色值。

**扩补纪律**：新模板须满足 7 条准入规则（见清单文档 §4），其中
「`occludesSubject` 独立论证，不得从 scope 推导」是最易违反的一条。

---

## 4. 调度逻辑（来源 N-3 + B5）

### 4.1 两道闸串联

- **闸1 路由**：`sim_max ≥ T` → template 产路 / custom 产路（决定走哪条产路）
- **闸2 审核强度**：按 `confidence` 只调制人工介入强度（auto / alternatives / must_review），**不改变产路**

> 目的是避免同一模糊点被**双重惩罚**。闸2 不许回头改产路。

### 4.2 产路地板制（N-3）

```
闸2 输出    = f(confidence)              # 闸2 对产路一无所知
最终 review = max(闸2输出, 产路地板(routing))
```

| routing | review 地板 | 闸2 调节能力 |
|---------|-------------|--------------|
| template | `auto` | 完全保留 |
| custom | `must_review` | 失效（被地板锁死） |

**组合矩阵**

| routing ＼ confidence | 低 | 中 | 高 |
|-----------------------|-----|-----|-----|
| template | must_review | alternatives | auto |
| custom | must_review | must_review | must_review |

### 4.3 动态阈值 T

```
T = clamp( 间隙锚, 约束于 配额锚分位 )
```

| 项 | 值 |
|----|-----|
| 配额锚 | 期望走库比例 **70%–90%** |
| 间隙锚 | 分数排序后的最大间隙（elbow） |
| 硬边界 | `T_min = 0.50` / `T_max = 0.80`（用户原提 50/80 降级为**边界**，不当取值） |
| 安全阀 | 整批 `sim_max` 中位数 < 0.4 → **整批转 custom + 人审**，禁止降阈值硬套库 |
| 样本少 | `N < 8` → 退化固定 `T = 0.65`；`N ≥ 8` → 用 elbow |

> 「B4 里 95% 走库」是**方针修辞**，不是阈值参数。

### 4.4 item 决策字段

`sim_max` / `confidence` / `routing: template|custom` / `review: auto|alternatives|must_review`

### 4.5 必测 5 组单测用例

1. `template × confidence 高` → `auto`
2. `template × confidence 中` → `alternatives`
3. `template × confidence 低` → `must_review`
4. `custom × 任意 confidence` → `must_review`
5. `custom × confidence = 0.99` → 仍须 `must_review`（地板锁死验证）

### 4.6 阻断门控（C2-2 / C2-4 / **M-1c**）

- **阈值**：均值 < 0.60 **或** 低置信词 > 30% **或** `alignedRatio < alignedRatioMin` → **阻断**（初值，🟡TBD 待实测校准）
- **性质**：**降级必须阻断**
- **错位检测**：只做机械校验（C2-5）

**`alignedRatioMin`（v0.5 新增，🔴 PLACEHOLDER 待实测）**

当前值 `0.8`。**⚠️ 须与 `meanConfidenceMin` 一并校准，不得分开拍** —— 二者测的是同一次
对齐的互补两面（听清了吗 / 对得上吗），分开校准必然得到一组自相矛盾的阈值。

它是 `AlignReport` 的**必填字段**（§5.1.1）同时也是**门控项**：缺它则 M-1c 的裁决无从落地。

---

## 5. 工程结构（来源 F1）

### 5.1 产物目录布局：阶段目录 / job 目录

```
jobs/<jobId>/
  00-input/       原始素材（已粗剪拼接的视频 + SRT）
  01-align/       强制对齐产物：16kHz 单声道 wav + 词级时间戳 JSON
  02-perceive/    抽帧（1.5s 可调）+ 主体/手持物/B-roll 检测 + footprint
  03-storyboard/  storyboard.json（烘焙后，fromFrame 已是绝对帧）
  04-validate/    validate-report.json（error / warning 明细）
  05-render/      Remotion 工程 + 成片 out.mp4 + 渲染日志
  06-review/      confirmed.json（谁、何时、确认了什么）
```

**三个关键设计点**

1. **每级是不可变快照** —— 下游不得回写上游文件。返修改第 3 级，第 4/5 级作废重跑
2. **禁跨级引用** —— storyboard 只能引用 01/02 的产物，不得引用 05 的成片（防环路）
3. **06-review 独立于 03** —— 人工放行信息不进 storyboard，避免污染烘焙产物

### 5.1.1 `align-report.json`（M-1c · v0.5 新增两个必填字段）

**🔴 这是 v0.5 的契约变更** —— 此前的 `align-report.json` 只记「whisper 有多自信」，
无法回答「SRT 与音频是否对得上」。两个字段都是**必填**。

```jsonc
{
  "fps": 30,
  "meanConfidence": 0.83,              // 整体均值置信度
  "lowConfidenceRatio": 0.12,          // 低置信词占比 0–1
  "gatePassed": true,                  // 门控是否通过
  "lowConfidenceWords": [17, 42],      // 低于阈值的词序号，供人工复核

  // ── 以下两个为 M-1c 新增，均必填 ──────────────────────────
  "textSource": "srt",                 // 文本权威来源：'srt' | 'whisper-asr'
  "alignedRatio": 0.94                 // SRT 词成功对上 token 的比例 0–1，同时是门控项
}
```

| 字段 | 类型 | 必填 | 语义 |
|------|------|------|------|
| `textSource` | `'srt'` \| `'whisper-asr'` | **是** | 文本权威来源，**可审计** |
| `alignedRatio` | number `0–1` | **是** | SRT 词成功对上 token 的比例，**同时是门控项** |

**为什么两个都是必填、缺一不可**

- `textSource` 缺了，一份 `words.json` **无法自证**它是 SRT 权威还是 whisper 权威 ——
  而这正是 M-1 的争点本身。**不落盘等于裁决没有被记录。**
  M-1 已裁决取 `'srt'`（B2-fix：只取 SRT 文本，时间戳从音频重新推导）；
  保留另两个取值是为将来若改判时**有历史可比**，而非鼓励使用。
- `alignedRatio` 是**新增的门控维度**，见 §4.6。

**🔴 为什么 `meanConfidence` 测不到这件事**

`meanConfidence` 衡量的是「**whisper 对自己听到的词有多自信**」，
而「SRT 与音频是否对得上」是**另一个维度**。一个 whisper **自信但与 SRT 完全不符**的场景
会**直接通过门控** —— 这违反项目 P0「未配置外部模型时直接报错退出，绝不伪造结果」的精神：
**一份对不上的 `words.json` 比一次显式失败危险得多。**

> 文件名与字段名属【实现期拟定，文档未点名】—— 文档对 `01-align/` 的规定只有
> 「16kHz 单声道 wav + 词级时间戳 JSON」两者。**但不得减少文档指定的数据内容。**

### 5.2 confirmed.json（人工放行闸的落点）

**F3 的定位是通用的人工放行闸**，不只服务对齐降级 —— 它同时承载 **D3-a 的 fullscreen 确认**。

```jsonc
{
  "jobId": "...",
  "stage": "alignment | storyboard | validate | render",
  "reason": "对齐置信度低于阈值，人工核验后放行",
  "confirmedBy": "人工署名",
  "confirmedAt": "ISO 时间",
  "acknowledgedFullscreen": ["fs-track/000"],   // D3-a：已确认的 fullscreen item ref
  "overrides": [{ "itemId": "...", "field": "fromFrame", "from": 120, "to": 135 }]
}
```

| 字段 | 承载谁 | 语义 |
|------|--------|------|
| `overrides` | C2-4 降级放行 | **改了什么**（`field`/`from`/`to`）|
| `acknowledgedFullscreen` | D3-a | **确认了哪些**（原样放行，没有「改」）|

> `acknowledgedFullscreen` 单开字段而不复用 `overrides`：确认 fullscreen 是**原样放行**，硬塞进 `overrides` 只能编一个假的 `from`/`to`。这不是新机制，是把「谁、何时、确认了**什么**」这个既定语义用完整。
> `stage` 枚举包含 `render` —— 因为 D3-a 的确认发生在 render 启动闸。

### 5.3 人工返修回路（F3）

**不建 Web 编辑器**，最小可用回路：

1. 人工改 `03-storyboard/storyboard.json`（改 fromFrame / footprint / 删 item）
2. 重跑构建期校验器 → 新 `04-validate/validate-report.json`
3. `remotion studio` 预览
4. 确认无误后写 `06-review/confirmed.json` 放行

### 5.4 渲染（F4 + E3）

- 本地 `remotion render`，**显式 `--gl=angle`**（4.0.x 必填）
- **不绑 Lambda**。先量基准：10 分钟成片墙钟时长 + CPU 峰值
- 版本锁 `remotion@4.0.534`（`--save-exact`，**禁 `^`**），Node **22.19+ / 24+**

#### 5.4.1 启动闸（D3-a 的落点）

渲染开始前必须依次通过，任一不过即**拒绝启动**：

| # | 条件 | 不过时 |
|---|------|--------|
| 1 | `04-validate/validate-report.json` 存在且 `ok === true` | 拒绝启动，回去走 F3 的人工返修回路 |
| 2 | storyboard 的 `meta.fps` 与本次渲染 fps 一致 | 停 —— 已烘焙帧号语义已漂移，必须**重新烘焙** |
| 3 | 版本锚定通过（`remotion` 与全部 `@remotion/*` 严格等于 `4.0.534`，无 `^`） | 停，先修环境 |
| 4 | **storyboard 内全部 `fullscreen` 项都已被 `06-review/confirmed.json` 的 `acknowledgedFullscreen` 覆盖** | **拒绝启动**（D3-a：不设自动放行规则）|

> 第 4 条不能在 `validate` 里做 —— 那里的输入边界只到 `03`/`01`/`02`，读不到 `06-review`（见 §2.10）。
> 这是「谁有资格拦」的问题，不是「谁愿意拦」的问题。

### 5.5 音频范围（F5）

- **范围内**：抽 16kHz 单声道 wav → 词级强制对齐（C2 / B2-fix 必需输入）
- **范围外**（明确不做）：降噪、响度归一、BGM 分离、音频可视化

---

## 6. Skill 切分（来源 §10.4）

按阶段切，**不做巨型 skill**。每个 skill 自带「必须停」条件。

| Skill | 触发时机 | 核心职责 | 必须停条件 |
|-------|----------|----------|-----------|
| `align` | 拿到视频 + SRT | 抽音轨、强制对齐、置信度门控 | **不达标必须停**（C2-2） |
| `perceive` | 对齐通过 | 抽帧、主体检测、footprint 生成 | — |
| `storyboard` | 感知完成 | 按词级锚点起草 storyboard.json | — |
| `validate` | storyboard 写完 | 跑全部构建期校验项（当前 17 项） | **有 error 必须停**（F2） |
| `render` | 校验全过 | Remotion 映射 + 渲染 | — |

**好处**：① 每个 skill 能独立重跑（返修只重跑 storyboard 之后）② 「必须停」条件独立可见

---

## 7. 待补清单

> v0.1 有 7 项待补。v0.2 已清 3 项（编号 1 / 3 / 7）；v0.4 再清 2 项（编号 2 / 6）。
> **剩余 2 项（编号 4 / 5）全部是「数值实测类」** —— 即结构层已可定稿，只差实拍素材校准。

| # | 项 | v0.2 状态 | 阻塞原因 | 处理方式 |
|---|-----|----------|----------|----------|
| 1 | 顶层字段名 / meta 字段名 | ✅ **已解决** | — | 见 §1.1 / §1.2，来源 §7.4 + 登记册 |
| 2 | item.params 具体键 | ✅ **已解决（首批）** | — | **首批 10 个模板的 `paramsSchema` 已给出**，见 [`docs/templates/2026-10-13-模板库首批清单.md`](../templates/2026-10-13-模板库首批清单.md) §2.2；必填信息由 `requiredParams` 表达（§3.2）；后续新增模板随清单增量维护 |
| 3 | 错误码命名规则 | ✅ **已解决** | — | 见 §2.5，Spec 自定（§10.3 指派） |
| 4 | 每 cue item 数阈值（校验项 2） | 🔴 **待实测** | 真源全文只写「超阈值 error」，**未给数值** | 与 C2-2 一并在实拍素材上校准 |
| 5 | C2-2 阈值初值 | 🔴 **待实测** | 已有初值 `均值 < 0.60 或 低置信词 > 30%`，未实测 | §10.5「剩余待办」第二件，Spec 落地后实测。**v0.5 起须一并校准 `alignedRatioMin`（§4.6）** |
| 6 | 模板库首批清单 | ✅ **已解决** | — | **首批 10 个模板已定**，见 [`docs/templates/2026-10-13-模板库首批清单.md`](../templates/2026-10-13-模板库首批清单.md)；已落地至 `src/templates/builtin.ts` |
| 7 | §5.3 机制决策表 | ✅ **已解决** | — | 见 **附录 A**（F7 归属 E/F） |

**真源中不存在、故不设的字段**（防止实现期凭常识添加）：素材指纹、storyboard 版本号、lang、author 元数据等。如需引入，须先回登记册新增裁决。

---

## 8. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-10-12 | v0.1 | 骨架初稿，合并 §7 四张待落地清单为 1–4 章，补工程结构 / Skill 切分 / 待补清单 |
| 2026-10-12 | **v0.2** | ① 清 TBD-1：顶层 3 字段（`meta`/`tracks`/`noMotionRanges`）由推断升格为确认，meta 字段全集锁定为 5 个；② 清 TBD-3：定义 14 项错误码全表 + 与进程级退出码的分工 + §2.9 报告契约；③ 清 TBD-7：新增附录 A「§5.3 八机制决策表」；④ 新增 §0.1 范围核对（对 §10.3）；⑤ §7 待补清单按「已解决 / 依赖后续 / 待实测」三类重标；⑥ 文件更名为 `SPEC-remotion-overlay-workflow.md`（版本号只出现在文内标题，不再进文件名） |
| 2026-10-13 | **v0.3** | 补实现期暴露的三处缺口：① 校验清单 14 → **15 项**（新增 #15 禁配段相交 `E-E5-01`，§1.4 / §2.3 / §2.5），并在 §2 开头加「活清单 + 增补须走登记册」的口径；② 新增 **§2.10** 说明 D3 为何刻意不在清单内及三条准入判据，D3 落点定为 render 启动闸（新增 **§5.4.1**），`confirmed.json` 补 `stage: render` + `acknowledgedFullscreen`（§5.2）；③ 时序校验区间下界由词起点改为 **cue 起点**（C2-5a，§1.5 / §2.2 #1），`E-C2-5-01` 的判定随之更新；④ `summary` 增加 `extra`，明确 `checked` ≠ 全部执行规则数（§2.9）；⑤ 错误码 `<source>` 取值域补 `E5` / `D3` / `F6` |
| 2026-10-13 | **v0.4** | 新增 **附录 B 术语表**（B.1 项目自身 / B.2 外部生态 / B.3 明确不收的会话元信息），落实 N-7；§7 待补清单第 6 项「模板库首批清单」状态更新为已产出 |
| 2026-10-13 | **v0.5** | 同步三条已落登记册的裁决：① 校验清单 15 → **16 项** —— 新增 #16「参数契约」（`paramsSchema` 校验，P1），新增 **§2.3.1** 参数契约类与 **§2.11** 判定口径（三条码 `E-P1-01/02/03` 全 error、不设 warning 档、固定判定顺序 `01→02→03`、`'number'` 额外要求 `Number.isFinite`、不做隐式转换、不判语义、不剔除非法 item），§2.5 错误码表补三条码且 `<source>` 取值域补 `P1`；② 模板契约扩 **`requiredParams?: string[]`**（省略 = 全部可选，刻意不改 `paramsSchema` 值类型，§3.2），`caption/karaoke-word` **摘除 `highlightColor`**、颜色改走命名令牌（§3.5）；③ **M-1 / M-1c**：M-1 裁决取方案 b（SRT 文本权威），新增 **§5.1.1** 给出 `align-report.json` 结构并补两个**必填**字段 `textSource` / `alignedRatio`，`alignedRatio` 同时是门控项、阈值 `alignedRatioMin`（🔴 PLACEHOLDER，须与 `meanConfidenceMin` 一并校准），§4.6 阻断门控同步 |

---

## 附录 A：§5.3「八个可直接抄的机制」— 采纳 / 借鉴 / 不做

> 归属：**E 采纳（Remotion 生态栈）+ F 借鉴（工程闭环）**（F7 / N-5）。
> 表体来源：进度文档 §5.3（八项）+ §5.5（根本差异：这些 skill 都是「从零做一条视频」，本项目是「在实拍上叠 overlay」；通用骨架可抄，layout / 主题 token 体系不可照搬，「不遮挡主体」必须自建）。
> 「决策」列的落点均引 E / F 已封口结论，**非新造**。

| # | 外部机制 | 决策 | 落点（本项目） | 依据 |
|---|---------|------|--------------|------|
| 1 | 模型只填表不写代码（只挑镜头 + 填文字，禁写坐标 / 帧数 / 颜色 / CSS） | **采纳** | 模型只写 `motion` + `params` + 锚点；坐标由 `footprint` 模板默认值给，帧由锚点烘焙器算 | §3.2 `paramsSchema`「模型只填表不写代码」；§1.5 作者语法层 |
| — | 同上，**落到校验层的强制手段** | **采纳（P1）** | `paramsSchema` 由「只被定义与注册」升级为**逐项校验**（校验项 #16，`E-P1-01/02/03`）；`caption/karaoke-word` 的 `highlightColor` **摘除** —— 留着它等于让模型能硬编码色值，颜色改走命名令牌 | §2.11；§3.2；登记册 P1 |
| 2 | 三档校验器 `validate.mjs`（errors 必改 / warnings 尽量改 / **human** 列出交人） | **借鉴，改造为两档 + 人工闸** | 构建期全部校验项（当前 17 项）→ `error`（阻断）/ `warning`（不阻断）；原「human」档**不进校验器**，改由 `06-review/confirmed.json` 承担 | F2 已定「两阶段，构建期为主」；F3 已定人工回路（F3 兼作通用放行闸，见 D3-a） |
| 3 | 语义化退出码（0 / 1 / 2 / 3 / 4 / 5 / 6 / 130） | **采纳** | 与项级 `E-*`/`W-*` 两套并存，不混用 | §2.5 |
| 4 | `revise.mjs` 一句话修改 + `meta.tweak` 旋钮（受限 op / 最多 3 轮 / 改前备份 / 改完先校验） | **部分借鉴** | 借鉴「改前备份 + 改完先校验」；**`meta.tweak` 旋钮不做** —— F3 已定不建编辑器，返修改 `03-storyboard/storyboard.json` 后重跑校验 | F3；§5.3 第 4 项 |
| 5 | custom 镜头围墙（文字/数字只经 slots 传入、静态检查拒硬编码、渲染前 tsc、渲染锁下运行） | **借鉴** | 对应 **custom 产路**：custom motion 必须走 `paramsSchema` + 静态检查，不得硬编码 | N-3 产路地板（custom → `must_review`）；§3.2 |
| 6 | 分段渲染 `lock.json`（改哪页渲哪页，未改复用） | **暂不做（挂起）** | F4 已定「本地整片渲染 + 先量基准」；**待基准出来、若决定上云再评** | F4；§8 盲区「渲染时长与成本预算」 |
| 7 | 确定性红线（禁 `Date.now()` / `Math.random()`；伪随机固定种子，seed 从 index 派生；helpers 有单测） | **采纳** | 直接写入 E 分支渲染约束 | E2 确定性红线 |
| 8 | 渲染后测量，不信 composition 数字 | **采纳** | F4 基准量化（10 分钟成片墙钟时长 + CPU 峰值）；渲染期兜底三类（字体未加载 / Canvas 未挂载 / GPU 上下文失败） | F4；F2 渲染期兜底 |

**明确不采纳的两类**（§5.5）

- 外部仓库的 **layout / 主题 token 体系** —— 它们是「从零生成画面」的排版体系，本项目是叠加层，坐标系与安全区语义不同
- **16 类 / 10 类 MG 分类法** —— §5.1 判定「对『在实拍上叠 overlay』基本不适用」；本项目真对标物是 Remotion 模板生态（RVE 81 模板 / 7 类）

---

## 附录 B：术语表

> **为何需要**：本项目术语大量来自外部生态（Remotion / MediaPipe / 逐帧动画语汇），
> 而真源文档曾把**会话元信息**（`grill-me` 等方法论名）混进术语表 —— 换人接手即失效。
> 本表**只收项目自身与外部生态的实义术语**，会话元信息一律不入。
> 归属：N-7（2026-10-13 关闭）。

### B.1 项目自身

| 术语 | 含义 | 首次定义处 |
|------|------|-----------|
| **overlay** | 叠加层。在已拍好的实拍画面之上叠加的 motion-graphic图层；与「从零生成画面」是两类问题 | §0.1 |
| **job** | 一次完整管线的输入 + 全部阶段产物的工作单元，落在 `jobs/<id>/` 下 | F1；§5.1 |
| **阶段快照（不可变快照）** | 每阶段产物落盘后不得被下游回写；返修须回到对应阶段并作废重跑其下游 | §5.1 |
| **锚点（anchor）** | 模型书写的**时间定位**形式，如 `word:37` + `offset:"-8f"`；由烘焙器一次性解析为帧 | C2 / C2-1；§1.5 |
| **烘焙（bake）** | 把锚点解析成 `fromFrame` + `durationInFrames` 的一次性过程。**锚点用完即弃** | C2；§1.5 |
| **exclusive组** | 声明为互斥的一组 item。同组footprint 相交 → `E-C4-01` error | C4；§2 校验项 |
| **footprint** | item 占位的归一化矩形 `[x, y, w, h]`；C4 几何判定的输入 | C4；§3.2 |
| **遮挡容忍度（区域分级 + 令牌预算）** | 遮挡预算**不是标量而是向量**：人脸 `0%` / 手持物 `≤20%` / B-roll `≤30%` | D2 |
| **载体模式（carrier）** | 作用于实拍视频本身的呈现方式（`subject-transform` / `footage-transform`）；兼作冲突时的自动退路 | D4；§3.1 |
| **双栈分离** | 载体类走**背景链串联**、其余叠加类走**叠加栈并列**；混栈会语义倒置 | C6 |
| **产路地板** | 由 `routing` 决定的 `review` 取值下限（template→auto，custom→must_review）；与闸 2 取 `max` | N-3；§4.1 |
| **安全阀** | 整批 `sim_max` 中位数 < 0.4 → 整批转 custom + 人审；**禁止降阈值硬套库** | B5；§4 |
| **动态阈值 T** | 闸 1 的路由阈值，`T = clamp(elbow, 配额锚 70–90% 分位, [0.50, 0.80])`；`N < 8` 退化为 0.65 | B5；§4 |
| **hug / 接力（handoff）** | 跨 item 的一阶关系：track 级 `handoffTo` 声明「本轨末项退场时交给此轨」，接收方以 `handoffIn` 承接 | C5；§3.3 |
| **live action** | 实拍素材本身。本项目所有 overlay 的底层画面 | §0.1 |

### B.2 外部生态

| 术语 | 含义 | 出处 |
|------|------|------|
| **workbench** | 外部案例（video-shotcraft）的工程骨架：shot 库 + 可复用组件层。本项目**借鉴其组件层**，不沿用其「从零生成」定位 | R1；附录 A |
| **ClipCard** | workbench 侧的镜头卡片数据结构。本项目**不采用**该结构，只借鉴「组件参数化」这一层| R1；附录 A |
| **lock.json** | 分段渲染的产物锁文件（改哪页渲哪页，未改复用）。本项目**暂不做**，挂起至基准出来后再评 | 附录 A 第 6 条 / F4 |
| **safe zone（安全区）** | 画面内不得被 overlay 侵占的区域，按区域类型（人脸 / 手持物 / B-roll）分级，容忍度不同 | D1 / D2 |
| **dead air** | 无有效语音的空档时段。本项目**不做检测**（音频处理范围见 F5） | F5；B.2 附注 |
| **beatF** | 外部工具的节拍帧标记概念。本项目**不引入** —— 时间定位走 C2 锚点 + 烘焙，不走节拍网格 | C2 |
| **mulberry32** | 确定性伪随机数发生器。本项目**唯一允许**的伪随机源；`Math.random()` 被确定性红线禁用 | E2 |
| **forced alignment（强制对齐）** | 拿既有 SRT **文本**当准绳、只从音频重新推导词级时间；**不信任 SRT 原时间戳** | B2-fix |
| **逐词时间戳（word-level timestamps）** | 每个词在音频上的起止时间 + 概率。C2-2 门控的输入 | C2-2 |
| **dweltime（驻留时长）** | 单个 motion 在画面上可见的帧数；下限由 `minVisibleInFrames` 保证 | C3；§3.2 |
| **tone / signal / beat** | 外部 motion-graphic 语汇中「一句话的强调点 / 信号 / 节拍」之别。本项目把选择权交给模型，用 `family` 归类而非强制三段 | B6 |

### B.3 明确**不收**的条目（会话元信息）

以下属**方法论 / 会话工具名**，不随仓库交接、不进术语表：

- `grill-me`、`drill-down`、会话轮次编号等
- 任何 `§N 第 M 次讨论` 式的过程标记 —— 决策理由归**登记册**，不进 Spec

> **纪律**：本表只收「换人接手仍需知道」的实义术语。
> 新增前自查：**这个词换个会话、换个执行者，还需要吗？** 不需要就别收。
