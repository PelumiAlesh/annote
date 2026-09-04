export const ANNOTE_PROTOCOL_VERSION = 1 as const;
export const ANNOTE_HEALTH_NAME = "annote";

export type AnnoteAnnotationStatus = "pending" | "acknowledged" | "resolved" | "dismissed" | "detached";
export type AnnoteThreadRole = "human" | "agent";

/** What the user expects the coding agent to do with an annotation. */
export type AnnoteIntent = "fix" | "ask" | "note";

export const ANNOTE_INTENTS: readonly AnnoteIntent[] = ["fix", "ask", "note"];

/**
 * Normalize any persisted/provided intent to the V1 vocabulary.
 * Legacy "change" means fix, legacy "question" means ask; anything missing
 * or unknown falls back to "fix" (Annote's primary point-and-change workflow).
 */
export function normalizeAnnotationIntent(value: unknown): AnnoteIntent {
  if (value === "fix" || value === "change") return "fix";
  if (value === "ask" || value === "question") return "ask";
  if (value === "note") return "note";
  return "fix";
}

export const ANNOTE_INTENT_LABELS: Record<AnnoteIntent, string> = {
  fix: "Fix",
  ask: "Ask",
  note: "Note",
};

export const ANNOTE_INTENT_TOOLTIPS: Record<AnnoteIntent, string> = {
  fix: "Request a change to this UI.",
  ask: "Ask the agent about this UI without requesting a change.",
  note: "Leave context or feedback without requesting a change.",
};

/** Agent-facing behavioral contract per intent (surfaced in MCP tool docs). */
export const ANNOTE_INTENT_AGENT_GUIDANCE: Record<AnnoteIntent, string> = {
  fix: "intent=fix is a requested implementation change: claim it, inspect context, implement, reply if useful, resolve when complete.",
  ask: "intent=ask is a question about the UI/code: inspect context and answer. Do not modify code merely because the annotation exists; only change code if the user subsequently explicitly requests it.",
  note: "intent=note is contextual information: do not interpret it as a change request and do not implement solely because it exists; reply/acknowledge where useful.",
};

export type AnnoteThreadMessageDTO = {
  id: string;
  role: AnnoteThreadRole;
  content: string;
  timestamp: string;
};

export type AnnoteSourceDTO = {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
  kind?: string;
  origin?: string;
};

export type AnnoteReactContextDTO = {
  component?: string;
  key?: string;
  stack?: Array<{ name: string; key?: string; source?: AnnoteSourceDTO }>;
  source?: AnnoteSourceDTO;
  sourceStatus?: string;
};

export type AnnoteStyleEditDTO = {
  property: string;
  originalValue?: string;
  value: string;
  state?: string;
  valid?: boolean;
};

export type AnnoteAnimationPatchDTO = {
  id?: string;
  label?: string;
  source?: string;
  keyframes?: unknown;
  timing?: unknown;
  cssText?: string;
  summary?: string;
};

export type AnnoteElementSnapshotDTO = {
  element: string;
  selector: string;
  targetPath?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  accessibility?: string;
  selectorAlternatives?: string[];
};

