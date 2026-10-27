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
  素材       强制对齐        感知与安全区      storyboard 起草      校验（当前 18 项）       渲染出片      人工放行
             ↑ 门控                                ↑ 烘焙锚点→帧      ↑ 有 error 停
```

下游不得回写上游（`writeStageJson` 内含 `assertNotWritingUpstream` 守卫）。`align` / `perceive` 产物已存在即跳过；`storyboard` / `validate` / `render` 每次重算。返修改第 3 级，第 4/5 级作废重跑。

| 阶段 | 做什么 | 必须停 |
|------|--------|--------|
| `align` | 抽 16kHz 单声道 wav → 强制对齐 → 置信度门控 | **门控不达标必须停**，降级必须阻断 |
| `perceive` | 抽帧、镜头切分、主体检测、安全区与区域预算基线 | **内置后端**：ffmpeg `scdet` 镜头切分 → YuNet 人脸（`face`）→ 人脸框外扩（`handheld`）→ 无脸镜头显著性（`broll`）。未配 `PERCEIVER_CMD` 也能直接跑；配了则走外部感知器覆盖。低置信**不阻断**，走告警 + 人工兜底 |
| `storyboard` | 按**词级锚点**起草并烘焙 `storyboard.json` | 安全阀 / fullscreen / custom 不许绕地板 |
| `validate` | 跑构建期校验项（当前 18 项，纯 JSON→JSON） | **有 error 必须停**，不进渲染 |
| `render` | C6 双栈映射 + 本地渲染 + 成片媒体 QA（解码/黑场/静帧/音频/联系表） | 校验未过 / fps 漂移 / 版本未锁 → 拒绝启动 |

每阶段的详细行为契约见 [`.workbuddy/skills/`](.workbuddy/skills/) —— 那是**执行期读**的精简版，
只保留「做什么、怎么调、什么情况必须停」。

---

## 快速开始

> **换了一台新电脑？** 先看 [`docs/SETUP.md`](docs/SETUP.md)（ffmpeg / whisper / 模型 / 自检），
> 再回来跑下面的流程。装完用 `npm run doctor` 确认 —— 它会一次说清缺什么、怎么补。

```bash
# 需要 Node.js 22.19+ / 24+
npm install

# 1. 建一个 job
npm run pipeline -- init --job my-first

# 2. 把视频 + SRT 放进 jobs/my-first/00-input/，填好 source.json
#    然后按序跑：
npm run pipeline -- align      --job my-first
npm run pipeline -- perceive   --job my-first
npm run pipeline -- storyboard --job my-first
npm run pipeline -- validate   --job my-first
npm run pipeline -- render     --job my-first

# 预览（Remotion Studio）
npm run studio
```

### 端到端跑通仓库自带的示例

`examples/demo` 是一个**不需要真实素材**的完整 job（fixture 已备好），用来验证管线本身：

```bash
npm install

npm run pipeline -- storyboard --job demo --jobs-dir examples
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- review     --job demo --jobs-dir examples --dry-run
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run
```

预期结果：`validate` 报 **0 error / 2 warning**（`summary.checked = 18` + `summary.extra = 2`），
并写出 `examples/demo/04-validate/validate-report.json`；
那两条 warning 都是 `W-F6-01`（示例里 s2 镜头与其人脸区被故意标成低置信，用来演示 F6 的人工兜底通道）。
注意 `checked` 只数清单内的 18 项，不含 `extra` 里那两条 —— 两者相加才是本次执行的全貌。

**`review`（P1-a 审核闸）**：产出 `06-review/preview-props.json` 并（去掉 `--dry-run` 时）启动
Remotion Studio 挂载**与 render 完全同源**的预览。demo 的产路地板恰好会产出一条
must_review 条目（`typo-main/002`）—— `render` 在此条目被人工确认前会拒绝启动（exit 1）。
确认方式：看片后把该 ref 写进 `examples/demo/06-review/confirmed.json`（文件不存在则新建）：

```json
{ "records": [ { "jobId": "demo", "stage": "render", "reason": "看片确认",
  "confirmedBy": "你的名字", "confirmedAt": "2026-10-22T23:00:00+08:00",
  "acknowledgedReview": ["typo-main/002"] } ] }
