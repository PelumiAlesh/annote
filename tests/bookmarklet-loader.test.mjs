import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const SOURCE = await readFile(new URL("../bookmarklet-loader.js", import.meta.url), "utf8");

function makeEnv() {
  const timers = [];
  let timerId = 0;
  const docListeners = {};
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attributes: {},
      parentNode: null,
      focused: false,
      value: "",
      textContent: "",
      style: {},
      listeners: {},
      setAttribute(k, v) {
        this.attributes[k] = v;
      },
      getAttribute(k) {
        return this.attributes[k];
      },
      addEventListener(t, f) {
        (this.listeners[t] ||= []).push(f);
      },
      removeEventListener(t, f) {
        this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f);
      },
      appendChild(c) {
        this.children.push(c);
        c.parentNode = this;
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        c.parentNode = null;
        return c;
      },
      remove() {
        if (this.parentNode) {
          const i = this.parentNode.children.indexOf(this);
          if (i >= 0) this.parentNode.children.splice(i, 1);
          this.parentNode = null;
        }
      },
      focus() {
        this.focused = true;
      },
      click() {
        [...(this.listeners.click || [])].forEach((f) => f({}));
      },
      select() {},
    };
    return el;
  }
  function walk(el, out) {
    out.push(el);
    el.children.forEach((c) => walk(c, out));
  }
  function all() {
    const out = [];
    walk(env.documentElement, out);
    return out;
  }
  function matchesAttr(el, sel) {
    const m = sel.match(/\[([a-z-]+)(="([^"]*)")?\]/);
    if (!m) return false;
    const v = el.attributes[m[1]];
    if (m[3] === undefined) return v !== undefined;
    return v === m[3];
  }
  const env = {};
  env.documentElement = makeEl("html");
  env.body = makeEl("body");
  env.head = makeEl("head");
  env.documentElement.appendChild(env.head);
  env.documentElement.appendChild(env.body);
  const document = {
    createElement: (t) => makeEl(t),
    querySelector: (sel) => all().find((el) => matchesAttr(el, sel)) || null,
    querySelectorAll: (sel) => all().filter((el) => el.tagName === "SCRIPT" && matchesAttr(el, sel)),
    addEventListener: (t, f) => ((docListeners[t] ||= []).push(f)),
    removeEventListener: (t, f) => {
      docListeners[t] = (docListeners[t] || []).filter((x) => x !== f);
    },
    head: env.head,
    body: env.body,
    documentElement: env.documentElement,
    execCommand: () => true,
  };
  const window = {};
  const navigator = {};
  const api = new Function(
    "window",
    "document",
    "navigator",
    "console",
    "setTimeout",
    "clearTimeout",
    `${SOURCE}; return window.AnnoteBookmarklet;`,
  )(
    window,
    document,
    navigator,
    console,
    (fn) => {
      timerId += 1;
      timers.push({ id: timerId, fn });
      return timerId;
    },
    (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  );
  return {
    api,
    window,
    document,
    navigator,
    timers,
    scripts: () => document.querySelectorAll('script[data-annote-loader="true"]'),
    overlay: () => document.querySelector("[data-annote-load-failure]"),
    fireTimers: () => {
      const pending = timers.splice(0);
      pending.forEach((t) => t.fn());
    },
    keydown: (key) => [...(docListeners.keydown || [])].forEach((f) => f({ key })),
  };
}

test("A. already loaded: toggles, injects nothing", () => {
  const env = makeEnv();
  let toggled = 0;
  env.window.__ANNOTE__ = { toggle: () => toggled++ };
  env.api.load("https://example.com/a.js");
  assert.equal(toggled, 1);
  assert.equal(env.scripts().length, 0);
});

test("J. second run with global: still no duplicate instance", () => {
  const env = makeEnv();
  let toggled = 0;
  env.window.__ANNOTE__ = { toggle: () => toggled++ };
  env.api.load("https://example.com/a.js");
  env.api.load("https://example.com/a.js");
  assert.equal(toggled, 2);
  assert.equal(env.scripts().length, 0);
});

test("B. success: global appears, mount runs, no overlay", () => {
  const env = makeEnv();
  let mounted = 0;
  env.api.load("https://example.com/a.js");
  assert.equal(env.scripts().length, 1);
  env.window.__ANNOTE__ = { mount: () => mounted++ };
  env.scripts()[0].onload();
  assert.equal(mounted, 1);
  assert.equal(env.overlay(), null);
});

test("F. repeated clicks while loading inject one script", () => {
  const env = makeEnv();
  env.api.load("https://example.com/a.js");
  env.api.load("https://example.com/a.js");
  env.api.load("https://example.com/a.js");
  assert.equal(env.scripts().length, 1);
});

test("C. onerror shows fallback with install command", () => {
  const env = makeEnv();
  env.api.load("https://example.com/a.js");
  env.scripts()[0].onerror();
  const overlay = env.overlay();
  assert.ok(overlay, "overlay missing");
  const dump = JSON.stringify(overlay, (k, v) => (k === "parentNode" || k === "listeners" ? undefined : v));
  assert.ok(dump.includes("npm install --save-dev annote"), "install command missing");
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(SOURCE), "must not use native dialogs");
});

