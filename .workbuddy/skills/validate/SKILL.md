---
name: validate
description: >-
  Remotion motion-graphic overlay 管线的第 4 步「validate」。当 storyboard.json 写完、需要在渲染前跑构建期校验项（当前 18 项）
  并产出 validate-report.json 时使用。负责构建期校验（纯 JSON→JSON）与渲染期兜底。
  不用于对齐、感知、storyboard 起草或渲染。
agent_created: true
---

# validate —— 构建期校验与阻断门控（当前 18 项）

> **管线位置**：第 4 步 / 共 5 步
> **上游**：`03-storyboard/storyboard.json` + `01-align/` + `02-perceive/`
> **下游**：`04-validate/validate-report.json` → **有 error 则阻断，不进渲染**

## 何时触发

- `03-storyboard/storyboard.json` 写入完成后。
- 人工返修 storyboard 之后**必须重跑**本阶段，不得沿用旧报告。

## 核心职责与铁律

### 1. 两阶段分层：构建期为主，渲染期兜底

| 阶段 | 可判条件 | 覆盖 |
|------|----------|------|
| **构建期**（纯 JSON→JSON，**不渲染**） | 只读 `03-storyboard/` + `01-align/` + `02-perceive/` | **全部校验项（当前 18 项）** |
| **渲染期兜底** | 需实际渲染才暴露 | 字体未加载、Canvas 未挂载（`delayRender` 超时）、GPU 上下文创建失败 |

构建期之所以能判全：校验器读的全是**结构化数据**（footprint / minVisibleInFrames / 各区域预算占用 / 主体框 / noMotionRanges），不需要渲染。

> **清单是活清单。** 增补要**先改 `docs/decisions/OPEN-DECISIONS.md`**，不得只在这里加。
> **准入判据**（三条全中才进清单）：输入在本阶段可读 / 纯结构化判定 / 渲染前就该阻断。
> 有一条规则**刻意不在清单内** —— D3 的 fullscreen 人工确认：它的确认记录产在 `06-review`，而本阶段的输入边界只到 `03`/`01`/`02`，**读不到**。故本阶段只出 `W-D3-01` 预告，硬拦在 render 启动闸。**例外只应该有这一条。**

### 2. 校验器是纯函数

- 逐项**独立**判定，互不短路
- 同一输入必须产出**逐字节一致**的报告（可入 git diff）
- `items` 按 `level` 再按 `code` 排序
- `hint` 是给人看的修法提示，**不参与机器判定**

### 3. 优先级：安全区判定（D）优先于 exclusive 组判定（C4）

遮挡主体是**硬约束**，图形之间打架只是**设计问题**。两者结论冲突时以安全区为准。

### 4. 只做机械校验，不做语义判断

本阶段**不设 LLM 语义闸**、不做语义高亮。语义次优（「卡在『参数』上但该强调『三倍』」）属**已显式接受的风险**，交人工在编辑页扫。

### 5. 🔴 产物时序自检：报告本身要先可信（2026-10-20 新增）

进校验之前先查一件事：**下游产物是不是比上游旧？**

```
若 03-storyboard/storyboard.json 的修改时间早于 01-align/words.json
⇒ 这份 storyboard 是用**旧版** words.json 烘焙的
⇒ 本次校验的一切数字都不可信 ⇒ 抛 ConfigError（退出码 2），不出报告
```

**实测故障（`jobs/e2e-perceive`，2026-10-20 复跑时抓到）**：

| 时间 | 发生了什么 |
|---|---|
| 10-18 14:53 | `storyboard.json` 用当时那版 `words.json` 烘焙 |
| 10-18 14:54 | `validate-report.json` 校验上面那份 |
| 10-19 12:57 | 改 M-1f 后 `align --force` 重跑，`words.json` 被覆盖成新版 |
| — | **下游比上游旧 22 小时，而那份报告仍写着 `ok:true / error:0`** |

⚠️ 那份报告的 `W-C3-01` 只有 4 条，真实的值是 **14 条**（按过时的 storyboard 报）。
差 3.5 倍，且**没有任何信号说它不可信**。

