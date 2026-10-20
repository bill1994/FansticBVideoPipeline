/**
 * 模板注册表。
 *
 * 校验器与烘焙器都必须能查到模板声明 —— 没有 `scope` 就判不了主从放行，
 * 没有 `minVisibleInFrames` 就判不了校验项 #6。
 *
 * 因此**查不到模板时抛 ConfigError（退出码 2），不静默跳过**：
 * 静默跳过会让校验器在「以为自己全跑了」的情况下漏判，比报错危险得多。
 */

import { ConfigError } from '../core/exit-code.ts';
import { BUILTIN_TEMPLATES } from './builtin.ts';
import { FAMILIES, SCOPES, type TemplateDeclaration } from './types.ts';

const registry = new Map<string, TemplateDeclaration>();
/** 自定义模板的来源标注（仅用于重复注册时的诊断；内置模板不需要）。 */
const registeredSources = new Map<string, string>();
/** 内置模板 id 集合 —— 用于区分「覆盖内置」与「自定义重复」两种错误。 */
const BUILTIN_IDS = new Set(BUILTIN_TEMPLATES.map((t) => t.id));

for (const t of BUILTIN_TEMPLATES) {
  if (registry.has(t.id)) {
    throw new ConfigError(`模板 id 重复：${t.id}`);
  }
  registry.set(t.id, t);
}

/**
 * 注册一个模板（供使用方扩展自有模板库）。
 *
 * 🔴 **不静默覆盖**（2026-10-20 修复）：原实现直接 `registry.set(t.id, t)`，
 * 同 id 会**静默替换内置模板** —— 一处 `registerTemplate` 就能改掉
 * `caption/karaoke-word` 的 `minVisibleInFrames` 或 `scope`，而全链路无任何提示。
 * 这与「定义了就该能被读出来」同源：覆盖行为不报错，就不会有人知道模板被换过。
 *
 * @param t 模板声明
 * @param source 可选来源标注（测试夹具名 / 文件路径），仅用于重复注册的诊断
 * @throws ConfigError 覆盖内置模板、或自定义 id 重复时抛（退出码 2）
 */
export function registerTemplate(t: TemplateDeclaration, source?: string): void {
  if (registry.has(t.id)) {
    if (BUILTIN_IDS.has(t.id)) {
      throw new ConfigError(
        `不得覆盖内置模板：${t.id}\n` +
          `  内置模板由 templates/builtin.ts 声明 —— 要改行为请新增版本（如 @1.1），` +
          `不要用 registerTemplate 替换；否则校验/渲染看到的是改过的声明，而产物无从追溯。`,
      );
    }
    const from = registeredSources.get(t.id);
    throw new ConfigError(
      `模板 id 重复：${t.id}${from === undefined ? '' : `（已由 ${from} 注册）`}`,
    );
  }
  registry.set(t.id, t);
  if (source !== undefined && source !== '') registeredSources.set(t.id, source);
}

/**
 * **仅供测试**：清空自定义注册，保留内置模板。
 *
 * 生产代码不得调用 —— 它存在只是为了让测试能在同一进程内复用 id
 * （注册表现在拒绝静默覆盖，测试之间必须显式清理）。
 */
export function __resetRegistryForTests(): void {
  for (const id of [...registry.keys()]) {
    if (!BUILTIN_IDS.has(id)) registry.delete(id);
  }
  registeredSources.clear();
}

export function listTemplates(): TemplateDeclaration[] {
  return [...registry.values()];
}

/**
 * 取模板声明。查不到即抛 `ConfigError` —— CLI 会转成退出码 2（参数错）。
 */
export function getTemplate(motion: string): TemplateDeclaration {
  const t = registry.get(motion);
  if (!t) {
    // 🔴 2026-10-19：补「漏了版本后缀」这一最常见写法的诊断。
    //   本函数的错误信息原本只列出已注册清单（全部形如 `xxx@1.0`），
    //   而用户若写成 `xxx`，清单里明明"有"它却仍报未注册 ——
    //   **报错信息自己打自己的脸**，实测因此绕了一圈才定位。
    const bare = motion.split('@')[0];
    const byBare = bare ? registry.get(`${bare}@1.0`) : undefined;
    const hint =
      byBare !== undefined
        ? `\n  ↳ 你大概想写 \`${byBare.id}\` —— motion 的规范写法是 \`family/subtype@version\`。`
        : '';
    throw new ConfigError(
      `未注册的 motion：${JSON.stringify(motion)}。` +
        `校验与烘焙都依赖模板声明（scope / minVisibleInFrames），无法在缺失时继续。` +
        `已注册：${[...registry.keys()].join(', ')}` +
        hint,
    );
  }
  return t;
}

/** 存在性查询，供「是否需要报错」的判断使用。 */
export function hasTemplate(motion: string): boolean {
  return registry.has(motion);
}

/** 启动期自检：契约字段是否落在文档枚举内。 */
export function assertRegistryValid(): void {
  for (const t of registry.values()) {
    if (!FAMILIES.includes(t.family)) {
      throw new ConfigError(`模板 ${t.id} 的 family "${t.family}" 不在 12 类枚举内`);
    }
    if (!SCOPES.includes(t.scope)) {
      throw new ConfigError(`模板 ${t.id} 的 scope "${t.scope}" 不在 6 值枚举内`);
    }
  }
}
