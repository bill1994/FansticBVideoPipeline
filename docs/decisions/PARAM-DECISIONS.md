# 参数级决策与占位值追踪（PARAM-DECISIONS）

> ⚠️ **本文件由 `npm run placeholders` 生成，请勿手改。**
> 真源：`src/core/placeholders.ts`。改了阈值或增删条目后重跑一次即可同步。
> 校验是否同步：`npm run placeholders -- --check`（不一致退 1）。

## 一、计数（唯一口径）

| 口径 | 数量 | 说明 |
|---|---|---|
| 占位值**项数** | **10** | 一个"需要独立做出的校准决定"算一项 |
| 占位值**数值个数** | **17** | 一项可含多个数（如对齐门控 3 个） |
| 明确排除的拟定值 | 5 | 见 §五，写清为什么不收 |

🔴 **引用数量时必须注明口径**：说「8 个占位值」指的是**项数**；说「12 个数值」指的是**数值个数**。此前 `MEMORY.md` / `PROGRESS.md` / 代码标记三方各数一套，就是因为没定粒度。

## 二、汇总表

| id | 参数 | 类别 | 当前值 | 真源 | 卡着谁 |
|---|---|---|---|---|---|
| `align-gate` | 强制对齐门控 | 文档初值 | `meanConfidenceMin` = **0.6**<br>`lowConfidenceRatioMax` = **0.3**<br>`alignedRatioMin` = **0.8** | `core/config.ts` · `ALIGN_GATE` | — |
| `confidence-bands` | 闸2 置信度分档 | 实现期拟定 | `high（≥ → auto）` = **0.8**<br>`mid（≥ → alternatives）` = **0.5** | `core/schedule.ts` · `CONFIDENCE_BANDS` | — |
| `density` | 每 cue 最大 item 数 | 实现期拟定 | `maxItemsPerCue` = **3** | `core/config.ts` · `DENSITY` | — |
| `safe-area-top` | 安全区顶部比例 | 实现期拟定 | `safeAreaTopRatio` = **0.6** | `core/config.ts` · `PERCEIVE.safeAreaTopRatio` | — |
| `handheld-expansion` | handheld 人脸框外扩 | 实现期拟定 | `widthRatio（宽）` = **3**<br>`heightRatio（高）` = **2.5** | `core/config.ts` · `HANDHELD_EXPANSION` | — |
| `saliency-target` | 显著性目标框面积 | 实现期拟定 | `targetAreaRatio` = **0.35** | `core/config.ts` · `SALIENCY_TARGET_AREA_RATIO` | — |
| `carrier-ratio` | 载体缺省占比 | 实现期拟定 | `CARRIER_RATIO_DEFAULT` = **0.5** | `core/carrier-window.ts` · `CARRIER_RATIO_DEFAULT` | — |
| `min-visible` | 主体最低可见比 | 文档初值 | `MIN_VISIBLE_RATIO` = **0.5** | `core/carrier-window.ts` · `MIN_VISIBLE_RATIO` | `W-D2-02` 从 warning 升 error |
| `silence-thresholds` | 静音检测与 SRT 一致性校验阈值 | 实现期拟定 | `noiseDb` = **-40**<br>`minDurationSec` = **0.5**<br>`longSilenceSec` = **1**<br>`overlapToleranceSec` = **0.5** | `core/config.ts` · `SILENCE` | `M-1d` 判据升 error；`M-1f` Q2 的告警可用性 |
| `reweigh-coverage-min` | 词时重铺的覆盖率阈值 | 实现期拟定 | `REWEIGH_COVERAGE_MIN` = **0.8** | `core/word-timeline.ts` · `REWEIGH_COVERAGE_MIN` | `M-1f` 的「好数据不被修坏」保证 |

## 三、逐项详情

### `align-gate` · 强制对齐门控

