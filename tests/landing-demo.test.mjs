import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [html, css, script] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
]);

test("homepage exposes an accessible centered page theme switch", () => {
  assert.ok(html.includes("data-demo-theme-toggle"));
  assert.ok(html.includes('aria-pressed="false"'));
  assert.ok(html.includes('class="demo-theme-icon sun"'));
  assert.ok(html.includes('class="demo-theme-icon moon"'));
  assert.ok(css.includes(".demo-theme-switch {"));
  assert.ok(css.includes("left: 50%;"));
  assert.ok(css.includes("transform: translate(-50%, -50%);"));
  assert.ok(html.includes('src="./app.js?v=0.2.0"'));
  assert.ok(html.includes('href="./styles.css?v=0.2.0"'));
});

test("demo switch drives the page theme signal without persistence", () => {
  assert.ok(script.includes('document.body.dataset.theme = theme === "dark" ? "dark" : "light"'));
  assert.ok(script.includes('setDemoTheme("light")'));
  assert.ok(!script.includes('localStorage.setItem("annote:demo-theme"'));
});

test("theme switch reconciles itself whenever the page theme changes", () => {
  assert.ok(script.includes("function syncDemoThemeToggle()"));
  assert.ok(script.includes("new MutationObserver(syncDemoThemeToggle)"));
  assert.ok(script.includes('attributeFilter: ["data-theme"]'));
  assert.ok(script.includes('demoThemeToggle?.setAttribute("aria-pressed", String(dark))'));
  assert.ok(script.includes('`Switch page to ${dark ? "light" : "dark"} theme`'));
});

test("homepage theme transition covers the full page", () => {
  assert.ok(css.includes("--demo-home-bg"));
  assert.ok(css.includes('--bg: #11110f;'));
  assert.ok(css.includes('--ink: #f3f1ea;'));
  assert.ok(css.includes("transition: background-color 520ms"));
  assert.ok(css.includes(".hero {\n  padding: 112px 0 84px;"));
  const heroBlock = css.slice(css.indexOf(".hero {"), css.indexOf(".eyebrow, .kicker"));
  assert.ok(heroBlock.includes("border-color 420ms ease"));
  assert.ok(css.includes(".hero .button.primary"));
  assert.ok(css.includes("background: var(--card-bg);"));
  assert.ok(css.includes("background: var(--control-bg);"));
});

test("bookmarklet copy action uses an icon and regular text", () => {
  assert.ok(html.includes('class="copy-button bookmarklet-copy-button"'));
  assert.ok(html.includes('class="copy-icon"'));
  assert.ok(html.includes("<span>Copy bookmarklet link</span>"));
  const bookmarkletCopyBlock = css.slice(css.indexOf(".bookmarklet-copy-button {"), css.indexOf(".bookmarklet-copy-button:hover"));
  assert.ok(bookmarkletCopyBlock.includes("font-family: var(--sans);"));
  assert.ok(bookmarkletCopyBlock.includes("font-weight: 400;"));
  assert.ok(bookmarkletCopyBlock.includes("color: var(--body-copy);"));
});

test("page theme switch uses opaque palette surfaces", () => {
  const switchBlock = css.slice(css.indexOf(".demo-theme-switch {"), css.indexOf(".demo-theme-switch:hover"));
  const trackBlock = css.slice(css.indexOf(".demo-theme-track {"), css.indexOf(".demo-theme-thumb {"));
  assert.ok(switchBlock.includes("background: var(--panel);"));
  assert.ok(trackBlock.includes("background: var(--line);"));
  assert.ok(!switchBlock.includes("transparent"));
  assert.ok(!trackBlock.includes("transparent"));
});

test("agent setup prompt remains a light surface in both page themes", () => {
  const promptBlock = css.slice(css.indexOf(".prompt-box {"), css.indexOf(".prompt-head {"));
  assert.ok(promptBlock.includes("background: #fff;"));
  assert.ok(promptBlock.includes("color: #11110f;"));
  assert.ok(css.includes("border-bottom: 1px solid #d6d2c8;"));
  assert.ok(css.includes("background: #ebe8df;"));
  assert.ok(css.includes("pre {"));
  assert.ok(css.includes("color: #11110f;"));
});
