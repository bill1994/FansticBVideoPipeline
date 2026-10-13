# 项目进度 — Remotion 视频动效叠加管线

> 最近更新：2026-10-13
> 状态标记：✅ 完成 / 🔶 进行中 / ⛔ 明确不做 / ❌ 未做

---

## 一句话

在**已拍摄、已粗剪拼接、无任何文字与特效**的实拍口播视频上，自动叠加
motion-graphic overlay。五阶段管线骨架已跑通，**外部模型刚接入第一步**，
但距离「用户拿到就能出片」还差关键几块。

---

## 二、用户第一次出片的路径（当前状态）

这是判断项目真实进展的唯一标准 —— 不是「代码写了多少」。

| 闸 | 状态 | 说明 |
|----|------|------|
| `00-input` 放素材 | ✅ | — |
| `01-align` 强制对齐 | 🔶 | **第一步已通**（whisper.cpp 接入 + SRT 解析），第二步文本对齐 DP 未做 |
| `02-perceive` 主体检测 | ❌ | `PERCEIVER_CMD` 未配置 → 退出码 2 |
| `03-storyboard` 起草 | ❌ | 「本仓库不内置模型调用」，用户须手写 `sim_max`/`confidence` |
| `04-validate` 校验 | ✅ | **16 项**，0 error / 2 warning（demo） |
| `05-render` 渲染 | ⚠️ | 跑得通，但**产出无价值** —— 见「已知问题」第 1 条 |

**结论：六道闸过了两道、一个半，一个关键环节是空的。**

---

## 三、已完成的功能

### 3.1 管线骨架（✅）

五阶段 `align → perceive → storyboard → validate → render`，统一 CLI 入口，
阶段目录为不可变快照（下游不得回写上游）。

- **烘焙器**：锚点 `{anchor:"word:37", offset:"-8f"}` → `fromFrame` + `durationInFrames`
- **调度**：两道闸串联 + 动态阈值 T + 安全阀 + 产路地板
- **校验器**：构建期 **16 项**（纯 JSON→JSON）+ 渲染期兜底三类
- **单测**：**131 项全过**（validate 40 / params 17 / srt 22 / occlusion 10 / bake 14 / schedule 19 / align-gate 9）

### 3.2 三条硬规则的代码化

| 规则 | 实现方式 |
|------|---------|
| **帧是真相** | 模型只写锚点，帧由烘焙器算；锚点用完即弃 |
| **不让模型手算帧** | 校验项 #16 按 `paramsSchema` 校验参数，禁止自造键/ 帧 / 颜色 |
| **确定性红线** | 禁 `Date.now()` / `Math.random()`；唯一伪随机源是 `mulberry32` |

### 3.3 文档体系（✅）

| 文件 | 作用 |
|------|------|
| `docs/decisions/OPEN-DECISIONS.md` | **裁决唯一真源**，42 条 RESOLVED |
| `docs/spec/SPEC-*.md` | 实现规格 v0.5（与真源冲突时以真源为准） |
| `docs/templates/2026-10-13-模板库首批清单.md` | 首批 10 个模板 + 契约值推导依据 |
| `docs/decisions/2026-10-13-裁决材料.md` | 4 项裁决的三视角评估（架构/QA/PM） |
| `docs/changelog/` | 按日变更记录 |
| `.workbuddy/skills/` | 五阶段执行期行为契约 |

**登记册纪律**：只追加 + 就地关闭；增补校验项**须先改登记册**，
不得只在正文里加 —— 这条纪律当天就抓到过两次漏同步。

---

## 四、已知问题（🔴 按严重度排序）

### 1. ⚠️ 渲染产出无价值 —— 最要紧

`templates/` 只有 `.gitkeep`，**零模板实现**。`MotionItem.tsx:9` 自述
「渲染的是结构占位块，不是真正的动效实现」，且 `getTemplate()` 无
「模板 id → 组件」映射 ⇒ **10 个模板渲染结果完全相同**（一个灰框 + 等宽字体）。

`src/remotion/MotionItem.tsx:35` 直读 `item.params.text`，这在模板实现完成后
就是字幕注字的入口（现已由校验项 #16 的 `E-P1-01` 拦住）。

### 2. 🔴 tier2 载体退让是空操作

`occlusion.ts` 的两级退让原本都只抑制报错、不改数据（已修 tier1）。
tier2（自动切 carrier）**仍是空操作**，现在出 `W-D4-01` 诚实告警。

三个阻塞点：
- `StoryboardItem` 无处承载「已切载体、画面要缩进哪个框」
- `CARRIER_FALLBACK` 按 motion 索引，**放不下逐 item 几何**
- `split-frame` 表达不了「把这条 motion 挪出这张人脸」

**修复须先在登记册立一条承载字段的裁决。**

### 3. ⚠️ 三个占位数值从未实测

