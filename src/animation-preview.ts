import { browserEasingForPreview } from "./animation-math";
import type { AnimationPatch, AnimationPreviewPatch, AnimationTimingPatch, NormalizedAnimation } from "./animation-types";

export type AnimationPreviewResult = {
  applied: Partial<Record<keyof AnimationTimingPatch, boolean>>;
  fallbackEasing?: string;
  error?: unknown;
};

type RuntimeSnapshot = {
  currentTime: CSSNumberish | null;
  playbackRate: number;
  playState: AnimationPlayState;
  timing?: OptionalEffectTiming;
};

function optionalTiming(timing: EffectTiming | undefined): OptionalEffectTiming | undefined {
  if (!timing) return undefined;
  const duration = timing.duration;
  return {
    delay: timing.delay,
    direction: timing.direction,
    duration: typeof duration === "number" || typeof duration === "string" ? duration : undefined,
    easing: timing.easing,
    endDelay: timing.endDelay,
    fill: timing.fill,
    iterationStart: timing.iterationStart,
    iterations: timing.iterations,
  };
}

export class AnimationPreviewSession {
  readonly animationId: string;
  private readonly runtime: Animation;
  private readonly effect: KeyframeEffect | null;
  private readonly original: RuntimeSnapshot;

  constructor(animation: NormalizedAnimation) {
    this.animationId = animation.id;
    this.runtime = animation.runtime;
    this.effect = typeof KeyframeEffect !== "undefined" && this.runtime.effect instanceof KeyframeEffect ? this.runtime.effect : null;
    this.original = {
      currentTime: this.runtime.currentTime,
      playbackRate: this.runtime.playbackRate,
      playState: this.runtime.playState,
      timing: optionalTiming(this.effect?.getTiming?.()),
    };
  }

  apply(patch: AnimationPreviewPatch): AnimationPreviewResult {
    return this.applyTiming(patch.timing);
  }

  applyAnnotationPatch(patch: AnimationPatch): AnimationPreviewResult {
    return this.applyTiming(patch.timing);
  }

  restore(): void {
    try {
      if (this.original.timing) this.effect?.updateTiming(this.original.timing);
      this.runtime.playbackRate = this.original.playbackRate;
      this.runtime.currentTime = this.original.currentTime;
      if (this.original.playState === "running") void this.runtime.play();
      else this.runtime.pause();
    } catch {
      // Animation rollback should never break annotation teardown.
    }
  }

  private applyTiming(patch: AnimationTimingPatch): AnimationPreviewResult {
    const result: AnimationPreviewResult = { applied: {} };
    const convertedEasing =
      patch.easing !== undefined ? browserEasingForPreview(patch.easing) : undefined;
    if (convertedEasing !== undefined && convertedEasing !== patch.easing) {
      result.fallbackEasing = convertedEasing;
    }
    const baseUpdate: OptionalEffectTiming = {};
    if (patch.duration !== undefined) baseUpdate.duration = patch.duration;
    if (patch.delay !== undefined) baseUpdate.delay = patch.delay;
    if (patch.iterations !== undefined) baseUpdate.iterations = patch.iterations === "infinite" ? Infinity : patch.iterations;

    const easingUpdate: OptionalEffectTiming | null =
      convertedEasing !== undefined ? { easing: convertedEasing } : null;

    const safeUpdate = (update: OptionalEffectTiming): boolean => {
      if (!this.effect || !Object.keys(update).length) return false;
      try {
        this.effect.updateTiming(update);
        return true;
      } catch (error) {
        result.error = error;
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          try {
            console.warn("[annote] animation preview update failed", error);
          } catch {
            // Logging must never break preview.
          }
        }
        return false;
      }
    };

    let baseApplied = false;
    let easingApplied = false;
    if (Object.keys(baseUpdate).length) {
      baseApplied = safeUpdate(baseUpdate);
      if (patch.duration !== undefined) result.applied.duration = baseApplied;
      if (patch.delay !== undefined) result.applied.delay = baseApplied;
      if (patch.iterations !== undefined) result.applied.iterations = baseApplied;
    }
    if (easingUpdate) {
      easingApplied = safeUpdate(easingUpdate);
      result.applied.easing = easingApplied;
      if (!easingApplied && !baseApplied && Object.keys(baseUpdate).length) {
        const combined: OptionalEffectTiming = { ...baseUpdate, ...easingUpdate };
        const combinedApplied = safeUpdate(combined);
        if (combinedApplied) {
          if (patch.duration !== undefined) result.applied.duration = true;
          if (patch.delay !== undefined) result.applied.delay = true;
          if (patch.iterations !== undefined) result.applied.iterations = true;
          result.applied.easing = true;
        }
      }
    } else if (!Object.keys(baseUpdate).length && easingUpdate === null) {
      // No timing fields to update.
    }

    if (patch.playbackRate !== undefined) {
      try {
        this.runtime.playbackRate = patch.playbackRate;
        result.applied.playbackRate = true;
      } catch (error) {
        result.error = error;
        result.applied.playbackRate = false;
      }
    }

    return result;
  }
}

export function createAnimationPreviewSession(animation: NormalizedAnimation): AnimationPreviewSession {
  return new AnimationPreviewSession(animation);
}