🔴 **为什么现有断言兜不住**：`alignmentConfidence` 一致性断言（同在本阶段）
在该案例里**是相等的** —— M-1f 只重铺词时、不改均值置信度。实测已确认。

**与 `guardSnapshot` 的区别**（两者管的是不同维度）：

| 守卫 | 管什么 | 何时触发 |
|---|---|---|
| `assertNotWritingUpstream` | **写入方向**：04 不许回写 03 | 有写入动作时 |
| 本检查 | **时序方向**：上游更新后下游重跑了没 | 进validate 时 |

**处置**：报错信息会给出该重跑什么。本阶段**不会替你重跑** ——
阶段目录是不可变快照，是否该重跑由你判断：

```bash
npm run pipeline -- storyboard --job <id>
npm run pipeline -- validate   --job <id>
```

⚠️ **已知局限**：比的是**文件修改时间**，不是数据依赖关系。
`cp` / 解压 / `git checkout` 会改写 mtime，理论上可产生假阳性
（本项目 `jobs/*` 被 gitignore，产物不入库，实际风险可控）。
更稳的版本是「烘焙时把上游 hash 写进 `storyboard.meta` 再比对」，已登记为待办。

## 必须停条件

> **有 error 必须停，不进渲染。** 这是 F2 定下的两处硬阻断之一。

- 有任何 `level: "error"` → **阻断**，退出码 `1`
- 只有 `warning` → **放行**，warning 不阻断
- 🔴 **产物时序倒挂** → **抛 ConfigError，退出码 `2`**，不出报告（见 §5）——
   它不属于「内容不合规」，而是「**这份报告本身不可信**」，不能给它盖章

**第 16 项（参数契约）触发时必须停 —— 这三条没有「放行」这一档**

| 情形 | 为什么必须停，而不是降级放行 |
|------|--------------------------|
| `E-P1-01` 模型给 caption/karaoke-word 塞了 `text` | **最危险的一类**：字幕文本的权威来源是 SRT，而渲染层直读 `item.params.text`。模型一旦能写 `text`，字幕就有了**第二个来源** —— 与语音对不上，而**时序校验只看帧区间、任何校验项都拦不住**。修法是**改 SRT 或 `words.json`，不是改 `params`** |
| `E-P1-02` 缺必填键 | 该键没有自然默认值，渲染期只能填一个占位值 → 静默错渲。返修是补键，不是绕过 |
| `E-P1-03` 类型不符（含 `NaN` / `Infinity`） | 非有限数值在插值时产生 NaN，**污染整条画面**，且成片不报错。必须回填正确类型 |

> **不要试图「就地修一下让它过」** —— 本阶段是**只读**的校验器，不改 `03-storyboard/`。
> 正确回路是：报出 →人工改 `03-storyboard/` → **重跑本阶段**。

## 校验项全表（当前 18 项）

**时间轴类（9 项）**

| # | 校验项 | 判定 | 来源 | error | warning |
|---|--------|------|------|-------|---------|
| 1 | 时序校验：`fromFrame` 须落在 `[锚定词所在 cue 起点, 该词 endFrame]` 内 | 否则 error | C2-5 / **C2-5a** | `E-C2-5-01` | — |
| 2 | 密度校验：每 cue 的 item 数超阈值 | warning | C2-5 / **C2-5b** | `W-C2-5-02` | 占位阈值未校准，不阻断 |
| 3 | footprint 相交 · 同 `exclusive` 组 | error | C4 | `E-C4-01` | — |
| 4 | footprint 相交 · 异组 | warning | C4 | — | `W-C4-01` |
| 5 | 主从冲突（跨 scope 类） | **自动放行，不校验** | C4 | — | — |
| 6 | 最小可见时长 `durationInFrames < minVisibleInFrames` | error | C3 | `E-C3-01` | — |
| 7 | 起点恰好落在词级边界 | warning | C3 | — | `W-C3-01` |
| 8 | 跨越 `subject-transform` 裁切边界 | error | C3 | `E-C3-02` | — |
| 9 | 接力 gap > 1.5s | warning | C5 | — | `W-C5-01` |

**工程与遮挡类（6 项）**

