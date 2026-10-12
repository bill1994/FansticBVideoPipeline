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
for (const t of BUILTIN_TEMPLATES) {
  if (registry.has(t.id)) {
    throw new ConfigError(`模板 id 重复：${t.id}`);
  }
  registry.set(t.id, t);
}

/** 注册一个模板（供使用方扩展自有模板库）。 */
export function registerTemplate(t: TemplateDeclaration): void {
  registry.set(t.id, t);
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
    throw new ConfigError(
      `未注册的 motion：${JSON.stringify(motion)}。` +
        `校验与烘焙都依赖模板声明（scope / minVisibleInFrames），无法在缺失时继续。` +
        `已注册：${[...registry.keys()].join(', ')}`,
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
