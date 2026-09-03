// Centralized global-shortcut definitions for Annote.
// Pure module (no DOM) — every global chord is decided here, and the
// annotator calls matchGlobalShortcut from a single gate in onKeyDown.
//
// Rules:
// - Every global requires the platform modifier (Cmd on macOS, Ctrl elsewhere).
// - Letter chords use `code` (physical key), because macOS Option-modified
//   keys produce alternate characters (e.g. Option+P = "π", Option+C = "ç").
// - Cmd/Ctrl+C (Copy) and Cmd/Ctrl+P (Print) are NEVER claimed.
// - Bare Backspace/Delete never fire: deletion requires Cmd/Ctrl+Backspace.

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
  return isMac ? "⌘" : "Ctrl";
}

export function shortcutLabel(action: GlobalShortcutAction | "delete-current", isMac: boolean): string {
  if (action === "toggle-pick") return isMac ? "⌘⌥P" : "Ctrl+Alt+P";
  if (action === "copy") return isMac ? "⌘⌥C" : "Ctrl+Alt+C";
  return isMac ? "⌘⌫" : "Ctrl+Backspace";
}

function modHeld(event: KeyEventLike): boolean {
  return event.ctrlKey || event.metaKey;
}

export function matchGlobalShortcut(event: KeyEventLike): GlobalShortcutAction | null {
  if (!modHeld(event)) return null;
  if (event.key === "Backspace" && !event.altKey && !event.shiftKey) return "delete";
  const code = event.code || "";
  if (event.altKey && !event.shiftKey) {
    if (code === "KeyP") return "toggle-pick";
    if (code === "KeyC") return "copy";
  }
  return null;
}
