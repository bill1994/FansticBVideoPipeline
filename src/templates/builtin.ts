/**
 * 首批模板清单。
 *
 * ✅ 清单与契约值已定：`docs/templates/2026-10-13-模板库首批清单.md`
 *    （首批 10 个，逐个模板的`layer` / `occludesSubject` / `footprint` /
 *    `minVisibleInFrames` 推导依据，以及 7 条扩补纪律均在文档中）
 *
 * 真源：SPEC §3（双轴框架 + §3.5 首批清单指向）。
 *
 * 三个容易踩的点（文档 §2.2 有详述，此处只留提醒）：
 * - `scope` 与 `occludesSubject` 是**两个独立维度** ——
 *   `ambience/noise-grain` 是 fullscreen 但 `occludesSubject: false`。
 * - `caption/karaoke-word` 的 `paramsSchema` **不含 `text`** ——
 *   字幕文本来自 SRT，不是模型自由填写。
 * - 依赖 perceive 主体框的两个模板标 `experimental`，
 *   因 perceive 模型尚未接入（`PERCEIVER_CMD` 未配置时退出码 2）。
 *
 * ⚠️ 2026-10-16：D-A 新增第 11 个成员（`typography/center-emphasis`）——
 *    它是首批清单（10 个）之外的新增，依据为
 *    `docs/proposals/2026-10-15-DA与DB裁决材料.md`（A1 方案）。
 *
 * 版本已锁：`@1.0`。升级走 `@1.1` 新增，**不改旧 storyboard**。
 */

import type { TemplateDeclaration } from './types.ts';

