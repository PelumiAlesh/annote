import assert from "node:assert/strict";
import test from "node:test";

import {
  cubicBezierPath,
  estimatedSpringSettleMs,
  formatCubicBezier,
  formatIterations,
  isValidEasing,
  normalizeIterations,
  parseCubicBezier,
  parseIterationsInput,
  parseSpringEasing,
  parseTimeInput,
  springProgress,
} from "/tmp/feedback-mark-animation-math.mjs";

function installAnimationMocks() {
  globalThis.KeyframeEffect = class KeyframeEffect {
    constructor(target, keyframes = [], timing = {}) {
      this.target = target;
      this.keyframes = keyframes;
      this.timing = {
        duration: 300,
        delay: 20,
        easing: "ease",
        iterations: 1,
        fill: "none",
        ...timing,
      };
      this.updates = [];
    }
    getTiming() {
      return { ...this.timing };
    }
    getComputedTiming() {
      return { duration: this.timing.duration, activeDuration: this.timing.duration };
    }
    getKeyframes() {
      return this.keyframes;
    }
    updateTiming(update) {
      this.updates.push({ ...update });
      this.timing = { ...this.timing, ...update };
    }
  };
  globalThis.CSSAnimation = class CSSAnimation {};
  globalThis.CSSTransition = class CSSTransition {};
}

function runtime({ id, effect, playbackRate = 1, playState = "idle", currentTime = 0, ctor = null } = {}) {
  const base = ctor ? new ctor() : {};
  return Object.assign(base, {
    id,
    effect,
    playbackRate,
    playState,
    currentTime,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls += 1;
      this.playState = "running";
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls += 1;
      this.playState = "paused";
    },
  });
}

test("parses and formats animation timing inputs", () => {
  assert.equal(parseTimeInput("240ms"), 240);
  assert.equal(parseTimeInput("0.2s"), 200);
  assert.equal(parseTimeInput("-80ms"), -80);
  assert.equal(parseTimeInput("nope"), null);
  assert.equal(parseIterationsInput("infinite"), "infinite");
  assert.equal(parseIterationsInput("2.5"), 2.5);
  assert.equal(formatIterations(normalizeIterations(Infinity)), "infinite");
});

test("validates and samples cubic bezier values", () => {
  const bezier = parseCubicBezier("cubic-bezier(.2, .8, .2, 1)");
  assert.deepEqual(bezier, [0.2, 0.8, 0.2, 1]);
  assert.equal(formatCubicBezier(bezier), "cubic-bezier(0.2, 0.8, 0.2, 1)");
  assert.equal(isValidEasing("cubic-bezier(.2,.8,.2,1)"), true);
  assert.equal(isValidEasing("cubic-bezier(1.4,.8,.2,1)"), false);
  assert.match(cubicBezierPath(bezier), /^M/);
});

test("keeps spring helpers deterministic", () => {
  const config = parseSpringEasing("spring(bounce: .3, stiffness: 180)");
  assert.equal(config.bounce, 0.3);
  assert.equal(config.stiffness, 180);
  assert.equal(springProgress(0, config), 0);
  assert.equal(estimatedSpringSettleMs(config) > 0, true);
});