| # | 校验项 | 判定 | 来源 | error | warning |
|---|--------|------|------|-------|---------|
| 10 | composition 尾部截断 | error（**不可省**） | C6 | `E-C6-01` | — |
| 11 | `footprintAnimates` 降级 | error → warning | C3 | `E-C3-03` | `W-C3-02` |
| 12 | 遮挡分级预算：各区域被占额度超预算 | error | D2 | `E-D2-01` | — |
| 13 | 载体自动降级（三级退让后仍冲突） | error | D4 | `E-D4-01` | — |
| 14 | B-roll 主体遮挡 > 30% 预算 | error | D2 | `E-D2-02` | — |
| **15** | **禁配段相交**：任何 motion 与 `noMotionRanges` 相交 | error | **E5** | **`E-E5-01`** | — |

**参数契约类（1 项）**

| # | 校验项 | 判定 | 来源 | error | warning |
|---|--------|------|------|-------|---------|
| **16** | **`params` 按 `paramsSchema` + `requiredParams` 校验**（三条码，见下） | error | **P1** | **`E-P1-01/02/03`** | **—（不设 warning 档）** |

**可读性类（1 项）**

| # | 校验项 | 判定 | 来源 | error | warning |
|---|--------|------|------|-------|---------|
| **17** | **文本估算宽超出 `footprint`**：按 `textMetrics`（字号 / 内边距 / 余量）估算 CJK 1.0em、拉丁 0.5em | warning，**不阻断** | **D-B** | — | **`W-DB-01`** |

**载体可见性类（1 项）**

| # | 校验项 | 判定 | 来源 | error | warning |
|---|--------|------|------|-------|---------|
| **18** | **载体变换后主体可见比**：`|safeArea ∩ visibleRegion(params)| / |safeArea| ≥ 0.5`。`visibleRegion` 认两种裁切源 —— `window`（split-frame 竖条裁切）与 `scale`（punch-in 放大裁边） | warning，**不阻断**（阈值未校准） | **D4-t2 / Q3** | — | **`W-D2-02`** |

> ⚠️ **第 18 项的判据为什么不能挂在 `footprint` 上**：载体类 `footprint` 是**视频位置**，
> 不是 overlay 位置，而裁切量由变换参数决定、**根本不体现在 footprint 上**
> （`split-frame` 的 `footprint` 恒为 `[0.5,0,0.5,1]`，但 `ratio` 从 0.3 到 0.7 画面完全不同；
> `punch-in` 的 `footprint` 恒为全屏，但 `scale=1.4` 四周确实被裁）。
> 这正是本项 **2026-10-17 上午增补 → 同日撤回 → 当晚换源重立** 的原因，
> 三段历史见 `src/validate/index.ts` 的文件头注释。

**不在 18 项内、但同样会出现在报告里**

| 项 | 判定 | 来源 | code |
|----|------|------|------|
| shot 主体未确（感知标了 `lowConfidence: true`） | warning，**不阻断** | F6 | `W-F6-01` |
| fullscreen 需人工确认 | warning，**不阻断**（硬拦在 render 启动闸） | D3 / **D3-a** | `W-D3-01` |

> 第 5 项**无错误码** —— 它不校验、直接放行，不产 report 条目。
> 第 10 项最危险：`item` 结束帧超出 `<Composition>` 时长时 Remotion **静默截断，不打日志**，成片少一截而全链路无报错。**不可省略**。
> **`summary.checked` 只数那 18 项**，不含下面两条警告 —— 它们记在 `summary.extra`。别把 `checked` 读成「全跑完了」。
> ⚠️ 第 17 项是 **warning 档**，理由是判定基于字符宽度估算而非字体度量，误报会误伤合法起草；实测校准后方可升 error。

## 关键判定细则

**C4 几何判定矩阵**

| 条件 | 判定 | 理由 |
|------|------|------|
| 相交 + 同 `exclusive` 组 | **error** | 同类抢位，只能留一个 |
| 相交 + 不同 `exclusive` 组 | **warning**，列出但不拦 | 几何相交 ≠ 视觉打架 |
| 不相交 | **通过**（即便同组） | 几何不冲突，规则不应误伤 |

