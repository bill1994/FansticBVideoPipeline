# Remotion 视频动效工作流 — Spec（v0.1 骨架）

> 状态：**骨架草案 / 未定稿**
> 生成日期：2026-10-12
> 依据：乐享《Remotion 视频动效工作流 — 进度总结（2026-10-12）》§7 / §10.3 + 各分支封口结论
> **配套真源**：`docs/decisions/OPEN-DECISIONS.md`（本文件与登记册冲突时，**以登记册为准**）

---

## 0. 本文件的定位

| 产物 | 读者 | 回答的问题 | 状态 |
|------|------|-----------|------|
| 登记册 `OPEN-DECISIONS.md` | 自己 / 未来的我 | 为什么这么定？否决了什么？ | 已成型（40+ 条） |
| **Spec（本文）** | 实现者（人或模型） | 照着做：字段是什么、校验怎么判、目录怎么建 | **v0.1 骨架** |
| Skill | 模型（执行时读） | 做这一步该遵守什么、何时必须停 | 未生成 |

**使用约束**：本 Spec 只描述「照着做」的内容，不承担追溯职责。任何**带 `🟡TBD` 标记**的条目 = 进度文档未给出字段级细节、需回登记册核对后补全，**不得凭常识填**。

---

## 1. 数据契约（来源 B6 + C6）

### 1.1 顶层结构

```jsonc
{
  "meta": { },              // 🟡TBD 命名待与登记册核对
  "tracks": [ ],            // 见 1.3
  "noMotionRanges": [ ]     // 见 1.4
}
```

> 🟡TBD：进度文档 §10.3 只说「顶层 3 字段」，未点名。上表为**结构推断**（meta / tracks / noMotionRanges），需回登记册确认字段名。

### 1.2 meta（顶层元数据）

来源：§7.4「顶层元数据与调度逻辑」。

| 字段 | 类型 | 取值 | 来源 | 说明 |
|------|------|------|------|------|
| `fps` | number | 整数 | C6 | **顶层固化**。改 fps 会让已烘焙帧号语义漂移 → 必须重新烘焙 |
| `anchorMode` | enum | `word` \| `cue` | C2-1 | 书写粒度，**默认 `word`** |
| `alignmentConfidence` | number | 0–1 | C2-2 | 强制对齐的整体置信度 |
| `confirmedBy` | string | 人工署名 | C2-4 | 审计链；**实际落盘在 `06-review/confirmed.json`，此处仅关联** |
| 🟡TBD | — | — | — | jobId / 素材指纹 / 版本等是否入 meta，待核对 |

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
- 校验期：任何 motion 与禁配段相交 → **error**
- **不需要**外部素材契约、media 字段、alpha 通道处理、fps 对齐

### 1.5 时间坐标规则（C2）

- **真相层 = 帧**：最终落盘 `fromFrame` + `durationInFrames`
- **作者语法层 = 锚点 + 帧偏移**：模型写 `{anchor:"word:37", offset:"-8f"}`，**不让模型手算帧**
- **一次性烘焙**：resolver 生成时解析锚点 → 帧，锚点用完即弃
- **不设 guard 文本快照**
- 编辑页**双显示**：`帧 372｜ = word:37 −8f`
- `abs`（绝对帧/秒）作为手写逃生口

---

## 2. 校验规格（来源 F2 · 构建期为主 + 渲染期兜底）

### 2.1 分层

| 阶段 | 可判条件 | 覆盖 |
|------|----------|------|
| **构建期**（纯 JSON→JSON，不渲染） | 只读 `03-storyboard/` + `01-align/` + `02-perceive/` | **14 项全部** |
| **渲染期兜底** | 需实际渲染才暴露 | 字体未加载、Canvas 未挂载（delayRender 超时）、GPU 上下文创建失败 |

- 校验器是**纯函数**，逐项独立判定，产出 `04-validate/validate-report.json`（error / warning 分组）
- **有 error 则阻断，不进渲染**
- **优先级**：安全区判定（D）**优先于** exclusive 组判定（C4）

### 2.2 时间轴类（9 项）

| # | 校验项 | 判定 | 来源 |
|---|--------|------|------|
| 1 | 时序校验：帧须落在目标词区间 | 否则 error | C2-5 |
| 2 | 密度校验：每 cue item 数超阈值 | error | C2-5 |
| 3 | footprint 同组相交 | error | C4 |
| 4 | footprint 异组相交 | warning | C4 |
| 5 | 主从冲突 | **自动放行**（由 scope 枚举推导，非白名单） | C4 |
| 6 | 最小可见时长不足 | error | C3 |
| 7 | 落在词级边界 | warning | C3 |
| 8 | 跨越 subject-transform 裁切边界 | error | C3 |
| 9 | 接力 gap > 1.5s | warning | C5 |

