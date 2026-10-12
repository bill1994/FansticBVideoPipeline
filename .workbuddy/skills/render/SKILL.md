---
name: render
description: >-
  Remotion motion-graphic overlay 管线的第 5 步「render」。当 04-validate 报告全过（ok=true）、需要把 storyboard.json
  映射为 Remotion 工程并本地渲染出片时使用。负责 C6 双栈映射、确定性约束与渲染执行。
  不用于对齐、感知、storyboard 起草或校验。
agent_created: true
---

# render —— Remotion 映射与渲染

> **管线位置**：第 5 步 / 共 5 步
> **上游**：`03-storyboard/storyboard.json` + `04-validate/validate-report.json`（**必须 `ok === true`**）
> **下游**：`05-render/` —— Remotion 工程 + 成片 `out.mp4` + 渲染日志

## 何时触发

- `04-validate` 报告 `ok: true`（**无 error**）时。
- 报告存在 error 时**不得触发本阶段** —— 回去走 `validate` 的人工返修回路。

## 职责一：把 storyboard 映射成 Remotion 组件树

### ① 时间映射 —— 每 track 一个外层 Sequence

```
外层：<Sequence from={trackStart} durationInFrames={trackDuration}>
        其中 trackStart   = min(所有 item.fromFrame)
              trackDuration = max(item.fromFrame + durationInFrames) − trackStart
内层：  <Sequence from={item.fromFrame − trackStart}
                 durationInFrames={item.durationInFrames}>
          {渲染该 motion}
```

外层的唯一意义是**把绝对帧转成轨道内相对帧**。否则轨道一重排，所有内层 `from` 全得改。

> **禁用 `<Series>`。** 它的语义是「依次播放」，内部自动把后一个起点算作前一个的终点 —— **结构上无法表达重叠**，与硬约束 3（动画可持续交叉、多轨并行）直接冲突。用 `<Series>` 写出的 storyboard 一定是串行的，这是**语义级错误**，不是实现细节。

### ② z 序 —— 排序后嵌套，不用 z-index

按 `(layer 升序, trackIndex 升序)` 排序后，依次嵌套为 `<AbsoluteFill>` 的子元素：

- `layer` 小 → 先嵌套 → 在下
- 同 `layer` → `trackIndex` 大（后声明）→ 在上

**禁用显式 `z-index`**，三个理由：

1. 静态 `z-index` 无额外收益，反而留下「将来要动态 z 就不够用」的包袱
2. **`transform` 会创建新的层叠上下文**，`z-index: 999` 只在同层叠上下文内生效 ——「设了 999 却因父级有 transform 而失效」极难排查
3. DOM 顺序是确定性规则，没有这种歧义

### ③ 双栈分离 —— 最易出错处

| scope 类别 | 作用于 | 渲染位置 | 关系 |
|-----------|-------|---------|------|
| `subject-transform` / `footage-transform` | **实拍视频本身**（裁切、缩放） | **背景链** | **串联**：依次嵌套施加 |
| `overlay-safe` / `under-subject` / `anchored` / `fullscreen` | 画面之上的叠加层 | **叠加栈** | **并列** |

把载体类塞进叠加栈会出现**语义倒置** —— 它成了「盖在视频上的一层」，而正确行为是「改变视频的呈现」。两者 z 序关系恰好相反：载体类永远在最底层且需独占视频元素，多个载体类必须依次嵌套施加 transform（裁切 → 缩放 → 再裁切）。

> **一个串联、一个并列，塞进同一数据结构必然生成错误代码。**

## 职责二：守住确定性红线

> **真正的红线只有一条：任何动画的推进权必须属于 `frame`，不能属于库自己的 ticker。**

**允许**（只要以帧驱动模式接入）：

```js
// GSAP：paused timeline + progress seek
const tl = gsap.timeline({ paused: true });
tl.to(el, { opacity: 1, duration: 0.3 });
tl.progress(frame / durationInFrames);

// GSAP 仅作值计算器，不跑真实动画循环
const eased = gsap.parseEase("power2.inOut")(progress);

// Three：动画只认 useCurrentFrame，禁用 R3F 的 useFrame()
const frame = useCurrentFrame();
rotation.set((frame / fps) * Math.PI);
```

**禁止项**

| 禁止项 | 原因 |
|--------|------|
| `Date.now()` / `performance.now()` | 墙钟时间，非确定性 |
| `Math.random()` | 伪随机须固定种子（`mulberry32`），**seed 从 item index 派生** |
| CSS `animation` / `transition` | **house rule**（见下） |
| R3F 的 `useFrame()` | 墙钟驱动，脱离帧同步 |
| GSAP 的自走 ticker（非 `paused`） | 同上 |

**CSS animation 是 house rule，不是平台限制。** Remotion 官方文档明确给出了帧同步解法（`animation-play-state: paused` + 负 `animation-delay`）。我们仍禁，理由两条且都成立：

1. **可静态检查性** —— 负 delay 方案仍要求每帧算 `-(frame/fps)` 写进 style，等于把 CSS 动画改写成帧驱动，绕一圈不如直接用 `interpolate()`
2. **lint 成本** —— `animation-delay` 的负值随帧变化，静态规则难以判定「这个 delay 是否与当前帧匹配」

前五条都能用 lint 规则静态扫出（禁 `Date.now` / `Math.random` / CSS animation / `useFrame` / 非 paused timeline）。

## 职责三：版本与运行环境（锁死，不得漂移）

