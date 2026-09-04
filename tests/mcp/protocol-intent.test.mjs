// Intent V1 protocol coverage: vocabulary, legacy migration, DTO surfacing.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ANNOTE_INTENT_AGENT_GUIDANCE,
  ANNOTE_INTENT_LABELS,
  ANNOTE_INTENT_TOOLTIPS,
  ANNOTE_INTENTS,
  annotationToDTO,
  compactAnnotation,
  normalizeAnnotationIntent,
} from "/tmp/annote-protocol.mjs";

test("intent vocabulary is exactly fix/ask/note", () => {
  assert.deepEqual([...ANNOTE_INTENTS], ["fix", "ask", "note"]);
  assert.deepEqual(ANNOTE_INTENT_LABELS, { fix: "Fix", ask: "Ask", note: "Note" });
  assert.equal(ANNOTE_INTENT_TOOLTIPS.fix, "Request a change to this UI.");
  assert.equal(ANNOTE_INTENT_TOOLTIPS.ask, "Ask the agent about this UI without requesting a change.");
  assert.equal(ANNOTE_INTENT_TOOLTIPS.note, "Leave context or feedback without requesting a change.");
  for (const intent of ANNOTE_INTENTS) {
    assert.match(ANNOTE_INTENT_AGENT_GUIDANCE[intent], new RegExp(`intent=${intent}`));
  }
});

test("normalize keeps V1 values and migrates legacy ones", () => {
  assert.equal(normalizeAnnotationIntent("fix"), "fix");
  assert.equal(normalizeAnnotationIntent("ask"), "ask");
  assert.equal(normalizeAnnotationIntent("note"), "note");
  assert.equal(normalizeAnnotationIntent("change"), "fix");
  assert.equal(normalizeAnnotationIntent("question"), "ask");
});

test("normalize falls back to fix for missing/invalid values", () => {
  for (const value of [undefined, null, "", "urgent", "FIX", 42, {}, []]) {
    assert.equal(normalizeAnnotationIntent(value), "fix");
  }
});

test("annotation DTO always carries a normalized intent", () => {
  const base = { id: "ann_1", comment: "hi", elementPath: "button" };
  assert.equal(annotationToDTO({ ...base, intent: "ask" }).intent, "ask");
  assert.equal(annotationToDTO({ ...base, intent: "question" }).intent, "ask");
  assert.equal(annotationToDTO({ ...base, intent: "change" }).intent, "fix");
  assert.equal(annotationToDTO({ ...base }).intent, "fix");
  assert.equal(annotationToDTO({ ...base, intent: "bogus" }).intent, "fix");
});

test("compact summaries carry intent so agents never infer it", () => {
  const session = { sessionId: "sess_1", page: { url: "https://x.test", origin: "https://x.test" } };
  for (const intent of ["fix", "ask", "note"]) {
    const full = annotationToDTO({ id: `ann_${intent}`, comment: "c", elementPath: "div", intent });
    assert.equal(compactAnnotation(session, full).intent, intent);
  }
});
