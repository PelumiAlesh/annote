import assert from "node:assert/strict";
import test from "node:test";

import { isMacPlatform, matchGlobalShortcut, shortcutLabel } from "/tmp/feedback-mark-shortcuts.mjs";

function key(overrides = {}) {
  return { key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

test("bare single keys never fire globals", () => {
  assert.equal(matchGlobalShortcut(key({ key: "p", code: "KeyP" })), null);
  assert.equal(matchGlobalShortcut(key({ key: "c", code: "KeyC" })), null);
  assert.equal(matchGlobalShortcut(key({ key: "Backspace" })), null);
  assert.equal(matchGlobalShortcut(key({ key: "Delete" })), null);
});

test("sacred browser chords are never claimed", () => {
  // Cmd/Ctrl+C = Copy, Cmd/Ctrl+P = Print — no Alt.
  assert.equal(matchGlobalShortcut(key({ key: "c", code: "KeyC", metaKey: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "c", code: "KeyC", ctrlKey: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "p", code: "KeyP", metaKey: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "p", code: "KeyP", ctrlKey: true })), null);
  // DevTools inspect chord stays free.
  assert.equal(matchGlobalShortcut(key({ key: "c", code: "KeyC", ctrlKey: true, shiftKey: true })), null);
});

test("Alt chords match by physical code (macOS Option chars)", () => {
  // macOS sends "π" for Option+P and "ç" for Option+C — code still matches.
  assert.equal(matchGlobalShortcut(key({ key: "π", code: "KeyP", metaKey: true, altKey: true })), "toggle-pick");
  assert.equal(matchGlobalShortcut(key({ key: "ç", code: "KeyC", ctrlKey: true, altKey: true })), "copy");
  assert.equal(matchGlobalShortcut(key({ key: "p", code: "KeyP", metaKey: true, altKey: true })), "toggle-pick");
  assert.equal(matchGlobalShortcut(key({ key: "c", code: "KeyC", ctrlKey: true, altKey: true })), "copy");
});

test("delete requires Cmd/Ctrl+Backspace exactly", () => {
  assert.equal(matchGlobalShortcut(key({ key: "Backspace", metaKey: true })), "delete");
  assert.equal(matchGlobalShortcut(key({ key: "Backspace", ctrlKey: true })), "delete");
  assert.equal(matchGlobalShortcut(key({ key: "Backspace", metaKey: true, shiftKey: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "Backspace", metaKey: true, altKey: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "Delete", metaKey: true })), null);
});

test("labels are platform aware and mnemonic", () => {
  assert.equal(shortcutLabel("toggle-pick", true), "⌘⌥P");
  assert.equal(shortcutLabel("toggle-pick", false), "Ctrl+Alt+P");
  assert.equal(shortcutLabel("copy", true), "⌘⌥C");
  assert.equal(shortcutLabel("copy", false), "Ctrl+Alt+C");
  assert.equal(shortcutLabel("delete", true), "⌘⌫");
  assert.equal(shortcutLabel("delete", false), "Ctrl+Backspace");
  assert.equal(isMacPlatform("MacIntel"), true);
  assert.equal(isMacPlatform("Win32"), false);
});
