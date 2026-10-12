import type { StoryboardTrack } from '../core/types.ts';
import { getTemplate } from '../templates/registry.ts';
import { isCarrierScope, type Scope } from '../templates/types.ts';

export { isCarrierScope };
export type { Scope };

/**
 * 取一条 track 的 scope。
 *
 * track 内 item 允许重叠但**必须同 scope** —— scope 决定它落背景链还是叠加栈，
 * 混 scope 会让「串联 / 并列」的划分不成立，那正是 C6 说的「最易出错处」。
 * 因此这里显式检查，不一致就直接失败，而不是取第一条糊过去。
 */
export function getScopeOf(track: StoryboardTrack): Scope | null {
  const first = track.items[0];
  if (!first) return null;
  const scope = getTemplate(first.motion).scope;
  for (const item of track.items) {
    const s = getTemplate(item.motion).scope;
    if (s !== scope) {
      throw new Error(
        `track "${track.id}" 混用了 scope：${scope} 与 ${s}。` +
          `载体类走背景链（串联）、叠加类走叠加栈（并列），混栈会语义倒置。`,
      );
    }
  }
  return scope;
}
