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
  assert.ok(!src.includes("isPanelControlFocused"), "panel-focus suppression back");
});

test("copy/clear disable via aria-disabled so tooltips keep working", () => {
  assert.ok(src.includes('aria-disabled="true"'), "aria-disabled missing");
  assert.ok(src.includes('.icon-btn[aria-disabled="true"]'), "dim style missing");
  assert.ok(src.includes('getAttribute("aria-disabled")'), "click guard missing");
});

test("destructive confirm contract", () => {
  assert.ok(src.includes('role="alertdialog"'), "alertdialog role missing");
  assert.ok(src.includes('aria-modal="true"'), "aria-modal missing");
  assert.ok(src.includes("[data-action='confirm-delete']") && src.includes("CONFIRM_INITIAL_FOCUS"), "delete-first focus missing");
  assert.ok(src.includes("trapConfirmTab"), "focus trap missing");
  assert.ok(src.includes('data-action="confirm-cancel"'), "outside-click scrim missing");
  assert.ok(src.includes("restoreConfirmPick"), "pick suspension missing");
  assert.ok(src.includes("[data-confirm-scrim]"), "scroll lock missing");
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

test("segment buttons carry their original value for undo", () => {  assert.ok(src.includes('data-action="set-segment"'), "segment action missing");
  assert.ok(src.includes('data-original-value="${escapeHtml(row.value)}"'), "segment original missing");
  assert.ok(src.includes("control.dataset.originalValue"), "handler ignores button original");
});

test("shortcut labels stay in sync with help", () => {
  for (const key of ["toggle-pick", "copy", "clear"]) {
    assert.ok(src.includes(`SHORTCUTS["${key}"]`) || src.includes(`SHORTCUTS.${key}`), `${key} label unused`);
  }
  assert.ok(src.includes("SHORTCUTS.copy"), "copy label missing from help");
});

test("dirty scope-switch shakes instead of switching", () => {
  const branch = src.slice(src.indexOf('action === "set-selection-scope"'), src.indexOf('action === "set-selection-scope"') + 600);
  assert.ok(branch.includes("blockDirtyComposerSwitch()"), "dirty guard missing on scope switch");
});

test("style-editor controls expose tooltips", () => {
  const lines = src.split("\n");
  const tokenLine = lines.find((line) => line.includes('class="token-button'));
  assert.ok(tokenLine?.includes("data-tooltip="), "token tooltip missing");
  const stepperLine = lines.find((line) => line.includes('class="stepper-btn"'));
  assert.ok(stepperLine?.includes("data-tooltip="), "stepper tooltip missing");
  const linkLine = lines.find((line) => line.includes('class="link-toggle'));
  assert.ok(linkLine?.includes("data-tooltip="), "link tooltip missing");
});

test("structure section animates open", () => {
  assert.ok(src.includes('(".structure-body")?.animate('), "structure open animation missing");
});

test("structure section animates closed", () => {
  assert.ok(src.includes("structureAnimating"), "close guard missing");
  assert.ok(src.includes('{ gridTemplateRows: "1fr"'), "close keyframes missing");
});

test("settings transitions animate height with body", () => {
  assert.ok(src.includes(".settings-viewport.animating"), "viewport height transition missing");
  assert.ok(src.includes("viewport.classList.add("), "animating class missing");
  assert.ok(!src.includes("translateX(18px)"), "hard slide distance back");
});

test("outside click dismisses panels but never confirm", () => {
  const idx = src.indexOf("Outside click dismisses");
  assert.ok(idx !== -1, "outside-click handler missing");
  const block = src.slice(idx, idx + 600);
  assert.ok(block.includes("!state.confirm"), "confirm exemption missing");
  assert.ok(block.includes("state.visible = false"), "panel close missing");
});

test("text buttons skip tooltips, icon-only keeps them", () => {
  const lines = src.split("\n");
  const fontLine = lines.find((line) => line.includes('class="font-trigger"'));
  assert.ok(fontLine && !fontLine.includes("data-tooltip="), "font tooltip back");
  const segLine = lines.find((line) => line.includes('data-action="set-segment"'));
  assert.ok(segLine?.includes("text-align"), "icon-segment exception missing");
});

test("truncated property labels expose full names", () => {
  assert.ok(src.includes('".css-name"'), "truncation pass missing");
  assert.ok(src.includes("scrollWidth"), "overflow check missing");
});
