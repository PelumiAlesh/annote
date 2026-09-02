import {
  formatIterations,
  formatMilliseconds,
  isValidEasing,
  normalizeIterations,
  parseIterationsInput,
  parseTimeInput,
} from "./animation-math";
import type {
  AnimationEdit,
  AnimationPatch,
  AnimationSource,
  AnimationTimingPatch,
  AnimationTimingValue,
  NormalizedAnimation,
  NormalizedKeyframe,
} from "./animation-types";

type AnimationLike = Animation & { animationName?: string; transitionProperty?: string };
type TimingLike = EffectTiming & { duration?: number | CSSNumericValue | string; iterations?: number };
type ComputedTimingLike = ComputedEffectTiming & { activeDuration?: number };

const RESERVED_KEYFRAME_FIELDS = new Set(["offset", "computedOffset", "easing", "composite"]);

function runtimeSource(animation: Animation): AnimationSource {
  const cssAnimation = typeof CSSAnimation !== "undefined" && animation instanceof CSSAnimation;
  if (cssAnimation) return "css-animation";
  const cssTransition = typeof CSSTransition !== "undefined" && animation instanceof CSSTransition;
  if (cssTransition) return "css-transition";
  return "waapi";
}

function effectFor(animation: Animation): KeyframeEffect | null {
  return typeof KeyframeEffect !== "undefined" && animation.effect instanceof KeyframeEffect ? animation.effect : null;
}

