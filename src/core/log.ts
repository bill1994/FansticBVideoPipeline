/**
 * 极简日志。无第三方依赖，输出保持稳定格式，便于 CI 抓取。
 */

const PREFIX = '[overlay-pipeline]';

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  stage(name: string, msg: string): void {
    process.stdout.write(`${PREFIX} ${ts()} ▶ ${name} — ${msg}\n`);
  },
  info(msg: string): void {
    process.stdout.write(`${PREFIX} ${ts()}   ${msg}\n`);
  },
  done(msg: string): void {
    process.stdout.write(`${PREFIX} ${ts()} ✔ ${msg}\n`);
  },
  warn(msg: string): void {
    process.stdout.write(`${PREFIX} ${ts()} ! ${msg}\n`);
  },
  error(msg: string): void {
    process.stderr.write(`${PREFIX} ${ts()} ✗ ${msg}\n`);
  },
};

/** 打印一段多行文本（报告摘要等），保持原样不加重前缀。 */
export function printBlock(text: string): void {
  process.stdout.write(`${text}\n`);
}
