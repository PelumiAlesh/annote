const SITE_BUNDLE = new URL("/dist/annote.iife.js", window.location.origin).href;

const BOOKMARKLET_BUNDLE =
  "https://cdn.jsdelivr.net/npm/annote@latest/dist/annote.iife.js";

const bookmarkletCode = `javascript:(()=>{const u=${JSON.stringify(BOOKMARKLET_BUNDLE)};const a=window.__ANNOTE__||window.__UI_ANNOTATOR__;if(a){a.toggle();return;}const s=document.createElement('script');s.src=u;s.onload=()=>window.__ANNOTE__?.mount?.()||window.__UI_ANNOTATOR__?.mount?.();document.documentElement.appendChild(s);})()`;
const bookmarklet = document.querySelector("[data-bookmarklet]");
if (bookmarklet) bookmarklet.setAttribute("href", bookmarkletCode);

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
    logo.src = "./favicon.svg";
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
  script.onload = () => {
    const annote = window.__ANNOTE__ || window.__UI_ANNOTATOR__;
    annote?.mount?.();
    toast("Annote is running — point at the page");
  };
  script.onerror = () => toast("Could not load Annote");
  document.documentElement.appendChild(script);
}

document.querySelectorAll("[data-run-annote]").forEach((button) => {
  button.addEventListener("click", runAnnote);
});