test("normalizes WAAPI animations and serializes only changed timing values", async () => {
  installAnimationMocks();
  const { animationPatchFromEdit, applyAnimationInput, discoverElementAnimations, editForAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(
    element,
    [
      { offset: 0, opacity: "0", transform: "scale(.95)", easing: "linear" },
      { offset: 1, opacity: "1", transform: "scale(1)", easing: "ease" },
    ],
    { duration: 900, delay: 50, easing: "ease-out", fill: "both" },
  );
  const animationRuntime = runtime({ id: "fade", effect });
  element.getAnimations = () => [animationRuntime];

  const [animation] = discoverElementAnimations(element, "button.primary");
  assert.equal(animation.source, "waapi");
  assert.equal(animation.timing.duration, 900);
  assert.deepEqual(animation.animatedProperties, ["opacity", "transform"]);

  const edit = editForAnimation(animation);
  applyAnimationInput(edit, "duration", "450ms");
  applyAnimationInput(edit, "easing", "cubic-bezier(.16, 1, .3, 1)");
  const patch = animationPatchFromEdit(edit, animation.targetSelector);
  assert.deepEqual(JSON.parse(JSON.stringify(patch)), {
    targetSelector: "button.primary",
    animationId: "waapi-fade-1",
    source: "waapi",
    animatedProperties: ["opacity", "transform"],
    timing: { duration: 450, easing: "cubic-bezier(.16, 1, .3, 1)" },
    originalTiming: { duration: 900, easing: "ease-out" },
  });
});

test("normalizes CSS animation identity and timing", async () => {
  installAnimationMocks();
  const { discoverElementAnimations } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(
    element,
    [
      { offset: 0, opacity: "0", transform: "translateY(8px)" },
      { offset: 1, opacity: "1", transform: "translateY(0)" },
    ],
    { duration: 900, delay: 100, easing: "ease", iterations: 1 },
  );
  const animationRuntime = runtime({ id: "", effect, ctor: globalThis.CSSAnimation });
  animationRuntime.animationName = "fadeUp";
  element.getAnimations = () => [animationRuntime];

  const [animation] = discoverElementAnimations(element, ".target");
  assert.equal(animation.source, "css-animation");
  assert.equal(animation.animationName, "fadeUp");
  assert.equal(animation.timing.duration, 900);
  assert.equal(animation.timing.delay, 100);
  assert.deepEqual(animation.animatedProperties, ["opacity", "transform"]);
});

test("normalizes CSS transition without inventing from/to state", async () => {
  installAnimationMocks();
  const { discoverElementAnimations } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(element, [], { duration: 300, easing: "ease" });
  const animationRuntime = runtime({ id: "", effect, ctor: globalThis.CSSTransition });
  animationRuntime.transitionProperty = "opacity";
  element.getAnimations = () => [animationRuntime];

  const [animation] = discoverElementAnimations(element, ".button");
  assert.equal(animation.source, "css-transition");
  assert.equal(animation.transitionProperty, "opacity");
  assert.deepEqual(animation.animatedProperties, ["opacity"]);
  assert.deepEqual(animation.keyframes, []);
});

test("saved patches override live values on reopen and match metadata if id order changes", async () => {
  installAnimationMocks();
  const { editForAnimation, normalizeAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(element, [], { duration: 900, easing: "ease" });
  const animationRuntime = runtime({ id: "", effect, ctor: globalThis.CSSAnimation });
  animationRuntime.animationName = "fadeUp";
  const animation = normalizeAnimation(animationRuntime, element, ".target", 2);
  const edit = editForAnimation(animation, [{
    targetSelector: ".target",
    animationId: "old-index",
    source: "css-animation",
    animationName: "fadeUp",
    animatedProperties: ["opacity"],
    timing: { duration: 450 },
  }]);
  assert.equal(edit.original.duration, 900);
  assert.equal(edit.value.duration, 450);
  assert.equal(edit.durationInput, "450ms");
});

test("invalid animation inputs keep last valid values and are excluded from patches", async () => {
  installAnimationMocks();
  const { animationPatchFromEdit, applyAnimationInput, editForAnimation, normalizeAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const element = {};
  const animation = normalizeAnimation(runtime({ id: "fade", effect: new globalThis.KeyframeEffect(element, [], { duration: 900 }) }), element, ".target", 0);
  const edit = editForAnimation(animation);
  applyAnimationInput(edit, "duration", "450ms");
  assert.equal(edit.value.duration, 450);
  applyAnimationInput(edit, "duration", "-200ms");
  applyAnimationInput(edit, "easing", "cubic-bezier(");
  applyAnimationInput(edit, "iterations", "-1");
  assert.equal(edit.validDuration, false);
  assert.equal(edit.validEasing, false);
  assert.equal(edit.validIterations, false);
  assert.equal(edit.value.duration, 450);
  assert.equal(animationPatchFromEdit(edit, ".target"), null);
});

test("multiple animation edits stay isolated by animation id", async () => {
  installAnimationMocks();
  const { animationPatchFromEdit, applyAnimationInput, editForAnimation, discoverElementAnimations } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const element = {};
  const fade = runtime({ id: "fade", effect: new globalThis.KeyframeEffect(element, [{ opacity: "0" }, { opacity: "1" }], { duration: 900, easing: "ease" }) });
  const slide = runtime({ id: "slide", effect: new globalThis.KeyframeEffect(element, [{ transform: "translateY(8px)" }, { transform: "translateY(0)" }], { duration: 700, easing: "linear" }) });
  element.getAnimations = () => [fade, slide];
  const [fadeAnimation, slideAnimation] = discoverElementAnimations(element, ".target");
  const fadeEdit = editForAnimation(fadeAnimation);
  const slideEdit = editForAnimation(slideAnimation);
  applyAnimationInput(fadeEdit, "duration", "450ms");
  applyAnimationInput(slideEdit, "easing", "ease-out");
  assert.deepEqual(animationPatchFromEdit(fadeEdit, ".target").timing, { duration: 450 });
  assert.deepEqual(animationPatchFromEdit(slideEdit, ".target").timing, { easing: "ease-out" });
});

test("preview session restores timing, currentTime, playbackRate, and play state idempotently", async () => {
  installAnimationMocks();
  const { normalizeAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const { createAnimationPreviewSession } = await import("/tmp/feedback-mark-animation-preview.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(element, [], { duration: 900, delay: 50, easing: "ease-out", iterations: 1 });
  const animationRuntime = runtime({ id: "fade", effect, playbackRate: 2, playState: "running", currentTime: 120 });
  const animation = normalizeAnimation(animationRuntime, element, ".target", 0);
  const session = createAnimationPreviewSession(animation);

  session.applyAnnotationPatch({
    targetSelector: ".target",
    animationId: animation.id,
    source: "waapi",
    animatedProperties: ["opacity"],
    timing: { duration: 450, delay: -20, easing: "linear", iterations: "infinite", playbackRate: 0.5 },
  });
  assert.equal(effect.getTiming().duration, 450);
  assert.equal(animationRuntime.playbackRate, 0.5);

  session.restore();
  session.restore();
  assert.equal(effect.getTiming().duration, 900);
  assert.equal(effect.getTiming().delay, 50);
  assert.equal(effect.getTiming().easing, "ease-out");
  assert.equal(animationRuntime.currentTime, 120);
  assert.equal(animationRuntime.playbackRate, 2);
  assert.equal(animationRuntime.playState, "running");
});

test("preview session tolerates externally cancelled animations", async () => {
  installAnimationMocks();
  const { createAnimationPreviewSession } = await import("/tmp/feedback-mark-animation-preview.mjs");
  const animation = {
    id: "cancelled",
    label: "cancelled",
    source: "waapi",
    targetSelector: ".target",
    animatedProperties: [],
    timing: { duration: 0, delay: 0, easing: "linear", iterations: 1, playbackRate: 1 },
    computedDuration: 0,
    keyframes: [],
    runtime: runtime({ id: "cancelled", effect: null, playState: "idle", currentTime: null }),
  };
  const session = createAnimationPreviewSession(animation);
  assert.doesNotThrow(() => {
    session.applyAnnotationPatch({ targetSelector: ".target", animationId: "cancelled", source: "waapi", animatedProperties: [], timing: { duration: 200 } });
    session.restore();
    session.restore();
  });
});

test("spring patch preserves semantic value but previews as browser-compatible linear", async () => {
  installAnimationMocks();
  const { animationPatchFromEdit, applyAnimationInput, editForAnimation, normalizeAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const { createAnimationPreviewSession } = await import("/tmp/feedback-mark-animation-preview.mjs");
  const { browserEasingForPreview, springEasingToLinear } = await import("/tmp/feedback-mark-animation-math.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(element, [], { duration: 900, easing: "ease-out" });
  const animationRuntime = runtime({ id: "spring-test", effect, playState: "running", currentTime: 0 });
  const animation = normalizeAnimation(animationRuntime, element, ".target", 0);
  const edit = editForAnimation(animation);
  const spring = "spring(stiffness: 1, damping: 1, mass: 0.1)";
  applyAnimationInput(edit, "easing", spring);
  const patch = animationPatchFromEdit(edit, ".target");
  assert.equal(patch.timing.easing, spring);
  assert.equal(patch.originalTiming.easing, "ease-out");
  const expectedLinear = springEasingToLinear(spring);
  assert.match(expectedLinear, /^linear\(/);
  assert.equal(browserEasingForPreview(spring), expectedLinear);
  assert.equal(springEasingToLinear(spring), springEasingToLinear(spring));
  const session = createAnimationPreviewSession(animation);
  session.applyAnnotationPatch(patch);
  assert.equal(effect.getTiming().easing, expectedLinear);
  assert.notEqual(effect.getTiming().easing, spring);
  session.restore();
  assert.equal(effect.getTiming().easing, "ease-out");
});

test("mixed duration and spring easing both preview without losing duration", async () => {
  installAnimationMocks();
  const { animationPatchFromEdit, applyAnimationInput, editForAnimation, normalizeAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const { createAnimationPreviewSession } = await import("/tmp/feedback-mark-animation-preview.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(element, [], { duration: 900, easing: "ease" });
  // Make effect.updateTiming throw when easing is the raw spring string to simulate browser incompatibility.
  const originalUpdate = effect.updateTiming.bind(effect);
  effect.updateTiming = (update) => {
    if (update.easing && update.easing.startsWith("spring(")) throw new TypeError("unsupported easing");
    return originalUpdate(update);
  };
  const animationRuntime = runtime({ id: "mixed", effect, playState: "running", currentTime: 0 });
  const animation = normalizeAnimation(animationRuntime, element, ".target", 0);
  const edit = editForAnimation(animation);
  applyAnimationInput(edit, "duration", "2540ms");
  applyAnimationInput(edit, "easing", "spring(stiffness: 1, damping: 1, mass: 0.1)");
  const patch = animationPatchFromEdit(edit, ".target");
  assert.equal(patch.timing.duration, 2540);
  assert.match(patch.timing.easing, /^spring\(/);
  const session = createAnimationPreviewSession(animation);
  const result = session.applyAnnotationPatch(patch);
  assert.equal(effect.getTiming().duration, 2540);
  assert.match(effect.getTiming().easing, /^linear\(/);
  assert.equal(result.applied.duration, true);
  assert.equal(result.applied.easing, true);
  session.restore();
  assert.equal(effect.getTiming().duration, 900);
});

test("committed animation remains changed until restore and restores original on delete", async () => {
  installAnimationMocks();
  const { normalizeAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const { createAnimationPreviewSession } = await import("/tmp/feedback-mark-animation-preview.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(element, [], { duration: 900, delay: 0, easing: "ease-out", iterations: 1 });
  const animationRuntime = runtime({ id: "commit-test", effect, playbackRate: 1, playState: "running", currentTime: 40 });
  const animation = normalizeAnimation(animationRuntime, element, ".target", 0);
  const patch = {
    targetSelector: ".target",
    animationId: animation.id,
    source: animation.source,
    animatedProperties: [...animation.animatedProperties],
    timing: { duration: 450, easing: "spring(stiffness: 10, damping: 5, mass: 1)" },
  };
  const committedSession = createAnimationPreviewSession(animation);
  committedSession.applyAnnotationPatch(patch);
  assert.equal(effect.getTiming().duration, 450);
  assert.match(effect.getTiming().easing, /^linear\(/);
  committedSession.restore();
  assert.equal(effect.getTiming().duration, 900);
  assert.equal(effect.getTiming().easing, "ease-out");
  assert.equal(animationRuntime.playbackRate, 1);
});

test("saved animation patches repopulate editor without redefining original baseline", async () => {
  installAnimationMocks();
  const { editForAnimation, normalizeAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const element = {};
  const effect = new globalThis.KeyframeEffect(element, [], { duration: 900, easing: "ease" });
  const animationRuntime = runtime({ id: "", effect, ctor: globalThis.CSSAnimation });
  animationRuntime.animationName = "fadeUp";
  const animation = normalizeAnimation(animationRuntime, element, ".target", 2);
  const savedPatch = {
    targetSelector: ".target",
    animationId: animation.id,
    source: "css-animation",
    animationName: "fadeUp",
    animatedProperties: ["opacity"],
    timing: { duration: 450, easing: "spring(stiffness: 50, damping: 10, mass: 1)" },
    originalTiming: { duration: 900, easing: "ease" },
  };
  const edit = editForAnimation(animation, [savedPatch]);
  assert.equal(edit.original.duration, 900);
  assert.equal(edit.value.duration, 450);
  assert.equal(edit.value.easing, "spring(stiffness: 50, damping: 10, mass: 1)");
  assert.equal(edit.durationInput, "450ms");
});

test("native easing values preview without conversion", async () => {
  installAnimationMocks();
  const { createAnimationPreviewSession } = await import("/tmp/feedback-mark-animation-preview.mjs");
  const { normalizeAnimation } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const easings = ["ease", "ease-out", "cubic-bezier(.16, 1, .3, 1)", "linear", "steps(4, end)"];
  for (const easing of easings) {
    const element = {};
    const effect = new globalThis.KeyframeEffect(element, [], { duration: 300, easing: "ease" });
    const animationRuntime = runtime({ id: `native-${easing}`, effect, playState: "running", currentTime: 0 });
    const animation = normalizeAnimation(animationRuntime, element, ".target", 0);
    const session = createAnimationPreviewSession(animation);
    session.applyAnnotationPatch({
      targetSelector: ".target",
      animationId: animation.id,
      source: animation.source,
      animatedProperties: [],
      timing: { easing },
    });
    assert.equal(effect.getTiming().easing, easing);
    session.restore();
    assert.equal(effect.getTiming().easing, "ease");
  }
});

test("changing one animation does not alter another on same element", async () => {
  installAnimationMocks();
  const { createAnimationPreviewSession } = await import("/tmp/feedback-mark-animation-preview.mjs");
  const { discoverElementAnimations, editForAnimation, applyAnimationInput, animationPatchFromEdit } = await import("/tmp/feedback-mark-animation-adapter.mjs");
  const element = {};
  const fadeEffect = new globalThis.KeyframeEffect(element, [{ opacity: "0" }, { opacity: "1" }], { duration: 900, easing: "ease" });
  const slideEffect = new globalThis.KeyframeEffect(element, [{ transform: "translateY(8px)" }, { transform: "translateY(0)" }], { duration: 700, easing: "linear" });
  const fade = runtime({ id: "fade", effect: fadeEffect, playState: "running", currentTime: 0 });
  const slide = runtime({ id: "slide", effect: slideEffect, playState: "running", currentTime: 0 });
  element.getAnimations = () => [fade, slide];
  const [fadeAnimation, slideAnimation] = discoverElementAnimations(element, ".target");
  const fadeEdit = editForAnimation(fadeAnimation);
  applyAnimationInput(fadeEdit, "duration", "450ms");
  applyAnimationInput(fadeEdit, "easing", "spring(stiffness: 20, damping: 4, mass: 0.5)");
  const patch = animationPatchFromEdit(fadeEdit, ".target");
  const session = createAnimationPreviewSession(fadeAnimation);
  session.applyAnnotationPatch(patch);
  assert.equal(fadeEffect.getTiming().duration, 450);
  assert.match(fadeEffect.getTiming().easing, /^linear\(/);
  assert.equal(slideEffect.getTiming().duration, 700);
  assert.equal(slideEffect.getTiming().easing, "linear");
  session.restore();
  assert.equal(fadeEffect.getTiming().duration, 900);
  assert.equal(slideEffect.getTiming().duration, 700);
});

test("formats source-specific animation markdown without unchanged fields", async () => {
  const { animationPatchMarkdownLines } = await import("/tmp/feedback-mark-animation-format.mjs");
  assert.deepEqual(animationPatchMarkdownLines({
    targetSelector: ".target",
    animationId: "css-animation-fadeup-1",
    source: "css-animation",
    animationName: "fadeUp",
    animatedProperties: ["opacity", "transform"],
    timing: { duration: 450, easing: "cubic-bezier(.16, 1, .3, 1)" },
  }), [
    "Animation:",
    "fadeUp",
    "",
    "Timing:",
    "```css",
    "animation-duration: 450ms;",
    "animation-timing-function: cubic-bezier(.16, 1, .3, 1);",
    "```",
  ]);
  assert.deepEqual(animationPatchMarkdownLines({
    targetSelector: ".button",
    animationId: "css-transition-opacity-1",
    source: "css-transition",
    transitionProperty: "opacity",
    animatedProperties: ["opacity"],
    timing: { duration: 220, easing: "ease-out" },
  }), [
    "Transition:",
    "opacity",
    "",
    "Timing:",
    "```css",
    "transition-duration: 220ms;",
    "transition-timing-function: ease-out;",
    "```",
  ]);
  assert.deepEqual(animationPatchMarkdownLines({
    targetSelector: ".target",
    animationId: "waapi-fade-1",
    source: "waapi",
    animatedProperties: ["opacity"],
    timing: { duration: 450, easing: "cubic-bezier(.16, 1, .3, 1)" },
  }), [
    "Animation:",
    "WAAPI animation",
    "",
    "Timing:",
    "- duration: 450ms",
    "- easing: cubic-bezier(.16, 1, .3, 1)",
  ]);
});