### 2.3 工程与遮挡类（5 项）

| # | 校验项 | 判定 | 来源 |
|---|--------|------|------|
| 10 | composition 尾部截断 | error（**不可省**） | C6 |
| 11 | footprintAnimates 降级 | error → warning | C3 |
| 12 | 遮挡分级预算超预算 | error | D2 |
| 13 | 载体自动降级（三级退让） | 见 §4.2 | D4 |
| 14 | B-roll 主体遮挡 | ≤30% 预算 | D2 |

### 2.4 C4 几何判定矩阵

| 条件 | 判定 | 理由 |
|------|------|------|
| 相交 + 同 exclusive 组 | **error** | 同类抢位 |
| 相交 + 不同 exclusive 组 | **warning** 不拦 | 几何相交 ≠ 视觉打架 |
| 不相交 | **通过**（即便同组） | 规则不应误伤 |

> footprint 取**全动画期最大包围盒**；声明 `footprintAnimates:true` 时相交检测由 error 降为 warning。

### 2.5 错误码约定

🟡TBD —— 进度文档要求 Spec 定义「失败错误码」，但**未给命名规则**。建议方案（待裁决）：

```
E-<source>-<nn>   error   例：E-C4-01（同组 footprint 相交）
W-<source>-<nn>   warning 例：W-C5-01（接力 gap > 1.5s）
```
`<source>` 取决策编号（C2-5 / C3 / C4 / C5 / C6 / D2 / D4）。

> 参照 §5.3 语义化退出码（0 可交付 / 1 校验没过 / 2 参数错 / 3 版式✗ / 4 渲染失败 / 5 排队超时 / 6 内部错误 / 130 中断）—— 进程级退出码与项级错误码**两套并存，不混用**。

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
| `paramsSchema` | object | 参数契约，**模型只填表不写代码** |
| `status` | enum | `core` \| `experimental` \| `custom` |
| `footprint` | `[x,y,w,h]` | 默认占位矩形，item 可覆盖 |
| `minVisibleInFrames` | integer | 该 motion 的最小可见时长 |
| `handoffIn` | object | 模板参数：如何承接入场 |

### 3.3 待落地新增 4 项（进 Spec 的模板契约）

1. `footprint` —— 归一化矩形，模板默认值，item 可覆盖
2. `minVisibleInFrames` —— 最小可见时长
3. `handoffTo` —— **track 级**字段，声明接力目标
4. `handoffIn` —— **模板参数**，声明如何承接入场

### 3.4 命名与版本

- 命名空间 `family/subtype@version`（如 `typography/lower-third@1.2`）
- **版本锁定** → 升级不破坏旧 storyboard

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

### 4.6 阻断门控（C2-2 / C2-4）

- **阈值**：均值 < 0.60 **或** 低置信词 > 30% → **阻断**（初值，🟡TBD 待实测校准）
- **性质**：**降级必须阻断**
- **错位检测**：只做机械校验（C2-5）

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

### 5.2 confirmed.json（C2-4 审计链落点）

```jsonc
{
  "jobId": "...",
  "stage": "alignment | storyboard | validate",
  "reason": "对齐置信度低于阈值，人工核验后放行",
  "confirmedBy": "人工署名",
  "confirmedAt": "ISO 时间",
  "overrides": [{ "itemId": "...", "field": "fromFrame", "from": 120, "to": 135 }]
}
```

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
| `validate` | storyboard 写完 | 跑 14 项校验 | **有 error 必须停**（F2） |
| `render` | 校验全过 | Remotion 映射 + 渲染 | — |

**好处**：① 每个 skill 能独立重跑（返修只重跑 storyboard 之后）② 「必须停」条件独立可见

---

## 7. 待补清单（Spec 定稿前必须清空）

| # | 项 | 阻塞原因 | 处理方式 |
|---|-----|----------|----------|
| 1 | meta 字段名（3 个） | 进度文档未点名 | 回 `OPEN-DECISIONS.md` 核对 |
| 2 | item.params 具体键 | 依赖模板落地 | 模板库首批模板确定后回填 |
| 3 | 错误码命名规则 | 文档未定义 | **待裁决**（本文 §2.5 为提案） |
| 4 | 每 cue item 数阈值（校验项 2） | 未给数值 | 待实测 / 待裁决 |
| 5 | C2-2 阈值初值 | 已有初值（0.60 / 30%）未实测 | Spec 落地后实测校准 |
| 6 | 模板库首批清单 | 未启动 | 实现期第一件事 |
| 7 | §5.3 机制「采纳/借鉴/不做」决策表 | 归属 E/F，随 Spec 并入 | 补入本文附录 |

---

## 8. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-10-12 | v0.1 | 骨架初稿，合并 §7 四张待落地清单为 1–4 章，补工程结构 / Skill 切分 / 待补清单 |
