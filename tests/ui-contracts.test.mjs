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
  assert.ok(src.includes('aria-label="Start dictation"'), "mic must be a labelled button");
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

test("shift multi-select preserves pristine composer and blocks dirty drafts", () => {
  const pointerBranch = src.slice(src.indexOf('if (event.shiftKey) {'), src.indexOf('if (event.shiftKey) {') + 650);
  const keyBranch = src.slice(src.indexOf('if (event.key === "Shift" && state.active'), src.indexOf('if (event.key === "Shift" && state.active') + 650);
  const keyUpBranch = src.slice(src.indexOf('function onKeyUp'), src.indexOf('function onWindowBlur'));
  assert.ok(pointerBranch.includes('state.selectedElement && draftIsDirty()'));
  assert.ok(pointerBranch.includes('shakeComposer()'));
  assert.ok(!pointerBranch.includes('closeComposerPreservingSelection()'));
  assert.ok(keyBranch.includes('state.selectedElement && draftIsDirty()'));
  assert.ok(keyBranch.includes('state.shiftSelecting = true;\n      setAnnotatingCursor(true);'));
  assert.ok(!keyBranch.includes('closeComposerPreservingSelection()'));
  assert.ok(keyBranch.includes("updateShiftSelectionPreview();"));
  assert.ok(!keyBranch.includes("state.hoverElement = null;"));
  assert.ok(pointerBranch.includes("updateShiftSelectionPreview();"));
  assert.ok(src.includes(".composer.shift-selecting {"));
  assert.ok(!src.includes("hideComposerForShiftSelect"));
  assert.ok(keyUpBranch.includes('if (state.selectedElement === selected)'));
  assert.ok(keyUpBranch.includes('state.selectedElements = [];'));
  assert.ok(keyUpBranch.includes('state.focusComposerOnRender = true;'));
  assert.ok(
    src.includes(
      'const cursor = commentCursor(state.shiftSelecting || state.selectedElements.length > 1 ? "#7dd3fc" : "#ff7a1a")',
    ),
  );
  const pointerMove = src.slice(src.indexOf("function onPointerMove"), src.indexOf("function openMultiSelectionComposer"));
  assert.ok(!pointerMove.includes("state.shiftSelecting && !event.shiftKey"));
  assert.ok(pointerMove.includes("if (state.selectedElement && !state.shiftSelecting) {"));
  assert.ok(pointerMove.includes("state.hoverElement = next;\n      return;"));
  const clearComposer = src.slice(src.indexOf("function clearComposerState"), src.indexOf("function closeComposerPreservingSelection"));
  assert.ok(clearComposer.includes("state.shiftSelecting = false;\n    if (state.active) setAnnotatingCursor(true);"));
  const openComposer = src.slice(src.indexOf("function openComposerForElement"), src.indexOf("function onPointerDown"));
  assert.ok(openComposer.includes("state.selectedElements = selectedElements;\n    if (state.active) setAnnotatingCursor(true);"));
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

test("four-sided style controls identify every input with directional tooltips", () => {
  assert.ok(src.includes('["padding", "margin", "border-width", "border-radius"].includes(row.property)'));
  assert.ok(src.includes('row.property === "border-radius"'));
  for (const position of ["Top left", "Top right", "Bottom right", "Bottom left"]) {
    assert.ok(src.includes(`["${position}", parts[`), `missing radius position ${position}`);
  }
  for (const position of ["Top", "Right", "Bottom", "Left"]) {
    assert.ok(src.includes(`["${position}", parts[`), `missing box side ${position}`);
  }
  assert.ok(src.includes('data-tooltip="${escapeHtml(inputLabel)}"'));
});

test("structure section animates open", () => {
  assert.ok(src.includes('(".structure-body")?.animate('), "structure open animation missing");
});

test("structure section animates closed", () => {
  assert.ok(src.includes("structureAnimating"), "close guard missing");
  assert.ok(src.includes('{ gridTemplateRows: "1fr"'), "close keyframes missing");
});

test("children and sibling structure branches remain permanently expanded", () => {
  assert.ok(src.includes('data-structure-list="children"'));
  assert.ok(src.includes('data-structure-list="siblings"'));
  assert.ok(!src.includes('toggle-structure-children'));
  assert.ok(!src.includes('toggle-structure-siblings'));
  assert.ok(!src.includes('function toggleStructureBranch'));
  assert.ok(!src.includes('structureChildrenExpanded'));
  assert.ok(!src.includes('structureSiblingsExpanded'));
  assert.ok(src.includes('<div class="structure-label">Children</div>'));
  assert.ok(src.includes('<div class="structure-label">Siblings</div>'));
  assert.ok(!src.includes('childrenCountLabel'));
  assert.ok(!src.includes('siblingsCountLabel'));
  assert.ok(src.includes('min-height: 0;\n        display: flex;'));
  assert.ok(src.includes('<div class="structure-list" data-structure-list="children"><div class="structure-list-inner">${childrenListInner}</div></div>'));
  assert.ok(src.includes('<div class="structure-list" data-structure-list="siblings"><div class="structure-list-inner">${siblingsListInner}</div></div>'));
  const group = src.slice(src.indexOf('.structure-group {'), src.indexOf('.structure-group:first-child'));
  assert.ok(group.includes('padding: 0;'));
});

test("settings transitions animate height with body", () => {
  assert.ok(src.includes(".settings-viewport.animating"), "viewport height transition missing");
  assert.ok(src.includes("viewport.classList.add("), "animating class missing");
  assert.ok(!src.includes("translateX(18px)"), "hard slide distance back");
});

test("theme transitions and observer stay scoped", () => {
  assert.ok(src.includes(".fm-layer.theme-transitioning"), "coordinated theme transition missing");
  assert.ok(src.includes("transition-property: background-color, color, border-color, box-shadow, fill, stroke"));
  assert.ok(src.includes('matchMedia("(prefers-color-scheme: dark)")'));
  assert.ok(src.includes("attributeFilter: [...THEME_ATTRIBUTE_FILTER]"));
  const themeObserver = src.slice(src.indexOf("function connectPageThemeObserver"), src.indexOf("function syncPageThemeObservation"));
  assert.ok(!themeObserver.includes("subtree"), "theme observer must not watch a subtree");
  assert.ok(!themeObserver.includes("setInterval"), "theme detection must not poll");
  assert.ok(src.includes('state.settings.theme !== "opposite-page"'), "explicit themes must not observe the page");
});

test("dark semantic tokens preserve the existing Annote palette", () => {
  for (const token of [
    "--fm-bg: #1a1a1a",
    "--fm-surface: #1a1a1a",
    "--fm-surface-secondary: #101010",
    "--fm-surface-dialog: #1c1c1e",
    "--fm-surface-subtle: rgba(255,255,255,.05)",
    "--fm-surface-hover: rgba(255,255,255,.1)",
    "--fm-border: rgba(255,255,255,.08)",
    "--fm-border-strong: rgba(255,255,255,.12)",
    "--fm-text-strong: rgba(255,255,255,.9)",
    "--fm-text: rgba(255,255,255,.85)",
    "--fm-text-muted: rgba(255,255,255,.58)",
    "--fm-text-subtle: rgba(255,255,255,.42)",
  ]) assert.ok(src.includes(token), `dark token changed: ${token}`);
});

test("light theme keeps toolbar buttons quiet until hover", () => {
  assert.ok(src.includes('.fm-layer[data-theme="light"] .toolbar .icon-btn,'));
  assert.ok(src.includes('background: transparent;\n        border-color: transparent;\n        color: var(--fm-text-muted);'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .toolbar .icon-btn:hover'));
  assert.ok(src.includes('background: var(--fm-surface-hover);'));
});

test("light style-editor toggle stays quiet until hover or selection", () => {
  assert.ok(src.includes('.fm-layer[data-theme="light"] .css-toggle {\n        background: transparent;'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .css-toggle:hover,\n      .fm-layer[data-theme="light"] .css-toggle.open {'));
  assert.ok(src.includes('background: var(--fm-surface-hover);\n        color: var(--fm-text-strong);'));
});

test("light theme covers composer labels, controls, menus, and tooltip shortcuts", () => {
  assert.ok(src.includes('.fm-layer[data-theme="light"] .toolbar-tooltip-shortcut'));
  assert.ok(src.includes('.css-row.changed .css-name'));
  assert.ok(src.includes('.composer-input, .css-input, .text-edit-input, .motion-input, .font-trigger, .color-control, .box-input'));
  assert.ok(src.includes('.intent-menu, .font-menu, .token-menu, .autocomplete'));
  assert.ok(src.includes('.intent-option[aria-checked="true"]'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] button {'));
});

test("theme control stays compact and borderless", () => {
  assert.ok(src.includes('grid-template-columns: repeat(3, 24px)'));
  assert.ok(src.includes('width: 24px;\n        height: 22px;'));
  assert.ok(src.includes('width: 12px;\n        height: 12px;'));
  const themeBlock = src.slice(src.indexOf('.theme-segments {'), src.indexOf('.settings-row:focus-visible'));
  assert.ok(themeBlock.includes('background: transparent'));
  assert.ok(themeBlock.includes('box-shadow: none'));
});

test("toolbar, markers, and picking retain their intended themed states", () => {
  assert.ok(
    src.includes('radial-gradient(circle at 0 0, transparent 17px, var(--fm-border) 17px 18px, var(--fm-surface) 18px)'),
    "top inner toolbar radius outline missing",
  );
  assert.ok(
    src.includes('radial-gradient(circle at 0 100%, transparent 17px, var(--fm-border) 17px 18px, var(--fm-surface) 18px)'),
    "bottom inner toolbar radius outline missing",
  );
  assert.ok(src.includes('.fm-layer[data-theme="light"].active .toolbar .pick-toggle'), "light active picker color missing");
  assert.ok(src.includes('border: 2px solid transparent'), "marker white border returned");
  assert.ok(src.includes('box-shadow: 0 10px 26px rgba(24,24,22,.24)'), "light marker shadow missing");
});

test("style editor transitions close the intent menu before composer geometry changes", () => {
  const branch = src.slice(src.indexOf('if (action === "toggle-css")'), src.indexOf('if (action === "collapse")'));
  assert.ok(branch.indexOf("state.intentMenuOpen = false;") < branch.indexOf("state.cssOpen = nextOpen;"));
});

test("leaving a pending tooltip target closes the previously active tooltip", () => {
  const branch = src.slice(src.indexOf("function closeAnnoteTooltip"), src.indexOf("function resetAnnoteTooltip"));
  assert.ok(branch.includes("const wasPending = toolbarTooltipPending === control;"));
  assert.ok(branch.includes("const orphanedActive = wasPending ? toolbarTooltipActive : null;"));
  assert.ok(branch.includes("if (orphanedActive) closeAnnoteTooltip(orphanedActive, immediate);"));
});

test("light settings, review, structure, and footer controls use explicit states", () => {
  assert.ok(src.includes('.settings-back, .settings-command button, .settings-link-button'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .style-change-head'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .state-tab.active .state-count'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .structure-row.selected'));
  assert.ok(src.includes('.composer-actions .text-btn, .text-btn.ghost, .delete-current, .footer-mic'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .segment.active'));
  assert.ok(src.includes('.css-row.changed .css-name { color: var(--fm-orange-strong); }'));
});

test("structure and radio selections invert appropriately by theme", () => {
  assert.ok(src.includes('.fm-layer[data-theme="light"] .structure-header:hover'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .structure-row.is-parent {'));
  assert.ok(src.includes('background: #181816;\n        color: #fff;'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .segment:not(.active)'));
  assert.ok(src.includes('.structure-row.selected { background: #fff; color: #181816; border-color: #fff;'));
  assert.ok(src.includes('.segment.active {\n        background: #fff;\n        border-color: #fff;\n        color: #181816;'));
});

test("light bound-token values use dark blue text", () => {
  assert.ok(src.includes('.fm-layer[data-theme="light"] .token-pill small'));
  assert.ok(src.includes('color: #0c4a6e;'));
});

test("composer footer actions are rectangular", () => {
  const block = src.slice(src.indexOf('.composer-actions .text-btn {'), src.indexOf('.composer-action-spacer'));
  assert.ok(block.includes('border-radius: 6px;'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .composer-actions [data-action="cancel-compose"]'));
});

test("compact tooltips use measured six-pixel padding", () => {
  assert.ok(src.includes('padding: 6px 6px;'));
  assert.ok(src.includes('const measuredCompactWidth'));
  assert.ok(!src.includes('Math.ceil(displayForMeasure.length * 7.2) + 20'));
  assert.ok(!src.includes('.toolbar-tooltip-copy.has-shortcut'));
});

test("light confirmations and review comments have semantic surfaces", () => {
  assert.ok(src.includes('.marker-tip, .confirm)'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .confirm {'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .item-body > p:first-child'));
  assert.ok(src.includes('.item-body > p:first-child { font-weight: 500; }'));
});

test("structure keeps only its top border and motion graph stays borderless", () => {
  const structure = src.slice(src.indexOf('.structure-section {'), src.indexOf('.structure-header {'));
  assert.ok(structure.includes('border: 0;'));
  assert.ok(structure.includes('border-top: 1px solid'));
  const graph = src.slice(src.indexOf('.motion-graph {'), src.indexOf('.motion-graph svg'));
  assert.ok(graph.includes('box-shadow: none;'));
});

test("color swatches expose the Coloris picker and preserve transparency preview", () => {
  assert.ok(src.includes('class="css-swatch color-picker-swatch"'));
  assert.ok(src.includes('data-action="open-coloris"'));
  assert.ok(src.includes('action === "open-coloris"'));
  assert.ok(src.includes('conic-gradient(#d8d8d6'));
  assert.ok(src.includes('setProperty("--fm-swatch-color"'));
  assert.ok(src.includes('.clr-picker[data-annote-theme="light"] {'));
  assert.ok(src.includes('.clr-picker .clr-preview::before'));
  assert.ok(src.includes('width: 26px !important;\n            height: 26px !important;'));
  assert.ok(src.includes('.clr-picker .clr-segmented {'));
  assert.ok(src.includes('picker.dataset.annoteTheme = state.resolvedTheme'));
});

test("expanded composer destructive and linked controls use explicit states", () => {
  assert.ok(src.includes('.delete-current:hover {\n        border-color: transparent;\n        background: transparent;\n        color: #f04438;'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .delete-current:hover'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .toolbar .icon-btn.danger:not([aria-disabled="true"]):hover'));
  assert.ok(src.includes('.link-toggle.linked {\n        background: rgba(14,165,233,.16);\n        color: #7dd3fc;'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .link-toggle.linked'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .token-button.bound {\n        background: #e0f2fe;\n        color: #0284c7;'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .token-button.bound:hover {\n        background: #bae6fd;\n        color: #181816;'));
});

test("inputs and motion controls avoid white outlines and tracks", () => {
  assert.ok(src.includes('.fm-layer :where(textarea, input, select, .composer-input, .font-trigger, .color-control, .motion-input, .css-input, .text-edit-input)'));
  assert.ok(src.includes('.motion-tick.filled {\n        background: var(--fm-text-subtle);'));
  assert.ok(src.includes('.motion-tick.active {\n        height: 18px;\n        background: var(--fm-text-muted);'));
  assert.ok(src.includes('background: #8a8987;\n        box-shadow: 0 1px 2px rgba(0,0,0,.36);'));
});

test("focus rings are thin and inset while text inputs remain ringless", () => {
  assert.ok(src.includes('.fm-layer :focus-visible:not(input):not(textarea):not(select)'));
  assert.ok(src.includes('box-shadow: inset 0 0 0 1px #ff7a1a;'));
  assert.ok(!src.includes('outline: 2px solid #ff7a1a'));
  assert.ok(src.includes('border-color: transparent !important;'));
});

test("expanded composer keeps the microphone beside the text field", () => {
  assert.ok(src.includes('const showTopMic = controls.top.includes("mic")'));
  assert.ok(!src.includes('controls.footerRight?.includes("mic")'));
});

test("collapsed multiline composer keeps all actions inside the field without a divider", () => {
  const topField = src.slice(src.indexOf('const topField ='), src.indexOf('return `<form class="composer'));
  assert.ok(topField.includes('class="icon-btn primary submit-icon'));
  assert.ok(!topField.includes('composer-bar-actions'));
  assert.ok(src.includes('.composer.multiline .intent-separator {\n        display: none;'));
  assert.ok(src.includes('${state.composerMultiline ? "multiline" : ""}'));
  assert.ok(src.includes('syncComposerSubmitState();\n        autogrowComposerTextarea(comment);'));
});

test("light theme explicitly colors token and motion metadata", () => {
  assert.ok(src.includes('.token-menu-group, .token-name'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .token-value'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .motion-metric span'));
  assert.ok(src.includes('.fm-layer[data-theme="light"] .motion-metric strong'));
});

test("motion sliders stay transparent with solid thumbs and stronger tabs", () => {
  assert.ok(src.includes('background: transparent !important;'));
  assert.ok(src.includes('background: #8a8987;'));
  assert.ok(src.includes('background: rgba(255,255,255,.2);'));
  assert.ok(src.includes('background: rgba(24,24,22,.16);'));
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

test("collapsed launcher carries the annotation count", () => {
  assert.ok(src.includes("launcher-badge"), "badge markup missing");
  assert.ok(src.includes("pendingCount"), "badge count missing");
  assert.ok(src.includes(".launcher-badge"), "badge style missing");
});

test("truncated property labels expose full names", () => {
  assert.ok(src.includes('".css-name > span"'), "truncation pass missing");
  assert.ok(src.includes("scrollWidth"), "overflow check missing");
});

test("voice dictation uses real buttons and handled actions", () => {
  assert.ok(src.includes('aria-label="Start dictation"'), "mic label missing");
  assert.ok(src.includes('aria-label="Cancel dictation"'), "voice cancel label missing");
  assert.ok(src.includes('aria-label="Stop recording"'), "stop label missing");
  assert.ok(!src.includes("data-mic-affordance"), "inert mic span back");
  for (const action of ["dictation-mic", "dictation-cancel", "dictation-stop"]) {
    assert.ok(src.includes(`action === "${action}"`), `${action} unhandled`);
  }
});

test("dictation locks commit paths and cleans up", () => {
  assert.ok(src.includes("dictationActive()) return;"), "submit/undo guard missing");
  assert.ok(src.includes("cleanupDictation()"), "cleanup missing");
  assert.ok(src.includes("getUserMedia({ audio: true })"), "mic-only capture missing");
  assert.ok(!src.includes("getDisplayMedia"), "screen capture present");
});

test("footer groups keep commit anchored right", () => {
  assert.ok(src.includes("footer-group footer-left"), "left group missing");
  assert.ok(src.includes("footer-group footer-right"), "right group missing");
  assert.ok(src.includes("footer-delete-gap"), "delete gap missing");
});

test("closing the composer resumes inspection-paused animations", () => {
  const idx = src.indexOf("function restoreSelectionPausedAnimations");
  assert.ok(idx !== -1, "selection restore missing");
  const block = src.slice(idx, idx + 700);
  assert.ok(block.includes("void animation.play()"), "resume missing");
  assert.ok(block.includes("motionUserPaused.clear()"), "user-pause reset missing");
});

test("motion user-pause sticks until explicit play or replay", () => {
  assert.ok(src.includes("motionUserPaused"), "user-pause tracking missing");
  assert.ok(src.includes("isMotionUserPaused"), "user-pause guard missing");
  const replayIdx = src.indexOf("const shouldReplay");
  assert.ok(replayIdx !== -1, "preview replay decision missing");
  assert.ok(src.slice(replayIdx, replayIdx + 200).includes("!isMotionUserPaused"), "preview resumes user-paused animation");
  const restoreIdx = src.indexOf("function restoreSelectionPausedAnimations");
  assert.ok(restoreIdx !== -1, "selection restore missing");
  assert.ok(src.slice(restoreIdx, restoreIdx + 800).includes("motionUserPaused"), "close resumes user-paused animation");
  assert.ok(src.includes("action === \"toggle-animation-play\""), "pause toggle missing");
  assert.ok(src.includes("action === \"replay-animation\""), "replay missing");
});

test("composer placeholder stays constant with style editor open", () => {
  assert.ok(!src.includes("Add a comment"), "old placeholder back");
  assert.ok(src.includes('placeholder="Describe your changes..."'), "unified placeholder missing");
});

test("structure close holds its end state until render swaps the class", () => {
  const idx = src.indexOf("gridTemplateRows");
  assert.ok(idx !== -1, "structure WAAPI missing");
  assert.ok(src.slice(idx, idx + 4000).includes('fill: "forwards"'), "close fill missing — body snaps back open");
});

test("motion tab switch swaps content synchronously without exiting wobble", () => {
  const idx = src.indexOf("function switchMotionPaneTab");
  assert.ok(idx !== -1, "tab switch missing");
  const block = src.slice(idx, src.indexOf("function updateMotionFieldsPanel"));
  assert.ok(!block.includes('add("exiting")'), "exiting wobble back");
  assert.ok(!block.includes("setTimeout"), "delayed swap back");
});

test("composer placeholder stays constant with style editor open", () => {
  assert.ok(!src.includes("Add a comment"), "old placeholder back");
  assert.ok(src.includes('placeholder="Describe your changes..."'), "unified placeholder missing");
});

test("intent selector lives inside the input with no native select", () => {
  assert.ok(!src.includes('<select name="intent"'), "native intent select back");
  assert.ok(!src.includes("intent-radios"), "radio intent UI back");
  assert.ok(src.includes('data-intent-wrap'), "intent wrap missing");
  assert.ok(src.includes('data-action="toggle-intent-menu"'), "intent toggle missing");
  assert.ok(src.includes('data-action="set-intent"'), "intent options missing");
  assert.ok(src.includes('role="menu"'), "menu role missing");
  assert.ok(src.includes('role="menuitemradio"'), "menuitemradio missing");
  // Selector must render inside the unified input surface, ahead of the
  // comment field — never as a separate row above/below it.
  const inputIdx = src.indexOf('class="composer-input"');
  assert.ok(inputIdx !== -1, "unified input surface missing");
  const row = src.slice(inputIdx, inputIdx + 2000);
  assert.ok(row.indexOf("renderIntentSelector()") < row.indexOf('name="comment"'), "intent outside input");
  for (const action of ["toggle-intent-menu", "set-intent"]) {
    assert.ok(src.includes(`action === "${action}"`), `${action} unhandled`);
  }
});

test("intent options explain themselves via the shared tooltip primitive", () => {
  // Copy lives in the protocol module; the composer must wire it through
  // data-tooltip (shared hover/focus primitive), never native title text.
  assert.ok(src.includes("ANNOTE_INTENT_TOOLTIPS"), "intent tooltip wiring missing");
  assert.ok(src.includes('data-tooltip="${escapeHtml(ANNOTE_INTENT_TOOLTIPS[value])}"'), "option tooltip missing");
  assert.ok(!src.includes("intent-option") || !src.includes('title="Request a change'), "native title tooltip used");
  // Options explain to the right in a wrapping bubble, not a wide pill.
  assert.ok(src.includes('data-tooltip-side="right"'), "option tooltip side missing");
  assert.ok(src.includes("data-tooltip-wrap"), "option tooltip wrap missing");
  assert.ok(src.includes('data-tooltip-delay="220"'), "intent tooltip stabilization delay missing");
  assert.ok(src.includes('data-tooltip-hover-only'), "intent tooltip should require pointer hover");
  assert.ok(src.includes('if (!control.hasAttribute("data-tooltip-hover-only")) openAnnoteTooltip(control, true);'));
  assert.ok(src.includes('const requestedDelay = Number.parseInt(control.dataset.tooltipDelay || "", 10);'));
});

test("single-line intent selector stays vertically centered", () => {
  const wrap = src.slice(src.indexOf('.intent-wrap {'), src.indexOf('.intent-toggle {'));
  const toggle = src.slice(src.indexOf('.intent-toggle {'), src.indexOf('.intent-toggle:hover'));
  const separator = src.slice(src.indexOf('.intent-separator {'), src.indexOf('.intent-menu {'));
  assert.ok(wrap.includes('align-self: center;'));
  assert.ok(wrap.includes('align-items: center;'));
  assert.ok(toggle.includes('align-self: center;'));
  assert.ok(separator.includes('align-self: center;'));
  assert.ok(separator.includes('margin: 0 4px 0 2px;'));
});

test("intent menu escapes composer clipping and tracks layout", () => {
  const idx = src.indexOf(".intent-menu {");
  assert.ok(idx !== -1, "menu styles missing");
  assert.ok(src.slice(idx, idx + 300).includes("position: fixed;"), "menu must escape overflow hidden");
});

test("composer input reads larger than metadata text", () => {
  assert.ok(src.includes(".composer-bar textarea {"), "composer input rule missing");
  const idx = src.indexOf(".composer-bar textarea {");
  assert.ok(src.slice(idx, idx + 400).includes("font-size: 13px;"), "input font size missing");
});

test("collapsed composer shares the expanded canonical width", () => {
  assert.ok(src.includes("width: min(410px, calc(100vw - 24px));"), "canonical width missing");
  assert.ok(!src.includes("Math.min(state.cssOpen ? 410 : 340"), "collapsed width split back");
  assert.ok(src.includes("Math.min(410, innerWidth - 24)"), "position calc not canonical");
});

test("dictation chrome stays quiet", () => {
  assert.ok(src.includes(".dictation-x {"), "x rule missing");
  assert.ok(src.includes(".footer-mic::after"), "footer mic hit area missing");
  assert.ok(src.includes("align-self: flex-start"), "toggle top alignment missing");
});
