export type AnimationSource = "css-animation" | "css-transition" | "waapi";

export type AnimationTimingValue = {
  duration: number;
  delay: number;
  easing: string;
  iterations: number | "infinite";
  playbackRate: number;
};

export type NormalizedKeyframe = {
  offset: number | null;
  easing: string;
  composite?: CompositeOperationOrAuto;
  properties: Record<string, string | number>;
};

export type NormalizedAnimation = {
  id: string;
  label: string;
  source: AnimationSource;
  targetSelector: string;
  animationName?: string;
  transitionProperty?: string;
  animatedProperties: string[];
  timing: AnimationTimingValue;
  computedDuration: number;
  keyframes: NormalizedKeyframe[];
  runtime: Animation;
};

export type AnimationTimingPatch = Partial<AnimationTimingValue>;

export type AnimationPatch = {
  targetSelector: string;
  animationId: string;
  source: AnimationSource;
  animationName?: string;
  transitionProperty?: string;
  animatedProperties: string[];
  timing: AnimationTimingPatch;
  originalTiming?: AnimationTimingPatch;
};

export type AnimationEdit = {
  animationId: string;
  source: AnimationSource;
  animationName?: string;
  transitionProperty?: string;
  animatedProperties: string[];
  original: AnimationTimingValue;
  value: AnimationTimingValue;
  durationInput: string;
  delayInput: string;
  easingInput: string;
  iterationsInput: string;
  validDuration: boolean;
  validDelay: boolean;
  validEasing: boolean;
  validIterations: boolean;
};

export type AnimationPreviewPatch = {
  timing: AnimationTimingPatch;
};
