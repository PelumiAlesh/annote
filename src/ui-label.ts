import type { ReactContext } from "./react-adapter";

export function formatUiLabel(
  component: string | null | undefined,
  fallback: string,
): string {
  return component ? `<${component}>` : fallback;
}

export function uiLabelFor(
  displayNameFallback: string,
  context: ReactContext | null | undefined,
  reactContextEnabled: boolean,
): string {
  if (!reactContextEnabled) return displayNameFallback;
  if (context?.component) return `<${context.component}>`;
  return displayNameFallback;
}
