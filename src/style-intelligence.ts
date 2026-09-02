import webrefCss from "@webref/css/css.json";
import * as csstree from "css-tree";

export type StyleStateKey = "current" | "hover" | "focus-visible" | "focus" | "active" | "disabled" | "loading" | "open" | "selected";

export type CssPropertyMeta = {
  name: string;
  syntax: string;
  inherited: boolean;
  knownValues: string[];
};

export type PropertyControl = "segmented" | "number" | "color" | "text" | "font" | "compound";

export type PropertyEditorConfig = {
  control: PropertyControl;
  options?: string[];
  step?: number;
  unit?: string;
};

export type CssColorParts = {
  hex: string;
  opacity: number;
};

type WebrefProperty = {
  name: string;
  syntax?: string;
  inherited?: string;
};

const KEYWORD_PATTERN = /(?:^|[|&\s])([a-z-]+)(?=$|[|&\s])/g;
const metadata = new Map<string, CssPropertyMeta>();

const COMMON_VALUES: Record<string, string[]> = {
  display: ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "flow", "flow-root", "none"],
  position: ["static", "relative", "absolute", "fixed", "sticky"],
  overflow: ["visible", "hidden", "clip", "scroll", "auto"],
  "overflow-x": ["visible", "hidden", "clip", "scroll", "auto"],
  "overflow-y": ["visible", "hidden", "clip", "scroll", "auto"],
  "align-items": ["stretch", "center", "start", "end", "flex-start", "flex-end", "baseline"],
  "justify-content": ["start", "end", "center", "space-between", "space-around", "space-evenly", "flex-start", "flex-end"],
  "font-style": ["normal", "italic", "oblique"],
  "font-weight": ["300", "400", "500", "600", "700", "800", "normal", "bold"],
  cursor: ["auto", "default", "pointer", "text", "grab", "not-allowed", "help", "move"],
  opacity: ["0", ".25", ".5", ".75", "1"],
};

const CONTROL_OVERRIDES: Record<string, PropertyEditorConfig> = {
  "flex-direction": { control: "segmented", options: ["row", "column"] },
  "text-align": { control: "segmented", options: ["left", "center", "right", "justify", "start", "end"] },
  position: { control: "segmented", options: ["static", "relative", "absolute", "fixed"] },
  overflow: { control: "segmented", options: ["visible", "hidden", "auto"] },
  "overflow-x": { control: "segmented", options: ["visible", "hidden", "auto"] },
  "overflow-y": { control: "segmented", options: ["visible", "hidden", "auto"] },
  "align-items": { control: "segmented", options: ["flex-start", "center", "flex-end", "stretch"] },
  "justify-content": { control: "segmented", options: ["flex-start", "center", "flex-end", "space-between"] },
  opacity: { control: "number", step: 0.05 },
  "font-family": { control: "font" },
  "font-weight": { control: "font" },
  padding: { control: "compound" },
  margin: { control: "compound" },
  "border-width": { control: "compound" },
  "border-radius": { control: "compound" },
};

const COLOR_PROPERTY_PATTERN = /(^color$|color$|^background$|background-color|border-color|outline-color)/;
const NUMERIC_PROPERTY_PATTERN =
  /(^opacity$|width$|height$|size$|gap$|spacing$|basis$|radius$|offset$|z-index$|line-height$|letter-spacing$|padding|margin|border-width|outline-width)/;
