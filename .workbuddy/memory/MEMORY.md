# 项目长期记忆 — video pipeline

## 身份

- **Remotion 视频动效叠加管线**：在实拍口播粗剪上叠 motion-graphic overlay。Node ≥22.19 / ESM / tsx，MIT。
- **两工作区共用远端** `github.com/bill1994/FansticBVideoPipeline`（**PUBLIC**，main）。
  `docs/proposals/` 与 `.workbuddy/memory/` 会随仓库公开。
- 🔴 **定位 = 「被模型读取的 skill pipeline」**：模型即操作者，**仓库不调模型**；`03-storyboard/draft.json` 是模型产物的等价物。

## 机器与工作区（🔴 本文件禁止写「本机」）

本文件**已被两台机的提交共同修改过**，任何「本机…」的表述都会在另一台机上读成假话。一律写绝对路径。

| 路径 | 素材 | 性质 |
|---|---|---|
| `G:\VideoPipeline` | ✅ `TestResources/` 3 段 mp4（`3月22日.mp4` 270M / `5月28日.mp4` 240M / `kukini.mp4` 681M）+ `10月6日.srt`；`jobs/` 4 个 | 10-14 从 E 盘迁入，**开发活跃机，唯一有素材的机器** |
| `G:\WorkbuddyProject\VideoPipeline` | ❌ 无 `jobs/`、无素材 | 曾作长期记忆主维护机 |

⚠️ **10-18 教训**：拉取后本文件被覆盖为 `WorkbuddyProject` 机视角，其中「本机 `jobs/` 空、素材在另一台机」两句在 `G:\VideoPipeline` 上**恰好相反**。已改为路径化表述 —— 后续同步别再写「本机」。

