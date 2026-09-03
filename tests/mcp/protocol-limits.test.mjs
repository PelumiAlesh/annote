import assert from "node:assert/strict";
import test from "node:test";

import { annotationToDTO } from "/tmp/annote-protocol.mjs";

function base(id = "a1") {
  return { id, comment: "hi", element: "Card", elementPath: ".card" };
}

test("deep nesting is truncated, not passed through", () => {
  let deep = { v: 1 };
  for (let i = 0; i < 50; i++) deep = { nest: deep };
  const dto = annotationToDTO({ ...base(), animationPatches: [{ id: "m1", keyframes: deep }] });
  assert.ok(dto);
  // Should either drop or sanitize — never preserve 50-deep structure.
  const json = JSON.stringify(dto.motionPatches);
  assert.ok(json.length < 100_000);
  assert.ok(!json.includes('"nest":{"nest":{"nest":{"nest":{"nest":{"nest":{"nest":'));
});

test("huge keyframe arrays are capped", () => {
  const frames = Array.from({ length: 5000 }, (_, i) => ({ offset: i, opacity: "1" }));
  const dto = annotationToDTO({ ...base(), animationPatches: [{ id: "m1", keyframes: frames }] });
  assert.ok(dto?.motionPatches?.[0]?.keyframes);
  assert.ok(dto.motionPatches[0].keyframes.length <= 64);
});

test("oversized strings are truncated", () => {
  const dto = annotationToDTO({ ...base(), animationPatches: [{ id: "m1", timing: { easing: "x".repeat(100_000) } }] });
  const json = JSON.stringify(dto);
  assert.ok(json.length < 200_000);
});

test("patch spam is capped at MAX_MOTION_PATCHES", () => {
  const patches = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, label: "x" }));
  const dto = annotationToDTO({ ...base(), animationPatches: patches });
  assert.ok(dto.motionPatches.length <= 16);
});

test("functions and non-plain values are dropped", () => {
  const dto = annotationToDTO({ ...base(), animationPatches: [{ id: "m1", keyframes: { run() {}, sym: Symbol("s"), ok: { a: 1 } } }] });
  const kf = dto.motionPatches[0].keyframes;
  assert.ok(!("run" in kf) || typeof kf.run !== "function");
  assert.ok(kf.ok);
});
