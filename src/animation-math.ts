// Spring helpers are adapted from DialKit's framework-neutral animation math.
export type SpringConfig = {
  bounce?: number;
  duration?: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
};

export type SpringParams = {
  mass: number;
  stiffness: number;
  damping: number;
  dampingRatio: number;
  angularFrequency: number;
};

export type CubicBezier = [number, number, number, number];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function parseTimeInput(value: string): number | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  const match = input.match(/^(-?\d*\.?\d+)(ms|s)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2] === "s" ? amount * 1000 : amount;
}

export function formatMilliseconds(value: number): string {
  if (!Number.isFinite(value)) return "0ms";
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}ms`;
}

export function parseIterationsInput(value: string): number | "infinite" | null {
  const input = value.trim().toLowerCase();
  if (input === "infinite" || input === "infinity") return "infinite";
  const amount = Number(input);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

export function formatIterations(value: number | "infinite"): string {
  return value === "infinite" ? "infinite" : String(roundTo(value, 3));
}

export function normalizeIterations(value: number | undefined): number | "infinite" {
  if (value === undefined) return 1;
  return value === Infinity ? "infinite" : value;
}

export function isValidEasing(value: string): boolean {
  const input = value.trim();
  if (!input) return false;
  if (/^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/i.test(input)) return true;
  if (/^steps\(\s*\d+\s*(,\s*(start|end|jump-start|jump-end|jump-none|jump-both))?\s*\)$/i.test(input)) return true;
  return parseCubicBezier(input) !== null || parseSpringEasing(input) !== null;
}

export function parseCubicBezier(value: string): CubicBezier | null {
  const match = value.trim().match(/^cubic-bezier\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  if (parts[0] < 0 || parts[0] > 1 || parts[2] < 0 || parts[2] > 1) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

export function formatCubicBezier(bezier: CubicBezier): string {
  return `cubic-bezier(${bezier.map((value) => String(roundTo(value, 3))).join(", ")})`;
}

export function cubicBezierPoint([x1, y1, x2, y2]: CubicBezier, t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t,
    y: 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t,
  };
}

export function cubicBezierPath(bezier: CubicBezier, width = 112, height = 54): string {
  const points: string[] = [];
  for (let index = 0; index <= 28; index += 1) {
    const point = cubicBezierPoint(bezier, index / 28);
    const x = roundTo(point.x * width, 2);
    const y = roundTo(height - clamp(point.y, -0.2, 1.2) * height, 2);
    points.push(`${index === 0 ? "M" : "L"}${x},${y}`);
  }
  return points.join(" ");
}

export function parseSpringEasing(value: string): SpringConfig | null {
  const match = value.trim().match(/^spring\(([^)]*)\)$/i);
  if (!match) return null;
  const config: SpringConfig = {};
  match[1].split(",").forEach((part) => {
    const [rawKey, rawValue] = part.split(":").map((item) => item.trim());
    const valueNumber = Number(rawValue);
    if (!rawKey || !Number.isFinite(valueNumber)) return;
    if (rawKey === "bounce") config.bounce = clamp(valueNumber, 0, 1);
    if (rawKey === "duration") config.duration = Math.max(0, valueNumber);
    if (rawKey === "mass") config.mass = Math.max(0.001, valueNumber);
    if (rawKey === "stiffness") config.stiffness = Math.max(0.001, valueNumber);
    if (rawKey === "damping") config.damping = Math.max(0.001, valueNumber);
  });
  return config;
}

export function springParams(config: SpringConfig = {}): SpringParams {
  const mass = config.mass ?? 1;
  const stiffness = config.stiffness ?? 170;
  const bounce = clamp(config.bounce ?? 0.25, 0, 1);
  const damping = config.damping ?? 2 * Math.sqrt(stiffness * mass) * (1 - bounce * 0.75);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const angularFrequency = Math.sqrt(stiffness / mass);
  return { mass, stiffness, damping, dampingRatio, angularFrequency };
}

export function springProgress(timeMs: number, config: SpringConfig = {}): number {
  const params = springParams(config);
  const time = Math.max(0, timeMs) / 1000;
  if (params.dampingRatio < 1) {
    const damped = params.angularFrequency * Math.sqrt(1 - params.dampingRatio ** 2);
    const envelope = Math.exp(-params.dampingRatio * params.angularFrequency * time);
    return 1 - envelope * (Math.cos(damped * time) + (params.dampingRatio * params.angularFrequency / damped) * Math.sin(damped * time));
  }
  return 1 - Math.exp(-params.angularFrequency * time);
}

export function estimatedSpringSettleMs(config: SpringConfig = {}, threshold = 0.001): number {
  if (config.duration !== undefined) return config.duration;
  const params = springParams(config);
  const settleSeconds = Math.log(1 / Math.max(threshold, 0.0001)) / Math.max(params.dampingRatio * params.angularFrequency, 0.001);
  return Math.round(settleSeconds * 1000);
}

export function springEasingToLinear(
  easing: string,
  options: { samples?: number } = {},
): string | null {
  const config = parseSpringEasing(easing);
  if (!config) return null;
  const samples = Math.max(16, Math.min(200, options.samples ?? 60));
  const settleMs = Math.max(80, estimatedSpringSettleMs(config));
  const values: string[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const timeMs = (index / samples) * settleMs;
    const progress = springProgress(timeMs, config);
    values.push(String(roundTo(progress, 3)));
  }
  return `linear(${values.join(", ")})`;
}

export function browserEasingForPreview(easing: string): string {
  const springLinear = springEasingToLinear(easing);
  if (springLinear !== null) {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
      try {
        if (!CSS.supports("animation-timing-function", springLinear)) {
          if (CSS.supports("animation-timing-function", "linear(0, 1)")) return "linear";
          return "ease";
        }
      } catch {
        // CSS.supports can throw on unsupported syntax in some runtimes.
      }
    }
    return springLinear;
  }
  return easing;
}

export function isBrowserSupportedEasing(easing: string): boolean {
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    try {
      return CSS.supports("animation-timing-function", easing);
    } catch {
      return false;
    }
  }
  return true;
}
