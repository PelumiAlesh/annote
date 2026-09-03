import assert from "node:assert/strict";
import test from "node:test";

import { CONFIRM_INITIAL_FOCUS, confirmDialogContent } from "/tmp/feedback-mark-confirm-dialog.mjs";

test("clear-all copy matches the approved wording", () => {
  const single = confirmDialogContent("clear-all", { count: 1 });
  assert.equal(single.title, "Delete all annotations?");
  assert.equal(single.body, "This removes the annotation on this page.");
  assert.equal(single.cancelLabel, "Cancel");
  assert.equal(single.confirmLabel, "Delete");
  const many = confirmDialogContent("clear-all", { count: 3 });
  assert.equal(many.body, "This removes all 3 annotations on this page.");
});

test("delete-current copy names the element when known", () => {
  const named = confirmDialogContent("delete-current", { elementLabel: "Hero card" });
  assert.equal(named.title, "Delete this annotation?");
  assert.ok(named.body.includes("Hero card"));
  const unnamed = confirmDialogContent("delete-current");
  assert.equal(unnamed.title, "Delete this annotation?");
  assert.ok(unnamed.body.length > 0);
});

test("initial focus is Cancel so Enter cannot confirm by accident", () => {
  assert.equal(CONFIRM_INITIAL_FOCUS, "cancel");
});
