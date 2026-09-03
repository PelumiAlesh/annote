// UI contract harness — static regression tripwires for interaction behavior.
// The annotator is a browser IIFE (no DOM in this repo's test env), so these
// tests assert the structural invariants that the browser QA checklist verifies
// by hand: every control is handled, no forbidden APIs, a11y hooks present.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const SRC = new URL("../src/annotator.ts", import.meta.url);
const src = await readFile(SRC, "utf8");

function dataActions() {
  const found = new Set();
  for (const match of src.matchAll(/data-action="([a-z-]+)"/g)) found.add(match[1]);
  return found;
}

function handledActions() {
  const found = new Set();
  for (const match of src.matchAll(/action === "([a-z-]+)"/g)) found.add(match[1]);
  // Scrim + overlay clicks route through dedicated listeners, not action branches.
  for (const match of src.matchAll(/querySelector(All)?\(["'`]\[?(data-[a-z-]+)[\]'"]?/g)) found.add(match[2]);
  return found;
}

test("every rendered data-action has a handler branch", () => {
  const handled = handledActions();
  const unhandled = [...dataActions()].filter((a) => !handled.has(a) && a !== "open-toolbar");
  // open-toolbar is handled via its dedicated delegation path (asserted below).
  assert.deepEqual(unhandled, [], `unhandled actions: ${unhandled}`);
  assert.ok(src.includes('action === "open-toolbar"'), "open-toolbar delegation missing");
  assert.ok(src.includes('action === "confirm-cancel"'), "confirm cancel missing");
  assert.ok(src.includes('action === "confirm-delete"'), "confirm delete missing");
});

test("no native dialogs or toast libraries", () => {
  assert.ok(!/\bconfirm\(/.test(src.replace("confirmDialogContent", "").replace("requestConfirm", "")), "native confirm present");
  assert.ok(!src.includes("window.confirm"), "window.confirm present");
  assert.ok(!/\balert\(/.test(src), "alert present");
  assert.ok(!src.includes("sonner"), "third-party toast present");
});

test("globals are modifier-gated through the central matcher", () => {
  assert.ok(src.includes("matchGlobalShortcut(event)"), "central gate missing");
  assert.ok(!src.includes('key === "p"'), "bare P shortcut back");
  assert.ok(!src.includes('key === "c"'), "bare C shortcut back");
  assert.ok(src.includes("requestClearAnnotations"), "delete path missing");
  assert.ok(!src.match(/event\.key === "Delete"/), "bare Delete branch back");
});

test("destructive confirm contract", () => {
  assert.ok(src.includes('role="alertdialog"'), "alertdialog role missing");
  assert.ok(src.includes('aria-modal="true"'), "aria-modal missing");
  assert.ok(src.includes("[data-confirm-cancel]") && src.includes("CONFIRM_INITIAL_FOCUS"), "cancel-first focus missing");
  assert.ok(src.includes("trapConfirmTab"), "focus trap missing");
  assert.ok(src.includes('data-action="confirm-cancel"'), "outside-click scrim missing");
});

test("notice/toast contract", () => {
  assert.ok(src.includes('role="status"'), "live region missing");
  assert.ok(src.includes("4000"), "error dwell missing");
  assert.ok(src.includes("notice-error"), "error variant missing");
});

test("a11y chrome contract", () => {
  assert.ok(src.includes(":focus-visible"), "focus-visible missing");
  assert.ok(src.includes("prefers-reduced-motion"), "reduced-motion missing");
  assert.ok(src.includes('aria-hidden="true" data-mic-affordance'), "mic must be visual-only");
  assert.ok(!src.includes("<span class=\"settings-help-tip\""), "span help-tip back");
  assert.ok(src.includes("scrubberKeyStep"), "slider keyboard missing");
  assert.ok(src.includes("[data-action='open-toolbar']"), "launcher keyboard missing");
});

test("shortcut labels stay in sync with help", () => {
  for (const key of ["toggle-pick", "copy", "clear"]) {
    assert.ok(src.includes(`SHORTCUTS["${key}"]`) || src.includes(`SHORTCUTS.${key}`), `${key} label unused`);
  }
  assert.ok(src.includes("SHORTCUTS.copy"), "copy label missing from help");
});