function numericDuration(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function timingFor(animation: Animation, effect: KeyframeEffect | null): AnimationTimingValue {
  const timing = (effect?.getTiming?.() || {}) as TimingLike;
  const computed = (effect?.getComputedTiming?.() || {}) as ComputedTimingLike;
  return {
    duration: Math.max(0, numericDuration(timing.duration, numericDuration(computed.duration, 0))),
    delay: numericDuration(timing.delay, 0),
    easing: typeof timing.easing === "string" && timing.easing.trim() ? timing.easing : "linear",
    iterations: normalizeIterations(timing.iterations),
    playbackRate: Number.isFinite(animation.playbackRate) ? animation.playbackRate : 1,
  };
}

function normalizeKeyframes(effect: KeyframeEffect | null): NormalizedKeyframe[] {
  if (!effect?.getKeyframes) return [];
  return effect.getKeyframes().map((keyframe) => {
    const properties: Record<string, string | number> = {};
    Object.entries(keyframe).forEach(([property, value]) => {
      if (RESERVED_KEYFRAME_FIELDS.has(property) || value === undefined || value === null) return;
      if (typeof value === "string" || typeof value === "number") properties[property] = value;
    });
    return {
      offset: typeof keyframe.offset === "number" ? keyframe.offset : null,
      easing: keyframe.easing || "linear",
      composite: keyframe.composite,
      properties,
    };
  });
}

function animationProperties(keyframes: NormalizedKeyframe[], transitionProperty?: string): string[] {
  const values = new Set<string>();
  if (transitionProperty) values.add(transitionProperty);
  keyframes.forEach((keyframe) => Object.keys(keyframe.properties).forEach((property) => values.add(property)));
  return Array.from(values).sort();
}

function stableId(parts: Array<string | undefined>, index: number): string {
  const raw = parts.filter(Boolean).join("-") || `animation-${index + 1}`;
  return `${raw}-${index + 1}`.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

export function discoverElementAnimations(element: HTMLElement, targetSelector: string): NormalizedAnimation[] {
  if (!element.getAnimations) return [];
  return element
    .getAnimations()
    .map((runtime, index) => normalizeAnimation(runtime, element, targetSelector, index))
    .filter((animation): animation is NormalizedAnimation => animation !== null);
}

export function normalizeAnimation(
  runtime: Animation,
  element: HTMLElement,
  targetSelector: string,
  index: number,
): NormalizedAnimation | null {
  const effect = effectFor(runtime);
  if (effect && effect.target && effect.target !== element) return null;
  const source = runtimeSource(runtime);
  const animationLike = runtime as AnimationLike;
  const keyframes = normalizeKeyframes(effect);
  const transitionProperty = source === "css-transition" ? animationLike.transitionProperty || undefined : undefined;
  const animationName = source === "css-animation" ? animationLike.animationName || undefined : undefined;
  const animatedProperties = animationProperties(keyframes, transitionProperty);
  const timing = timingFor(runtime, effect);
  const computed = (effect?.getComputedTiming?.() || {}) as ComputedTimingLike;
  const label =
    animationName ||
    transitionProperty ||
    runtime.id ||
    (animatedProperties.length ? animatedProperties.join(", ") : `Animation ${index + 1}`);
  return {
    id: stableId([source, animationName, transitionProperty, runtime.id || undefined], index),
    label,
    source,
    targetSelector,
    animationName,
    transitionProperty,
    animatedProperties,
    timing,
    computedDuration: Math.max(0, numericDuration(computed.activeDuration, timing.duration)),
    keyframes,
    runtime,
  };
}

function patchMatchesAnimation(animation: NormalizedAnimation, patch: AnimationPatch): boolean {
  if (patch.animationId === animation.id) return true;
  if (patch.source !== animation.source) return false;
  if (patch.animationName && patch.animationName === animation.animationName) return true;
  if (patch.transitionProperty && patch.transitionProperty === animation.transitionProperty) return true;
  if (!patch.animationName && !patch.transitionProperty && patch.animatedProperties.length) {
    return patch.animatedProperties.some((property) => animation.animatedProperties.includes(property));
  }
  return false;
}

export function patchForAnimation(animation: NormalizedAnimation, existingPatch?: AnimationPatch | AnimationPatch[]): AnimationPatch | undefined {
  const patches = Array.isArray(existingPatch) ? existingPatch : existingPatch ? [existingPatch] : [];
  return patches.find((patch) => patchMatchesAnimation(animation, patch));
}

export function editForAnimation(animation: NormalizedAnimation, existingPatch?: AnimationPatch | AnimationPatch[]): AnimationEdit {
  const patch = patchForAnimation(animation, existingPatch);
  const patchedTiming = patch?.timing || {};
  const value: AnimationTimingValue = {
    ...animation.timing,
    ...patchedTiming,
  };
  return {
    animationId: animation.id,
    source: animation.source,
    animationName: animation.animationName,
    transitionProperty: animation.transitionProperty,
    animatedProperties: [...animation.animatedProperties],
    original: { ...animation.timing },
    value,
    durationInput: formatMilliseconds(value.duration),
    delayInput: formatMilliseconds(value.delay),
    easingInput: value.easing,
    iterationsInput: formatIterations(value.iterations),
    validDuration: true,
    validDelay: true,
    validEasing: isValidEasing(value.easing),
    validIterations: true,
  };
}

export function applyAnimationInput(edit: AnimationEdit, field: string, input: string): void {
  if (field === "duration") {
    edit.durationInput = input;
    const value = parseTimeInput(input);
    edit.validDuration = value !== null && value >= 0;
    if (edit.validDuration && value !== null) edit.value.duration = value;
  }
  if (field === "delay") {
    edit.delayInput = input;
    const value = parseTimeInput(input);
    edit.validDelay = value !== null;
    if (edit.validDelay && value !== null) edit.value.delay = value;
  }
  if (field === "easing") {
    edit.easingInput = input;
    edit.validEasing = isValidEasing(input);
    if (edit.validEasing) edit.value.easing = input.trim();
  }
  if (field === "iterations") {
    edit.iterationsInput = input;
    const value = parseIterationsInput(input);
    edit.validIterations = value !== null;
    if (edit.validIterations && value !== null) edit.value.iterations = value;
  }
  if (field === "speed") {
    const value = Number(input);
    if (Number.isFinite(value) && value > 0) edit.value.playbackRate = value;
  }
}

function changedTiming(original: AnimationTimingValue, value: AnimationTimingValue): AnimationTimingPatch {
  const patch: AnimationTimingPatch = {};
  if (value.duration !== original.duration) patch.duration = value.duration;
  if (value.delay !== original.delay) patch.delay = value.delay;
  if (value.easing !== original.easing) patch.easing = value.easing;
  if (value.iterations !== original.iterations) patch.iterations = value.iterations;
  if (value.playbackRate !== original.playbackRate) patch.playbackRate = value.playbackRate;
  return patch;
}

function originalChangedTiming(original: AnimationTimingValue, timing: AnimationTimingPatch): AnimationTimingPatch {
  const patch: AnimationTimingPatch = {};
  if (timing.duration !== undefined) patch.duration = original.duration;
  if (timing.delay !== undefined) patch.delay = original.delay;
  if (timing.easing !== undefined) patch.easing = original.easing;
  if (timing.iterations !== undefined) patch.iterations = original.iterations;
  if (timing.playbackRate !== undefined) patch.playbackRate = original.playbackRate;
  return patch;
}

export function animationPatchFromEdit(edit: AnimationEdit, targetSelector: string): AnimationPatch | null {
  if (!edit.validDuration || !edit.validDelay || !edit.validEasing || !edit.validIterations) return null;
  const timing = changedTiming(edit.original, edit.value);
  if (!Object.keys(timing).length) return null;
  return {
    targetSelector,
    animationId: edit.animationId,
    source: edit.source,
    animationName: edit.animationName,
    transitionProperty: edit.transitionProperty,
    animatedProperties: [...edit.animatedProperties],
    timing,
    originalTiming: originalChangedTiming(edit.original, timing),
  };
}

export function animationEditSignature(edits: AnimationEdit[]): string {
  return edits
    .map((edit) => [
      edit.animationId,
      edit.value.duration,
      edit.value.delay,
      edit.value.easing,
      edit.value.iterations,
      edit.value.playbackRate,
      edit.validDuration ? "1" : "0",
      edit.validDelay ? "1" : "0",
      edit.validEasing ? "1" : "0",
      edit.validIterations ? "1" : "0",
    ].join("\u0001"))
    .sort()
    .join("\u0002");
}