```

写完后 `render --dry-run` 即可放行。storyboard 被改动后需重跑 `review`
（hash 防漂移：确认只对看片时的那个 storyboard 版本有效）。

其他命令：

```bash
npm run typecheck   # tsc --noEmit
npm run verify      # 一条命令三段：typecheck + test + demo 端到端（A3）
npm test            # vitest：57 个测试文件 / 852 项（校验 · 模板渲染 · 集成 · spec 契约 …）
npm run templates:gallery  # 生成模板预览画廊 → out/template-gallery/gallery.html
npm run determinism -- --job demo --jobs-dir examples  # 双渲像素一致性检查（抽样帧各渲两次比 PNG 字节）
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
│   ├── validate/             构建期校验（当前 18 项，纯函数）
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

需要模型的阶段（`align` / `perceive`）**都有内置实现**，外部命令是可选覆盖：

| 阶段 | 内置用什么 | 体积 |
|------|-----------|------|
| `align` | `whisper.cpp`（出逐词时间）+ **SRT 文字权威** + 内置 DP 对齐（`text-align.ts`） | whisper 模型 148MB |
| `perceive` | **YuNet**（MIT，人脸检测，已实测与 OpenCV 参照逐框对齐 <0.5px）+ ffmpeg `scdet`（镜头切分） | 230KB |

> `perceive` 内置后端三通道：`face`（YuNet 人脸）、`handheld`（人脸框外扩，**不做物体检测**）、
> `broll`（仅无脸镜头用经典显著性，框不到即退让）。主讲解物品是鞋子而 **COCO 80 类里没有 shoe**，
> 所以 `handheld` 走几何外扩 —— 语义是「保护上半身＋手部区域」，不是精确物品框。

**为什么不让多模态大模型直接干？** 分界是「**测量 vs 选择**」：
逐词时间戳、bbox 坐标、显著性峰值属于**测量**，多模态模型的实测误差比容差大一个数量级
（grounding 偏差 20–40%，IoU 仅 0.09–0.13，而我们的容差是 ±33ms / <3% 坐标误差）。
它擅长的是**选择** —— 候选框三选一、shot 分类、挑模板写文案。

完整论证、待裁决项与落地计划见
[`docs/proposals/2026-10-13-模型选型与分工.md`](docs/proposals/2026-10-13-模型选型与分工.md)；
感知后端的选型与集成方案见
[`docs/reviews/2026-10-16-perceive检测后端选型与工程集成-研究报告.md`](docs/reviews/2026-10-16-perceive检测后端选型与工程集成-研究报告.md)。

**外部命令覆盖**（可选；都不配也能跑）：

```bash
# 强制对齐：把 {fps, words: WordTimestamp[], cues: Cue[]} 写到 {out}
export ALIGNER_CMD="python tools/align.py --wav {wav} --srt {srt} --out {out} --fps {fps}"

# 感知：写出 {out_dir}/shots.json 与 {out_dir}/regions.json
export PERCEIVER_CMD="python tools/perceive.py --video {video} --frames {frames_dir} --out {out_dir} --fps {fps} --interval {interval}"
```

未配外部命令时走内置实现；内置也跑不通（缺 whisper 模型 / 缺 ffmpeg / 缺 YuNet 权重）时
**显式报错退出（退出码 2），绝不伪造结果** —— 一条静默产出的错误 storyboard，
比一次显式失败危险得多。

> 模型权重**不入库**（`.gitignore` 忽略 `perceive-models/`）：换机需重新下载，
> 且下载后应校验 sha256（YuNet 2026may 官方版 = `ebafce4e…`，229,738 字节）。
> `PERCEIVE_MODEL` 可覆盖模型路径。

> 换模型的代价很低：`02-perceive` 的产物契约已定死形状，实现只需填内容，
> 下游校验器不关心模型怎么来。

---

## 几条硬规则（写在代码里，不是写在文档里）

- **帧是真相。** 落盘只有 `fromFrame` + `durationInFrames`；模型写的是锚点
  `{anchor:"word:37", offset:"-8f"}`，由烘焙器一次性解析成帧，**锚点用完即弃**。
- **偏移可为负 —— 负偏移＝抢拍，合法。** 边界只有一条：**不得早于锚定词所在 cue 的起点**。
  动效在同一句话内提前进入可接受，跨到上一句才算错位（C2-5a）。
  这条边界是**修正过的** —— 原先写成「须落在目标词区间内」，那样连文档自己的示例都过不了。
- **填稿时不手算帧。** 创作期（写 `motionboard.json`）模型只填表：挑模板 + 填文字 + 写锚点，
  禁写坐标/帧数/颜色/CSS —— 那些由 `footprint`、锚点烘焙器、令牌决定。
  ⚠️ **这条只管填稿，不是对模型能力的限制**：写模板（`src/remotion/templates/*.tsx`）时
  模型就是代码作者，坐标与颜色必须有；颜色走 `tokens.ts` 的令牌，不硬编码 hex。
