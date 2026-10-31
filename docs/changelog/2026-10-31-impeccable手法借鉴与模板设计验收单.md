# 2026-10-31 · impeccable 手法借鉴与模板设计验收单

> 把「渲出来好不好看」从人眼自觉升格为一张制度化的验收单。
> 均未提交（等用户指示）。

---

## 1. 模板设计验收单（文档）

**新增** [`docs/templates/2026-10-31-模板设计验收单.md`](../templates/2026-10-31-模板设计验收单.md)。

- 六维度检查单：目的与焦点 / 对比度与可读性（视频特有：背景是拍出来的）/
  排版与层级 / 时值与缓动 / 克制（一个强想法不堆技法）/ 令牌与体系一致。
- 修复顺序（先功能可读缺陷，后视觉抛光）+ 判例库（11 条，回收自项目与 Shotcraft 的「被裁判例」）。
- 来源：[`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) v4.8.0（Apache-2.0）的
  `animate.md` / `polish.md` / `audit.md`，**只蒸馏方法论与检查条目，未复制任何代码**。
- **为什么不是第 19 项校验**：五条维度是审美判断，机器判不了；强制门的误报会吃掉信任。
  约束力来自流程挂接（§2）与判例回填（每次过单发现新判例回填判例库）。

## 2. 流程挂接

- `SKILL.md` 创作期动效生成流程表第 3 与第 4 步之间插入：对着画廊三帧过验收单，
  问题回填配方卡 `pitfalls`，再走 `motion:accept` 六道验收。
- 定位：**六道验收管「能不能用」，验收单管「好不好看」**；验收单不阻断入库。

## 3. 配方卡新增 `designIntent`（设计意图）栏

- `src/templates/types.ts` 的 `SpecDoc` 加可选字段 `designIntent?: string`
  （键名避开 `intent`——那是 motionboard 受控词表的绑定键，语义已占用）。
- 22 张配方卡全部补齐一句话「这个动效解释什么」：
  - `src/templates/builtin.ts` 14 张（tsx 模板）；
  - `templates/specs/*.json` 8 张（spec 模板，写在 `_doc` 内）。
- 安全性：`_doc` 在 `canonicalSpecHash` 剥离名单内（P0-3 起），补文档不影响签章与装载；
  doc-recipe 测试锁死的三条性质（不破坏装载 / 不影响签章 / 能流到消费端）均未触碰。

## 4. 明确不借的（同 P1-1 裁决精神）

| 不借 | 理由 |
|---|---|
| 62 条规则检测器（二进制引擎） | 扫渲染后 DOM，视频输出没有触控目标/键盘焦点/视口溢出 |
| `npx impeccable install` 全套 | 20+ 目录 + 二进制 + 第二工具面 |
| a11y / 响应式 / 触控章节 | 固定 1080p 无此概念；「对比度」改造为维度 B（对真实视频背景验） |
| 毫秒时值表 | 交互延迟经验值；视频数值归《参数手感表》 |
| 0–4 分 / 20 分总分 | 审美评分数字化看似客观实则误导；用「过/不过 + 证据 + 判例」 |

## 5. 验证

- `npm run typecheck`、`npm test` 全过（本次未新增测试：`designIntent` 为可选文档字段，
  doc-recipe 既有测试已覆盖「_doc 可自由增改」的三条性质）。
- 后续维护：新模板过单发现新判例 → 回填验收单 §3 判例库。

## 6. 验收单首次实测（同日）：pulse-accent@0.1 入库

按 SKILL.md 创作流程完整走了一遍：起草 `custom/pulse-accent@0.1`（本仓第一个动
`color` 轨的 spec：全亮 brand → 半亮 inkDim 余韵的渐弱双脉冲，驻留期强调语义，
与 8 份基线 spec 的「入场/揭示」类全部不同）→ `motion:accept` 六道门 → 画廊 23×3 帧 →
按验收单六维读图过单。

- **门 1 拦**：color 轨禁写 ease（颜色是阶跃）——已写进配方卡 pitfalls。
- **门 4 拦**：对称双呼吸的三个验收探针有两个落同一状态（违反「动效贯穿」）——
  改成渐弱双脉冲（第二口降档 inkDim），设计改进与过门是同一件事。判例已进验收单 §3。
- **过单维度 B 抓到**：spec 通道没有 onLight 机制，inkDim/brand 在亮底实拍上的
  表现未经验证——pitfall 已补进配方卡，上真素材前必须真渲抽帧。
- **连带修掉三处计数绊线**：doc-recipe 与 template-gallery 测试里写死的 8/22/66，
  改为「基线钉线（8 / ≥22）+ custom 库动态」，钉总数会在每落一个 custom 模板时误报。
- **外部事件收尾**（同日，用户两步裁决）：`examples/demo/**` 与 `jobs/.gitkeep` 系用户
  有意删除（根目录去杂物），且明确**不要任何形式的假数据目录**（否决了挪 `tests/fixtures/`
  的方案）。最终处置：原 demo 的六份**输入**产物（source / align-report / words / shots /
  regions / motionboard）内嵌为代码模块 `tests/fixtures/e2e-job.ts`（14→18KB，出处 git
  历史 ≤ b83caac），`writeE2EFixture()` 运行时写入临时目录、跑完即删——**仓库零假数据文件，
  集成覆盖恢复全量**。接线更新：pipeline-e2e 五项测试、verify 的 e2e 段、doctor 提示语、
  cli-state 两处注释、README「验证管线本身」一节、SETUP §③、PROGRESS §八。
  实测：860/860 全过；verify e2e 段 17s 真跑通过（validate 18 项 + 渲染闸双向）。
