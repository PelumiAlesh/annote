export type StructureLabel = { primary: string; secondary: string | null };

export function isStructureCandidateElement(
  element: Element,
  opts: { rootHost?: HTMLElement | null; shieldId?: string } = {},
): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element === document.documentElement || element === document.body) return false;
  if (opts.rootHost?.contains(element)) return false;
  if (element.closest(`#${opts.shieldId || "annote-interaction-shield"}, [data-annote-shield]`)) return false;
  if (element.closest(".clr-picker")) return false;
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "template", "noscript"].includes(tag)) return false;
  return true;
}

export function getStructureParent(
  element: HTMLElement,
  isCandidate: (el: Element) => boolean = (el) => el instanceof HTMLElement,
): HTMLElement | null {
  let parent: HTMLElement | null = element.parentElement;
  while (parent && !isCandidate(parent)) {
    parent = parent.parentElement;
  }
  if (parent === document.documentElement || parent === document.body) return null;
  return parent;
}

export function getStructureChildren(
  element: HTMLElement,
  isCandidate: (el: Element) => boolean = (el) => el instanceof HTMLElement,
  limit = 8,
): { children: HTMLElement[]; truncated: number } {
  const all = Array.from(element.children).filter(isCandidate) as HTMLElement[];
  return { children: all.slice(0, limit), truncated: Math.max(0, all.length - limit) };
}

export function getStructureSiblings(
  element: HTMLElement,
  isCandidate: (el: Element) => boolean = (el) => el instanceof HTMLElement,
  limit = 8,
): { siblings: HTMLElement[]; truncated: number } {
  const parent = element.parentElement;
  if (!parent) return { siblings: [], truncated: 0 };
  const all = Array.from(parent.children).filter((el) => el !== element && isCandidate(el as Element)) as HTMLElement[];
  return { siblings: all.slice(0, limit), truncated: Math.max(0, all.length - limit) };
}
