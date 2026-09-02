import assert from "node:assert/strict";
import test from "node:test";

import {
  cssSuggestions,
  cssValueStatus,
  boxValueIsLinked,
  colorPartsToCss,
  getCssPropertyMeta,
  getPropertyEditorConfig,
  hasWebrefMetadata,
  isConcreteColorValue,
  isTokenValueValidForProperty,
  isValidCssValue,
  mergeBoxValuePart,
  parseCssColorParts,
  serializeEditedStyles,
  stepCssNumericValue,
} from "/tmp/feedback-mark-style-intelligence.mjs";

test("loads Webref CSS property metadata", () => {
  const meta = getCssPropertyMeta("font-size");
  assert.equal(hasWebrefMetadata("font-size"), true);
  assert.equal(meta.name, "font-size");
  assert.match(meta.syntax, /length|size|math/i);
});

test("validates CSS values through the CSS lexer", () => {
  assert.equal(isValidCssValue("font-size", "14px"), true);
  assert.equal(isValidCssValue("font-size", "1rem"), true);
  assert.equal(isValidCssValue("font-size", "clamp(1rem, 2vw, 2rem)"), true);
  assert.equal(isValidCssValue("font-size", "banana"), false);
});

test("validates token raw values against the target property", () => {
  assert.equal(isTokenValueValidForProperty("font-size", "18px"), true);
  assert.equal(isTokenValueValidForProperty("opacity", "0.9"), true);
  assert.equal(isTokenValueValidForProperty("font-size", "0.9"), false);
});

test("tolerates intermediate typing states before firm validation", () => {
  assert.equal(cssValueStatus("font-size", "1."), "intermediate");
  assert.equal(cssValueStatus("font-size", "1.", true), "invalid");
});

test("suggests contextual keyword and page font values", () => {
  assert.deepEqual(cssSuggestions("display", "fl").slice(0, 3), ["flex", "flow", "flow-root"]);
  assert.equal(cssSuggestions("position", "st").includes("sticky"), true);
  assert.equal(cssSuggestions("font-family", "In", ["Inter", "IBM Plex Sans"]).includes("Inter"), true);
});

test("serializes only valid edited CSS grouped by state", () => {
  assert.deepEqual(
    serializeEditedStyles([
      { state: "current", property: "font-size", originalValue: "68px", value: "56px", valid: true },
      { state: "current", property: "line-height", originalValue: "1.1", value: "1.1", valid: true },
      { state: "hover", property: "color", originalValue: "#111827", value: "#fff", valid: true },
      { state: "hover", property: "opacity", originalValue: "1", value: "banana", valid: false },
    ]),
    {
      current: { "font-size": "56px" },
      hover: { color: "#fff" },
    },
  );
});

test("classifies editor controls from overrides and metadata", () => {
  assert.deepEqual(getPropertyEditorConfig("flex-direction", "row"), {
    control: "segmented",
    options: ["row", "column"],
  });
  assert.deepEqual(getPropertyEditorConfig("opacity", "0.5"), { control: "number", step: 0.05 });
  assert.equal(getPropertyEditorConfig("opacity", "var(--opacity)").control, "text");
  assert.equal(getPropertyEditorConfig("font-family", "Inter, sans-serif").control, "font");
  assert.equal(getPropertyEditorConfig("background", "rgb(0, 0, 0)").control, "color");
  assert.equal(getPropertyEditorConfig("background-color", "rgb(0, 0, 0)").control, "color");
  assert.equal(getPropertyEditorConfig("padding", "12px").control, "compound");
  assert.equal(getPropertyEditorConfig("border-width", "1px").control, "compound");
});

test("preserves custom segmented values as segmented controls", () => {
  const config = getPropertyEditorConfig("justify-content", "space-evenly");
  assert.equal(config.control, "segmented");
  assert.equal(config.options.includes("space-evenly"), false);
});

test("steps simple numeric values while preserving units", () => {
  assert.equal(stepCssNumericValue("font-size", "14px", 1), "15px");
  assert.equal(stepCssNumericValue("gap", "1.5rem", -1), "0.5rem");
  assert.equal(stepCssNumericValue("opacity", "0.5", 1), "0.55");
  assert.equal(stepCssNumericValue("opacity", "0.02", -1), "0");
  assert.equal(stepCssNumericValue("font-size", "clamp(1rem, 2vw, 2rem)", 1), null);
});

test("detects concrete color swatches without pretending variables are colors", () => {
  assert.equal(isConcreteColorValue("#fff"), true);
  assert.equal(isConcreteColorValue("rgb(0, 0, 0)"), true);
  assert.equal(isConcreteColorValue("oklch(70% 0.15 40)"), true);
  assert.equal(isConcreteColorValue("transparent"), true);
  assert.equal(isConcreteColorValue("var(--brand)"), false);
  assert.equal(isConcreteColorValue("currentColor"), false);
});

test("parses editable hex and opacity color channels", () => {
  assert.deepEqual(parseCssColorParts("rgb(255, 122, 26)"), { hex: "#ff7a1a", opacity: 1 });
  assert.deepEqual(parseCssColorParts("rgba(255, 122, 26, 0.42)"), { hex: "#ff7a1a", opacity: 0.42 });
  assert.deepEqual(parseCssColorParts("#fff8"), { hex: "#ffffff", opacity: 0.53 });
  assert.equal(colorPartsToCss("#ff7a1a", 1), "#ff7a1a");
  assert.equal(colorPartsToCss("#ff7a1a", 0.4), "rgba(255, 122, 26, 0.4)");
  assert.equal(parseCssColorParts("oklch(70% 0.15 40)"), null);
});

test("detects linked box values for compact spacing controls", () => {
  assert.equal(boxValueIsLinked("12px"), true);
  assert.equal(boxValueIsLinked("12px 12px"), true);
  assert.equal(boxValueIsLinked("12px 8px"), false);
  assert.equal(boxValueIsLinked("4px 4px 4px 4px"), true);
});

test("merges box side edits back to compact shorthand when possible", () => {
  assert.equal(mergeBoxValuePart("12px", 1, "8px"), "12px 8px 12px 12px");
  assert.equal(mergeBoxValuePart("12px 8px 12px 8px", 2, "12px"), "12px 8px");
  assert.equal(mergeBoxValuePart("4px 4px 4px 4px", 0, "4px"), "4px");
});
