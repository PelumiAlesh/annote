import { formatIterations, formatMilliseconds } from "./animation-math";
import type { AnimationPatch } from "./animation-types";

export function animationPatchLabel(patch: AnimationPatch): string {
  if (patch.source === "css-animation") return patch.animationName || patch.animationId;
  if (patch.source === "css-transition") return patch.transitionProperty || patch.animationId;
  return patch.animationName || "WAAPI animation";
}

export function animationPatchTimingEntries(patch: AnimationPatch): Array<[string, string]> {
  return animationTimingEntries(patch.timing);
}

export function animationPatchOriginalTimingEntries(patch: AnimationPatch): Array<[string, string]> {
  return animationTimingEntries(patch.originalTiming || {});
}

function animationTimingEntries(timing: AnimationPatch["timing"]): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (timing.duration !== undefined) entries.push(["duration", formatMilliseconds(timing.duration)]);
  if (timing.delay !== undefined) entries.push(["delay", formatMilliseconds(timing.delay)]);
  if (timing.easing !== undefined) entries.push(["easing", timing.easing]);
  if (timing.iterations !== undefined) entries.push(["iterations", formatIterations(timing.iterations)]);
  if (timing.playbackRate !== undefined) entries.push(["playbackRate", `${timing.playbackRate}x`]);
  return entries;
}

function cssMotionProperty(patch: AnimationPatch, key: string): string | null {
  if (patch.source === "css-animation") {
    const properties: Record<string, string> = {
      duration: "animation-duration",
      delay: "animation-delay",
      easing: "animation-timing-function",
      iterations: "animation-iteration-count",
    };
    return properties[key] || null;
  }
  if (patch.source === "css-transition") {
    const properties: Record<string, string> = {
      duration: "transition-duration",
      delay: "transition-delay",
      easing: "transition-timing-function",
    };
    return properties[key] || null;
  }
  return null;
}

export function animationPatchMarkdownLines(patch: AnimationPatch): string[] {
  const lines: string[] = [];
  const entries = animationPatchTimingEntries(patch);
  if (!entries.length) return lines;
  lines.push(patch.source === "css-transition" ? "Transition:" : "Animation:");
  lines.push(animationPatchLabel(patch));
  lines.push("");
  lines.push("Timing:");
  const cssEntries = entries
    .map(([key, value]) => {
      const property = cssMotionProperty(patch, key);
      return property ? `${property}: ${value};` : "";
    })
    .filter(Boolean);
  if (cssEntries.length && patch.source !== "waapi") {
    lines.push("```css");
    cssEntries.forEach((entry) => lines.push(entry));
    lines.push("```");
    return lines;
  }
  entries.forEach(([key, value]) => lines.push(`- ${key}: ${value}`));
  return lines;
}
