import assert from "node:assert/strict";
import test from "node:test";

import { isValidStoredAnnotation, sanitizeStoredAnnotations } from "/tmp/feedback-mark-annotation-storage.mjs";

const valid = { id: "ann_1", elementPath: ".card", element: "Card", comment: "Fix spacing", status: "pending" };

test("legacy valid annotation passes", () => {
  assert.equal(isValidStoredAnnotation(valid), true);
});

test("malformed JSON shape / wrong primitive types are rejected", () => {
  assert.equal(isValidStoredAnnotation(null), false);
  assert.equal(isValidStoredAnnotation({ id: 123, elementPath: ".a" }), false);
  assert.equal(isValidStoredAnnotation({ id: "a", elementPath: 42 }), false);
  assert.equal(isValidStoredAnnotation({ elementPath: ".a" }), false);
  assert.equal(isValidStoredAnnotation({ id: "a" }), false);
});

test("nested invalid fields are rejected", () => {
  assert.equal(isValidStoredAnnotation({ ...valid, status: "bogus" }), false);
  assert.equal(isValidStoredAnnotation({ ...valid, thread: [{ id: 1, content: "x" }] }), false);
  assert.equal(isValidStoredAnnotation({ ...valid, styleEdits: [{ property: "color" }] }), false);
  assert.equal(isValidStoredAnnotation({ ...valid, styleEdits: Array.from({ length: 100 }, () => ({ property: "color", value: "red" })) }), false);
});

test("one bad apple does not spoil the batch", () => {
  const { valid: items, skipped } = sanitizeStoredAnnotations([valid, { id: 1 }, { ...valid, id: "ann_2" }]);
  assert.equal(items.length, 2);
  assert.equal(skipped, 1);
});

test("oversized structures are skipped", () => {
  const huge = { ...valid, id: "big", comment: "x".repeat(200_000) };
  assert.equal(isValidStoredAnnotation(huge), false);
  const { valid: items } = sanitizeStoredAnnotations([valid, huge]);
  assert.equal(items.length, 1);
});

test("non-array payload never crashes", () => {
  assert.deepEqual(sanitizeStoredAnnotations(null), { valid: [], skipped: 1 });
  assert.deepEqual(sanitizeStoredAnnotations({}), { valid: [], skipped: 1 });
});