- **类别**：文档初值
- **真源**：`src/core/config.ts#ALIGN_GATE`
- **当前值**：`meanConfidenceMin` = **0.6**；`lowConfidenceRatioMax` = **0.3**；`alignedRatioMin` = **0.8**
- **当前值从哪来**：前两项是 C2-2 的文档初值「均值<0.60 或低置信词>30% → 阻断」；`alignedRatioMin=0.8` 是实现期拟定（M-1c，2026-10-13）。
- **怎么校准**：在 2–3 条真实素材上跑 align，取 `alignedRatio` 与 `meanConfidence` 的实测分布下沿；三项**必须一次定完**。已知反例：kukini 三项全过（0.9113 / 3.19% / 1.000），但词时仍漂 7.06s ⇒ 光调这三个数**修不了** `M-1d`，别指望它。
- **越界后果**：偏严 → 好素材被误拦（退出码 2，用户无路可走）；偏松 → 错位对齐静默通过，错误直到成片才看得见。
- **必须一起校准**：`confidence-bands`（分开调会留下一道看着齐全、实则测不到的门）

### `confidence-bands` · 闸2 置信度分档

- **类别**：实现期拟定
- **真源**：`src/core/schedule.ts#CONFIDENCE_BANDS`
- **当前值**：`high（≥ → auto）` = **0.8**；`mid（≥ → alternatives）` = **0.5**
- **当前值从哪来**：真源只给了组合矩阵（低/中/高 → must_review/alternatives/auto），**未给分界数值**。
- **怎么校准**：与 `align-gate` 同批跑：把实测 confidence 排序后看三档的实际切点，要求「auto 档不出现明显错位项」。
- **越界后果**：偏严 → 大量条目掉进 must_review，而项目没有审核 UI，人审成本直接压给用户；偏松 → 低质条目自动通过，闸2 退化成装饰。
- **必须一起校准**：`align-gate`（分开调会留下一道看着齐全、实则测不到的门）

### `density` · 每 cue 最大 item 数

- **类别**：实现期拟定
- **真源**：`src/core/config.ts#DENSITY`
- **当前值**：`maxItemsPerCue` = **3**
- **当前值从哪来**：真源全文只写「每 cue 的 item 数超阈值 → error」，**未给数值**。
- **怎么校准**：统计真实 storyboard 的「每 cue 实际 item 数」分布，取 P90 作为阈值；至少 2 条素材、覆盖口播/特写两类镜头。
- **越界后果**：🔴 **这是唯一一个「占位值却直接产 error」**：偏严会**阻断真实素材**，而项目没有 storyboard 编辑 UI，用户只能手改 JSON。这是「过度严格」最现实的伤害点。

### `safe-area-top` · 安全区顶部比例

- **类别**：实现期拟定
- **真源**：`src/core/config.ts#PERCEIVE.safeAreaTopRatio`
- **当前值**：`safeAreaTopRatio` = **0.6**
- **当前值从哪来**：SPEC §2.7 只写「安全区 ≠ 主体 bbox，取 bbox 上部（腿部以下可压）」，无精确比例；0.6 取自 talkcraft 的生产口径（上 60% / 左右 20%）。
- **怎么校准**：真实素材抽帧，量「头 + 手（+ 手持物）下沿」占 bbox 的比例，取覆盖所需值。`tools/probe-regions.mts` 可批量出图。
- **越界后果**：偏大 → 安全区变窄，正常字幕被判遮挡，`W-D2-01` 满屏；偏小 → 主体下半被 overlay 压住却不报警。

### `handheld-expansion` · handheld 人脸框外扩

- **类别**：实现期拟定
- **真源**：`src/core/config.ts#HANDHELD_EXPANSION`
- **当前值**：`widthRatio（宽）` = **3**；`heightRatio（高）` = **2.5**
- **当前值从哪来**：SPEC 只说 handheld 是「手持讲解物品」，**未规定如何从人脸推导**。当前值有部分实测依据（3月22日 s2：手与鞋落在 y≈0.75–0.85，反推高度需 2.3，取 2.5 留余量），但只对那一种构图成立。
- **怎么校准**：在 3 条素材上取「人物中景 / 特写 / 半身」各一帧，量手与手持物下沿，要求外扩框底部 ≥ 该下沿且不超 `OCCLUSION_BUDGET.handheld`(0.2) 的合理占比。
- **越界后果**：偏小 → 手和手持物落在框外，遮挡**完全漏报**；偏大 → 框吃满 20% 预算，同样大小的 overlay 占比变小，保护形同虚设。

### `saliency-target` · 显著性目标框面积

