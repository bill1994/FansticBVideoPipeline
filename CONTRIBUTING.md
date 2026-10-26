# 协作者上手指南

> 最近更新：2026-10-23
> 面向：**接手本项目继续开发**的人（人或 AI）
> 真源优先级：`docs/decisions/OPEN-DECISIONS.md` > `PROGRESS.md` > 其他

---

## 1. 先跑起来（3 分钟）

```bash
npm install
npm run typecheck      # 应零错误
npm test               # 应 845 项全过（56 文件）

# 无需真实素材的端到端 demo
npm run pipeline -- storyboard --job demo --jobs-dir examples
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run
```

✅ **`align` / `perceive` 都有内置后端（whisper.cpp / YuNet），不配外部命令也能跑**；
外部 `ALIGNER_CMD` / `PERCEIVER_CMD` 只是可选覆盖。内置后端缺依赖（whisper 二进制/模型、
ONNX 模型）时**显式报错**，绝不伪造结果。详见 §4「三条不可违背的红线」。

---

## 2. 五分钟理解架构

```
00-input → 01-align → 02-perceive → 03-storyboard → 04-validate → 05-render
                            ↑                            ↓
                      ✅ 有内置后端            纯 JSON→JSON，18 项
```

**核心心智模型：帧是真相。**
模型（人或 AI）只写**锚点**（如 `word:37`），帧号由烘焙器算出来。
模型永不手算帧、永不写颜色/坐标/CSS。

| 目录 | 职责 | 关键文件 |
|---|---|---|
| `src/core/` | 类型契约、调度、烘焙、IO | `bake.ts`（锚点→帧）、`types.ts` |
| `src/validate/` | **18 项**构建期校验（纯函数） | `geometry.ts`（#18 载体可见比，P4 最新） |
| `src/templates/` | 11 个模板的**声明**（非实现） | `builtin.ts` |
| `src/remotion/` | 渲染层 | `templates/`（**11 个真实实现**）、`tokens.ts`、`carrier.tsx`（背景链分段包裹）、`core/carrier-window.ts`（载体窗口几何真源） |
| `.workbuddy/skills/` | 五阶段执行期行为契约 | `perceive/SKILL.md` 等 |

---

## 3. 🔴 接手前必读：三条容易踩的坑

### 坑1 · 契约层与实现层是两套东西，别混

`src/templates/builtin.ts` 里 11 个模板的**声明**全在位，
`src/remotion/templates/` 里**11 个全部有真实实现**（2026-10-24 补齐 `annotation/pointer-callout` / `transition/whip-pan`）。
未实现的仍会落占位块（黄色斜纹 + `data-template-missing="1"`），这条降级路径由单测守护。

⚠️ **别把「声明齐全」误读为「实现齐全」** —— 这正是 2026-10-15
之前「渲染结果全是灰框」长达数日的根因。

### 坑 2 · 字体/字号等「实现细节」在契约里只有一个真源

字号**原本硬编码在组件里**，导致校验器 #17（文本溢出）拿不到。
现已收进 `TemplateDeclaration.textMetrics`。
⚠️ **改组件字号时必须同步改 `builtin.ts` 的 `textMetrics`**，
否则溢出判定静默失准、报告照样全绿。

已加测试「契约字号 == 组件字号」防漂移，但**新增模板时要主动声明**。

### 坑 3 · 「定义了」不等于「被用了」

2026-10-15 一天内撞见**三例**同款病：

| 字段 | 症状 | 处置 |
|---|---|---|
| `occludesSubject` | 文档说它参与 error 判定，代码没人读 | 补实现 |
| `handoffIn` | 与 `paramsSchema.enter` 语义重复 | 删除字段 |
| `DUR.exit` | 令牌定义了，只有 1 个模板在用 | 补齐 5 个模板的出场 |

⇒ **新增任何字段 / 令牌 / 配置项后，立刻问一句：「谁读它？」**
答不上来就是同款病。

---

## 4. 三条不可违背的红线

### ① 确定性（E2）
动画推进权必须属于 frame：全树**只有** `MotionItem` 一处调 `useCurrentFrame()`，
子组件只收 `frame` prop。
禁 `Date.now()` / `Math.random()` / CSS animation / transition。

### ② 测量失败就显式报错，绝不伪造结果
`align` / `perceive` 的**内置后端**（whisper.cpp / YuNet）缺依赖时显式失败；
外部命令不可用也走显式失败。**不配外部命令 ≠ 失败**（内置后端会接管）。
**一条静默产出的错误 storyboard，比一次显式失败危险得多。**

