# examples/demo —— 端到端示例 job

一个**不需要真实素材**的完整 job，用来验证管线本身跑得通。
所有输入都是手写的 fixture，不调用任何模型。

## 目录内容

| 目录 | 来源 | 说明 |
|------|------|------|
| `00-input/` | 手写 | 只有 `source.json` 清单，**没有真实视频** |
| `01-align/` | fixture | 60 个词的时间戳 + 6 条 cue，已通过门控 |
| `02-perceive/` | fixture | 5 个 shot（含 2 个 B-roll）+ 6 个区域（人脸/手持物/B-roll） |
| `03-storyboard/` | **起草稿 → 本管线产出** | `draft.json` 是手写的（等价于「模型产出」）；`storyboard.json` + `bake-report.json` 由 `storyboard` 阶段烘焙 |
| `04-validate/` | **本管线产出** | `validate-report.json` |
| `05-render/` | **本管线产出** | `render-props.json`（dry-run 产物，未真正渲染） |

## 怎么跑

```bash
npm install

npm run pipeline -- storyboard --job demo --jobs-dir examples --draft examples/demo/03-storyboard/draft.json
npm run pipeline -- validate   --job demo --jobs-dir examples
npm run pipeline -- render     --job demo --jobs-dir examples --dry-run
```

`align` / `perceive` 在这个 job 里被跳过 —— 它们需要外部模型适配器
（见主 README 的「外部工具适配」），而 demo 的 `01-align` / `02-perceive`
已经是它们的等价产出。

## 预期结果

```
✅ 校验通过（checked=17 项 + 2 条起草原生约束, warning=2）
   ! W-F6-01 [face-s2] 区域 face-s2（face）为低置信检测结果
   ! W-F6-01 [s2] shot s2 的主体归属为低置信，安全区未确
```

- **0 error** —— 全部 footprint 都避开了人脸/手持物/B-roll 预算区
- **2 warning** —— 都是 `W-F6-01`，因为 `s2` 与其 `face-s2` 被**故意**标成低置信，
  用来演示「低置信不阻断、走人工兜底」这条通道

## 这个 demo 顺带演示了什么

- **锚点烘焙**：`draft.json` 里全是 `word:N` 锚点，没有一帧是手写的；
  `durationInFrames` 也全部省略，由 `max(模板 minVisibleInFrames, 锚定词区间长度)` 导出
- **负偏移＝抢拍（C2-5a 的回归证据）**：8 条锚点里有 5 条用 `-8f`（抢在词前 8 帧），
  它们**全部通过**时序校验；剩下 3 条（`word:40` / `word:30` / `word:50`）保持 `+2f`，
  因为它们的词**正好是所在 cue 的首词** —— 负偏移会跨过 cue 起点，那是真错位。
  一个示例同时展示「负偏移合法」和「跨 cue 才拦」两侧
- **动态阈值 T**：8 个 `sim_max` 走 elbow → `T = 0.641`
  （其中 `typo-main` 的第三个 item `sim_max=0.55` 低于 T，走 `custom` 产路 → 被地板锁到 `must_review`）
- **双栈分离**：`bg-punch`（`footage-transform`）落背景链串联，其余 7 项落叠加栈并列
- **禁配段**：`noMotionRanges` 里有一条片尾空镜区间（校验项 #15）

## 改它

`03-storyboard/draft.json` 是唯一需要手改的文件。
改完重跑 `storyboard` → `validate`，两者都是幂等的（同输入同输出，可直接 diff）。

### 🔴 两条纪律（都踩过）

1. **不许给 `draft.json` 里的 motion 写颜色键**（如 `highlightColor`）。
   `caption/karaoke-word` 的 `paramsSchema` 按 P1 硬约束**刻意只声明 `boxed`** ——
   颜色由渲染期按命名令牌（`'brand'` / `'accent'`）解析，不经 `params`。
   写了就会被校验项 #16 判 `E-P1-01`（未声明键）**阻断**。
2. **要改下游产物，改 `draft.json` 再重跑，别手改 `storyboard.json`。**
   `draft.json` 才是「模型产出」的等价物；`storyboard.json` 是烘焙快照。
   手改快照会让第 1 条的错误被掩盖 —— `validate` 直接跑是绿的，
   一旦按上面「怎么跑」重跑 `storyboard` 就立刻复现阻断，文档与实测自相矛盾。
   （本仓库 2026-10-16 修过一次这个错层修复。）
