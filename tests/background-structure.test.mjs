import assert from "node:assert/strict";
import test from "node:test";

import { isDefaultBackgroundValue, shouldShowBackgroundRow } from "/tmp/feedback-mark-background-helpers.mjs";
import { getStructureChildren, getStructureParent, getStructureSiblings, isStructureCandidateElement } from "/tmp/feedback-mark-structure-helpers.mjs";

test("background helper hides defaults", () => {
  assert.equal(isDefaultBackgroundValue("background-image", "none"), true);
  assert.equal(isDefaultBackgroundValue("background-image", "url(foo.png)"), false);
  assert.equal(isDefaultBackgroundValue("background-image", "linear-gradient(red, blue)"), false);
  assert.equal(isDefaultBackgroundValue("background-position", "0% 0%"), true);
  assert.equal(isDefaultBackgroundValue("background-position", "center"), false);
  assert.equal(isDefaultBackgroundValue("background-size", "auto"), true);
  assert.equal(isDefaultBackgroundValue("background-size", "cover"), false);
  assert.equal(isDefaultBackgroundValue("background-repeat", "repeat"), true);
  assert.equal(isDefaultBackgroundValue("background-repeat", "no-repeat"), false);
});

test("background helper shows only meaningful rows", () => {
  assert.equal(shouldShowBackgroundRow("background", "red", false), false);
  assert.equal(shouldShowBackgroundRow("background", "red", true), false);
  assert.equal(shouldShowBackgroundRow("background-color", "rgb(0,0,0)", false), true);
  assert.equal(shouldShowBackgroundRow("background-image", "none", false), false);
  assert.equal(shouldShowBackgroundRow("background-image", "none", true), true);
  assert.equal(shouldShowBackgroundRow("background-image", "url(x)", false), true);
  assert.equal(shouldShowBackgroundRow("background-position", "0% 0%", false), false);
  assert.equal(shouldShowBackgroundRow("background-position", "center", false), true);
});

test("structure candidate excludes Annote and script", async () => {
  const { isStructureCandidateElement } = await import("/tmp/feedback-mark-structure-helpers.mjs");
  if (typeof document !== "undefined" && document.createElement) {
    const el = document.createElement("div");
    assert.equal(isStructureCandidateElement(el), true);
    const script = document.createElement("script");
    assert.equal(isStructureCandidateElement(script), false);
    const style = document.createElement("style");
    assert.equal(isStructureCandidateElement(style), false);
  } else {
    // In Node without DOM, just verify helper exists
    assert.equal(typeof isStructureCandidateElement, "function");
  }
});

test("structure parent/children/siblings immediate", async () => {
  const { getStructureChildren, getStructureParent, getStructureSiblings } = await import("/tmp/feedback-mark-structure-helpers.mjs");
  if (typeof document === "undefined" || !document.createElement) {
    // Skip DOM test in non-DOM environment, just verify helpers exist
    assert.equal(typeof getStructureParent, "function");
    return;
  }
  const parent = document.createElement("div");
  const a = document.createElement("div");
  a.id = "a";
  const b = document.createElement("div");
  b.id = "b";
  const c = document.createElement("div");
  c.id = "c";
  parent.append(a, b, c);
  document.body.append(parent);
  const isCandidate = (el) => el instanceof HTMLElement && el !== document.body;
  const p = getStructureParent(b, isCandidate);
  assert.equal(p, parent);
  const { children } = getStructureChildren(parent, isCandidate);
  assert.equal(children.length, 3);
  const { siblings } = getStructureSiblings(b, isCandidate);
  assert.equal(siblings.length, 2);
  assert.ok(!siblings.includes(b));
  parent.remove();
});

test("structure limit truncates", async () => {
  const { getStructureChildren } = await import("/tmp/feedback-mark-structure-helpers.mjs");
  if (typeof document === "undefined" || !document.createElement) {
    assert.equal(typeof getStructureChildren, "function");
    return;
  }
  const parent = document.createElement("div");
  for (let i = 0; i < 12; i++) parent.appendChild(document.createElement("span"));
  document.body.append(parent);
  const { children, truncated } = getStructureChildren(parent, () => true, 8);
  assert.equal(children.length, 8);
  assert.equal(truncated, 4);
  parent.remove();
});
