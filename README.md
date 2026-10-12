# Remotion Overlay Pipeline

在**已拍摄、已粗剪拼接、无任何文字与特效**的实拍视频上，自动叠加 motion-graphic overlay。

输入一段口播视频 + 一份 SRT，输出一个可运行的 Remotion 工程与成片。

---

## 它解决什么问题

主流 motion-graphic 工具都是「从零做一条视频」（纯图形 / 截图 / AI 画面）。
本项目是**「在实拍上叠 overlay」** —— 坐标体系、安全区语义、遮挡规则全都不一样。
三件必须自己解决的事：

1. **不遮挡主体** —— 动效出现时不得压住 presenter 的脸。
   遮挡容忍度不是标量而是**向量**：人脸 0%、手持物 ≤20%、B-roll 主体 ≤30%。
2. **可对主体 scale / crop 并置入 graphic 载体** —— 且这个载体模式兼作冲突时的自动退路。
3. **动画可持续交叉** —— 多轨并行、一段 motion 覆盖多段话，**时间重叠是常态而非异常**。

---

## 管线五阶段

```
00-input ──► 01-align ──► 02-perceive ──► 03-storyboard ──► 04-validate ──► 05-render ──► 06-review
  素材       强制对齐        感知与安全区      storyboard 起草      14 项校验       渲染出片      人工放行
             ↑ 门控                                ↑ 烘焙锚点→帧      ↑ 有 error 停
```

每一级都是**不可变快照**：下游不得回写上游。返修改第 3 级，第 4/5 级作废重跑。

| 阶段 | 做什么 | 必须停 |
|------|--------|--------|
| `align` | 抽 16kHz 单声道 wav → 强制对齐 → 置信度门控 | **门控不达标必须停**，降级必须阻断 |
| `perceive` | 抽帧、主体检测、安全区与区域预算基线 | 无硬阻断（低置信走告警 + 人工兜底） |
| `storyboard` | 按**词级锚点**起草并烘焙 `storyboard.json` | 安全阀 / fullscreen / custom 不许绕地板 |
| `validate` | 跑 14 项构建期校验（纯 JSON→JSON） | **有 error 必须停**，不进渲染 |
| `render` | C6 双栈映射 + 本地渲染 | 校验未过 / fps 漂移 / 版本未锁 → 拒绝启动 |

每阶段的详细行为契约见 [`.workbuddy/skills/`](.workbuddy/skills/) —— 那是**执行期读**的精简版，
只保留「做什么、怎么调、什么情况必须停」。

---

## 快速开始

```bash
# 需要 Node.js 22.19+ / 24+
npm install

# 1. 建一个 job
npm run pipeline -- init --job my-first

# 2. 把视频 + SRT 放进 jobs/my-first/00-input/，填好 source.json
#    然后按序跑：
npm run pipeline -- align      --job my-first
npm run pipeline -- perceive   --job my-first
npm run pipeline -- storyboard --job my-first --draft path/to/draft.json
npm run pipeline -- validate   --job my-first
npm run pipeline -- render     --job my-first

# 预览（Remotion Studio）
npm run studio
```

### 端到端跑通仓库自带的示例

`examples/demo` 是一个**不需要真实素材**的完整 job（fixture 已备好），用来验证管线本身：

```bash
npm install

npm run pipeline -- storyboard --job demo --jobs-dir examples --draft examples/demo/03-storyboard/draft.json
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run
```

预期结果：`validate` 报 **0 error / 2 warning** 并写出 `examples/demo/04-validate/validate-report.json`；
那两条 warning 都是 `W-F6-01`（示例里 s2 镜头与其人脸区被故意标成低置信，用来演示 F6 的人工兜底通道）。