test("D. load without global shows fallback", () => {
  const env = makeEnv();
  env.api.load("https://example.com/a.js");
  env.scripts()[0].onload();
  assert.ok(env.overlay(), "overlay missing for missing global");
});

test("E. timeout shows fallback and removes script", () => {
  const env = makeEnv();
  env.api.load("https://example.com/a.js");
  assert.equal(env.scripts().length, 1);
  env.fireTimers();
  assert.ok(env.overlay(), "overlay missing on timeout");
  assert.equal(env.scripts().length, 0);
});

test("G. retry works after failure", () => {
  const env = makeEnv();
  let mounted = 0;
  env.api.load("https://example.com/a.js");
  env.scripts()[0].onerror();
  assert.ok(env.overlay());
  env.api.load("https://example.com/a.js");
  assert.equal(env.scripts().length, 1);
  env.window.__ANNOTE__ = { mount: () => mounted++ };
  env.scripts()[0].onload();
  assert.equal(mounted, 1);
});

test("H. dismiss removes overlay; Escape removes overlay", () => {
  const env = makeEnv();
  env.api.load("https://example.com/a.js");
  env.scripts()[0].onerror();
  const findButtons = () => {
    const out = [];
    const walk = (el) => {
      out.push(el);
      el.children.forEach(walk);
    };
    walk(env.overlay());
    return out.filter((el) => el.tagName === "BUTTON");
  };
  const dismiss = findButtons().find((b) => b.textContent === "Dismiss");
  assert.ok(dismiss, "dismiss button missing");
  dismiss.click();
  assert.equal(env.overlay(), null);
  env.api.load("https://example.com/a.js");
  env.scripts()[0].onerror();
  assert.ok(env.overlay());
  env.keydown("Escape");
  assert.equal(env.overlay(), null);
});

test("I. copy button copies the npm command", async () => {
  const env = makeEnv();
  let copied = null;
  env.navigator.clipboard = { writeText: (t) => ((copied = t), Promise.resolve(t)) };
  env.api.load("https://example.com/a.js");
  env.scripts()[0].onerror();
  const walk = (el, out) => {
    out.push(el);
    el.children.forEach((c) => walk(c, out));
    return out;
  };
  const copy = walk(env.overlay(), []).find((el) => el.tagName === "BUTTON" && el.textContent === "Copy install command");
  assert.ok(copy, "copy button missing");
  copy.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(copied, "npm install --save-dev annote");
});

test("success clears timeout: no late failure UI, script retained", () => {
  const env = makeEnv();
  let mounted = 0;
  env.api.load("https://example.com/a.js");
  env.window.__ANNOTE__ = { mount: () => mounted++ };
  env.scripts()[0].onload();
  assert.equal(mounted, 1);
  env.fireTimers();
  assert.equal(env.overlay(), null, "late failure UI after success");
  assert.equal(env.scripts().length, 1, "loaded script must be retained");
});

test("overlay focuses dismiss only when focus is on the page body", () => {
  const env = makeEnv();
  env.document.hasFocus = () => true;
  env.document.activeElement = env.document.body;
  env.api.load("https://example.com/a.js");
  env.scripts()[0].onerror();
  const focused = (function walk(el) {
    if (el.focused) return el;
    for (const c of el.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  })(env.document.documentElement);
  assert.ok(focused && focused.textContent === "Dismiss", "should focus dismiss from body");
  const env2 = makeEnv();
  const input = { tagName: "INPUT" };
  env2.document.hasFocus = () => true;
  env2.document.activeElement = input;
  env2.api.load("https://example.com/a.js");
  env2.scripts()[0].onerror();
  const focused2 = (function walk(el) {
    if (el.focused) return el;
    for (const c of el.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  })(env2.document.documentElement);
  assert.equal(focused2, null, "must not steal focus from page input");
});

test("href keeps annote@latest, stays self-contained", () => {
  const env = makeEnv();
  const href = env.api.href();
  assert.ok(href.startsWith("javascript:void("), "must not navigate on return value");
  assert.ok(href.includes("annote@latest"), "must keep @latest");
  assert.ok(!href.includes("eval(") && !href.includes("new Function"), "no eval tricks");
  assert.ok(href.includes("jsdelivr"), "must load from jsDelivr");
});
