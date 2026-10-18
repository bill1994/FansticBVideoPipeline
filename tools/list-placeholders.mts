/**
 * list-placeholders.mts — 从 `src/core/placeholders.ts` 生成参数决策档案。
 *
 * 运行：
 *   npm run placeholders            # 生成/覆盖 docs/decisions/PARAM-DECISIONS.md
 *   npm run placeholders -- --check # 只校验文档是否与代码一致（不一致退 1，供 CI）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么文档必须由代码生成
 * ─────────────────────────────────────────────────────────────
 * 「占位值有几个」曾同时存在 8 / 7 / 3 三个口径，根因是**数字被手抄在多处**。
 * 手抄的文档一定漂移 —— 本项目已经因「定义一套、实现另一套」栽过 `DUR.exit`
 * 与字号真源两次。所以这里只做一件事：把注册表**渲染**成文档，
 * 让「文档说的」和「代码是的」在结构上不可能分叉。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  EXCLUDED_PARAMS,
  PLACEHOLDERS,
  placeholderCount,
  placeholderValueCount,
  renderPlaceholderTable,
} from '../src/core/placeholders.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outPath = path.join(repoRoot, 'docs/decisions/PARAM-DECISIONS.md');

const KIND_LABEL = { invented: '实现期拟定', 'doc-initial': '文档初值' } as const;

function render(): string {
  const lines: string[] = [];

  lines.push('# 参数级决策与占位值追踪（PARAM-DECISIONS）');
  lines.push('');
  lines.push('> ⚠️ **本文件由 `npm run placeholders` 生成，请勿手改。**');
  lines.push('> 真源：`src/core/placeholders.ts`。改了阈值或增删条目后重跑一次即可同步。');
  lines.push('> 校验是否同步：`npm run placeholders -- --check`（不一致退 1）。');
  lines.push('');

  // ── 一、计数 ─────────────────────────────────────────────
  lines.push('## 一、计数（唯一口径）');
  lines.push('');
  lines.push('| 口径 | 数量 | 说明 |');
  lines.push('|---|---|---|');
  lines.push(
    `| 占位值**项数** | **${placeholderCount()}** | 一个"需要独立做出的校准决定"算一项 |`,
  );
  lines.push(
    `| 占位值**数值个数** | **${placeholderValueCount()}** | 一项可含多个数（如对齐门控 3 个） |`,
  );
  lines.push(
    `| 明确排除的拟定值 | ${EXCLUDED_PARAMS.length} | 见 §五，写清为什么不收 |`,
  );
  lines.push('');
  lines.push(
    '🔴 **引用数量时必须注明口径**：说「8 个占位值」指的是**项数**；' +
      '说「12 个数值」指的是**数值个数**。此前 `MEMORY.md` / `PROGRESS.md` / ' +
      '代码标记三方各数一套，就是因为没定粒度。',
  );
  lines.push('');

  // ── 二、汇总表 ───────────────────────────────────────────
  lines.push('## 二、汇总表');
  lines.push('');
  lines.push(renderPlaceholderTable());
  lines.push('');

  // ── 三、逐项详情 ─────────────────────────────────────────
  lines.push('## 三、逐项详情');
  lines.push('');
  for (const p of PLACEHOLDERS) {
    lines.push(`### \`${p.id}\` · ${p.title}`);
    lines.push('');
    lines.push(`- **类别**：${KIND_LABEL[p.kind]}`);
    lines.push(`- **真源**：\`${p.source}\``);
    lines.push(
      `- **当前值**：${p.members.map((m) => `\`${m.label}\` = **${m.read()}**`).join('；')}`,
    );
    lines.push(`- **当前值从哪来**：${p.basis}`);
    lines.push(`- **怎么校准**：${p.calibration}`);
    lines.push(`- **越界后果**：${p.impact}`);
    if (p.blockedBy) lines.push(`- **当前卡着**：${p.blockedBy}`);
    if (p.alignWith?.length) {
      lines.push(
        `- **必须一起校准**：${p.alignWith.map((x) => `\`${x}\``).join(' / ')}` +
          '（分开调会留下一道看着齐全、实则测不到的门）',
      );
    }
    lines.push('');
  }

  // ── 四、已校准的样板 ─────────────────────────────────────
  lines.push('## 四、已校准的样板：`MATCH_MIN_SIMILARITY = 0.35`');
  lines.push('');
  lines.push(
    '这是本项目第一条**有完整实测依据**的参数决策，可作其他参数的校准范式：',
  );
  lines.push('');
  lines.push('| 类别 | 实测相似度区间 |');
  lines.push('|---|---|');
  lines.push('| 正确匹配（5/6） | 0.655 – 1.000 |');
  lines.push('| 正确匹配的例外：whisper 只听了一半 | 0.455 |');
  lines.push('| 错位匹配（全部） | 0.000 – 0.154 |');
  lines.push('');
  lines.push(
    '两组之间有**巨大空隙**（0.154 → 0.455），取 **0.35** 落在空隙中央：' +
      '既能救回「whisper 漏听后半句」（0.455 > 0.35），又能拒绝全部实测错位匹配' +
      '（最高 0.154，2.3 倍余量）。',
  );
  lines.push('');
  lines.push(
    '🔴 它**不是占位值**：文档虽未给数，但此值是从实测分布反推的，' +
      '不属于「为实现可运行而编一个」。区别就在这里。',
  );
  lines.push('');

  // ── 五、明确排除 ─────────────────────────────────────────
  lines.push('## 五、明确排除的拟定值');
  lines.push('');
  lines.push('这些同样是"文档没给数"，但**不进占位值清单**，理由逐条写明：');
  lines.push('');
  lines.push('| 参数 | 位置 | 为什么不收 |');
  lines.push('|---|---|---|');
  for (const e of EXCLUDED_PARAMS) {
    lines.push(`| \`${e.name}\` | \`${e.where}\` | ${e.reason} |`);
  }
  lines.push('');

  // ── 六、纪律 ─────────────────────────────────────────────
  lines.push('## 六、纪律');
  lines.push('');
  lines.push('1. **新增条目先过收录判据**：文档未给数值或只给初值，且影响判定结论或成片几何。');
  lines.push('2. **只引用不复制**：`read()` 必须 `() => 常量.字段`，禁止写字面阈值（有静态断言守着）。');
  lines.push('3. **相关阈值一起校准**：`alignWith` 标出的必须同批定，不得分两次拍。');
  lines.push('4. **校准完改 `kind` → 移到 §四**：有实测依据的参数不再是占位值，别让它留在清单里充数。');
  lines.push('5. **改完重跑本脚本**：`npm run placeholders`，否则文档与代码分叉。');
  lines.push('');

  return lines.join('\n');
}

function main(): void {
  const md = render();
  const check = process.argv.includes('--check');

  if (check) {
    const cur = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    if (cur !== md) {
      console.error(
        'FAIL: docs/decisions/PARAM-DECISIONS.md 与 src/core/placeholders.ts 不一致。\n' +
          '      跑 `npm run placeholders` 重新生成后提交。',
      );
      process.exit(1);
    }
    console.log('OK: PARAM-DECISIONS.md 与注册表一致');
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(
    `已生成 ${path.relative(repoRoot, outPath)}` +
      `（${placeholderCount()} 项 / ${placeholderValueCount()} 个数值）`,
  );
}

main();