export type AnnoteAnnotationDTO = {
  protocolVersion: typeof ANNOTE_PROTOCOL_VERSION;
  id: string;
  status: AnnoteAnnotationStatus;
  feedback: string;
  intent: AnnoteIntent;
  thread: AnnoteThreadMessageDTO[];
  target: AnnoteElementSnapshotDTO;
  targets?: AnnoteElementSnapshotDTO[];
  react?: AnnoteReactContextDTO;
  source?: AnnoteSourceDTO;
  cssEdits?: AnnoteStyleEditDTO[];
  designTokens?: string[];
  motionPatches?: AnnoteAnimationPatchDTO[];
  pageUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type AnnoteSessionDTO = {
  protocolVersion: typeof ANNOTE_PROTOCOL_VERSION;
  sessionId: string;
  page: {
    url: string;
    title?: string;
    origin: string;
  };
  annotations: AnnoteAnnotationDTO[];
  updatedAt: string;
};

export type AnnoteHealthDTO = {
  ok: true;
  name: typeof ANNOTE_HEALTH_NAME;
  protocolVersion: typeof ANNOTE_PROTOCOL_VERSION;
  instanceId: string;
};

export type AnnoteBridgeEventDTO =
  | { eventId: string; type: "connected"; instanceId: string; timestamp: string }
  | { eventId: string; type: "resync-required"; instanceId: string; timestamp: string }
  | { eventId: string; type: "annotation.reply"; annotationId: string; message: string; timestamp: string }
  | { eventId: string; type: "annotation.acknowledge"; annotationId: string; claimedBy?: string; timestamp: string }
  | { eventId: string; type: "annotation.resolve"; annotationId: string; timestamp: string }
  | { eventId: string; type: "annotation.dismiss"; annotationId: string; reason?: string; timestamp: string };

export type AnnoteSessionSummaryDTO = {
  sessionId: string;
  page: AnnoteSessionDTO["page"];
  pendingCount: number;
  acknowledgedCount: number;
  updatedAt: string;
};

export type AnnoteCompactAnnotationDTO = {
  id: string;
  status: AnnoteAnnotationStatus;
  comment: string;
  intent: AnnoteIntent;
  element: string;
  component?: string;
  sourceFile?: string;
  sessionId: string;
  page: AnnoteSessionDTO["page"];
};

type RawRecord = Record<string, unknown>;

const SENSITIVE_FIELD_PATTERN = /(password|passwd|pwd|secret|token|cookie|authorization|auth|api[-_]?key|access[-_]?key|session|credential)/i;
const SENSITIVE_VALUE_PATTERN = /\b(Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;

function isoFromTimestamp(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return fallback;
}

function cleanString(value: unknown, max = 1000): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(SENSITIVE_VALUE_PATTERN, "[redacted]").trim().slice(0, max);
}

function cleanStringArray(value: unknown, maxItems = 8): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.map((item) => cleanString(item, 240)).filter((item): item is string => !!item);
  return cleaned.length ? cleaned.slice(0, maxItems) : undefined;
}

function normalizeSourcePath(fileName: string): string {
  const cleaned = fileName
    .replace(/\?.*$/, "")
    .replace(/^webpack-internal:\/\/\/?/, "")
    .replace(/^webpack:\/\/\/?/, "")
    .replace(/^webpack:\/\//, "")
    .replace(/^vite:\/\/\/?/, "")
    .replace(/^turbopack:\/\/\/?/, "")
    .replace(/^file:\/\//, "")
    .replace(/^\.\//, "");
  const srcIndex = cleaned.indexOf("/src/");
  if (srcIndex >= 0) return cleaned.slice(srcIndex + 1);
  return cleaned.replace(/^\/src\//, "src/");
}

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {};
}

// Transport guardrails for broad `unknown` animation data coming from host pages.
// Shared by browser serialization and the MCP boundary — no extra deps.
export const MAX_MOTION_PATCHES = 16;
export const MAX_TRANSPORT_DEPTH = 6;
export const MAX_TRANSPORT_KEYS = 64;
export const MAX_TRANSPORT_ARRAY = 64;
export const MAX_TRANSPORT_STRING = 2000;
export const MAX_TRANSPORT_JSON_BYTES = 100_000;

function sanitizeTransportValue(value: unknown, budget = MAX_TRANSPORT_JSON_BYTES, depth = 0): unknown | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.slice(0, MAX_TRANSPORT_STRING);
  if (typeof value === "number" || typeof value === "boolean") return Number.isFinite(value) ? value : undefined;
  if (depth >= MAX_TRANSPORT_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value.slice(0, MAX_TRANSPORT_ARRAY)) {
      const cleaned = sanitizeTransportValue(item, budget, depth + 1);
      if (cleaned !== undefined) out.push(cleaned);
    }
    return out;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as RawRecord).slice(0, MAX_TRANSPORT_KEYS);
    const out: RawRecord = {};
    for (const [key, item] of entries) {
      if (typeof key !== "string" || key.length > 160) continue;
      const cleaned = sanitizeTransportValue(item, budget, depth + 1);
      if (cleaned !== undefined) out[key.slice(0, 160)] = cleaned;
    }
    const keys = Object.keys(out);
    if (!keys.length) return undefined;
    try {
      if (JSON.stringify(out).length > budget) return undefined;
    } catch {
      return undefined;
    }
    return out;
  }
  return undefined;
}

function box(value: unknown): AnnoteElementSnapshotDTO["boundingBox"] | undefined {
  const raw = record(value);
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return { x, y, width, height };
}