- **`params` 按 `paramsSchema` 逐项校验（第 16 项，P1）。** 三条码全 error、不设 warning 档：
  `E-P1-01` 未知键 / `E-P1-02` 缺必填键 / `E-P1-03` 类型不符。判定顺序固定 `01 → 02 → 03`。
  > **为什么全 error**：现有的 warning 档（几何相交、主体未确等人补）都有正当的不拦理由，
  > 而参数写错没有 —— 要么崩，要么静默错渲。
  > **三个判定边界**：`'number'` 额外要求 `Number.isFinite`（`NaN` / `Infinity` 裸 `typeof` 会放行，
  > 而它们在插值时产生 NaN 污染整条画面）；**不做隐式转换**（`scale: "1.08"` ≠ `scale: 1.08`）；
  > **不判语义**（`stat-card` 的 `value: "999%"` 结构正确，校验器只验结构）。
  > **不剔除非法 item** —— 校验器是纯函数且逐项独立判定，剔除会让报告随执行顺序变化并吞掉其他项的问题。
- **必填信息不塞进 `paramsSchema`。** 它是 `Record<string,string>` 的扁平表，装不下 required；
  必填查独立可选字段 `requiredParams`（**省略 = 全部可选**）。
  刻意不把值类型改成 `{type, required?, default?}` —— `default` 是**渲染期**的事，
  塞进校验层属职责混淆。
- **字幕文本与颜色都不经 params。** `caption/karaoke-word` 故意不声明 `text`（它来自 SRT）
  也不声明颜色（已摘除原 `highlightColor`）—— 留着任何一个都等于让模型能硬写文本或色值，
  违反「禁写坐标/帧数/颜色/CSS」这条硬约束。高亮色由渲染期按**命名令牌**（`'brand'` / `'accent'`）解析。
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
| 对齐门控阈值 `alignedRatioMin` | `0.80` | 🔴 **占位值**：M-1c 新增。**须与 `meanConfidenceMin` 一并校准，不得分开拍** |
| 门控置信度分档 | `high ≥ 0.80` / `mid ≥ 0.50` | **占位值**：真源只给了组合矩阵，未给分界数值 |
| 每 cue 的 item 数阈值 | `3` | **占位值**：真源只写「超阈值」，未给数值 |
| 走库比例 | 70%–90%（配额锚） | 文档值 |
| 阈值硬边界 | `T_min=0.50` / `T_max=0.80` | 文档值（是**边界**不是取值） |
| 样本少退化 | `N < 8` → `T = 0.65` | 文档值 |
| 安全阀 | 中位数 < `0.4` → 整批转 custom | 文档值 |
| 接力 gap | > `1.5s` → warning | 文档值 |
| 遮挡预算 | 人脸 `0%` / 手持物 `≤20%` / B-roll `≤30%` | 文档值 |
| 安全区上部比例 `safeAreaTopRatio` | `0.6` | 🔴 **占位值**：SPEC 只写「取 bbox 上部」，无精确比例 |
| 手持物外扩 `HANDHELD_EXPANSION` | 宽 `3×` / 高 `2.5×` | 🔴 **占位值**：由单条素材反推，只对当前构图成立 |
| 显著性目标面积 `targetAreaRatio` | `0.35` | 🔴 **占位值**：三素材目视可接受，未量化 |
| 分屏可见比 `MIN_VISIBLE_RATIO` | `0.5` | 🔴 **占位值**：D4-t2 派生判据，**已落地**并被校验 #18（`W-D2-02`）消费；阈值本身待真实素材校准 |
| 渲染基准 | 10 分钟成片的墙钟时长 + CPU 峰值 | 首次渲染时量 |

改这些值前，请先看 [`.workbuddy/memory/MEMORY.md`](.workbuddy/memory/MEMORY.md) 与登记册的对应条目。

---

## 实现期发现的三处文档缺口 —— 已裁决并回写（2026-10-13）

这三处是实现 `src/validate/` 时暴露的：代码必须对它们给出确定行为，写到那里才发现文档答不上来。
**已按 `docs/proposals/2026-10-13-三处缺口修改方案.md` 裁决并同步到登记册 / Spec / Skill / 代码**；
乐享 KB 正文同步写回。结论如下：

