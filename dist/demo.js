const link = document.querySelector("[data-bookmarklet]");
const src = "https://cdn.jsdelivr.net/npm/annote@0.1.0/dist/annote.iife.js";
const code = `javascript:(()=>{const u=${JSON.stringify(src)};const a=window.__ANNOTE__||window.__UI_ANNOTATOR__;if(a){a.toggle();return;}const s=document.createElement('script');s.src=u;s.onload=()=>window.__ANNOTE__?.mount?.()||window.__UI_ANNOTATOR__?.mount?.();document.documentElement.appendChild(s);})()`;

if (link) {
  link.setAttribute("href", code);
}

document.querySelector("[data-run-local]")?.addEventListener("click", () => {
  (window.__ANNOTE__ || window.__UI_ANNOTATOR__)?.toggle?.();
});

document.querySelector("[data-waapi-orb]")?.animate(
  [
    { transform: "translateX(0) scale(1)", opacity: 0.72 },
    { transform: "translateX(145px) scale(1.15)", opacity: 1 },
    { transform: "translateX(40px) scale(0.9)", opacity: 0.82 },
  ],
  {
    duration: 2200,
    easing: "cubic-bezier(.2,.8,.2,1)",
    iterations: Infinity,
    direction: "alternate",
  },
);
