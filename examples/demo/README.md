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
✅ 校验通过（checked=14 项 + 3 条起草原生约束, warning=2）
   ! W-F6-01 [face-s2] 区域 face-s2（face）为低置信检测结果
   ! W-F6-01 [s2] shot s2 的主体归属为低置信，安全区未确
```

- **0 error** —— 全部 footprint 都避开了人脸/手持物/B-roll 预算区
- **2 warning** —— 都是 `W-F6-01`，因为 `s2` 与其 `face-s2` 被**故意**标成低置信，
  用来演示「低置信不阻断、走人工兜底」这条通道

## 这个 demo 顺带演示了什么

- **锚点烘焙**：`draft.json` 里全是 `word:N` 锚点，没有一帧是手写的；
  `durationInFrames` 也全部省略，由 `max(模板 minVisibleInFrames, 锚定词区间长度)` 导出
- **动态阈值 T**：8 个 `sim_max` 走 elbow → `T = 0.641`
  （其中 `typo-main` 的第三个 item `sim_max=0.55` 低于 T，走 `custom` 产路 → 被地板锁到 `must_review`）
- **双栈分离**：`bg-punch`（`footage-transform`）落背景链串联，其余 7 项落叠加栈并列
- **禁配段**：`noMotionRanges` 里有一条片尾空镜区间

## 改它

`03-storyboard/draft.json` 是唯一需要手改的文件。
改完重跑 `storyboard` → `validate`，两者都是幂等的（同输入同输出，可直接 diff）。