### ③ 增补校验项**须先改登记册**
不得只在代码里加。纪律存在的原因：**当天就抓到过两次漏同步**。
新增错误码要同时进 `src/core/errors.ts` 的 `CODES`。

---

## 5. 当前状态与待办

### 今日（2026-10-15）完成
| 项 | 内容 |
|---|---|
| 模板实现 | **0 → 5 个**（`overlay-safe`），映射表建立（原病根） |
| 字幕通道 | `01-align/words.json` → 渲染 props（此前渲染期无人读它） |
| 契约字段审计 | `occludesSubject` 补实现；`handoffIn` 删除 |
| 第二轮打磨 | 缓动曲线（expo-out / cubic-in）+ 参数手感表 |
| 校验项 #17 | 文本溢出（warning 档） |

### ✅ 已裁决（2026-10-16 前全部落定；实施状态见右列）

| 编号 | 议题 | 裁决 | 实施 |
|---|---|---|---|
| **D-A** | 新增「会遮挡主体的叠加模板」 | A1（居中大字） | ✅ 已实现：`typography/center-emphasis@1.0`（首批唯一遮挡型） |
| **D-B2** | 逐模板文本度量表 | C（批量真渲实测） | ✅ 已实现（2026-10-24）：`tools/measure-text-metrics.mts` + 实测表 + 契约回填 |
| **M-2** | perceive 运行时 | (b) 全 Node | ✅ 已实现（2026-10-17 内置 YuNet 后端；`PERCEIVER_CMD` 仍可外部覆盖） |
| **M-4** | VLM 替代检测 | 不接受（保留测量） | — |

⚠️ **D-A 的背景**：此前 **10 个模板无一能触发遮挡判定**（声明 `occludesSubject: true` 的 3 个全是载体类/fullscreen，被 scope 规则排除）。
`center-emphasis` 落地后该依赖解除（测试夹具保留用于无关链路）。完整材料见
`docs/proposals/2026-10-15-DA与DB裁决材料.md`。

⚠️ **D-B2 的实测更正（2026-10-24）**：CJK 1.0em 是对的；数字系数被旧默认 0.5em
**低估约 33%**（6 个模板实测 0.615–0.667，已回填 `latinWidthEm`）。
旧「`tag-float` 16 字撑破 / `stat-card` 9 位溢出画面」在**声明 footprint** 下不可复现。
证据：`docs/templates/2026-10-24-文本度量实测表.md`。

### ⬜ 其他待办
- ~~批次 2 模板~~：✅ **已实现**（2026-10-15）：`cinematic/punch-in`（首个背景链实现，
  包裹视频的机制见 `src/remotion/carrier.tsx`）+ `ambience/noise-grain`（首个 fullscreen 实现）
- ~~perceive 接入~~：✅ **已实现**（2026-10-17）：内置后端 ffmpeg `scdet` 镜头切分 + YuNet 人脸
  → 人脸框外扩（handheld）→ 无脸镜头显著性（broll）三通道；未配 `PERCEIVER_CMD` 也能跑，配了走外部覆盖
- ~~D7 环境可移植~~：✅ **已修**（2026-10-15）：whisper 目录改「仓库根相对解析」
  （`resolveWhisperCppRoot()`，`WHISPER_CPP_PATH` 可覆盖）；`src/` 零盘符路径有单测兜底

---

## 6. 文档地图（按需要查，别通读）

| 你想知道 | 去哪 |
|---|---|
| 某条决策**为什么**这么定 | `docs/decisions/OPEN-DECISIONS.md`（唯一真源） |
| 项目整体进度与真实数字 | `PROGRESS.md` |
| 参数调到多少、什么手感 | `docs/templates/2026-10-15-参数手感表.md` |
| 模板该怎么起草 | `.workbuddy/skills/storyboard/SKILL.md` |
| 某次改动做了什么 | `docs/changelog/` |
| 待裁决议题的方案对比 | `docs/proposals/` |

⚠️ **`OPEN-DECISIONS.md` 与 Spec 冲突时，以登记册为准。**

---

## 7. 提交规范

- 仓库用 **noreply 身份**（`29155565+bill1994@users.noreply.github.com`），别改成私人邮箱
- 中文 commit 信息，格式：`<type>(<scope>): <摘要>`
  例：`feat(remotion): 首批 5 个模板真实实现`
- 改动若涉及**契约 / 校验项 / 阈值**，commit 里注明是否已回写登记册

---

## 8. 一句话提醒

⚠️ **本仓库是 PUBLIC 的。** `docs/proposals/` 与 `.workbuddy/memory/`
都会随仓库公开 —— 写这两处时按「会被公开」的标准写。