import assert from "node:assert/strict";
import test from "node:test";

import {
  THEME_ATTRIBUTE_FILTER,
  detectPageTheme,
  normalizeThemePreference,
  resolveTheme,
} from "/tmp/feedback-mark-theme.mjs";

function element(attributes = {}) {
  return { getAttribute: (name) => attributes[name] ?? null };
}

function documentFixture(bodyAttributes = {}, htmlAttributes = {}) {
  return { body: element(bodyAttributes), documentElement: element(htmlAttributes) };
}

test("opposite-page is the default and resolves against the detected page", () => {
  assert.equal(normalizeThemePreference(undefined), "opposite-page");
  assert.equal(resolveTheme("opposite-page", "light"), "dark");
  assert.equal(resolveTheme("opposite-page", "dark"), "light");
  assert.equal(resolveTheme("dark", "light"), "dark");
});

test("detection prioritizes effective body then html backgrounds", () => {
  const doc = documentFixture({ class: "dark" }, { class: "dark" });
  const getStyle = (target) => ({
    backgroundColor: target === doc.body ? "rgb(250, 250, 248)" : "rgb(10, 10, 10)",
    colorScheme: "dark",
  });
  assert.equal(detectPageTheme(doc, getStyle), "light");
});

test("explicit theme attributes win immediately over a transitioning background", () => {
  const doc = documentFixture({ "data-theme": "dark" });
  const staleLightBackground = () => ({ backgroundColor: "rgb(243, 241, 234)", colorScheme: "light" });
  assert.equal(detectPageTheme(doc, staleLightBackground), "dark");

  const switchedDoc = documentFixture({ "data-theme": "light" });
  const staleDarkBackground = () => ({ backgroundColor: "rgb(17, 17, 15)", colorScheme: "dark" });
  assert.equal(detectPageTheme(switchedDoc, staleDarkBackground), "light");
});

test("transparent roots use common theme attributes and fall back light", () => {
  const transparent = () => ({ backgroundColor: "rgba(0, 0, 0, 0)", colorScheme: "normal" });
  assert.equal(detectPageTheme(documentFixture({}, { "data-theme": "dark" }), transparent), "dark");
  assert.equal(detectPageTheme(documentFixture({ class: "app light-theme" }), transparent), "light");
  assert.equal(detectPageTheme(documentFixture(), transparent), "light");
});

test("theme observation is restricted to the approved attribute allowlist", () => {
  assert.deepEqual(THEME_ATTRIBUTE_FILTER, [
    "class", "style", "data-theme", "data-mode", "data-color-mode", "data-color-scheme", "data-bs-theme",
  ]);
});