function sourceFrom(value: unknown): AnnoteSourceDTO | undefined {
  const raw = record(value);
  const fileName = cleanString(raw.fileName, 500);
  if (!fileName) return undefined;
  const lineNumber = Number(raw.lineNumber);
  const columnNumber = Number(raw.columnNumber);
  return {
    fileName: normalizeSourcePath(fileName),
    lineNumber: Number.isFinite(lineNumber) ? lineNumber : undefined,
    columnNumber: Number.isFinite(columnNumber) ? columnNumber : undefined,
    kind: cleanString(raw.kind, 80),
    origin: cleanString(raw.origin, 80),
  };
}

function reactFrom(value: unknown): AnnoteReactContextDTO | undefined {
  const raw = record(value);
  const component = cleanString(raw.component, 160);
  const stack: AnnoteReactContextDTO["stack"] = Array.isArray(raw.stack)
    ? raw.stack
        .flatMap((frame) => {
          const item = record(frame);
          const name = cleanString(item.name, 160);
          return name ? [{ name, key: cleanString(item.key, 160), source: sourceFrom(item.source) }] : [];
        })
        .slice(0, 6)
    : undefined;
  const source = sourceFrom(raw.source);
  if (!component && !stack?.length && !source) return undefined;
  return { component, key: cleanString(raw.key, 160), stack, source, sourceStatus: cleanString(raw.sourceStatus, 80) };
}

function styleEditsFrom(value: unknown): AnnoteStyleEditDTO[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const edits: AnnoteStyleEditDTO[] = value
    .flatMap((item) => {
      const raw = record(item);
      const property = cleanString(raw.property, 100);
      const next = cleanString(raw.value, 300);
      if (!property || next === undefined || SENSITIVE_FIELD_PATTERN.test(property)) return [];
      return [{
        property,
        originalValue: cleanString(raw.originalValue, 300),
        value: next,
        state: cleanString(raw.state, 80),
        valid: typeof raw.valid === "boolean" ? raw.valid : undefined,
      }];
    });
  return edits.length ? edits : undefined;
}

function motionPatchesFrom(annotation: RawRecord): AnnoteAnimationPatchDTO[] | undefined {
  const raw = Array.isArray(annotation.animationPatches)
    ? annotation.animationPatches
    : annotation.animationPatch
      ? [annotation.animationPatch]
      : [];
  const patches = raw
    .slice(0, MAX_MOTION_PATCHES)
    .map((item) => {
      const patch = record(item);
      const keyframes = sanitizeTransportValue(patch.keyframes, MAX_TRANSPORT_JSON_BYTES / 4);
      const timing = sanitizeTransportValue(patch.timing, MAX_TRANSPORT_JSON_BYTES / 4);
      return {
        id: cleanString(patch.id, 160),
        label: cleanString(patch.label, 240),
        source: cleanString(patch.source, 240),
        keyframes: keyframes === undefined ? undefined : keyframes,
        timing: timing === undefined ? undefined : timing,
        cssText: cleanString(patch.cssText, 2000),
        summary: cleanString(patch.summary, 500),
      };
    })
    .filter((item) => Object.values(item).some((value) => value !== undefined));
  return patches.length ? patches : undefined;
}

function tokensFrom(edits: AnnoteStyleEditDTO[] | undefined): string[] | undefined {
  const tokens = new Set<string>();
  edits?.forEach((edit) => {
    const matches = edit.value.matchAll(/var\((--[-_a-zA-Z0-9]+)\)/g);
    for (const match of matches) tokens.add(match[1]);
  });
  return tokens.size ? Array.from(tokens) : undefined;
}

function threadFrom(value: unknown, fallbackComment: string, fallbackTime: string): AnnoteThreadMessageDTO[] {
  if (!Array.isArray(value)) {
    return fallbackComment ? [{ id: "msg_initial", role: "human", content: fallbackComment, timestamp: fallbackTime }] : [];
  }
  return value
    .map((item, index) => {
      const raw = record(item);
      const content = cleanString(raw.content, 2000);
      if (!content) return null;
      return {
        id: cleanString(raw.id, 120) || `msg_${index + 1}`,
        role: raw.role === "agent" ? "agent" : "human",
        content,
        timestamp: isoFromTimestamp(raw.timestamp, fallbackTime),
      };
    })
    .filter((item): item is AnnoteThreadMessageDTO => !!item);
}