`footprint` 取**全动画期最大包围盒**。
主从放行**由 `scope` 枚举自动推导**（载体类 × 叠加类跨类组合天然为主从关系），**禁止**用字符串白名单 —— 白名单会随命名空间无限膨胀，是校验黑洞。

**D2 令牌预算判定**

不判「有没有相交」，而是**算各级区域各被占了多少遮挡额度，总和超预算才报错**。

| 区域 | 预算 |
|------|------|
| 人脸 / 头肩 | 0% |
| 手持物 | ≤ 20% |
| B-roll 主体 | ≤ 30% |
| 其余区域 | 无限 |

**D 回填 C4 的约束**

| motion 类型 | footprint 约束 | 判定 |
|-------------|----------------|------|
| `overlay-safe` / `under-subject` | 须**避开**各级区域 | 超预算 → error |
| `subject-transform` / `footage-transform` | 变换后须让**主体可见比 ≥ 50%** | 低于阈值 → warning `W-D2-02`（**第 18 项**，D4-t2/P4 实装）。🔴 判据看 `visibleRegion(params)`（认 `window` 裁切与 `scale` 放大），**不看 `footprint`** —— 详见第 18 项下方说明 |
| `fullscreen` | — | **一律人工确认** → 本阶段只出 `W-D3-01`，硬拦在 render 启动闸 |

**第 13 项三级退让**：冲突 → ① 同预算内尝试挪 `footprint`（不动时间轴、不改文案）→ ② 挪不动则切 `carrier` 模式（画面缩进载体框，overlay 在框外）→ ③ 仍冲突才报错。

> **② 的载体档是「逐 item 声明」**（D4-t2，2026-10-17）：写在 storyboard item 的 `carrier` 字段上
> （`{ template, params }`），**不是**按 motion 索引的全局映射表（那张表已废除）。
> `item.carrier` **未声明** → ② 无法启动 → `E-D4-01`；已声明 → ② **已实装（P3）**：
> 校验期写入主体锚定裁切窗 `carrier.params.window`，渲染期 `split-frame` 消费它真正改变成片；
> 出 `W-D4-01`（**语义已变为「退让已生效」的记录**，码名沿用旧串以保登记册可追溯）。
> ⚠️ **施加 ≠ 成功**：若施加后仍超预算，改报 `E-D2-01`（「退路不够」），
> 与 `E-D4-01`（「退路不存在」）互斥。
> 引用合法性由**结构检查**把关：模板必须已注册且属载体类 scope，否则直接 `ConfigError` → **退出码 2**。
>
> 🔴 **`carrier` 不是模型可填字段**：它由校验期写入（或人工返修时手填）。
> 与 `_author` 同理 —— 起草稿里不要写它。

**第 16 项参数契约：三条码与判定边界**

| code | check | title |
|------|-------|-------|
| `E-P1-01` | `params-unknown-key` | params 含模板未声明的键 |
| `E-P1-02` | `params-missing-required` | params 缺必填键 |
| `E-P1-03` | `params-type-mismatch` | params 值类型与声明不符 |

**判定顺序固定 `01 → 02 → 03`** —— 未知键最能指出模型对模板的理解偏差，先报它，
同一 item 的其他问题才不会被埋掉。

四条必须照抄的边界：

1. **`'number'` 额外要求 `Number.isFinite`** —— `NaN` / `Infinity` 的 `typeof` 也是 `'number'`，
   裸 `typeof` 会放行，而它们在插值时产生 NaN，**污染整条画面**。
2. **不做隐式转换** —— `scale: "1.08"` ≠ `scale: 1.08`。把字符串悄悄转成数字等于替模型做决策。
3. **不判语义** —— `stat-card` 的 `value: "999%"` 数值可疑但结构正确，本项只验结构。
4. **不剔除非法 item** —— 本阶段是纯函数且逐项独立判定；剔除会让报告随执行顺序变化，
   并吞掉其他项的真实问题。

> **为什么三条全 error、不设 warning 档**：`W-C4-01`（几何相交）、`W-F6-01`（等人补）
> 都有正当的不拦理由 —— 前者视觉上可能没问题，后者只是提示。
> 参数写错没有这类理由：**要么崩，要么静默错渲。**

## 报告契约（`04-validate/validate-report.json`）