| 项 | 当前值 | 状态 |
|----|--------|------|
| 对齐门控 | 均值 < 0.60 或低置信词 > 30% → 阻断 | 🔴 待实测 |
| `alignedRatioMin` | 0.8 | 🔴 PLACEHOLDER，须与上一项**一并**校准 |
| 每 cue item 数 | 3 | 🔴 PLACEHOLDER，却直接产 error |

> **`DENSITY.maxItemsPerCue = 3` 是个未校准的占位值，却会阻断真实素材**，
> 而项目没有编辑 UI，用户只能手改 JSON。这是「过度严格」最现实的伤害点。

### 4. ⚠️ `p` 不是可信度

实测：纯音调输入下whisper 输出 `[_BEG_]`、`(`、`字`、`J` 等噪声 token，
**而 `p` 高达 0.9996**。它衡量「模型对自身解码有多自信」，
**测不到「SRT 与音频是否对得上」** —— 后者由 `alignedRatio` 负责。

### 5. ⛔ 明确不做的

| 项 | 理由 |
|----|------|
| 降噪 / 响度归一 / BGM 分离 | F5：低置信→阻断→人工已覆盖 |
| 双语字幕对齐 | 用户素材为纯中文；且 (a) 方案技术上不成立 |
| `under-subject` scope 的模板 | 依赖 perceive 主体框，模型未接入。**诚实留空优于占位** |
| `brand` / `rhythm` / `sfx` 家族 | 需品牌资产或音频节拍分析，输入未落地 |

---

## 五、后续计划（按优先级）

### 阶段 1 · 让管线真能用（最高优先）

| # | 事项 | 说明 |
|---|------|------|
| 1 | **修 tier2 载体退让** | 须先立裁决（承载字段 + 键粒度 + 新载体模板） |
| 2 | **align 第二步：文本对齐 DP** | 把 whisper 子词映射回 SRT 词，约 150 行 DP |
| 3 | **接入 perceive** | MediaPipe（几 MB 级，非「重型」）；无它则「不遮挡主体」不可执行 |
| 4 | **模板实现（最小 5 个）** | 工作量最大，但决定成片有没有价值 |
| 5 | **VLM 起草接入** | 「自动」的兑现；可与 storyboard 编辑页合并 |

### 阶段 2 · 补齐质量

| # | 事项 | 说明 |
|---|------|------|
| 6 | **C2-2 阈值实测** | 需真实素材；顺带校准 `alignedRatioMin` |
| 7 | **渲染基准量化** | **必须在模板实现之后** —— 现在量的是灰框，数字会系统性偏小且误导 |
| 8 | **复核 `DENSITY.maxItemsPerCue`** | 未校准的占位值当 error 用，伤害真实用户 |

### 阶段 3 · 可选评估

- shot 级 VLM 兜底（替代 F6 的人工兜底）—— 需先用官方文档核实模型能力
- Qwen3-ForcedAligner 等专用对齐模型 —— ⚠️ 单次上限 5 分钟，
  长视频需切片，且引入 PyTorch 栈与「可复现性」立法意图冲突

---

## 六、环境要求

| 项 | 要求 | 备注 |
|----|------|------|
| Node.js | **22.19+ / 24+** | Remotion 官方硬要求 |
| Remotion | 锁 `4.0.534`（`--save-exact`，**禁 `^`**） | 4.0.x 每 2–3 天一版，不锁必然漂移 |
| ffmpeg | `align` 阶段必需 | 抽 16kHz 单声道 wav |
| GPU 配置 | **必须显式 `--gl=angle`** | 漏了可能产出**空白 canvas** |
| whisper.cpp | `1.5.5`（首个支持 `t_dtw` 的版本） | Windows 走预编译二进制，**无需 cmake / Python** |
| 模型 | `whisper.cpp/ggml-base.bin`（148MB） | ⚠️ 走 `tools/setup-whisper.mts`，含 hf-mirror 自动降级 |

---

## 七、当前真实数字

```
校验项      16 项（构建期）+ 3 类（渲染期兜底）
错误码      25 条（E-*/W-*）
单测        131 项全过
登记册      42 条 RESOLVED，仅剩 2 条OPEN（均为「待实测数值」）
模板        10 个首批声明，0 个实现
测试文件    7 个
```

---

## 八、怎么跑

```bash
npm install

# 一次性准备 whisper（M-1 第一步）
node --experimental-strip-types tools/setup-whisper.mts

# 无需真实素材的端到端 demo
npm run pipeline -- storyboard --job demo --jobs-dir examples --draft examples/demo/03-storyboard/draft.json
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run

npm run typecheck
npm test
```

> `align` / `perceive` 未配置外部模型时**直接退出码 2**，绝不伪造结果 ——
> 一条静默产出的错误 storyboard，比一次显式失败危险得多。

---

> 本文档随代码演进更新。改动落在哪一步，就更新哪一节，不写「已完成」了事。
> 详细变更见 `docs/changelog/`，决策理由见 `docs/decisions/OPEN-DECISIONS.md`。
