// Pure validators for persisted annotations (localStorage is untrusted input).
// No DOM access — safe to unit-test in Node and bundle in the browser.

export const MAX_STORED_ANNOTATIONS = 500;
export const MAX_STORED_JSON_BYTES = 1_000_000;
export const MAX_STORED_ANNOTATION_BYTES = 100_000;
export const MAX_STORED_STRING = 5000;
export const MAX_STORED_THREAD = 50;

const VALID_STATUS = new Set(["pending", "acknowledged", "resolved", "dismissed", "detached"]);

function isString(value: unknown, max = MAX_STORED_STRING): value is string {
  return typeof value === "string" && value.length <= max;
}

function isOptionalString(value: unknown, max = MAX_STORED_STRING): boolean {
  return value === undefined || isString(value, max);
}

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {};
}

function validThread(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_STORED_THREAD) return false;
  return value.every((item) => {
    const raw = record(item);
    return isString(raw.id, 160) && isString(raw.content, MAX_STORED_STRING) && (raw.role === "human" || raw.role === "agent" || raw.role === undefined);
  });
}

function validStyleEdits(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 64) return false;
  return value.every((item) => {
    const raw = record(item);
    return isString(raw.property, 100) && isString(raw.value, 1000) && isOptionalString(raw.originalValue, 1000);
  });
}

export function isValidStoredAnnotation(value: unknown): boolean {
  const raw = record(value);
  if (!isString(raw.id, 160) || !raw.id) return false;
  if (!isString(raw.elementPath, 1000) || !raw.elementPath) return false;
  if (raw.status !== undefined && !(typeof raw.status === "string" && VALID_STATUS.has(raw.status))) return false;
  if (!isOptionalString(raw.comment)) return false;
  if (!isOptionalString(raw.element, 500)) return false;
  if (!validThread(raw.thread)) return false;
  if (!validStyleEdits(raw.styleEdits)) return false;
  try {
    if (JSON.stringify(value).length > MAX_STORED_ANNOTATION_BYTES) return false;
  } catch {
    return false;
  }
  return true;
}

export function sanitizeStoredAnnotations(raw: unknown): { valid: unknown[]; skipped: number } {
  if (!Array.isArray(raw)) return { valid: [], skipped: Array.isArray(raw) ? 0 : 1 };
  try {
    if (JSON.stringify(raw).length > MAX_STORED_JSON_BYTES) {
      // Still salvage: filter items individually instead of dropping everything.
    }
  } catch {
    return { valid: [], skipped: raw.length };
  }
  const valid: unknown[] = [];
  let skipped = 0;
  for (const item of raw.slice(0, MAX_STORED_ANNOTATIONS)) {
    if (isValidStoredAnnotation(item)) valid.push(item);
    else skipped += 1;
  }
  if (raw.length > MAX_STORED_ANNOTATIONS) skipped += raw.length - MAX_STORED_ANNOTATIONS;
  return { valid, skipped };
}
