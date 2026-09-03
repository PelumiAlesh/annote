/* Annote bookmarklet loader.
 *
 * Self-contained: the bookmarklet `javascript:` href embeds
 * `annoteBookmarkletBootstrap` (see `AnnoteBookmarklet.href()` below), so
 * this function must not reference anything outside its own scope.
 *
 * Fixed remote source: the published Annote browser bundle on jsDelivr.
 * No eval, no fetch-and-eval, no CSP bypass attempts. Some pages block
 * `javascript:` URLs, external scripts, jsDelivr, or dynamic script tags
 * via Content Security Policy or browser restrictions — that is a platform
 * boundary, and the loader fails gracefully instead of circumventing it.
 */
function annoteBookmarkletBootstrap(bundleUrl) {
  var w = window;
  var d = document;
  var LOG = "[Annote]";
  var TIMEOUT_MS = 10000;
  var INSTALL_CMD = "npm install --save-dev annote";

  function existingAnnote() {
    return w.__ANNOTE__ || w.__UI_ANNOTATOR__ || w.__FEEDBACK_MARK__ || null;
  }

  function copyText(text, done) {
    function legacyCopy() {
      try {
        var ta = d.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        d.documentElement.appendChild(ta);
        ta.select();
        try {
          d.execCommand("copy");
        } catch (e) {}
        ta.remove();
      } catch (e) {}
      if (done) done();
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            if (done) done();
          },
          legacyCopy,
        );
      } else {
        legacyCopy();
      }
    } catch (e) {
      legacyCopy();
    }
  }

  function removeScript(script) {
    try {
      if (!script) return;
      if (typeof script.remove === "function") script.remove();
      else if (script.parentNode && script.parentNode.removeChild) script.parentNode.removeChild(script);
    } catch (e) {}
  }

  function removeFailureUi() {
    try {
      var el = d.querySelector("[data-annote-load-failure]");
      if (el) el.remove();
    } catch (e) {}
    try {
      if (d.removeEventListener && removeFailureUi._esc) d.removeEventListener("keydown", removeFailureUi._esc, true);
    } catch (e) {}
    removeFailureUi._esc = null;
  }

  // Self-contained fallback: inline DOM/CSS only, no Annote dependency,
  // no external resources, removes itself cleanly.
  function showFailureUi(reason) {
    removeFailureUi();
    try {
      var box = d.createElement("div");
      box.setAttribute("data-annote-load-failure", "true");
      box.setAttribute("role", "alertdialog");
      box.setAttribute("aria-label", "Annote could not run on this page");
      box.style.cssText = [
        "position:fixed",
        "left:50%",
        "bottom:24px",
        "transform:translateX(-50%)",
        "z-index:2147483647",
        "width:min(380px,calc(100vw - 32px))",
        "background:#11110f",
        "color:#f6f3eb",
        "border:1px solid #3a3833",
        "border-radius:12px",
        "padding:16px",
        "font:13px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif",
        "box-shadow:0 24px 64px rgba(0,0,0,.5)",
      ].join(";");
      var title = d.createElement("div");
      title.textContent = "Annote couldn\u2019t run on this page.";
      title.style.cssText = "font-weight:600;margin:0 0 4px;";
      var body = d.createElement("div");
      body.textContent = "This site may block injected scripts. For development projects, install Annote through npm for the most reliable setup.";
      body.style.cssText = "color:#b9b4a8;margin:0 0 12px;";
      var cmd = d.createElement("div");
      cmd.textContent = INSTALL_CMD;
      cmd.style.cssText = "font:11px ui-monospace,SFMono-Regular,Menlo,monospace;background:#1d1d1d;border-radius:8px;padding:8px 10px;margin:0 0 12px;overflow-wrap:anywhere;";
      var row = d.createElement("div");
      row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
      function buttonStyle(primary) {
        return [
          "border:0",
          "border-radius:999px",
          "padding:8px 14px",
          "font:inherit",
          "font-size:12px",
          "cursor:pointer",
          primary ? "background:#ff7a1a;color:#120804;" : "background:#242424;color:#f2f2f2;",
        ].join("");
      }
      var copy = d.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy install command";
      copy.style.cssText = buttonStyle(true);
      copy.addEventListener("click", function () {
        copyText(INSTALL_CMD, function () {
          copy.textContent = "Copied";
        });
      });
      var dismiss = d.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "Dismiss";
      dismiss.style.cssText = buttonStyle(false);
      dismiss.addEventListener("click", removeFailureUi);
      row.appendChild(dismiss);
      row.appendChild(copy);
      box.appendChild(title);
      box.appendChild(body);
      box.appendChild(cmd);
      box.appendChild(row);
      (d.body || d.documentElement).appendChild(box);
      // Focus the dismiss button, but never steal focus from page input —
      // a late timeout failure must not yank the user's cursor.
      try {
        var active = null;
        try {
          active = d.activeElement;
        } catch (e) {}
        if (d.hasFocus && d.hasFocus() && (!active || active === d.body || active === d.documentElement)) dismiss.focus();
      } catch (e) {}
      removeFailureUi._esc = function (event) {
        if (event && event.key === "Escape") removeFailureUi();
      };
      try {
        d.addEventListener("keydown", removeFailureUi._esc, true);
      } catch (e) {}
    } catch (e) {}
    try {
      if (typeof console !== "undefined" && console.warn) console.warn(LOG, "load failed:", reason);
    } catch (e) {}
  }

  function fail(state, reason) {
    state.settled = true;
    if (state.timer) {
      try {
        clearTimeout(state.timer);
      } catch (e) {}
      state.timer = null;
    }
    try {
      removeScript(state.script);
    } catch (e) {}
    if (w.__ANNOTE_LOADER__ === state) {
      try {
        w.__ANNOTE_LOADER__ = null;
      } catch (e) {}
    }
    showFailureUi(reason);
    if (state.reject) state.reject(new Error(reason));
  }

  function useExisting() {
    var a = existingAnnote();
    if (!a) return false;
    try {
      if (typeof a.toggle === "function") a.toggle();
      else if (typeof a.activate === "function") a.activate();
    } catch (e) {
      try {
        if (typeof console !== "undefined" && console.warn) console.warn(LOG, "existing instance error:", e && e.message);
      } catch (ignored) {}
    }
    return true;
  }

  // Already loaded: toggle, never inject.
  if (useExisting()) return;

  // One in-flight load at a time: repeated clicks reuse the same attempt.
  try {
    if (w.__ANNOTE_LOADER__ && !w.__ANNOTE_LOADER__.settled) return;
  } catch (e) {}
  var state = { settled: false, timer: null, script: null, reject: null };
  try {
    w.__ANNOTE_LOADER__ = state;
  } catch (e) {}

  // Drop a stale tag from a previous failed attempt so retry is clean.
  try {
    var stale = d.querySelectorAll('script[data-annote-loader="true"]');
    for (var i = 0; i < stale.length; i++) removeScript(stale[i]);
  } catch (e) {}

  function onScriptError() {
    fail(state, "script error (blocked by CSP, offline, or CDN unreachable)");
  }

  var script = null;
  try {
    script = d.createElement("script");
  } catch (e) {
    fail(state, "script injection rejected");
    return;
  }
  if (!script) {
    fail(state, "script injection rejected");
    return;
  }
  state.script = script;
  try {
    script.setAttribute("data-annote-loader", "true");
    script.async = true;
    script.src = bundleUrl;
    script.onload = function () {
      var annote = existingAnnote();
      if (!annote) {
        fail(state, "bundle loaded but window.__ANNOTE__ is missing");
        return;
      }
      try {
        if (typeof annote.mount === "function") annote.mount();
        else if (typeof annote.toggle === "function") annote.toggle();
      } catch (e) {
        fail(state, "initialization threw");
        try {
          if (typeof console !== "undefined" && console.warn) console.warn(LOG, "init error:", e && e.message);
        } catch (ignored) {}
        return;
      }
      state.settled = true;
      try {
        clearTimeout(state.timer);
      } catch (e) {}
      state.timer = null;
      try {
        if (w.__ANNOTE_LOADER__ === state) w.__ANNOTE_LOADER__ = null;
      } catch (e) {}
    };
    script.onerror = onScriptError;
    state.timer = setTimeout(function () {
      fail(state, "timed out waiting for window.__ANNOTE__");
    }, TIMEOUT_MS);
    (d.head || d.documentElement).appendChild(script);
  } catch (e) {
    fail(state, "script injection rejected");
  }
}

(function (g) {
  var BOOKMARKLET_BUNDLE = "https://cdn.jsdelivr.net/npm/annote@latest/dist/annote.iife.js";
  function load(bundleUrl) {
    annoteBookmarkletBootstrap(bundleUrl || BOOKMARKLET_BUNDLE);
  }
  function href(bundleUrl) {
    return "javascript:void((" + annoteBookmarkletBootstrap.toString() + ")(" + JSON.stringify(bundleUrl || BOOKMARKLET_BUNDLE) + "))";
  }
  try {
    g.AnnoteBookmarklet = {
      BUNDLE_URL: BOOKMARKLET_BUNDLE,
      INSTALL_CMD: "npm install --save-dev annote",
      TIMEOUT_MS: 10000,
      load: load,
      href: href,
    };
  } catch (e) {}
})(typeof window !== "undefined" ? window : globalThis);