export const BUILTIN_TEMPLATES: TemplateDeclaration[] = [
  // ── caption（B6 必备家族）────────────────────────────────────
  {
    id: 'caption/karaoke-word@1.0',
    family: 'caption',
    subtype: 'karaoke-word',
    version: '1.0',
    doc: {
      summary: '底部字幕带，说到哪个字哪个字变亮；文本来自 SRT，不由 params 填写。',
      fits: ['有字幕的口播全程', '需要逐字阅读引导'],
      energy: 'low',
      designIntent: '解释阅读进度：说到哪个字哪个字亮。它是字幕通道不是强调戏，唯一的动效语言就是高亮本身——所以刻意不加任何位移。',
      params: [
        { key: 'boxed', typical: 'true（实拍推荐）', feel: 'false 无底板，亮背景下白字会看不清' },
      ],
      pitfalls: [
        '高亮 scale 写死 1.06：>1.15 会挤动相邻词排版、整句字幕抖动',
        '不要给它加整体位移 —— 一移就与「哪个字亮」抢注意力',
      ],
    },
    scope: 'overlay-safe',
    layer: 90,
    occludesSubject: false,
    status: 'core',
    // 🔴 刻意**不含 `text`**（P1）：字幕文本来自 SRT，不是模型自由填写。
    //    模型若也能写 text，就会出现「字幕与语音对不上」，而时序校验只看帧区间、
    //    任何校验项都拦不住。
    // 🔴 刻意**不含 `highlightColor`**：Spec 附录 A 第 1 条硬约束明文
    //    「禁写坐标 / 帧数 / **颜色** / CSS」。留着它等于让模型能硬编码色值。
    //    高亮色由渲染期按命名令牌（'brand' | 'accent'）解析，不经 params。
    paramsSchema: { boxed: 'boolean' },
    // `boxed` **不标必填**：它有天然默认值（无框），强制模型写 `boxed:false`
    // 是纯噪音，违反「不让模型为默认值做无谓决策」的立法意图。
    // ⚠️ 本模板因此**没有任何必填参数** —— 字幕的一切都来自 SRT。
    footprint: [0.1, 0.86, 0.8, 0.1],
    minVisibleInFrames: 12,
  },

  // ── typography ──────────────────────────────────────────────
  {
    id: 'typography/kinetic-line@1.0',
    family: 'typography',
    subtype: 'kinetic-line',
    version: '1.0',
    doc: {
      summary: '中部偏左的强调大字，逐字切出、短暂停留，左侧带一道强调竖条。',
      fits: ['一句话里的核心强调词', '结论句'],
      energy: 'mid-high',
      designIntent: '注意力引导：把视线钉到结论句的核心词上，左侧竖条是视线落点。强调但不遮蔽——footprint 压在中部偏左就是给主体让位。',
      params: [
        { key: 'text', typical: '1–6 字', feel: '字数越多字号感越挤' },
        { key: 'enter', typical: 'from-left', feel: 'pop 最抓眼（起始放大 18% 再回落），长文本慎用' },
      ],
      pitfalls: [
        '实测约 14 字溢出（16 字铺满 806px 框）；nowrap 不折行也不会自动缩放',
        '未知 enter 预设静默回退 from-left，不报错',
      ],
    },
    scope: 'overlay-safe',
    layer: 60,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { text: 'string', enter: 'string' },
    requiredParams: ['text'], // enter 有天然默认值，可选
    footprint: [0, 0.72, 0.42, 0.18],
    minVisibleInFrames: 30,
    // D-B：fontSize 与组件 `kinetic-line.tsx` 的 54 一致；
    // paddingPx = paddingLeft 16 + borderLeft 4（左侧竖条也占宽）
    // latinWidthEm：D-B2 实测（2026-10-24）—— 数字 0.617em
    textMetrics: { fontSizePx: 54, paddingPx: 20, latinWidthEm: 0.617 },
    // 🔴 原`handoffIn: 'from-left'` 已删除（2026-10-15，问题 9 审计）。
    //
    //   删除理由（三条，缺一不可）：
    //   1. **零消费**：全仓检索（src/ tests/ tools/）确认无任何代码读它。
    //   2. **与 `enter` 语义重复**：本模板的 `enter: 'from-left'` 说的是同一件事
    //      （从左侧入场），且 `enter` 在 `paramsSchema` 里 —— 模型**能填**、
    //      渲染期**真消费**（4 个预设 + 单测覆盖）。两份并存必有一份是死的，
    //      而死的恰好是 `handoffIn`。
    //   3. **它连模型都填不了**：`handoffIn` 不在 `paramsSchema` 中，
    //      模型按契约只能填 `enter`；而校验项 #16 只校验 `params`，
    //      碰不到模板声明本身 ⇒ 这个字段从设计上就是只读的、无人可写的。
    //
    // 保留 `enter` 作为**唯一**的入场方式。若将来接力确需区分
    // 「常规入场」与「接力承接入场」，应**扩展 `enter` 的取值枚举**
    // （如 `enter: 'handoff-from-left'`），而不是平行加一个字段。
    // 见 docs/changelog/2026-10-15-契约字段审计.md。
  },
  {
    id: 'typography/lower-third@1.0',
    family: 'typography',
    subtype: 'lower-third',
    version: '1.0',
    doc: {
      summary: '贴左滑入的姓名 / 职务双行条，方角深色底板。',
      fits: ['首次介绍人物', '身份 / 职务说明'],
      energy: 'low',
      designIntent: '引入身份状态：回答「现在说话的人是谁」。贴左滑入的空间语义是「从画面外来、留在画面里」，所以出场也向左推出而不是凭空淡掉。',
      params: [
        { key: 'title', typical: '2–10 字', feel: '姓名；实测 16 字时文本溢出条形背景' },
        { key: 'subtitle', typical: '可选', feel: '留空单行、有值双行；空串与整个键缺失等价' },
      ],
      pitfalls: [
        'title 过长会撑破底板（nowrap 使其长过 footprint）',
        '出场用「向左推出」而非淡出：条形信息从哪来回哪去才符合直觉',
      ],
    },
    scope: 'overlay-safe',
    layer: 60,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { title: 'string', subtitle: 'string' },
    requiredParams: ['title'], // subtitle 可选
    footprint: [0.05, 0.78, 0.5, 0.14],
    minVisibleInFrames: 45,
    // D-B：按**主文本 title** 判定（副标题 17px 更小，不是最宽的那行）
    // paddingPx = 左右 26 + 20（见 lower-third.tsx 的 padding 与 borderLeft）
    // latinWidthEm：D-B2 实测（2026-10-24）—— 数字 0.620em
    textMetrics: { fontSizePx: 26, paddingPx: 50, latinWidthEm: 0.62 },
  },
  {
    id: 'typography/tag-float@1.0',
    family: 'typography',
    subtype: 'tag-float',
    version: '1.0',
    doc: {
      summary: '右上浮动的关键词气泡，进出场非对称（进上浮 24px / 出下沉 16px）。',
      fits: ['短标签', '关键词强调'],
      energy: 'mid',
      designIntent: '标记关键词：轻量地说「这个词值得注意」。上浮 24px 的语义是「浮上来」——再大就成「从别处飞进来」，标注变成了搬运。',
      params: [{ key: 'text', typical: '2–6 字', feel: '字数越多越容易撑破胶囊框' }],
      pitfalls: [
        '实测约 13 字溢出（撑破 240px 胶囊框）',
        '上浮距离 >40px 会被读作「从别处飞入」，>24px 起就不再是「浮」',
      ],
    },
    scope: 'overlay-safe',
    layer: 60,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { text: 'string' },
    requiredParams: ['text'],
    footprint: [0.5, 0.1, 0.3, 0.2],
    minVisibleInFrames: 36,
    // D-B：fontSize 与组件一致；paddingPx = 左右 20×2
    // latinWidthEm：D-B2 实测（2026-10-24）—— 数字 0.615em
    textMetrics: { fontSizePx: 24, paddingPx: 40, latinWidthEm: 0.615 },
    // 🔴 原 `handoffIn: 'fade-up'` 已删除（2026-10-15，问题 9 审计）。
    //   理由同`kinetic-line` 那处：零消费 + 语义与入场方式重复 + 不在
    //   `paramsSchema` 内故模型无法填写。本模板的入场方式由
    //   `templates/tag-float.tsx` 固定为「上浮 +24px」，无需声明式表达。
  },
  {
    // ── P1-3（2026-10-27）：「借手法不抄代码」路线的第一个落地模板 ──
    // 手法借自 `video-shotcraft` @ 43bd349 的 `marker-underline-title` **手法文档**
    // （Apache-2.0，未复制源码）。借来的是时值配比：划线 10f（原文「14f 版被裁偏慢」）、
    // 字底 -0.1em、左低右高（原文「画反一眼假——返工判例」）、中段宽首尾收细。
    // · 与 `custom/rule-underline@1.0` **不是变体关系**：那是不倾斜、等宽、纯色的
    //   制图式直线；本模板是微上斜、变宽、边缘柔化的人手马克笔。两者可并存。
    // · `status: 'experimental'`：新模板未经真实素材验证，按准入纪律不标 core。
    id: 'typography/marker-underline@1.0',
    family: 'typography',
    subtype: 'marker-underline',
    version: '1.0',
    doc: {
      summary: '标题落定后，关键词下方一笔手绘马克笔从左到右划过（微上斜、变宽、墨色渗开）。',
      fits: ['标题里强调单个词', '手写感 / 有人味的调性', '正文式标注'],
      energy: 'low',
      designIntent: '模拟人手圈重点：划线是看完标题后补的一笔强调，不是另一个信息层——所以必须晚于标题落定起笔，且自己不带入场动画。',
      params: [
        {
          key: 'text',
          typical: '2–8 字（与标题同字号）',
          feel: '划线宽度跟随文字；超过一屏宽的 2/3 时线会显得比字更抢',
        },
        {
          key: 'onLight',
          typical: 'true / false（默认 false）',
          feel: '画面是**亮底**时置 true：文字转深墨、线转深橙、去掉黑描边。白底上不置会几乎看不见',
        },
      ],
      pitfalls: [
        '划线 10f 是实测节奏：**14f 版被裁偏慢**，>14f 读作进度条',
        '左低右高是硬约束 —— **画反一眼假**（借用方的返工判例）',
        '起笔必须晚于标题落定 +4~8f：同动会抢戏，划线是「看完标题后的强调」',
        '不用 rule-underline 替代：等宽直线读作分隔线，没有「人拿笔圈重点」的语义',
      ],
    },
    scope: 'overlay-safe',
    layer: 60,
    occludesSubject: false,
    status: 'experimental',
    paramsSchema: { text: 'string', onLight: 'boolean' },
    requiredParams: ['text'],
    // 高度给足：文字行高 + 下方 -0.1em 的划线与渗开层
    footprint: [0.18, 0.58, 0.64, 0.22],
    minVisibleInFrames: 30,
    // 字号 54 与 `kinetic-line` 相同 ⇒ latinWidthEm 直接复用其 D-B2 实测值 0.617
    //（不比自编一个数诚实：同字体同字号的 em 度量必然一致）
    textMetrics: { fontSizePx: 54, paddingPx: 0, latinWidthEm: 0.617 },
  },
  {
    // ── P1-3 第二个落地模板（2026-10-27）──
    // 手法借自 `video-shotcraft` @ 43bd349 的 `outline-word-fill`（Apache-2.0，未复制源码）。
    // 与 center-emphasis 的区分：那张是**实心白字+底板**静态压上去；
    // 这张是**先空心后实心**，靠"第 54 帧硬切点亮"制造冲击，两者语义不同、可并存。
    // 🔴 `occludesSubject: true`：点亮后是实心大字，客观上遮挡（不学"声明 true 却不遮挡"那种写法）。
    id: 'typography/outline-fill@1.0',
    family: 'typography',
    subtype: 'outline-fill',
    version: '1.0',
    doc: {
      summary: '3.2 倍空心大字急缩落位，虚线环慢收锁定，第 54 帧一帧硬切成实心白热字、一闪辉光定格。',
      fits: ['单词式利益点', '节奏卡点上的"钉子"', '需要最强视觉冲击的一句话'],
      energy: 'high',
      designIntent: '节奏卡点上的一记钉子：空心收缩是蓄势、虚线环慢收是瞄准，第 54 帧一帧硬切是释放——整条动效只为点亮那一个瞬间服务。',
      params: [
        {
          key: 'text',
          typical: '2–6 字（84px 空心字，占画宽约 1/3）',
          feel: '字越多空心越像"气球框"；超过 8 字建议换 center-emphasis',
        },
        {
          key: 'onLight',
          typical: 'true / false（默认 false）',
          feel: '画面是**亮底**时置 true：描边转深灰、点亮色转深橙、辉光转深色扩散',
        },
      ],
      pitfalls: [
        '🔴 点亮必须是**一帧硬切**：任何 >3f 的慢扫都会把"钉子"降级成美化动画（原文判例）',
        '空心字字重必须 500：700+ 会让 2px 细描边包住一大块空白，读作气球字',
        '辉光只留 8f：持续辉光读作"发光字体"，质感立刻廉价',
        '圆环 44f 的慢收是全片的"呼吸"，压到 20f 会和字的 11f 撞在一起，快慢对比消失',
        '需要 ≥90f 的 cue（约 3s）：太短时整条节拍被等比压缩，冲击力会削弱',
      ],
    },
    scope: 'overlay-safe',
    layer: 70,
    occludesSubject: true,
    status: 'experimental',
    paramsSchema: { text: 'string', onLight: 'boolean' },
    requiredParams: ['text'],
    // 🔴 高度必须够：圆环直径取 footprint **短边**（meet），
    //    0.46×1080≈497px ⇒ 圆≈477px，才能包住 4 字 ×84px≈336px 的字。
    //    曾经给 0.3（324px），结果圆比字小、字溢出环外（2026-10-27 实渲发现）。
    footprint: [0.15, 0.28, 0.7, 0.46],
    minVisibleInFrames: 90,
    // fontSize 与组件一致（84）；无底板故 paddingPx 0。
    // 🔴 latinWidthEm = **0.587**，不是同字体 700 字重的 0.616 ——
    //    本模板空心字用 500 字重（原文判例：700+ 会糊成气球字），数字明显更窄。
    //    这正是 D-B2 要逐模板实测的原因：字重一变，em 系数就变。
    textMetrics: { fontSizePx: 84, paddingPx: 0, latinWidthEm: 0.587 },
  },
  {
    // ── P1-3 第三个（也是最后一个）落地模板（2026-10-27）──
    // 手法借自 `video-shotcraft` @ 43bd349 的 `gradient-word-sweep`（Apache-2.0，未复制源码）。
    // 三层叠：渐变彩层被 clip-path 揭开 + 波前高光带 + 填满后跳闪电。
    // 🔴 三个关键判例：波前必须有**梯度**（无梯度＝静态渐变裁切）；
    //    泛光封顶 0.72（0.75+ 被裁"泛光感有点强"）；**禁跟随光点**（被裁"廉价装饰"）。
    id: 'typography/gradient-sweep@1.0',
    family: 'typography',
    subtype: 'gradient-sweep',
    version: '1.0',
    doc: {
      summary: '关键词被渐变彩光从左扫过"充能"：波前最亮、向后衰减，填满后跳细闪电、整词泛光呼吸。',
      fits: ['卖点词充能', '能量高潮段的文字戏', '黑场标语里的关键词'],
      energy: 'high',
      designIntent: '用充能的过程感解释「这个词正在变重要」：波前扫过是注入，闪电是能量外溢。可读的是过程，不是最终颜色多好看。',
      params: [
        {
          key: 'text',
          typical: '2–6 字（84px / 900 字重）',
          feel: '字越多扫充跨度越长；超过 8 字"扫过"的过程会失去冲击',
        },
        {
          key: 'onLight',
          typical: 'true / false（默认 false）',
          feel: '亮底时底层文字转深墨（渐变彩层与辉光不变，它们在亮底上依然可见）',
        },
      ],
      pitfalls: [
        '🔴 波前必须带**梯度**（前亮后暗）：没有它就是"把字涂成彩色"，不是"充能"（原文判例）',
        '泛光封顶 0.72：0.75+ 档被裁"泛光感有点强"；辉光层数 <3 会读作纯色',
        '🚫 **填充过程中不要加跟随移动的光点**：原文实测判例「读作廉价装饰，删」',
        '闪电要稀疏：同屏 ≤1 道、间歇 >8f、持续约 6f；频率高读作电弧故障',
        '扫充 15–20f：>28f 读作进度条',
      ],
    },
    scope: 'overlay-safe',
    layer: 62,
    occludesSubject: false,
    status: 'experimental',
    paramsSchema: { text: 'string', onLight: 'boolean' },
    requiredParams: ['text'],
    footprint: [0.15, 0.55, 0.72, 0.2],
    minVisibleInFrames: 60,
    // fontSize 与组件一致（84）；拉丁系数为 D-B2 实测值（900 字重与 700 的差异 <0.002）
    textMetrics: { fontSizePx: 84, paddingPx: 0, latinWidthEm: 0.616 },
  },
  {
    // ── D-A（2026-10-16 落地）：首批里**唯一** `occludesSubject: true` 的叠加模板 ──
    // 「居中大字强调」：一行大字压在画面中部（主体所在区），是口播视频里
    // 「压在人身上的大字」这一高频手法的具象。它让 D2 的遮挡判定链路
    // **第一次能在真实素材上被触发**（此前 10/10 模板无一能进入判定）。
    // · `layer: 70`：高于其余 overlay-safe（40–60）——它就是"压"在最上面的；
    // · `footprint` 落在中部：与主体区重合，遮挡判定名副其实，
    //   而不是「声明 true 但默认摆位不遮挡」的语义矛盾（见 D-A 裁决材料 §1.3）。
    id: 'typography/center-emphasis@1.0',
    family: 'typography',
    subtype: 'center-emphasis',
    version: '1.0',
    doc: {
      summary: '画面中央「压上去」的遮蔽型大字：底板 + 左金条，进出场均无位移。',
      fits: ['强结论', '需要最高视觉权重的一句话'],
      energy: 'high',
      designIntent: '强结论的权重顶格：底板加左金条把一句话压到画面中央，语义是「其他一切可以让位，这句必须看到」。进出场无位移——压上去的东西不漂移。',
      params: [{ key: 'text', typical: '≤8 字（保守建议）', feel: '#17 估算阈值约 20 字' }],
      pitfalls: [
        'occludesSubject: true —— 压到人脸区（预算 0%）会被校验拦截或告警',
        '出场是纯淡出不缩放：压上去的东西不缩回去、只消失',
      ],
    },
    scope: 'overlay-safe',
    layer: 70,
    occludesSubject: true,
    status: 'core',
    paramsSchema: { text: 'string' },
    requiredParams: ['text'],
    footprint: [0.15, 0.38, 0.7, 0.22],
    minVisibleInFrames: 30,
    // D-B：fontSize 与组件 `center-emphasis.tsx` 的 72 一致；
    // paddingPx = 左右 32×2 + 左侧强调竖条 6
    // latinWidthEm：D-B2 实测（2026-10-24）—— 数字 0.616em
    textMetrics: { fontSizePx: 72, paddingPx: 70, latinWidthEm: 0.616 },
  },

  // ── data ────────────────────────────────────────────────────
  {
    id: 'data/stat-card@1.0',
    family: 'data',
    subtype: 'stat-card',
    version: '1.0',
    doc: {
      summary: '大字号数字卡，靠字号与品牌色建立层级，动画幅度刻意最小。',
      fits: ['数字 / 金额 / 指标', '参数播报'],
      energy: 'mid',
      designIntent: '让数字自己当主角：大字号加品牌色建立层级，动画幅度刻意压到最小——播报中的数字一旦滚动或抖动，就读作「不值得当真」。',
      params: [
        { key: 'value', typical: '≤8 位', feel: '建议位数是**可读性**而非溢出线（#17 约 23 位才 warning）' },
        { key: 'unit', typical: '可选', feel: '留空则单行显示' },
      ],
      pitfalls: [
        '刻意不做 digit roll（数字滚动）',
        '出场缩 4% < 入场缩 10%：反着来会读作「塌陷」',
      ],
    },
    scope: 'overlay-safe',
    layer: 55,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { value: 'string', unit: 'string' },
    requiredParams: ['value'], // unit 可选
    footprint: [0.62, 0.12, 0.32, 0.24],
    minVisibleInFrames: 45,
    // D-B：按 **value** 判定（44px，unit 15px 更小）
    // paddingPx = 左右 24×2
    // 🔴 D-B2 实测（2026-10-24）：`FONT.numeric` 44px / weight 800 的数字
    //    每字前进宽 **29.35px = 0.667em**；默认拉丁系数 0.5 低估 33%。
    //    ⚠️ 必须写 `latinWidthEm` 而不是 `charWidthEm` —— 后者只管 CJK，
    //    写成 0.667 会把 CJK 估算砍半（一个系数乘两个基准表达不了）。
    textMetrics: { fontSizePx: 44, paddingPx: 48, latinWidthEm: 0.667 },
  },

  // ── annotation ──────────────────────────────────────────────
  {
    id: 'annotation/pointer-callout@1.0',
    family: 'annotation',
    subtype: 'pointer-callout',
    version: '1.0',
    doc: {
      summary: '指向画面某一区域的标注：左上标签写说明，配轻量指示，不做实心底色大箭头。',
      fits: ['指认某个实物 / 区域', '讲解画面里的细节'],
      energy: 'mid',
      designIntent: '空间指认：把视线引到画面里的某个实物或区域。footprint 就是目标本身、指示保持轻量——标注的职责是指出，不是盖住被指的东西。',
      params: [{ key: 'target', typical: '必填，2–8 字', feel: '标注文字；长文本由 fitScaleFor 压回框内' }],
      pitfalls: [
        'footprint 就是**目标区域本身**，不是标签的摆放位置',
        'status=experimental：未经真实素材校准，anchored 定位依赖 perceive 区域质量',
      ],
    },
    scope: 'anchored',
    layer: 70,
    occludesSubject: false,
    status: 'experimental',
    paramsSchema: { target: 'string' },
    requiredParams: ['target'], // 无 target 则标注无指向对象，语义上必填
    footprint: [0.3, 0.3, 0.2, 0.2],
    minVisibleInFrames: 24,
    // 2026-10-24：标签文字 20px；padding = 12×2 + 1px 边框×2。
    // 与组件 `pointer-callout.tsx` 的 chip 内边距一致 —— 两处数字必须同步，
    // 否则校验项 #17 与渲染期 `fitScale` 会给出相反结论（D-B 的同款病）。
    // latinWidthEm：D-B2 实测（2026-10-24）—— 数字 0.617em
    textMetrics: { fontSizePx: 20, paddingPx: 26, latinWidthEm: 0.617 },
  },

  // ── carrier / cinematic（载体类：作用于实拍视频本身）────────
  {
    id: 'carrier/split-frame@1.0',
    family: 'carrier',
    subtype: 'split-frame',
    version: '1.0',
    doc: {
      summary: '把实拍视频缩进一侧，另一侧留白给 overlay —— 是布局切换，不是动效。',
      fits: ['需要大面积文字 / 图表', '单侧构图'],
      energy: 'low',
      designIntent: '布局切换：画面让出一半给文字或图表，是空间重排不是动效。切换即到位——缓动滑入会读成镜头横移，可见比判据也会跟着漂。',
      params: [
        { key: 'side', typical: 'right', feel: '视频显在哪侧；改它不改变主体被切的程度' },
        { key: 'ratio', typical: '0.5', feel: '0.3 视频窄 / overlay 宽，0.7 反之；钳制 [0.3,0.7]' },
        { key: 'window', typical: '校验期自动写入', feel: '不填则退回居中窗口；形状非法直接抛错' },
      ],
      pitfalls: [
        '刻意不做进出场：缓动滑入会读成「镜头横移」，并让 window 随帧变化、动摇 W-D2-02 判据',
        'window 以该 shot 的 safeArea 中心为锚，不是画面中心',
      ],
    },
    scope: 'subject-transform',
    layer: 5,
    occludesSubject: true,
    // ⚠️ `status: 'experimental'` **保留**（P2 实现了组件，但主体锚定窗口
    //    未经真实素材校准 —— 实现完成 ≠ 质量达标，同 `D-B` 的教训）。
    status: 'experimental',
    // 🔴 2026-10-17（P2）：原 `paramsSchema: { inset: 'number' }` 已废弃 ——
    //    `inset` 的语义与值域一直未定义，正是 D4-t2 的三个落地阻塞点之一。
    //    现按 Q3 定义为 `side`（视频显在哪一侧）+ `ratio`（展示条占比，钳 0.3–0.7）。
    //
    // ⚠️ **裁切窗 `window` 刻意不在 paramsSchema 里**：
    //    它是**校验期写入**的系统字段（模型不该也不能填），
    //    与 `textMetrics` / `requiredParams` 的分工同理。
    //    一旦把它写进这张表，模型就能填它；#16 的「未知键」拦截也就跟着失效。
    paramsSchema: { side: 'string', ratio: 'number' },
    // 与实现的缺省侧（`right`）一致 —— 声明与默认渲染不一致是 #17 字号事故的同款病。
    footprint: [0.5, 0, 0.5, 1],
    minVisibleInFrames: 30,
  },
  {
    id: 'cinematic/punch-in@1.0',
    family: 'cinematic',
    subtype: 'punch-in',
    version: '1.0',
    doc: {
      summary: '全画面推近：推进段（前 78%）+ 回退段（后 22%），缓起缓停的镜头感。',
      fits: ['强调某个瞬间', '情绪推近'],
      energy: 'mid',
      designIntent: '镜头语言的情绪推近：「靠近看这个瞬间」。推进 78% 加回退 22% 是一次完整的呼吸——只进不退，结束瞬间会跳回全景读作剪辑事故。',
      params: [{ key: 'scale', typical: '1.06', feel: '越大推近越强；钳制 [1.0,1.6]' }],
      pitfalls: [
        '回退段必须有：无剪辑场景不回退 = 结束瞬间跳回全景',
        'scale >1.6 超数字变焦可见劣化线；<1 是拉远、非本模板语义（钳到 1.0 = 无运动）',
      ],
    },
    scope: 'footage-transform',
    layer: 1,
    occludesSubject: true,
    status: 'core',
    paramsSchema: { scale: 'number' },
    footprint: [0, 0, 1, 1],
    minVisibleInFrames: 24,
  },

  // ── transition / ambience（fullscreen：必然覆盖全画面）───────
  {
    id: 'transition/whip-pan@1.0',
    family: 'transition',
    subtype: 'whip-pan',
    version: '1.0',
    doc: {
      summary: '全屏速度线沿一个方向扫过，配一层很轻的暗底，做段落转场。',
      fits: ['段落切换', '场景跳转'],
      energy: 'high',
      designIntent: '段落转场：10 帧速度线扫过的瞬间说「这一章结束了」。瞬时性就是全部语义——慢下来或反复用，转场就退化成装饰。',
      params: [
        { key: 'direction', typical: 'left', feel: 'left / right / up / down 四向；未知值静默回退 left' },
      ],
      pitfalls: [
        'fullscreen ⇒ 触发 D3-a 人工确认闸：未在 confirmed.json 确认则 render 直接拒绝启动',
        'minVisible 仅 10 帧：它本就是瞬时转场，不要当强调模板用',
      ],
    },
    scope: 'fullscreen',
    layer: 100,
    occludesSubject: true,
    status: 'core',
    paramsSchema: { direction: 'string' },
    footprint: [0, 0, 1, 1],
    minVisibleInFrames: 10,
  },
  {
    id: 'ambience/noise-grain@1.0',
    family: 'ambience',
    subtype: 'noise-grain',
    version: '1.0',
    doc: {
      summary: '全屏胶片颗粒，每帧换 seed，相邻帧纹理完全不同。',
      fits: ['统一质感', '压住数码感'],
      energy: 'low',
      designIntent: '质感统一：给多源素材盖一层一致的胶片颗粒，让片子读作「一条」而不是「拼的」。它的成功标准是没人注意到它。',
      params: [{ key: 'opacity', typical: '0.05', feel: '0.03–0.08 是胶片颗粒典型量级；钳制 [0,1]' }],
      pitfalls: [
        'opacity >0.08 会被读成「雪花屏」',
        '全屏噪声每帧重算，长片渲染成本可观；必要时降级为小尺寸 + pattern 平铺（stitchTiles 已预置）',
      ],
    },
    scope: 'fullscreen',
    layer: 0,
    occludesSubject: false,
    status: 'core',
    paramsSchema: { opacity: 'number' },
    footprint: [0, 0, 1, 1],
    minVisibleInFrames: 60,
  },
];
