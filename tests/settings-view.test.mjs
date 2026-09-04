import assert from "node:assert/strict";
import test from "node:test";

import {
  mcpNeedsApprovalStatus,
  mcpStatusLabel,
  renderHelpSettings,
  renderMcpSettings,
  renderSettingsContent,
  renderSettingsHeader,
  renderSettingsRoot,
} from "/tmp/feedback-mark-settings-view.mjs";
import { ANNOTE_VERSION } from "/tmp/feedback-mark-version.mjs";

function data(overrides = {}) {
  return {
    settings: {
      theme: "opposite-page",
      pauseAnimationOnSelect: false,
      clearAfterSend: false,
      preventPageActions: true,
      reactContext: true,
    },
    mcpStatus: "connected",
    settingsView: "root",
    mcpSetupCopyState: "idle",
    setupCommand: "npm run mcp:init",
    site: "localhost:4173",
    noticeHtml: "",
    shortcuts: { pick: "⌥P", copy: "⌥C", del: "⌥⌫" },
    ...overrides,
  };
}

function assertNoNestedButtons(html, where) {
  // A <button> containing another <button> is invalid HTML — browsers split
  // the row apart (this exact regression broke Settings toggles).
  assert.ok(!/<button[^>]*>((?!<\/button>).)*<button/s.test(html), `nested buttons in ${where}`);
}

test("toggle rows are valid, clickable, and reflect state", () => {
  const html = renderSettingsRoot(data());
  assertNoNestedButtons(html, "settings root");
  for (const key of ["pauseAnimationOnSelect", "clearAfterSend", "preventPageActions", "reactContext"]) {
    assert.ok(html.includes(`data-setting="${key}"`), `${key} missing`);
  }
  assert.ok(html.includes('role="switch"'), "switch role missing");
  assert.ok(html.includes('aria-checked="true"'), "checked state missing");
  const off = renderSettingsRoot(data({ settings: { pauseAnimationOnSelect: false, clearAfterSend: false, preventPageActions: false, reactContext: false } }));
  assert.ok(off.includes('aria-checked="false"'), "unchecked state missing");
});

test("theme is an accessible icon-only three-option control", () => {
  const html = renderSettingsRoot(data());
  assert.equal((html.match(/data-theme-preference=/g) || []).length, 3);
  assert.ok(html.includes('role="radiogroup" aria-label="Theme"'));
  for (const [value, label] of [["light", "Light"], ["opposite-page", "Opposite page"], ["dark", "Dark"]]) {
    assert.ok(html.includes(`data-theme-preference="${value}"`));
    assert.ok(html.includes(`aria-label="${label} theme"`));
    assert.ok(html.includes(`data-tooltip="${label}"`));
  }
  assert.ok(html.includes('data-theme-preference="opposite-page"') && html.includes('aria-checked="true"'));
  assert.ok(!html.includes(">Light</button>") && !html.includes(">Dark</button>"));
});

test("nav rows expose status without nested buttons", () => {
  const html = renderSettingsRoot(data({ mcpStatus: "permission-required" }));
  assertNoNestedButtons(html, "nav rows");
  assert.ok(html.includes("Permission needed"), "approval status missing");
  assert.ok(html.includes('role="button"'), "nav row role missing");
});

test("mcp views cover every status with setup copy intact", () => {
  const denied = renderMcpSettings(data({ mcpStatus: "permission-required" }));
  assert.ok(denied.includes("Allow on this site"), "allow CTA missing");
  const connected = renderMcpSettings(data({ mcpStatus: "connected" }));
  assert.ok(connected.includes("Connected"), "connected missing");
  const fresh = renderMcpSettings(data({ mcpStatus: "companion-not-found" }));
  assert.ok(fresh.includes("Not connected"), "not-connected missing");
  assert.ok(fresh.includes("npm run mcp:init"), "setup command missing");
  assert.equal(mcpStatusLabel("connected"), "Connected");
  assert.equal(mcpNeedsApprovalStatus("permission-required"), true);
  assert.equal(mcpNeedsApprovalStatus("connected"), false);
});

test("help documents the live shortcut labels", () => {
  const html = renderHelpSettings(data());
  assert.ok(html.includes("⌥P") && html.includes("⌥C") && html.includes("⌥⌫"), "shortcuts missing from help");
});

test("titles are escaped", () => {
  const html = renderSettingsHeader('<script>alert(1)</script>');
  assert.ok(!html.includes("<script"), "unescaped title");
  assert.ok(html.includes("&lt;script&gt;"), "title not entity-encoded");
});

test("version footer matches package.json", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(ANNOTE_VERSION, pkg.version, "settings-view version drifted from package.json");
  const html = renderSettingsRoot(data());
  assert.ok(html.includes(`v${pkg.version}`), "version missing from settings root");
  assert.ok(html.indexOf(`v${pkg.version}`) > html.indexOf("<h2>Settings</h2>"), "version not in header");
});
