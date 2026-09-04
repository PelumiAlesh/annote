const SITE_BUNDLE = new URL("/dist/annote.iife.js", window.location.origin).href;

const BOOKMARKLET_BUNDLE = window.AnnoteBookmarklet
  ? window.AnnoteBookmarklet.BUNDLE_URL
  : "https://cdn.jsdelivr.net/npm/annote@latest/dist/annote.iife.js";

const bookmarkletCode = window.AnnoteBookmarklet
  ? window.AnnoteBookmarklet.href(BOOKMARKLET_BUNDLE)
  : "";
const bookmarklet = document.querySelector("[data-bookmarklet]");
if (bookmarklet && bookmarkletCode) bookmarklet.setAttribute("href", bookmarkletCode);

// Page-level theme control. It intentionally starts fresh in Light so the
// Opposite Page demonstration remains predictable on every load.
const demoThemeToggle = document.querySelector("[data-demo-theme-toggle]");
function syncDemoThemeToggle() {
  const dark = document.body.dataset.theme === "dark";
  demoThemeToggle?.setAttribute("aria-pressed", String(dark));
  demoThemeToggle?.setAttribute("aria-label", `Switch page to ${dark ? "light" : "dark"} theme`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#11110f" : "#f3f1ea");
}
function setDemoTheme(theme) {
  document.body.dataset.theme = theme === "dark" ? "dark" : "light";
  syncDemoThemeToggle();
}
if (demoThemeToggle) {
  setDemoTheme("light");
  demoThemeToggle.addEventListener("click", () => {
    setDemoTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
  });
  new MutationObserver(syncDemoThemeToggle).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

let bookmarkletDragGhost = null;
function cleanupBookmarkletGhost() {
  if (bookmarkletDragGhost) {
    bookmarkletDragGhost.remove();
    bookmarkletDragGhost = null;
  }
}
if (bookmarklet) {
  bookmarklet.addEventListener("dragstart", (event) => {
    bookmarklet.classList.add("dragging");
    try {
      event.dataTransfer.effectAllowed = "copy";
    } catch {}
    cleanupBookmarkletGhost();
    const ghost = document.createElement("div");
    ghost.style.position = "fixed";
    ghost.style.left = "-9999px";
    ghost.style.top = "-9999px";
    ghost.style.display = "inline-flex";
    ghost.style.alignItems = "center";
    ghost.style.gap = "10px";
    ghost.style.padding = "8px 14px";
    ghost.style.minHeight = "44px";
    ghost.style.border = "1px solid rgba(216, 73, 0, 0.25)";
    ghost.style.background = "rgba(255, 107, 26, 0.08)";
    ghost.style.borderRadius = "8px";
    ghost.style.fontFamily = "DM Mono, monospace";
    ghost.style.fontSize = "13px";
    ghost.style.fontWeight = "500";
    ghost.style.color = "#11110f";
    ghost.style.lineHeight = "1";
    ghost.setAttribute("aria-hidden", "true");
    const logo = document.createElement("img");
    logo.src = "./mark.svg";
    logo.alt = "";
    logo.width = 26;
    logo.height = 26;
    logo.style.width = "26px";
    logo.style.height = "26px";
    logo.style.display = "block";
    logo.style.flex = "0 0 26px";
    logo.style.borderRadius = "4px";
    const label = document.createElement("span");
    label.textContent = "Annote";
    ghost.appendChild(logo);
    ghost.appendChild(label);
    document.body.appendChild(ghost);
    bookmarkletDragGhost = ghost;
    try {
      const rect = ghost.getBoundingClientRect();
      event.dataTransfer.setDragImage(ghost, rect.width * 0.5, rect.height * 0.5);
    } catch {}
    requestAnimationFrame(() => cleanupBookmarkletGhost());
  });
  bookmarklet.addEventListener("dragend", () => {
    bookmarklet.classList.remove("dragging");
    cleanupBookmarkletGhost();
  });
}

let toastTimer;
function toast(message) {
  const el = document.querySelector("[data-toast]");
  if (!el) return;
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    toast("Copied");
  }
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyText(button.dataset.copy || ""));
});

document.querySelectorAll("[data-copy-bookmarklet]").forEach((button) => {
  button.addEventListener("click", () => copyText(bookmarkletCode));
});

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.copyTarget || "");
    if (target) copyText(target.textContent.trim());
  });
});

function runAnnote() {
  const existing = window.__ANNOTE__ || window.__UI_ANNOTATOR__;
  const siteScript = document.querySelector('script[data-annote-site-runtime="true"]');
  const isSiteRuntime = !!siteScript && !!existing;

  if (existing && isSiteRuntime) {
    existing.toggle?.();
    return;
  }

  if (existing) {
    try {
      existing.destroy?.();
    } catch {}
    const oldSiteScript = document.querySelector('script[data-annote-site-runtime="true"]');
    if (oldSiteScript) oldSiteScript.remove();
    try {
      // @ts-ignore
      delete window.__ANNOTE__;
      // @ts-ignore
      delete window.__UI_ANNOTATOR__;
      // @ts-ignore
      delete window.__FEEDBACK_MARK__;
    } catch {}
  }

  const freshBundleUrl = `${SITE_BUNDLE}?v=${Date.now()}`;
  const script = document.createElement("script");
  script.src = freshBundleUrl;
  script.setAttribute("data-annote-site-runtime", "true");
  script.async = true;
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    script.remove();
    toast("Could not load Annote");
  }, 10000);
  script.onload = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const annote = window.__ANNOTE__ || window.__UI_ANNOTATOR__;
    if (!annote) {
      script.remove();
      toast("Could not load Annote");
      return;
    }
    try {
      annote.mount?.();
    } catch {
      toast("Could not load Annote");
      return;
    }
    toast("Annote is running — press ⌥P / Alt+P to start picking");
  };
  script.onerror = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    toast("Could not load Annote");
  };
  document.documentElement.appendChild(script);
}

document.querySelectorAll("[data-run-annote]").forEach((button) => {
  button.addEventListener("click", runAnnote);
});