- **类别**：实现期拟定
- **真源**：`src/core/config.ts#SALIENCY_TARGET_AREA_RATIO`
- **当前值**：`targetAreaRatio` = **0.35**
- **当前值从哪来**：无文档依据；三素材目视可接受，**未做量化**。
- **怎么校准**：对每个 broll shot 跑 `tools/probe-saliency.mts`（已有 0.15 / 0.35 / 0.5 三档），由人判定「框是否刚好框住主体」，统计最常被选中的档位；至少 10 个 shot。
- **越界后果**：偏小 → 框太窄，overlay 压到主体却按小框算占比，遮挡漏报；偏大 → 框覆盖大半屏，`broll` 的 30% 预算一进来就超，判定退化为常态报警。

### `carrier-ratio` · 载体缺省占比

- **类别**：实现期拟定
- **真源**：`src/core/carrier-window.ts#CARRIER_RATIO_DEFAULT`
- **当前值**：`CARRIER_RATIO_DEFAULT` = **0.5**
- **当前值从哪来**：D4-t2 裁决只给了钳制区间 [0.3, 0.7]，**未给默认值**；取区间中值 0.5（"不需要判断时应当安全"）。
- **怎么校准**：真实素材上试 0.3 / 0.5 / 0.7 三档分屏，看「展示条能否放下 9 个模板的最长文本」且「主体不被切走」（配合 `MIN_VISIBLE_RATIO` 判据）。
- **越界后果**：偏小 → 主体被切走，`W-D2-02` 报警；偏大 → 展示条窄到放不下内容，与 `text-metrics` 的字数上限打架。
- **必须一起校准**：`min-visible`（分开调会留下一道看着齐全、实则测不到的门）

### `min-visible` · 主体最低可见比

- **类别**：文档初值
- **真源**：`src/core/carrier-window.ts#MIN_VISIBLE_RATIO`
- **当前值**：`MIN_VISIBLE_RATIO` = **0.5**
- **当前值从哪来**：D4-t2 裁决原文给的默认值 0.5，明示"待真实素材校准"。
- **怎么校准**：真实素材上跑分屏，量 `|safeArea ∩ visibleRegion| / |safeArea|` 的实际分布，取「观感上主体未被切走」的最低值；需与 `carrier-ratio` 一起定。
- **越界后果**：偏严 → 正常分屏被判「主体被切走」，`W-D2-02` 满屏；偏松 → 主体被切掉一半仍报通过。
- **当前卡着**：`W-D2-02` 从 warning 升 error
- **必须一起校准**：`carrier-ratio`（分开调会留下一道看着齐全、实则测不到的门）

### `silence-thresholds` · 静音检测与 SRT 一致性校验阈值

- **类别**：实现期拟定
- **真源**：`src/core/config.ts#SILENCE`
- **当前值**：`noiseDb` = **-40**；`minDurationSec` = **0.5**；`longSilenceSec` = **1**；`overlapToleranceSec` = **0.5**
- **当前值从哪来**：文档与裁决册均未给数值（`M-1d` / `M-1f` 为 OPEN）。kukini 单条素材实测：`noise=-40dB / d=0.5` 下全片仅 3 段静音（6.736s 大空洞 + 0.53s / 0.57s 句中换气）；SRT 留白 7.083s vs 实测 6.736s，差 0.35s ⇒「长静音」取 1.0s 以排除换气。
- **怎么校准**：补齐 3月22日 / 5月28日 的 SRT 后，三条素材各跑一次 align，对比 `silentWordRatio` 与「SRT↔静音不吻合」的告警条数：① 不吻合告警应**只在真错位时**出现（句中换气绝不能被当错位）；② `longSilenceSec` 需保证各素材的正常换气都不超过它；③ `noiseDb` 若素材底噪偏高需上调。
- **越界后果**：`noiseDb` 偏大（阈值过高）→ 正常语音尾音被判静音 → 词时误重铺、误告警；偏小 → 真静音漏检 → `M-1d` 失守。`longSilenceSec` 偏小 → 句中换气被当错位 → 满屏警告（用户会学会忽略警告）；偏大 → 大错位漏检。`overlapToleranceSec` 偏小 → 边界轻微不齐就报警；偏大 → 真错位放过。
- **当前卡着**：`M-1d` 判据升 error；`M-1f` Q2 的告警可用性
- **必须一起校准**：`align-gate`（分开调会留下一道看着齐全、实则测不到的门）

### `reweigh-coverage-min` · 词时重铺的覆盖率阈值