| 项 | 值 |
|----|-----|
| Remotion 版本 | **锁 `4.0.534` 精确版**；`npm i --save-exact remotion@4.0.534 @remotion/xxx@4.0.534`，**禁止 `^`** |
| 为什么锁 | 4.0.x patch 每 2–3 天一个，不锁必然漂移；且官方扩展包**必须与主包严格同版本** |
| 升级节奏 | 显式手动升级，不设 `latest`；每次升级跑一次全量渲染回归 |
| Node | **22.19+ / 24+** |
| GPU 配置 | **必须显式 `--gl=angle`** —— 4.0.x 必填，漏了 Chrome Headless Shell 可能产出**空白 canvas** |

> 当前不存在 5.x 版本线。

## 职责四：渲染方式

- **本地渲染**，不绑 Lambda。理由：成本最低、无云依赖；首次渲染耗时长可后台跑。
- **先量基准**：10 分钟成片的**墙钟时长 + CPU 峰值**。基准出来再决定是否上云；若上云走 Lambda 分片并行（需验证 80 分钟 HD 时长限制）。
- 分段渲染 `lock.json`（改哪页渲哪页、未改复用）**实现期暂不做**，待基准出来、若决定上云再评。

## fps 与烘焙绑定

`meta.fps` 是**顶层固化值**。**改 fps 会让全部已烘焙 `fromFrame` 语义漂移** —— 改 fps 必须**重新烘焙**，不允许跨 fps 复用 storyboard。

## 渲染期兜底校验

以下三类只能在渲染时暴露，属 `04-validate` 的渲染期分支，用同一报告结构（`stage: "render"`）：

| 情形 | code |
|------|------|
| 字体未加载 | `E-RT-01` |
| Canvas 未挂载（`delayRender` 超时） | `E-RT-02` |
| GPU 上下文创建失败 | `E-RT-03` |

## 必须停条件

文档 §10.4 给本阶段的「必须停」标记是 **`—`（无门控）** —— 因为阻断已在前一步的 `validate` 用掉了。
但以下**四种情形拒绝启动或立即中止**，不许硬跑：

| 情形 | 处置 |
|------|------|
| `04-validate/validate-report.json` 的 `ok !== true` | **拒绝启动**。回去走 `validate` 的人工返修回路，不许「先渲出来看看」 |
| storyboard 的 `meta.fps` 与本次渲染 fps 不一致 | **停** —— 全部已烘焙 `fromFrame` 语义已漂移，必须**重新烘焙**，不允许跨 fps 复用 storyboard |
| 版本未锁死（含 `^`）或缺 `--gl=angle` | **停**，先修环境。带着这两个问题渲出来的多半是空白 canvas |
| **storyboard 内有 `fullscreen` 项，但未被 `06-review/confirmed.json` 的 `acknowledgedFullscreen` 全部覆盖** | **拒绝启动**（**D3-a**）。`fullscreen` 必然覆盖全画面，D3 规定一律人工确认、**不设自动放行规则** |

> **为什么这条闸在本阶段而不是 `validate`**：确认记录产在 `06-review`，而 `validate` 的输入边界只到 `03`/`01`/`02`，**它读不到** —— 这是「谁有资格拦」的问题，不是「谁愿意拦」的问题。`validate` 只出 `W-D3-01` 预告（不阻断）。**例外只应该有这一条。**

`06-review/confirmed.json` 的相关字段：

```jsonc
{
  "stage": "render",
  "reason": "fullscreen 类 motion 覆盖全画面，人工确认后放行",
  "confirmedBy": "人工署名",
  "confirmedAt": "ISO 时间",
  "acknowledgedFullscreen": ["fs-track/000"]   // 必须覆盖 storyboard 内全部 fullscreen item ref
}
```

## 产物（落 `05-render/`）

文档对 `05-render/` 的规定是「Remotion 工程 + 成片 `out.mp4` + 渲染日志」。工程目录名为实现建议。

| 文件 | 来源 | 内容 |
|------|------|------|
| `remotion/` | 【文档指定：Remotion 工程】 | 组件树由 storyboard 映射生成（目录名为实现建议） |
| `out.mp4` | 【文档指定】 | 成片 |
| `render.log` | 【文档指定：渲染日志】 | 含墙钟时长、CPU 峰值 |

> 成片是链路末端。**`06-review/` 的放行信息不得回写进本阶段产物**，反之亦然。

## 失败与退出码

| 情形 | 处置 |
|------|------|
| `04-validate` 报告 `ok !== true` | **拒绝启动**，退出码 `1` |
| 参数错（版本未锁、缺 `--gl=angle`） | 退出码 `2` |
| 渲染失败 / 产出空白 canvas | 退出码 `4` |
| 排队超时 | 退出码 `5` |
| 内部错误 | 退出码 `6` |
| 用户中断 | 退出码 `130` |

## 落盘检查清单

- [ ] `04-validate` 报告 `ok === true`（无 error）才开始
- [ ] 每 track 有且仅有一个外层 `<Sequence>`，内层用**相对偏移**
- [ ] 代码中**零出现** `<Series>`
- [ ] z 序由 `(layer, trackIndex)` 排序 + DOM 嵌套实现，**零出现显式 `z-index`**
- [ ] 载体类走背景链串联，叠加类走叠加栈并列，**未混栈**
- [ ] 无 `Date.now` / `performance.now` / `Math.random` / CSS animation / `useFrame` / 非 paused GSAP ticker
- [ ] 需要的伪随机已用 `mulberry32`，seed 从 item index 派生
- [ ] `remotion` 与所有 `@remotion/*` 版本**严格等于** `4.0.534`，无 `^`
- [ ] 渲染命令**显式带 `--gl=angle`**
- [ ] 渲染日志记录了墙钟时长与 CPU 峰值（基准量化）
- [ ] 未修改 `03-storyboard/` 或任何上游产物
