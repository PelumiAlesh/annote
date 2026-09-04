export type ThemePreference = "light" | "opposite-page" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_ATTRIBUTE_FILTER = [
  "class",
  "style",
  "data-theme",
  "data-mode",
  "data-color-mode",
  "data-color-scheme",
  "data-bs-theme",
] as const;

const DARK_SIGNAL = /(?:^|[\s_-])(dark|night|black)(?:$|[\s_-])/i;
const LIGHT_SIGNAL = /(?:^|[\s_-])(light|day)(?:$|[\s_-])/i;
const EXPLICIT_THEME_ATTRIBUTES = [
  "data-theme",
  "data-mode",
  "data-color-mode",
  "data-color-scheme",
  "data-bs-theme",
] as const;

function parseRgb(value: string): [number, number, number, number] | null {
  const match = value.trim().match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (!match) return null;
  const alpha = match[4]?.endsWith("%") ? Number.parseFloat(match[4]) / 100 : Number.parseFloat(match[4] ?? "1");
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const channels = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function classifiedBackground(element: Element | null, getStyle: typeof getComputedStyle): ResolvedTheme | null {
  if (!element) return null;
  const parsed = parseRgb(getStyle(element).backgroundColor);
  if (!parsed || parsed[3] <= 0.01) return null;
  return luminance([parsed[0], parsed[1], parsed[2]]) > 0.42 ? "light" : "dark";
}

function themeSignal(element: Element | null): ResolvedTheme | null {
  if (!element) return null;
  const values = [
    element.getAttribute("class"),
    element.getAttribute("data-theme"),
    element.getAttribute("data-mode"),
    element.getAttribute("data-color-mode"),
    element.getAttribute("data-color-scheme"),
    element.getAttribute("data-bs-theme"),
  ].filter(Boolean).join(" ");
  if (DARK_SIGNAL.test(values)) return "dark";
  if (LIGHT_SIGNAL.test(values)) return "light";
  return null;
}

function explicitThemeSignal(element: Element | null): ResolvedTheme | null {
  if (!element) return null;
  const values = EXPLICIT_THEME_ATTRIBUTES.map((name) => element.getAttribute(name)).filter(Boolean).join(" ");
  if (DARK_SIGNAL.test(values)) return "dark";
  if (LIGHT_SIGNAL.test(values)) return "light";
  return null;
}

export function detectPageTheme(
  doc: Document = document,
  getStyle: typeof getComputedStyle = getComputedStyle,
): ResolvedTheme {
  // Explicit theme attributes change before animated backgrounds finish, so
  // trusting them first prevents opposite-page mode from reading stale pixels.
  return explicitThemeSignal(doc.body)
    ?? explicitThemeSignal(doc.documentElement)
    ?? classifiedBackground(doc.body, getStyle)
    ?? classifiedBackground(doc.documentElement, getStyle)
    ?? themeSignal(doc.body)
    ?? themeSignal(doc.documentElement)
    ?? (getStyle(doc.body ?? doc.documentElement).colorScheme.toLowerCase().split(/\s+/).includes("dark") ? "dark" : null)
    ?? "light";
}

export function resolveTheme(preference: ThemePreference, pageTheme: ResolvedTheme): ResolvedTheme {
  if (preference === "opposite-page") return pageTheme === "dark" ? "light" : "dark";
  return preference;
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "opposite-page" ? value : "opposite-page";
}