> `validate-report.json` 文件名由 F1 指定；下面的字段结构来自 **Spec §2.9**（Spec 自定，进度文档与登记册均未定义），可随实现调整，但**必须能表达「项级错误码 + 级别 + 定位 + 可复现排序」四件事**。

```jsonc
{
  "jobId": "2026-10-12-demo",
  "ok": false,                       // 无 error 才为 true（warning 不影响）
  "summary": { "error": 2, "warning": 3, "checked": 17, "extra": ["W-D3-01", "W-F6-01"] },
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

渲染期兜底用同结构，`stage: "render"`，`code` 前缀 `E-RT-*` / `W-RT-*`。
`summary.extra` 列出**不在 18 项内**但已执行的规则码（`W-D3-01` / `W-F6-01`）—— `checked` 与 `extra` 相加才是本次执行的全貌。

## 两套码不要混用

| | 项级错误码 | 进程级退出码 |
|---|---|---|
| 粒度 | 单条校验项 | 一次 CLI 调用 |
| 载体 | report 的 `code` 字段 | 进程 `$?` |
| 用途 | 定位「哪条规则没过、为什么」 | 定位「这一步整体是什么结局」 |

```
0 可交付 / 1 校验没过 / 2 参数错 / 3 版式✗ / 4 渲染失败 / 5 排队超时 / 6 内部错误 / 130 中断
```

有 error → 退出码必为 `1`；退出码 `1` 必伴随 ≥ 1 条 `E-*`。

## 校验不过之后：人工返修回路

**不建 Web 编辑器。** 最小可用回路：

1. 人工改 `03-storyboard/storyboard.json`（改 `fromFrame` / `footprint` / 删 item）
2. **重跑本阶段** → 新 `04-validate/validate-report.json`
3. `remotion studio` 预览
4. 若返修**引入了别的阶段的闸**，按对应闸写 `06-review/confirmed.json`：
   - 新加了 `fullscreen` item → `stage: "render"` + `acknowledgedFullscreen`（由 render 启动闸读）
   - 对齐门控本来就未过 → `stage: "alignment"`（由 storyboard 读）

> 🔴 **本阶段不读 `confirmed.json`**，也不接受「写一张放行单」来跳过 error。
> 校验器是**只读纯函数**，输入边界只到 `03` / `01` / `02` —— 它读不到 `06-review`。
> 「改完 storyboard 再写 confirmed 放行」是**错的**：`ok: true` 本身就是放行，不需要额外凭据。
>
> ⚠️ 2026-10-19 更正：此前本节的示例写 `stage: "validate"` 并称「写 confirmed.json 放行」，
> 而**没有任何代码读 `stage:"validate"` 的记录** —— 照着做会写一张没人看的凭据。
> `overrides` 同样目前**只有记录作用**（无消费者），改了什么仍应如实写，但别指望它驱动行为。

## 落盘检查清单

- [ ] 18 项**全部**已跑（`summary.checked == 18`），无早退短路
- [ ] `items` 已按 `level` → `code` 排序，输出可逐字节复现
- [ ] 有 error 时 `ok=false` 且已阻断（退出码 `1`）
- [ ] 安全区判定优先级高于 exclusive 组判定
- [ ] 第 5 项（主从冲突）未产出任何 report 条目
- [ ] 第 10 项（尾部截断）**没有**被跳过
- [ ] 第 15 项（禁配段相交）**没有**被跳过
- [ ] 第 16 项（参数契约）**没有**被跳过，`E-P1-01/02/03` 逐项跑过
- [ ] 第 17 项（文本溢出）**没有**被跳过（它是 warning 档，但必须出现在 `checked` 的 18 项里）
- [ ] 每个 item 的 `params` 键都对照过 `paramsSchema`；必填键对照过 `requiredParams`
- [ ] 非有限数值（`NaN` / `Infinity`）未被 `'number'` 声明放行
- [ ] `summary.extra` 已列出 `W-D3-01` / `W-F6-01`，未被误当成 `checked` 的一部分
- [ ] 未做任何语义判断 / LLM 调用
- [ ] 未修改 `03-storyboard/` 或任何上游产物（校验器只读）
