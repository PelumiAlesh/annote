// Centralized global-shortcut definitions for Annote.
// Pure module (no DOM) — every global chord is decided here, and the
// annotator calls matchGlobalShortcut from a single gate in onKeyDown.
//
// Rules:
// - Every global is Option/Alt + key, with NO other modifier. Cmd/Ctrl
//   combinations are never claimed (Cmd+Opt+C opens Chrome DevTools,
//   Cmd+C is Copy, Cmd+P is Print). Ctrl+Alt (AltGr) is excluded so
//   Windows AltGr characters never trigger Annote.
// - Letter chords use `code` (physical key), because macOS Option-modified
//   keys produce alternate characters (e.g. Option+P = "π", Option+C = "ç").
// - Bare Backspace/Delete never fire: deletion requires Alt+Backspace.

export type GlobalShortcutAction = "toggle-pick" | "copy" | "delete";

export type KeyEventLike = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function isMacPlatform(platform: string | undefined): boolean {
  return /mac/i.test(platform || "");
}

export function platformModifier(isMac: boolean): string {
  return isMac ? "⌥" : "Alt";
}

export function shortcutLabel(action: GlobalShortcutAction | "delete-current" | "destroy", isMac: boolean): string {
  if (action === "toggle-pick") return isMac ? "⌥P" : "Alt+P";
  if (action === "copy") return isMac ? "⌥C" : "Alt+C";
  if (action === "destroy") return "Esc";
  return isMac ? "⌥⌫" : "Alt+Backspace";
}

export function matchGlobalShortcut(event: KeyEventLike): GlobalShortcutAction | null {
  // Option/Alt only — any Cmd/Ctrl (incl. AltGr) or Shift disqualifies.
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === "Backspace") return "delete";
  const code = event.code || "";
  if (code === "KeyP") return "toggle-pick";
  if (code === "KeyC") return "copy";
  return null;
}