function targetFrom(annotation: RawRecord): AnnoteElementSnapshotDTO {
  return {
    element: cleanString(annotation.element, 240) || "Selected element",
    selector: cleanString(annotation.elementPath, 500) || "unknown",
    targetPath: cleanString(annotation.fullPath, 800),
    boundingBox: box(annotation.boundingBox),
    nearbyText: cleanString(annotation.nearbyText, 500),
    accessibility: cleanString(annotation.accessibility, 500),
    selectorAlternatives: cleanStringArray(annotation.selectorAlternatives),
  };
}

function targetsFrom(annotation: RawRecord): AnnoteElementSnapshotDTO[] | undefined {
  const rawTargets = Array.isArray(annotation.multiSelectElements)
    ? annotation.multiSelectElements
    : Array.isArray(annotation.targets)
      ? annotation.targets
      : [];
  const targets: AnnoteElementSnapshotDTO[] = rawTargets
    .flatMap((item) => {
      const raw = record(item);
      const selector = cleanString(raw.elementPath, 500) || cleanString(raw.selector, 500);
      const element = cleanString(raw.element, 240);
      return selector && element
        ? [{
            element,
            selector,
            targetPath: cleanString(raw.fullPath, 800),
            boundingBox: box(raw.boundingBox),
            nearbyText: cleanString(raw.nearbyText, 500),
            accessibility: cleanString(raw.accessibility, 500),
            selectorAlternatives: cleanStringArray(raw.selectorAlternatives),
          }]
        : [];
    });
  return targets.length ? targets : undefined;
}

export function annotationToDTO(value: unknown): AnnoteAnnotationDTO | null {
  const raw = record(value);
  const id = cleanString(raw.id, 160);
  if (!id) return null;
  const now = new Date().toISOString();
  const createdAt = isoFromTimestamp(raw.timestamp, now);
  const updatedAt = isoFromTimestamp(raw.updatedAt, createdAt);
  const feedback = cleanString(raw.comment, 2000) || "";
  const cssEdits = styleEditsFrom(raw.styleEdits);
  const react = reactFrom(raw.reactContext);
  return {
    protocolVersion: ANNOTE_PROTOCOL_VERSION,
    id,
    status: raw.status === "acknowledged" || raw.status === "resolved" || raw.status === "dismissed" || raw.status === "detached" ? raw.status : "pending",
    feedback,
    intent: normalizeAnnotationIntent(raw.intent),
    thread: threadFrom(raw.thread, feedback, createdAt),
    target: targetFrom(raw),
    targets: targetsFrom(raw),
    react,
    source: react?.source,
    cssEdits,
    designTokens: tokensFrom(cssEdits),
    motionPatches: motionPatchesFrom(raw),
    pageUrl: cleanString(raw.url, 1000),
    createdAt,
    updatedAt,
  };
}

export function annotationsToDTO(values: unknown): AnnoteAnnotationDTO[] {
  if (!Array.isArray(values)) return [];
  return values.map(annotationToDTO).filter((item): item is AnnoteAnnotationDTO => !!item);
}

export function sessionSummary(session: AnnoteSessionDTO): AnnoteSessionSummaryDTO {
  return {
    sessionId: session.sessionId,
    page: session.page,
    pendingCount: session.annotations.filter((annotation) => annotation.status === "pending").length,
    acknowledgedCount: session.annotations.filter((annotation) => annotation.status === "acknowledged").length,
    updatedAt: session.updatedAt,
  };
}

export function compactAnnotation(session: AnnoteSessionDTO, annotation: AnnoteAnnotationDTO): AnnoteCompactAnnotationDTO {
  return {
    id: annotation.id,
    status: annotation.status,
    comment: annotation.feedback.length > 180 ? `${annotation.feedback.slice(0, 177)}...` : annotation.feedback,
    intent: annotation.intent,
    element: annotation.target.element,
    component: annotation.react?.component,
    sourceFile: annotation.source?.fileName,
    sessionId: session.sessionId,
    page: session.page,
  };
}

export function isProtocolCompatible(version: unknown): boolean {
  return version === ANNOTE_PROTOCOL_VERSION;
}
