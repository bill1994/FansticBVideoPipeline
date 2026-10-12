---
name: validate
description: >-
  Remotion motion-graphic overlay 管线的第 4 步「validate」。当 storyboard.json 写完、需要在渲染前跑 14 项结构化校验
  并产出 validate-report.json 时使用。负责构建期校验（纯 JSON→JSON）与渲染期兜底。
  不用于对齐、感知、storyboard 起草或渲染。
agent_created: true
---

# validate —— 14 项校验与阻断门控

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
| **构建期**（纯 JSON→JSON，**不渲染**） | 只读 `03-storyboard/` + `01-align/` + `02-perceive/` | **14 项全部** |
| **渲染期兜底** | 需实际渲染才暴露 | 字体未加载、Canvas 未挂载（`delayRender` 超时）、GPU 上下文创建失败 |

构建期之所以能判全 14 项：校验器读的全是**结构化数据**（footprint / minVisibleInFrames / 各区域预算占用 / 主体框），不需要渲染。

### 2. 校验器是纯函数

- 逐项**独立**判定，互不短路
- 同一输入必须产出**逐字节一致**的报告（可入 git diff）
- `items` 按 `level` 再按 `code` 排序
- `hint` 是给人看的修法提示，**不参与机器判定**

### 3. 优先级：安全区判定（D）优先于 exclusive 组判定（C4）

遮挡主体是**硬约束**，图形之间打架只是**设计问题**。两者结论冲突时以安全区为准。

### 4. 只做机械校验，不做语义判断

本阶段**不设 LLM 语义闸**、不做语义高亮。语义次优（「卡在『参数』上但该强调『三倍』」）属**已显式接受的风险**，交人工在编辑页扫。

## 必须停条件

> **有 error 必须停，不进渲染。** 这是 F2 定下的两处硬阻断之一。

- 有任何 `level: "error"` → **阻断**，退出码 `1`
- 只有 `warning` → **放行**，warning 不阻断

## 14 项校验全表

**时间轴类（9 项）**

| # | 校验项 | 判定 | 来源 | error | warning |
|---|--------|------|------|-------|---------|
| 1 | 时序校验：`fromFrame` 须落在目标词区间内 | 否则 error | C2-5 | `E-C2-5-01` | — |
| 2 | 密度校验：每 cue 的 item 数超阈值 | error | C2-5 | `E-C2-5-02` | — |
| 3 | footprint 相交 · 同 `exclusive` 组 | error | C4 | `E-C4-01` | — |
| 4 | footprint 相交 · 异组 | warning | C4 | — | `W-C4-01` |
| 5 | 主从冲突（跨 scope 类） | **自动放行，不校验** | C4 | — | — |
| 6 | 最小可见时长 `durationInFrames < minVisibleInFrames` | error | C3 | `E-C3-01` | — |
| 7 | 起点恰好落在词级边界 | warning | C3 | — | `W-C3-01` |
| 8 | 跨越 `subject-transform` 裁切边界 | error | C3 | `E-C3-02` | — |
| 9 | 接力 gap > 1.5s | warning | C5 | — | `W-C5-01` |

**工程与遮挡类（5 项）**

| # | 校验项 | 判定 | 来源 | error | warning |
|---|--------|------|------|-------|---------|
| 10 | composition 尾部截断 | error（**不可省**） | C6 | `E-C6-01` | — |
| 11 | `footprintAnimates` 降级 | error → warning | C3 | `E-C3-03` | `W-C3-02` |
| 12 | 遮挡分级预算：各区域被占额度超预算 | error | D2 | `E-D2-01` | — |
| 13 | 载体自动降级（三级退让后仍冲突） | error | D4 | `E-D4-01` | — |
| 14 | B-roll 主体遮挡 > 30% 预算 | error | D2 | `E-D2-02` | — |

**兜底告警**

| 项 | 判定 | 来源 | code |
|----|------|------|------|
| shot 主体未确（感知标了 `lowConfidence: true`） | warning，**不阻断** | F6 | `W-F6-01` |

> 第 5 项**无错误码** —— 它不校验、直接放行，不产 report 条目。
> 第 10 项最危险：`item` 结束帧超出 `<Composition>` 时长时 Remotion **静默截断，不打日志**，成片少一截而全链路无报错。**不可省略**。

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
| `subject-transform` / `footage-transform` | 须**包住**安全区 | 未包住 → warning |
| `fullscreen` | — | **一律人工确认** |

**第 13 项三级退让**：冲突 → ① 同预算内尝试挪 `footprint`（不动时间轴、不改文案）→ ② 挪不动则自动切 `carrier` 模式 → ③ 仍冲突才报错。

## 报告契约（`04-validate/validate-report.json`）

> `validate-report.json` 文件名由 F1 指定；下面的字段结构来自 **Spec §2.9**（Spec 自定，进度文档与登记册均未定义），可随实现调整，但**必须能表达「项级错误码 + 级别 + 定位 + 可复现排序」四件事**。

```jsonc
{
  "jobId": "2026-10-12-demo",
  "ok": false,                       // 无 error 才为 true（warning 不影响）
  "summary": { "error": 2, "warning": 3, "checked": 14 },
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
4. 确认无误后写 `06-review/confirmed.json` 放行

```jsonc
{
  "jobId": "...",
  "stage": "validate",
  "reason": "人工核验后放行",
  "confirmedBy": "人工署名",
  "confirmedAt": "ISO 时间",
  "overrides": [{ "itemId": "...", "field": "fromFrame", "from": 120, "to": 135 }]
}
```

这就是「降级必须阻断」的闭环：**阻断 → 人工改 → 重校验 → 写 confirmed.json 放行 → 进渲染**。
`overrides` 记录改了什么，审计链不断。**放行信息不得写进 storyboard** —— 那会污染烘焙产物。

## 落盘检查清单

- [ ] 14 项**全部**已跑（`summary.checked == 14`），无早退短路
- [ ] `items` 已按 `level` → `code` 排序，输出可逐字节复现
- [ ] 有 error 时 `ok=false` 且已阻断（退出码 `1`）
- [ ] 安全区判定优先级高于 exclusive 组判定
- [ ] 第 5 项（主从冲突）未产出任何 report 条目
- [ ] 第 10 项（尾部截断）**没有**被跳过
- [ ] 未做任何语义判断 / LLM 调用
- [ ] 未修改 `03-storyboard/` 或任何上游产物（校验器只读）