const COMPLEX_VALUE_PATTERN = /\b(calc|clamp|min|max|var|rgb|hsl|oklch|color-mix)\(/i;

function buildMetadata(): void {
  if (metadata.size) return;
  const properties = (webrefCss as { properties?: WebrefProperty[] }).properties || [];
  properties.forEach((property) => {
    const syntax = property.syntax || "";
    const knownValues = new Set(COMMON_VALUES[property.name] || []);
    let match: RegExpExecArray | null;
    while ((match = KEYWORD_PATTERN.exec(syntax))) {
      const value = match[1];
      if (!value.includes("-") || !value.startsWith("<")) knownValues.add(value);
    }
    metadata.set(property.name, {
      name: property.name,
      syntax,
      inherited: property.inherited === "yes",
      knownValues: Array.from(knownValues).filter((value) => !value.startsWith("<")).sort(),
    });
  });
}

export function getCssPropertyMeta(property: string): CssPropertyMeta | null {
  buildMetadata();
  return metadata.get(property) || null;
}

export function hasWebrefMetadata(property: string): boolean {
  return !!getCssPropertyMeta(property);
}

export function cssValueStatus(property: string, rawValue: string, firm = false): "empty" | "intermediate" | "valid" | "invalid" {
  const value = rawValue.trim();
  if (!value) return "empty";
  if (!firm && /^[\w.#(%,-]*$/.test(value) && /[.(,-]$/.test(value)) return "intermediate";
  if (!firm && /^[+-]?\d*\.?\d+$/.test(value)) return "intermediate";
  try {
    const match = csstree.lexer.matchProperty(property, value);
    return match.matched ? "valid" : "invalid";
  } catch {
    return typeof CSS !== "undefined" && CSS.supports(property, value) ? "valid" : "invalid";
  }
}

export function isValidCssValue(property: string, value: string): boolean {
  return cssValueStatus(property, value, true) === "valid";
}

export function isTokenValueValidForProperty(property: string, tokenValue: string): boolean {
  return cssValueStatus(property, tokenValue, true) === "valid";
}

export function cssSuggestions(property: string, prefix: string, pageValues: string[] = []): string[] {
  const normalized = prefix.trim().toLowerCase();
  const meta = getCssPropertyMeta(property);
  const values = new Set<string>([...pageValues, ...(COMMON_VALUES[property] || []), ...(meta?.knownValues || [])]);
  return Array.from(values)
    .filter((value) => value && (!normalized || value.toLowerCase().startsWith(normalized)))
    .slice(0, 8);
}

export function simpleNumericParts(value: string): { number: number; unit: string } | null {
  const trimmed = value.trim();
  if (!trimmed || COMPLEX_VALUE_PATTERN.test(trimmed)) return null;
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/i);
  if (!match) return null;
  return { number: Number(match[1]), unit: match[2] || "" };
}

export function stepCssNumericValue(property: string, value: string, direction: 1 | -1): string | null {
  const parts = simpleNumericParts(value);
  if (!parts) return null;
  const config = getPropertyEditorConfig(property, value);
  const step = config.step || 1;
  const next = parts.number + direction * step;
  const clamped = property === "opacity" ? Math.max(0, Math.min(1, next)) : next;
  const rounded = Number(clamped.toFixed(step < 1 ? 2 : 3));
  return `${rounded}${parts.unit}`;
}

export function isColorProperty(property: string): boolean {
  return COLOR_PROPERTY_PATTERN.test(property);
}

export function isConcreteColorValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /var\(|currentColor/i.test(trimmed)) return false;
  return /^(#|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|transparent$)/i.test(trimmed);
}

function componentToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

export function parseCssColorParts(value: string): CssColorParts | null {
  const trimmed = value.trim();
  if (/^transparent$/i.test(trimmed)) return { hex: "#000000", opacity: 0 };
  const hex = trimmed.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const raw = hex[1];
    if (raw.length === 3 || raw.length === 4) {
      const channels = raw.split("").map((part) => part + part);
      return {
        hex: `#${channels.slice(0, 3).join("")}`.toLowerCase(),
        opacity: channels[3] ? Math.round((Number.parseInt(channels[3], 16) / 255) * 100) / 100 : 1,
      };
    }
    if (raw.length === 6 || raw.length === 8) {
      return {
        hex: `#${raw.slice(0, 6)}`.toLowerCase(),
        opacity: raw.length === 8 ? Math.round((Number.parseInt(raw.slice(6, 8), 16) / 255) * 100) / 100 : 1,
      };
    }
  }
  const rgb = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+%?))?\s*\)$/i);
  if (!rgb) return null;
  const opacityValue = rgb[4]?.endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number.parseFloat(rgb[4] || "1");
  return {
    hex: `#${componentToHex(Number(rgb[1]))}${componentToHex(Number(rgb[2]))}${componentToHex(Number(rgb[3]))}`,
    opacity: Math.max(0, Math.min(1, Number.isFinite(opacityValue) ? opacityValue : 1)),
  };
}

export function colorPartsToCss(hex: string, opacity: number): string {
  const normalizedHex = hex.trim();
  const normalizedOpacity = Math.max(0, Math.min(1, opacity));
  if (!/^#[0-9a-f]{6}$/i.test(normalizedHex)) return hex;
  if (normalizedOpacity >= 1) return normalizedHex.toLowerCase();
  const r = Number.parseInt(normalizedHex.slice(1, 3), 16);
  const g = Number.parseInt(normalizedHex.slice(3, 5), 16);
  const b = Number.parseInt(normalizedHex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Number(normalizedOpacity.toFixed(2))})`;
}

export function colorPartsToRgb(hex: string, opacity: number): string {
  const normalizedHex = hex.trim();
  const normalizedOpacity = Math.max(0, Math.min(1, opacity));
  if (!/^#[0-9a-f]{6}$/i.test(normalizedHex)) return hex;
  const r = Number.parseInt(normalizedHex.slice(1, 3), 16);
  const g = Number.parseInt(normalizedHex.slice(3, 5), 16);
  const b = Number.parseInt(normalizedHex.slice(5, 7), 16);
  return normalizedOpacity >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(normalizedOpacity.toFixed(2))})`;
}

export function splitBoxValue(value: string): string[] {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return parts.slice(0, 4);
}

export function boxValueIsLinked(value: string): boolean {
  const parts = splitBoxValue(value);
  return parts.length === 4 && parts.every((part) => part === parts[0]);
}

export function mergeBoxValuePart(value: string, index: number, nextPart: string): string {
  const parts = splitBoxValue(value);
  if (parts.length !== 4) return value;
  parts[index] = nextPart;
  const [top, right, bottom, left] = parts;
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return parts.join(" ");
}

export function getPropertyEditorConfig(property: string, value = ""): PropertyEditorConfig {
  const override = CONTROL_OVERRIDES[property];
  if (override) {
    if (override.control === "number" && !simpleNumericParts(value)) return { control: "text" };
    return override;
  }
  if (isColorProperty(property)) return { control: "color" };
  const meta = getCssPropertyMeta(property);
  const finite = (meta?.knownValues || []).filter((item) => /^[a-z-]+$/.test(item));
  if (finite.length >= 2 && finite.length <= 4) return { control: "segmented", options: finite };
  if (NUMERIC_PROPERTY_PATTERN.test(property) && simpleNumericParts(value)) return { control: "number", step: 1 };
  return { control: "text" };
}

export function serializeEditedStyles(
  edits: Array<{ state: string; property: string; value: string; originalValue: string; valid: boolean }>,
): Record<string, Record<string, string>> {
  const grouped: Record<string, Record<string, string>> = {};
  edits.forEach((edit) => {
    if (!edit.valid || edit.value.trim() === edit.originalValue.trim()) return;
    grouped[edit.state] ||= {};
    grouped[edit.state][edit.property] = edit.value.trim();
  });
  return grouped;
}