- **类别**：实现期拟定
- **真源**：`src/core/word-timeline.ts#REWEIGH_COVERAGE_MIN`
- **当前值**：`REWEIGH_COVERAGE_MIN` = **0.8**
- **当前值从哪来**：**继承自 `highlightWords` 的原值 0.8，不是本项目验证过的结论** —— 它随显示层实现被搬进产物层，来源已不可考。kukini 修复后实测分布：最小 0.714 / 25%位 0.857 / 中位 0.900 / 最大 1.000。阈值 0.8 恰好把 7 条「首词比 SRT 窗口早约 10 帧」的边缘 cue 判为需重铺，而它们的词时**本是对的**（人说话起止略宽于字幕标注，非错位）。
- **怎么校准**：补齐 3月22日 / 5月28日后三条素材各跑一次，取覆盖率分布：① 阈值应落在「真漂移」与「边缘抖动」之间的**空隙**（kukini 上看是 0.714 之下）；② 交叉验证：低于阈值的 cue 是否真落进了静音（用 `silentWordRatio` 佐证），只有「既低覆盖、又落静音」才是真漂移。
- **越界后果**：偏高 → 真漂移漏修（本次已修的那条 cov=0.182 会漏掉）；偏低 → **把对的词时改坏**（本次 0.8 会误伤 7 条本正确的 cue）。⚠️ 第二个方向更隐蔽：重铺后画面看不出异常，只是高亮时机被人为改过。
- **当前卡着**：`M-1f` 的「好数据不被修坏」保证
- **必须一起校准**：`align-gate`（分开调会留下一道看着齐全、实则测不到的门）

## 四、已校准的样板：`MATCH_MIN_SIMILARITY = 0.35`

这是本项目第一条**有完整实测依据**的参数决策，可作其他参数的校准范式：

| 类别 | 实测相似度区间 |
|---|---|
| 正确匹配（5/6） | 0.655 – 1.000 |
| 正确匹配的例外：whisper 只听了一半 | 0.455 |
| 错位匹配（全部） | 0.000 – 0.154 |

两组之间有**巨大空隙**（0.154 → 0.455），取 **0.35** 落在空隙中央：既能救回「whisper 漏听后半句」（0.455 > 0.35），又能拒绝全部实测错位匹配（最高 0.154，2.3 倍余量）。

🔴 它**不是占位值**：文档虽未给数，但此值是从实测分布反推的，不属于「为实现可运行而编一个」。区别就在这里。

## 五、明确排除的拟定值

这些同样是"文档没给数"，但**不进占位值清单**，理由逐条写明：

| 参数 | 位置 | 为什么不收 |
|---|---|---|
| `maxAreaRatio / minEnergy` | `src/stages/region-derive.ts` | 启发式开关，语义本身即上界（「面积超 60% 就不算主体」），不是待实测的质量阈值 |
| `detectMaxSide / scoreThreshold / nmsThreshold` | `src/core/config.ts#PERCEIVE` | 对齐上游 opencv_zoo demo 的默认值，属上游惯例而非本项目拟定 |
| `MIN_DURATION_MS` | `src/stages/whisper-adapter.ts` | 技术兜底（避免零时长 token），非质量阈值，调它不影响判定口径 |
| `DUR.enter / DUR.exit` | `src/remotion/tokens.ts#DUR` | 第二轮已按真渲实测调优（expo-out 在 t=0.2 走完 75%），属「已调优、待真实素材复核」，与「未校准」不同类别 |
| `MATCH_MIN_SIMILARITY` | `src/stages/text-align.ts` | **已实测校准**（正确匹配 0.655–1.000 / 听漏半句 0.455 / 错位 ≤0.154 ⇒ 取 0.35 落在空隙中央），是 PARAM-DECISIONS 的正面样板，不是占位值 |

## 六、纪律

1. **新增条目先过收录判据**：文档未给数值或只给初值，且影响判定结论或成片几何。
2. **只引用不复制**：`read()` 必须 `() => 常量.字段`，禁止写字面阈值（有静态断言守着）。
3. **相关阈值一起校准**：`alignWith` 标出的必须同批定，不得分两次拍。
4. **校准完改 `kind` → 移到 §四**：有实测依据的参数不再是占位值，别让它留在清单里充数。
5. **改完重跑本脚本**：`npm run placeholders`，否则文档与代码分叉。