其他命令：

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest：N-3 五组单测 + 烘焙 + 14 项校验
npm run render:video  # 直接调 remotion render（已内置 --gl=angle）
```

---

## 目录结构

```
.
├── src/
│   ├── cli.ts                统一入口（五阶段 + init）
│   ├── core/                 类型契约、错误码、报告、调度、烘焙、IO
│   │   ├── types.ts          storyboard.json / 各阶段产物 的数据契约
│   │   ├── errors.ts         项级错误码表（E-*/W-*）
│   │   ├── exit-code.ts      进程级语义化退出码（与项级码两套并存，不混用）
│   │   ├── schedule.ts       两道闸 + 产路地板 + 动态阈值 T
│   │   ├── bake.ts           锚点 → 帧的一次性烘焙
│   │   └── io.ts             job 目录 + 不可变快照守卫
│   ├── validate/             14 项构建期校验（纯函数）
│   ├── templates/            模板契约（双轴 family × scope）与注册表
│   ├── stages/               五个阶段的执行逻辑
│   └── remotion/             Remotion 工程（C6 双栈映射）
├── tests/                    vitest
├── examples/demo/            可端到端跑通的示例 job
├── templates/                模板库（实现期扩展）
├── docs/
│   ├── spec/                 SPEC —— 实现规格
│   ├── decisions/            OPEN-DECISIONS —— 裁决唯一真源
│   ├── reviews/              审核报告（历史档）
│   └── changelog/            变更记录
├── jobs/                     逐任务工作区（不入库）
└── .workbuddy/skills/        五阶段 Skill（执行期行为契约）
```

---

## 环境要求

| 项 | 要求 | 说明 |
|----|------|------|
| Node.js | **22.19+ / 24+** | Remotion 官方硬要求 |
| ffmpeg | `align` 阶段需要 | 抽 16kHz 单声道 wav |
| Remotion | 锁 `4.0.534`（`--save-exact`，**禁 `^`**） | 4.0.x 每 2–3 天一版，不锁必然漂移；官方扩展包必须与主包严格同版本 |
| GPU 配置 | **必须显式 `--gl=angle`** | 4.0.x 必填，漏了 Chrome Headless Shell 可能产出**空白 canvas** |

> 当前**不存在** 5.x 版本线。`remotion` 与全部 `@remotion/*` 必须是同一精确版本，
> 这条在 `render` 阶段启动时会自检（`assertVersionPinned`）。

---

## 外部工具适配

`align` 与 `perceive` 需要重型模型（ASR 对齐、人体/关键点/显著性检测）。
本仓库**不内置**这些模型 —— 它们的体积与许可需要单独决策，故只定义**输入输出契约**，
通过环境变量接入：

```bash
# 强制对齐：把 {fps, words: WordTimestamp[], cues: Cue[]} 写到 {out}
export ALIGNER_CMD="python tools/align.py --wav {wav} --srt {srt} --out {out} --fps {fps}"

# 感知：写出 {out_dir}/shots.json 与 {out_dir}/regions.json
export PERCEIVER_CMD="python tools/perceive.py --video {video} --frames {frames_dir} --out {out_dir} --fps {fps} --interval {interval}"
```

未配置时**直接报错退出（退出码 2）**，绝不伪造对齐或检测结果 ——
一条静默产出的错误 storyboard，比一次显式失败危险得多。

---

## 几条硬规则（写在代码里，不是写在文档里）

- **帧是真相。** 落盘只有 `fromFrame` + `durationInFrames`；模型写的是锚点
  `{anchor:"word:37", offset:"+2f"}`，由烘焙器一次性解析成帧，**锚点用完即弃**。
- **不手算帧。** 模型只填表不写代码：只挑模板 + 填文字，禁写坐标/帧数/颜色/CSS。
- **禁用 `<Series>`。** 它的语义是「依次播放」，**结构上无法表达重叠**，与硬约束 3 直接冲突。
- **禁用显式 `z-index`。** z 序由 `(layer 升序, trackIndex 升序)` + DOM 嵌套决定。
  `transform` 会创建新的层叠上下文，「设了 999 却失效」极难排查。
- **载体类与叠加类必须分栈。** `subject-transform`/`footage-transform` 作用于视频本身，
  走背景链**串联**；其余四类走叠加栈**并列**。混栈会语义倒置。
- **动画推进权必须属于 frame。** 禁 `Date.now()` / `performance.now()` / `Math.random()`
  （用 `mulberry32`，seed 从 item index 派生）/ CSS animation / R3F `useFrame()` / 非 paused 的 GSAP ticker。
  > CSS animation 这条是**本项目的 house rule，不是平台限制** —— 官方文档确实给出了
  > `animation-play-state: paused` + 负 `animation-delay` 的帧同步解法。我们不用，
  > 理由是 lint 可静态检查 + 负延迟易错。真正的红线自始至终只有一条：**推进权属于 frame**。
- **不遮挡主体优先于图形打架。** 安全区判定（D 分支）**优先于** exclusive 组判定（C4）。
- **主从放行由 `scope` 枚举自动推导，不做字符串白名单。** 白名单会随命名空间无限膨胀，
  是校验黑洞；用枚举则新增模板零维护。

---

## 🔴 待实测的数值（**不要当成结论用**）

以下数字**不是**设计结论，而是为了让管线可运行而设的占位值 / 待校准初值：

| 项 | 当前值 | 状态 |
|----|--------|------|
| 对齐门控阈值 | 均值 < `0.60` 或低置信词 > `30%` → 阻断 | 文档初值，**待实测校准** |
| 门控置信度分档 | `high ≥ 0.80` / `mid ≥ 0.50` | **占位值**：真源只给了组合矩阵，未给分界数值 |
| 每 cue 的 item 数阈值 | `3` | **占位值**：真源只写「超阈值」，未给数值 |
| 走库比例 | 70%–90%（配额锚） | 文档值 |
| 阈值硬边界 | `T_min=0.50` / `T_max=0.80` | 文档值（是**边界**不是取值） |
| 样本少退化 | `N < 8` → `T = 0.65` | 文档值 |
| 安全阀 | 中位数 < `0.4` → 整批转 custom | 文档值 |
| 接力 gap | > `1.5s` → warning | 文档值 |
| 遮挡预算 | 人脸 `0%` / 手持物 `≤20%` / B-roll `≤30%` | 文档值 |
| 渲染基准 | 10 分钟成片的墙钟时长 + CPU 峰值 | 首次渲染时量 |

改这些值前，请先看 [`.workbuddy/memory/MEMORY.md`](.workbuddy/memory/MEMORY.md) 与登记册的对应条目。

---

## 实现过程中发现的三处文档缺口

写在代码注释里，也在这里集中列一次（**未擅自改文档，只是显式标注**）：

1. **D3 的「fullscreen 一律人工确认」不在 14 项校验表内。**
   validate 只能读 `03/01/02`（人工确认落在 `06-review`），读不到 → 故 validate 只出
   `W-D3-01` warning，**真正的硬停放在 `render` 的启动闸**。
2. **E5 的「motion 与禁配段相交 → error」同样不在 14 项表内。**
   已按 §1.4 实现，编为 `E-E5-01`（`<source>` 取决策编号，符合命名规则）。
3. **`offset: "-8f"` 这个规范示例会违反时序校验。**
   C2-5 要求 `fromFrame` 落在目标词的 `[startFrame, endFrame]` 内（「否则动效早于词出现」），
   而负偏移必然把 `fromFrame` 推到词起点**之前**。当前实现**照字面执行 C2-5**，
   因此示例 job 统一用 `+2f`。这条需要裁决：是放宽区间，还是负偏移本就只用于 `abs` 锚点。

---

## 文档

| 文件 | 读者 | 回答什么 |
|------|------|----------|
| [`docs/spec/SPEC-remotion-overlay-workflow.md`](docs/spec/SPEC-remotion-overlay-workflow.md) | 实现者 | 照着做：字段是什么、校验怎么判、目录怎么建 |
| [`docs/decisions/OPEN-DECISIONS.md`](docs/decisions/OPEN-DECISIONS.md) | 自己 / 未来的我 | 为什么这么定？否决了什么？**冲突时以它为准** |
| [`.workbuddy/skills/`](.workbuddy/skills/) | 模型（执行时读） | 这一步该遵守什么、何时必须停 |

三者**不互相替代**：登记册是决策的考古层（保留否决理由），Spec 是完整规格，
Skill 是提炼后的「必须遵守」。**Skill 不指向 Spec** —— 塞整份规格会挤掉素材本身的信息。

---

## License

[MIT](LICENSE)