`G:\VideoPipeline\jobs\` 实际进度（**没有任何 job 跑过 03/04/05**）：

| job | 已有阶段 |
|---|---|
| `e2e-0322` / `e2e-0528` / `e2e-perceive` | `00-input` + `02-perceive` |
| `real30` | `00-input` + `01-align` |

## 命令

```bash
npm run pipeline -- <stage> --job <id> [--jobs-dir <dir>]  # align|perceive|storyboard|validate|render|init
npm run typecheck && npm test   # tsc --noEmit / vitest 411 项 / 24 文件
```
demo（无需真实素材）：`storyboard`（须带 `--draft`）→ `validate` → `render`，`--jobs-dir examples`。
预期 0 error / 2 warning（均 `W-F6-01`）。⚠️ 仅在**不重跑 storyboard** 时成立（见雷区）。

## 结构

| 路径 | 职责 |
|------|------|
| `src/cli.ts` | 唯一入口：参数解析 + 阶段分发 + 语义化退出码（0/1/2/…/6/130） |
| `src/core/` | `types.ts` 契约 / `errors.ts`（**26 条**项级码）/ `exit-code.ts` / `config.ts` / `bake.ts` 锚点→帧 / `schedule.ts` 两道闸+地板+动态T / `io.ts` job 目录+不可变快照守卫 / `carrier-window.ts` **载体几何唯一真源** / `report.ts` / `srt.ts` / `zh-normalize.ts` |
| `src/stages/` | `align`(后端选择)→`builtin-align`→`whisper-adapter`+`text-align`(DP)；`perceive`(后端选择)→`builtin-perceive`→`shot-detect`(ffmpeg scdet)+`yunet`+`region-derive`；`storyboard`/`validate`/`render` |
| `src/validate/` | **18 项**构建期校验（纯 JSON→JSON）+ 2 条 extra（`W-D3-01`/`W-F6-01`）；`context.ts` 唯一读盘入口；`occlusion.ts` 消解唯一实现（含 `resolveScene` 单一入口） |
| `src/templates/` | 声明：`builtin.ts` **11 个** / `registry.ts` 自检 / `types.ts` 双轴 family×scope |
| `src/remotion/` | `index→Root→Overlay`(双栈) / `carrier.tsx` **时间表渲染**（不嵌套） / `carrier-synth.ts` **影子载体轨**（D4-t3） / `MotionItem`（全树唯一 `useCurrentFrame`）/ `carrier.tsx` / `caption.ts` / `tokens.ts` 颜色唯一来源 / `templates/` **9 个实现** |
| `tests/` `tools/` | vitest **24 文件 / 411 项**；探针 16 个（probe-yunet / -regions / -shots / -saliency …） |
| `docs/` `.workbuddy/skills/` | 规格/裁决/提案/评审/变更 + 五阶段执行期契约 |

## 当前状态（2026-10-18 · `b4935ba` · 工作区干净）

六道闸「四道半」：`01-align` ✅ / `02-perceive` ✅（内置三通道：ffmpeg `scdet` → YuNet `face` → 人脸外扩 `handheld` → 无脸镜头显著性 `broll`；三素材 77 shot / 0 低置信）/ `03-storyboard` 🔶（管线通，不调模型）/ `04-validate` ✅ / `05-render` 🔶（**9/11** 模板有实现）。
**硬阻断已拆**（未配 `PERCEIVER_CMD` 不再退出码 2）。

- ✅ **计数**：18 项校验 / **411 单测 / 24 文件** / 11 声明 / 9 实现 / 26 条码 / 8 个占位值。
- ✅ **通道方案 A 已落地**：`resolveScene(ctx)` 为消解单一入口，`render` 侧重算后用 `ctx.storyboard` 生成 props。
- ✅ **P3 已接线**：tier2 真正写入 `carrier.params.window`（主体锚定），遮挡率按**施加后**重算 + 终判。
- ✅ **P4 已重立 `W-D2-02`（第 18 项）**：判据换源为 `visibleRegion(params)`，该函数已认
  `window`（分屏）与 `scale`（放大）**两种裁切源** ⇒ D2-2 撤回理由②已消解。
- ✅ **split-frame 坐标系 bug 已修**（真渲抽帧抓出，见「真渲纪律」）。
- ✅ **D4-t2 施工 4/4 完成**（P1 契约 → P2 实现 → P3 接线 → P4 重立）。
- ✅ **10-18 拉取后复验**：typecheck 零输出 / 384 项全绿 /
  `validate --job demo --jobs-dir examples` → `checked=18 项 + 2 条起草原生约束, warning=2`。

## 🔴 四层假绿教训（本项目最贵的经验，务必记住）

| 层 | 病 | 状态 |
|---|---|---|
| 1 | 算了却只拼进 `detail` 字符串 | 10-13 已修 |
| 2 | 改了**内存对象**，跨进程无通道（`render` 独立进程重读 JSON） | 10-17 已修（方案 A） |
| 3 | 施加了变换，但**未验证终态**（如载体施加后仍超预算却报成功） | 10-17 已修（补终判） |
| 4 | 组件单测 + 静态断言全绿，但**画面是错的**（CSS 坐标系） | 10-17 已修 |

**判据：凡涉及「改变产物」的判定，都必须能回答「成片里哪儿变了」。**

## 🔴「两处各写一套算法」—— 本项目第三次同款病（根治口诀）

**同一个概念只允许有一个真源。** 三次实例：

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | split-frame 分界线落在 0.75（偏差 25%） | `clip-path` 百分比相对父容器，`MotionItem` 已按 footprint 缩窄 | 组件内反向抵消父级定位撑回满画面；⚠️ 抵消量也相对父宽，**必须除以 footprint 尺寸** |
| 2 | `params.scale=3.0` 时判据按 3.0 算、渲染实际用 1.6 | 钳制常量只存在于 `punch-in.tsx` | 常量上提 `core/carrier-window.ts`，两边共用 `clampScale()` |
| 3 | 校验期顺序耦合（#12 改写 footprint 后 #17 读到改后的值） | 校验项之间存在隐式顺序依赖 | 明知并记录；`render` 侧复用同一份 `resolveScene` |

🔴 **发现手段**：跨层探针对账（渲染期实际值 vs 判据推算值）比单测更灵 ——
`carrier-window.test.ts` 现导入 `punchInScale` 做跨模块对账。
🔴 **写断言前先跑一遍拿真实值**，别纯手算 —— 两次几何算错都伪装成「代码有 bug」。

## 🔴 真渲纪律（最高优先级）

- 🔴 **「单测全绿 + 静态断言全绿」≠ 画面正确**。P2 的 10 项 split-frame 测试全绿，
  真渲抽帧却量到分界落在 **0.75**（期望 0.5，偏差 25%）。
- **根因**：`clip-path` / `position` 的百分比**相对父容器**，而 `MotionItem` 先按
  `item.footprint` 撑出定位 div ⇒ 坐标系错位。`punch-in` 用 `transform: scale()`
  相对自身算所以恰好正确 ⇒ **只有部分模板会露馅，更危险**。
- **修法**：先反向抵消父级 footprint 定位撑回满画面。⚠️ 抵消量也相对父宽，
  **必须除以 footprint 尺寸**：`-fp[0]/fp[2]`、`1/fp[2]`（第一版就漏了这个除法）。
- **量测法**：`remotion still` 抽帧 + 纯 Node 解 PNG（zlib + PNG 反滤波）像素级量分界线。
- 🔴 **探针脚本未入库**：`out/make-split-frame-probe.mjs` 在 `out/` 下，被 `.gitignore` 忽略
  ⇒ 只存在于做过那次真渲的机器，换机重跑需重建探针（`out/frames/` 里的抽帧同理）。
- 🔴 **「视频在不在」用像素判断，不用眼睛**：抽单像素比对即可 ——
  根容器背景是 `0,0,0`，占位底是 `16,20,24`，素材画面是任意真实值。
  10-18 就是靠这条区分出「视频没挂载」与「素材开头本来就黑」。

## 🔴 真素材端到端首跑（2026-10-18，`jobs/e2e-perceive`）—— 两个渲染层阻塞 bug

详见 `docs/changelog/2026-10-18-真素材端到端首跑.md`。首次跑通 align→perceive→storyboard→validate→render，
成片 6667 帧 / 219MB / **墙钟 21 分 06 秒**。抓出：

| # | bug | 症状 | 修法 |
|---|---|---|---|
| 1 | `<OffthreadVideo>` 的 src 路径 | 渲染到 2836 帧崩，**或全程黑帧且不报错** | Remotion 静态服务把 URL 映射到 **bundle 目录**；实测只有 `public/<name>` 命中 ⇒ `video: 'public/'+basename` + `--public-dir=<00-input>` |
| 2 | `CarrierTrack` 把视频裁在轨道窗内 | 只要有一个载体类 item（如 `punch-in`），**其区间外整段视频消失**（6517 帧纯黑） | 窗口前 `[0,start)` / 窗口后 `[end,duration)` 补**无变换透传**，`CarrierTrack` 新增 `durationInFrames` |

🔴 **为什么这两个 bug 长期隐形**：demo job 是 `hasVideo: false`（走占位底）⇒
**「有真实视频」这条代码路径从未被执行**；而 bug 2 让「视频没挂载」表现为**静默黑屏**，
bug 1 的 404 只在视频真被挂载时才报 —— 两个 bug 互相遮蔽。

✅ **方案 A 在画面上被证实**：起草 footprint `[0.3,0.34,...]` → tier1 平移至 `[0.10,0.54,...]`
→ 成片里「值回票价？」**确实出现在左侧中部**。这是「报告改了、画面真改了」的第一次实拍证据。

## 🔴 对齐假绿：`alignedRatio` 结构上看不见时间空洞

- 10-18 实测：门控全过（均值 0.9113 / 低置信 3.19% / `alignedRatio = 1.000`），
  但 cue3 整整 **早了 7.06 秒**，词被塞进 **7.08 秒静音**（`volumedetect` mean −58 dB）。
- 根因两层：① whisper 吐出 **8.08–20.52s 的单一分段**，把 7 秒静音整个吞掉
  （`builtin-align.ts` 调 whisper **没传 `-ml` / `-sow`**）；② `alignedRatio` 的定义是
  「SRT 词对上 **token** 的比例」—— **衡量文本匹配，不衡量时间**，所以必然报 1.0。
- ⇒ 与旧记录里「alignedRatio=1.0 却有 3240ms 空洞」是**同一结构性盲区**。
- 损伤范围工具：`tools/probe-align-drift.mjs`（逐 cue 比对 SRT 起点与词落点，>1s 即报）。
  kukini 48 条 cue 中 4 条超 1s（−7.06 / −1.33 / −1.40 / +1.06）。
- ⏳ **未修**：属门控指标选型，按纪律先改裁决册。

## ⚠️ 已知未解：两条判据对「cue 化字幕」过敏

cue 化后 `validate` 是 **0 error / 104 warning**，其中 103 条属**判据适用范围**问题：

| 码 | 条数 | 为什么是误报 |
|---|---|---|
| `W-C3-01` 起点恰在词边界 | 49（48 条来自字幕） | 字幕**本就该对齐语音**；该码的立法意图是「机械对齐读起来像机器」，用在字幕上反了 |
| `W-C4-01` footprint 相交 | 54 | 相邻 cue 的 caption item 差 1 帧（`toFrame` 含端点，相邻 cue 的 `fromFrame` 等于上一条 `toFrame`） |

建议**收窄适用范围**（字幕家族 / 同轨相邻 item 豁免），但改判据须先走登记册，**本轮只记不改**。

## 🔴 载体轨不能嵌套（2026-10-18 第二轮真渲抓到的第三个 bug）

**症状**：影子载体轨单独存在时完美分屏；一旦外层还有 `punch-in` 载体轨，**加了等于没加**
（SSIM `1.000000`，像素完全一致）。

**根因**：`<Sequence from={x}>` 是**相对父级**偏移时间。`CarrierChain` 原本 `reduce` 嵌套包裹，
内层起点 = 父层偏移(2744) + 自身 `fromFrame`(6488) = 9232 > 成片长度 6667 ⇒ 永不渲染。
补 `from={0}` 无效 —— 偏移发生在每一个 `<Sequence>` 上，而变换必须包住视频就只能嵌套。

**修法（已实装）**：把时间轴**拍平**。`composeCarrierTimeline(tracks, total)` 取所有载体 item
起止帧作切点切成**原子窗口**，每窗最多挂一个变换；`CarrierTimeline` 外层 `from={0}` 零偏移、
逐窗 `from={w.from}`，有变换套 `MotionItem`、否则原样透传。
副产品：首轮那个「载体窗外视频消失」的 bug 在结构上不可能复发（单测断言逐段相接、无缝无叠）。

⚠️ **边界**：两载体时间**真重叠**时取「数组靠前者（更内层）优先」，外层变换在该窗被丢弃。
取确定性降级而非叠乘。需要「放大 + 分屏」同时生效**应先立裁决**。

🔴 **教训（第三次同款）**：「组件单测全绿 + 像素证据齐」仍可能只覆盖**单条链**。
本轮三个 bug 全是「两条路径/两条链同时存在时才暴露」——
**验证时要问「这套机制在**组合**下还成立吗」**，不能只验单条。

## 占位值（🔴 勿当结论；8 个，通道通了 ⇒ 优先级上升）

`ALIGN_GATE` 0.60/30% + `alignedRatioMin` 0.8（**须一并校准**）；闸2 分档 0.8/0.5；`DENSITY.maxItemsPerCue=3`（却能直接产 error）；
`PERCEIVE.safeAreaTopRatio=0.6`；`HANDHELD_EXPANSION` 宽3×/高2.5×；显著性 `targetAreaRatio=0.35`；`CARRIER_RATIO_DEFAULT=0.5`；
`MIN_VISIBLE_RATIO=0.5`（D4-t2 派生，**判据已于 P4 实装**，但阈值未校准 ⇒ `W-D2-02` 只能是 warning 档）。
`CARRIER_FALLBACK` 全局表**已删**（P1）⇒ 未声明载体报 `E-D4-01`。

## 裁决状态

- **D-A** ✅ `typography/center-emphasis@1.0` 已实装（首个遮挡型）。
- **D-B2** ✅ 选 C（批量真渲度量表）⏳ 未做；阻塞：缺图像量测管线（该机 ffmpeg 无 `eq`、无 PIL）。
- **M-2** ✅ 全 Node（onnxruntime-node）+ RTMO-S 起步；**M-4** ✅ 不接受 VLM 替代检测 ⇒ **face fail-closed 至今零实现**（只做 `lowConfidence` 标记）。
- **D4-t2** ✅ 裁决（10-17）：Q1 逐 item 显式 `carrier`、**废全局 map**；Q3 **cover 裁切分屏 + 主体锚定窗口**（中心 = shot `safeArea` 中心，`ratio` 钳 0.3–0.7，`side` 只决定视频显在哪侧；裁切窗校验期算好写入 `params.window`）。派生 `visibleRegion(params)` ⇒ `W-D2-02` 判据 = `|safeArea∩window|/|safeArea| ≥ 0.5`。
- ⚠️ 10-17 曾把 `W-D2-02` 补成第 18 项、**当日撤回**，10-17 晚又以新判据重新入册。教训：**「规格写了」≠「我读懂了」** —— carrier 类 `footprint` 是**视频位置**不是 overlay 位置。
- ⚠️ **裁决总数不要再引用**：旧记录一处写「44 RESOLVED」、另一处写「48」，两者相互矛盾且未核
  （登记册状态列有三种格式混排，机械计数得 38–45 区间）。**只引 OPEN 清单**即可。

## 下次开工点

**真素材端到端已两轮**：首轮（`2026-10-18-真素材端到端首跑.md`）修了两个阻塞 bug；
第二轮（`2026-10-18-cue字幕与影子载体轨.md`）做了 cue 化字幕 + 影子载体轨 + 拍平载体时间轴。
成片在 `jobs/e2e-perceive/05-render/out.mp4`。下一步：

1. **两条判据收窄适用范围**（见上）—— 否则 104 条 warning 会把真信号淹掉。
2. **静音-词一致性门控**（`M-1d`，已登待决）：`alignedRatio` 只看文本匹配，
   cue3 早 7.06s 仍报 1.000。判据要用 `silencedetect`，**不能拿 SRT 时间戳当基准**。
3. **占位值校准（8 个）** —— 尤其 `MIN_VISIBLE_RATIO=0.5`（挡着 `W-D2-02` 升 error）。
4. 剩余 2 个模板（`pointer-callout` / `whip-pan`）→ 11/11。
5. **组合场景验证模板**：本轮三个 bug 全是「单链正常、双链同时存在才暴露」⇒
   往后每个新机制都要问「和已有机制**同时**启用时还成立吗」。

其余待办：face fail-closed（M-4 定案未落）、`D-B2` 度量表、根 `SKILL.md`、
D6 参数决策档案与 `PLACEHOLDER` 追踪表。

**实测基准（F4）**：6667 帧 1080p60 → 墙钟 **21 分 06 秒**，成片 219 MB。

## P1–P4 定下的口径（后续别推翻）

- 🔴 **`visibleRegion` 必须认两种裁切源**：`window`（split-frame 分屏）与 `scale > 1`
  （punch-in 放大裁边）⇒ 可见区 `[(1-1/s)/2, (1-1/s)/2, 1/s, 1/s]`。
  只实现 window 那一支 = D2-2 撤回理由②「对放大完全漏报」原样留着。
- 🔴 **两者并存时取交集**（`intersectRects`），不是「window 优先」—— 后者会静默忽略 scale 的裁边 ⇒ 漏报。
- 🔴 **scale 必须过 `clampScale()`**（`[1.0, 1.6]`，常量在 `core/`），否则判据比渲染更狠 ⇒ 误报。
- ⚠️ **scale 分支取目标值（最坏帧），非当前帧** —— `punchInScale` 有进出场，中段帧 scale 小于目标值。
  方向**保守**（可能误报、不会漏报），**已拍板保持现状**。
- ⚠️ scale 可见区是**纯几何推导**（占位底铺满画面，真渲量不到黑边），真实素材下须复核。
- 查 shot `safeArea` 按**时间相交**，不按「item 起始帧落在 shot 内」—— item 可横跨两个 shot。
- `W-D2-02` 与 `W-D4-01` 的码串都沿用旧值保登记册可追溯，**语义以代码注释为准**。
- `W-D2-02` 的类归属（「载体可见性类」）**未经登记册裁决**，变更须走 `OPEN-DECISIONS.md`。
- 改写**只在内存 + 由 render 侧重算**传递，不落新阶段产物（`guardSnapshot` 本就禁止 04 写 03）；
  `render` 必须用 `ctx.storyboard` 而非单独 `readJson`，否则改写又蒸发。
- 🔴 **`resolveScene` 必须在 render 侧跑一次**，且**幂等**（已在预算内不重复平移）。
- 消解逻辑**唯一一份**在 `validate/occlusion.ts`，render 复用而非复制 ⇒ 校验与渲染几何逐位一致。
  分叉会让报告对成片说谎。
- 🔴 **施加 ≠ 成功**：tier2 必须有终判（施加后按展示条重算遮挡率），否则应报 `E-D2-01` 而非谎称成功。
- `window` **刻意不进 `paramsSchema`** —— 校验期写入的系统字段，进表模型就能填它。
- 载体几何**只此一份实现**（`core/carrier-window.ts`），validate 与 remotion 都从它取。
- split-frame **刻意无进出场**（窗口随帧变化会动摇 `W-D2-02` 的判据）⇒ 渲染测试用
  `STATIC_LAYOUT_TEMPLATES` 具名豁免 + 两条反向断言。

## 文档真源层级（冲突时以此裁决）

乐享 KB（唯一活文档，给人读）> `docs/decisions/OPEN-DECISIONS.md`（**裁决真源**；OPEN 仅 `C2-2` 阈值实测、`C2-3` BGM 分离倾向不做）> `docs/spec/SPEC-*.md`（v0.7）> `docs/changelog/` > `docs/proposals/`（未裁决前不含结论）。
另：`PROGRESS.md`（真实数字 + 后续计划）、`CONTRIBUTING.md`（接手 3 分钟：裁决册 > PROGRESS > 其他）。

## 约定 / 雷区

- **帧是真相**：模型只写锚点 `{anchor:"word:37", offset:"-8f"}`，烘焙器解析成帧；**负偏移＝抢拍合法**（下界是锚定词所在 cue 起点，C2-5a）。
- **新增字段/令牌/配置后立刻问「谁读它」** —— 10-15 一天撞见三例（`occludesSubject`/`handoffIn`/`DUR.exit`）。
- **推进实现后回头改计划书状态**：每完成一条 D 项，先更新 `docs/proposals/2026-10-14-后续提升优化计划书.md` 文首状态横幅。
- **改文档计数时区分活计数与条目身份**（「当前 16 项」要改，「第 16 项」不能改）。历史档案（changelog / memory 日志 / reviews / SPEC 版本历史行）保留原数字不动。
- 增补校验项**须先改裁决册**；新错误码同时进 `errors.ts` 的 `CODES`。**`CODES` 键名不可与已删配置同名**（会误导），但错误码字符串要保留以保可追溯。
- 确定性红线：全树仅 `MotionItem` 读时钟；禁 `Date.now()`/`Math.random()`（用 `mulberry32`）/CSS animation/`<Series>`/显式 z-index。
- 🔴 **demo 夹具坑**：`draft.json` 曾带 `highlightColor` 而模板声明刻意不含 ⇒ 手改下游快照能骗过 validate，重跑 storyboard 就红（已修）。**别手改下游快照。**
- 🔴 环境铁律：pip **阿里源**（清华源 TLS 挂）；npm 大包「curl 下 tgz → cache add → 离线装」；`onnxruntime-node@1.30.0` 实测 **288MB**；模型落 `perceive-models/`（gitignore，换机重下，sha256 `ebafce4e…`）。参照 venv `~/.workbuddy/binaries/python/envs/default`。
- `PROGRESS.md §七` 的 ffmpeg `EBUSY` 在 `G:\VideoPipeline` **不复现**（ffmpeg 9.0.2 gyan.dev）⇒ 特定安装方式问题，勿当通用坑。
- Git Bash：`python -c` 传含反引号多行串会失败 → 写临时 `.py`；git 输出中文路径需 `core.quotepath=false`。

## git

- 仓库级 noreply 身份（`29155565+bill1994@…`）；`gh auth setup-git` 做凭证，**别用 GCM**。
- 🔴 **代理只走环境变量 `HTTP_PROXY`/`HTTPS_PROXY`，勿写死端口**（宿主每会话换端口）；直接 `git push`。曾用 `-c http.proxy=127.0.0.1:4436` 连续 5 次失败而 curl 却通 —— **别用 curl 通推断 git 通**。偶发 502 → 重试即通。
- 双工作区并行提交会产生「同内容不同 hash」重复提交：先建 `backup/pre-pull-<date>`，`git diff` 为空再 `reset --hard origin/main`。
- 两边都写 `.workbuddy/memory/` 日期日志 ⇒ **拉取时查同名日志冲突并合并**（先例 10-12/13/15）。
- 🔴 **`MEMORY.md` 名义上「只本机维护」，实际上已被远端提交过** —— 10-18 拉取即被另一台机视角整体覆盖。
  故：① 内容一律**路径化**、不写「本机」；② 拉取前先 `git log --oneline -- .workbuddy/memory/MEMORY.md`
  看它是否被动过；③ 改完若要留，就得提交（否则下次 ff 又被覆盖）。