1. **D3 的「fullscreen 一律人工确认」不设落点，且 F3 的 `confirmed.json` 装不下它。**
   → 裁决 **D3-a**：确认落在 **render 启动闸**，不进构建期清单。
   理由：确认记录产在 `06-review`，而构建期的输入边界只到 `03`/`01`/`02`，**读不到** ——
   这是「谁有资格拦」的问题。`validate` 只出 `W-D3-01` 预告；
   `confirmed.json` 补 `stage: "render"` 与 `acknowledgedFullscreen`。
2. **E5 的「motion 与禁配段相交 → error」漏收。**
   → 并入清单，成为**第 15 项**（`E-E5-01`）。它的三条准入判据与其余各项完全同质，
   原清单成型早于 E5，属**纯漏收**而非设计分歧。清单同时改为**不带计数的命名**，
   免得再被数字钉死。3. **`offset: "-8f"` 这个规范示例会违反 C2-5 的时序校验。**
   → 裁决 **C2-5a**：**改 C2-5 的区间下界** —— 由「词起点」改为「**锚定词所在 cue 的起点**」。
   负偏移＝抢拍，**合法**；跨过 cue 起点才算错位。
   决定性理由：禁负偏移会把抢拍逼回 `abs:` 手写帧号 → 写死帧号后失去「跟着词走」的能力 →
   违反 C2 铁律「不让模型手算帧」。
   **`examples/demo` 的起草稿已改回负偏移（抢拍 8 帧），作为这条修复的回归证据。**

**判据（清单准入规则）**：某个规则该不该进清单，看三条 —— 输入在本阶段可读 / 纯结构化判定 /
渲染前就该阻断。全中才进；否则另找落点并写明。**例外只应该有 D3 这一条。**

### 第四处缺口：`paramsSchema` 无人校验 → 校验项 #16（P1）

写首批模板清单时暴露的第二处同类缺口：**`paramsSchema` 只被定义与注册，校验器侧零引用。**
模型填了模板未声明的键、或漏填必填键，构建期一声不吭。

> **为什么它比前三处更危险**：前三处是「判定规则答不上来」，这一处是「根本没有判定」。
> 最坏的具体后果：`caption/karaoke-word` 故意不把 `text` 放进 `paramsSchema`（字幕文本来自 SRT），
> 而渲染层直读 `item.params.text` —— 模型一旦硬塞 `text`，字幕文本就有了第二个来源，
> 与语音对不上，而**时序校验只看帧区间、任何校验项都拦不住**。

已按 **P1** 裁决落地（详见上文硬规则一节）：进清单成为**第 16 项**，三条码全 error；
契约扩 `requiredParams`；`karaoke-word` 摘除 `highlightColor`。详见
[`docs/templates/2026-10-13-模板库首批清单.md`](docs/templates/2026-10-13-模板库首批清单.md) §2.2 与 §6。

### 另两条已落登记册的裁决：align 的文本权威（M-1 / M-1c）

M-1 已裁决取方案 **(b)** —— whisper 出时间、把词序列文本对齐回 SRT，**保住 SRT 权威**。
M-1c 同步给 `AlignReport` 补两个**必填**字段：`textSource`（可审计）与 `alignedRatio`
（SRT 词对上 token 的比例，**同时是门控项**，阈值 `alignedRatioMin` 🔴 PLACEHOLDER 待实测）。

> **为什么非加不可**：`meanConfidence` 衡量的是「whisper 对自己听到的词有多自信」，
> 它**测不到「SRT 与音频是否对得上」**。一个 whisper 自信但与 SRT 完全不符的场景会
> 直接通过门控 —— 这违反项目 P0「绝不伪造结果」。

---

## 文档

| 文件 | 读者 | 回答什么 |
|------|------|----------|
| [`docs/spec/SPEC-remotion-overlay-workflow.md`](docs/spec/SPEC-remotion-overlay-workflow.md) | 实现者 | 照着做：字段是什么、校验怎么判、目录怎么建 |
| [`docs/decisions/OPEN-DECISIONS.md`](docs/decisions/OPEN-DECISIONS.md) | 自己 / 未来的我 | 为什么这么定？否决了什么？**冲突时以它为准** |
| [`docs/proposals/`](docs/proposals/) | 我 / 拍板者 | 待裁决的议题、方案对比、落地计划（**未裁决前不含结论**）|
| [`.workbuddy/skills/`](.workbuddy/skills/) | 模型（执行时读） | 这一步该遵守什么、何时必须停 |

三者**不互相替代**：登记册是决策的考古层（保留否决理由），Spec 是完整规格，
Skill 是提炼后的「必须遵守」。**Skill 不指向 Spec** —— 塞整份规格会挤掉素材本身的信息。

---

## License

[MIT](LICENSE)
