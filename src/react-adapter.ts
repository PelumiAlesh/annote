import { b as traverseFiber, i as getDisplayName, l as getLatestFiber, m as isCompositeFiber, s as getFiberFromHostInstance, type BippyFiber } from "bippy/dist/core.js";

export type ReactSourceLocation = {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
  origin: "debug-source" | "debug-stack" | "source-map";
  kind?: ReactSourceKind;
};

export type ReactSourceKind = "app" | "shared-ui" | "package" | "generated" | "unknown";

export type ReactComponentFrame = {
  name: string;
  key?: string;
  source?: ReactSourceLocation;
};

export type ReactContext = {
  component: string;
  key?: string;
  stack: ReactComponentFrame[];
  source?: ReactSourceLocation;
  sourceStatus?: "pending" | "resolved" | "unavailable" | "aborted" | "timeout";
};

export type ReactCoreApi = {
  getFiberFromHostInstance(hostInstance: unknown): BippyFiber | null;
  getLatestFiber(fiber: BippyFiber): BippyFiber;
  getDisplayName(type: unknown): string | null;
  isCompositeFiber(fiber: BippyFiber): boolean;
  traverseFiber(
    fiber: BippyFiber | null,
    selector: (fiber: BippyFiber) => boolean | void | Promise<boolean | void>,
    ascending?: boolean,
  ): BippyFiber | null | Promise<BippyFiber | null>;
};

export type ReactAdapter = {
  detect(element: Element): boolean;
  getComponentContext(element: Element): ReactContext | null;
  getSourceLocation(element: Element, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ReactSourceLocation | null>;
};

export type ReactSourceCoordinator = {
  request(element: Element, context: ReactContext, onResolve: (context: ReactContext) => void): void;
  cancel(): void;
};

type FiberFrame = {
  fiber: BippyFiber;
  name: string;
  key?: string;
  source?: ReactSourceLocation;
  depth: number;
};

type SourceCandidate = FiberFrame & {
  score: number;
};

const defaultCore: ReactCoreApi = {
  getFiberFromHostInstance,
  getLatestFiber,
  getDisplayName,
  isCompositeFiber,
  traverseFiber,
};

const WRAPPER_NAMES = new Set([
  "Anonymous",
  "Context.Consumer",
  "Context.Provider",
  "Fragment",
  "Memo",
  "Mode",
  "Offscreen",
  "Profiler",
  "Provider",
  "StrictMode",
  "Suspense",
  "SuspenseList",
]);

const WRAPPER_NAME_PATTERNS = [
  /^(Button|Icon|Slot|Primitive|Portal|Provider|Root|Trigger|Content|Viewport|Item|List|Group|Label|Control|Indicator)$/,
  /^(Dialog|Popover|Tooltip|Select|DropdownMenu|NavigationMenu|Tabs|Accordion|Toast|Sheet|Drawer)(Root|Trigger|Content|Item|Portal)?$/,
  /^(Styled|Base|Unstyled|Primitive)[A-Z]/,
];

const COMPOSITE_TAGS = new Set([0, 1, 2, 11, 14, 15]);

function cleanComponentName(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name.replace(/^ForwardRef\((.*)\)$/, "$1").replace(/^memo\((.*)\)$/i, "$1").trim();
  if (!normalized || WRAPPER_NAMES.has(normalized)) return null;
  return normalized;
}

export function isMeaningfulComponentName(name: string | null | undefined): name is string {
  return cleanComponentName(name) !== null;
}

function normalizeKey(key: BippyFiber["key"]): string | undefined {
  if (key === null || key === undefined) return undefined;
  const normalized = String(key).replace(/^\.\$?/, "").replace(/^\$/, "");
  return normalized || undefined;
}

export function normalizeSourcePath(fileName: string): string {
  return normalizeFilePath(fileName);
}

export function normalizeFilePath(fileName: string): string {
  const withoutQuery = fileName.replace(/\?.*$/, "");
  const decoded = safeDecode(withoutQuery)
    .replace(/^webpack-internal:\/\/\/?/, "")
    .replace(/^webpack:\/\/\/?/, "")
    .replace(/^webpack:\/\//, "")
    .replace(/^vite:\/\/\/?/, "")
    .replace(/^turbopack:\/\/\/?/, "")
    .replace(/^file:\/\//, "")
    .replace(/^\.\//, "");
  const srcIndex = decoded.indexOf("/src/");
  if (srcIndex >= 0) return decoded.slice(srcIndex + 1);
  return decoded.replace(/^\/src\//, "src/");
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export function isGeneratedBundleSourcePath(fileName: string): boolean {
  const path = normalizeFilePath(fileName);
  return (
    /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.vite|\.turbo|\.webpack|static|chunks?)\//i.test(path) ||
    /(^|\/)(framework|main|runtime|polyfills?|vendors?|webpack|turbopack|app-pages-browser)([-_.][A-Za-z0-9]+)?\.(c?m?js)$/i.test(path) ||
    /[-_.][a-f0-9]{8,}\.(c?m?js)$/i.test(path) ||
    /\.(min|bundle|chunk)\.(c?m?js)$/i.test(path)
  );
}

export function isSharedUiSourcePath(fileName: string): boolean {
  const path = normalizeFilePath(fileName).toLowerCase();
  return (
    /(^|\/)(components\/ui|ui\/components|design-system|designsystem|shared\/ui|packages\/ui|libs\/ui|src\/ui)\//.test(path) ||
    /(^|\/)(radix|shadcn|headless|ariakit|react-aria)\//.test(path)
  );
}

export function classifySourcePath(fileName: string): ReactSourceKind {
  const path = normalizeFilePath(fileName);
  if (!path) return "unknown";
  if (/(^|\/)node_modules\//.test(path) || /^@[\w-]+\//.test(path)) return "package";
  if (isGeneratedBundleSourcePath(path)) return "generated";
  if (isSharedUiSourcePath(path)) return "shared-ui";
  if (/(^|\/)(src|app|pages|components|routes|features|views)\//.test(path)) return "app";
  if (/\.(tsx|jsx|ts|js|mdx)$/.test(path)) return "unknown";
  return "unknown";
}

function withSourceKind(source: ReactSourceLocation | undefined): ReactSourceLocation | undefined {
  return source ? { ...source, fileName: normalizeFilePath(source.fileName), kind: classifySourcePath(source.fileName) } : undefined;
}

function sourceFromDebugSource(fiber: BippyFiber): ReactSourceLocation | undefined {
  const source = fiber._debugSource;
  if (!source?.fileName) return undefined;
  return withSourceKind({
    fileName: normalizeSourcePath(source.fileName),
    lineNumber: source.lineNumber,
    columnNumber: source.columnNumber,
    origin: "debug-source",
  });
}

function sourceFromDebugStack(fiber: BippyFiber): ReactSourceLocation | undefined {
  const stack = fiber._debugStack?.stack || "";
  const match = stack.match(/\(?((?:https?:\/\/|file:\/\/|webpack:\/\/|webpack-internal:\/\/|\/)[^():]+):(\d+):(\d+)\)?/);
  if (!match) return undefined;
  return withSourceKind({
    fileName: normalizeSourcePath(match[1]),
    lineNumber: Number(match[2]),
    columnNumber: Number(match[3]),
    origin: "debug-stack",
  });
}

function sourceFor(fiber: BippyFiber): ReactSourceLocation | undefined {
  return sourceFromDebugSource(fiber) || sourceFromDebugStack(fiber);
}

function displayNameForFiber(core: ReactCoreApi, fiber: BippyFiber): string | null {
  return cleanComponentName(
    core.getDisplayName(fiber.type) ||
      core.getDisplayName(fiber.elementType) ||
      nestedDisplayName(fiber.type) ||
      nestedDisplayName(fiber.elementType),
  );
}

function nestedDisplayName(type: unknown): string | null {
  if (typeof type === "function") {
    const named = type as Function & { displayName?: string };
    return cleanComponentName(named.displayName || named.name);
  }
  if (!type || typeof type !== "object") return null;
  const value = type as { displayName?: unknown; name?: unknown; render?: unknown; type?: unknown };
  if (typeof value.displayName === "string") return cleanComponentName(value.displayName);
  if (typeof value.name === "string") return cleanComponentName(value.name);
  return nestedDisplayName(value.render) || nestedDisplayName(value.type);
}

function fallbackFiberFromHostInstance(element: Element): BippyFiber | null {
  try {
    for (const key of Object.keys(element)) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
        const fiber = Reflect.get(element, key);
        if (fiber && typeof fiber === "object" && "return" in fiber) return fiber as BippyFiber;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function latestFiber(core: ReactCoreApi, element: Element): BippyFiber | null {
  let fiber: BippyFiber | null = null;
  try {
    fiber = core.getFiberFromHostInstance(element);
  } catch {
    fiber = null;
  }
  fiber ||= fallbackFiberFromHostInstance(element);
  if (!fiber) return null;
  try {
    return core.getLatestFiber(fiber);
  } catch {
    return fiber;
  }
}

function isComposite(core: ReactCoreApi, fiber: BippyFiber): boolean {
  try {
    if (core.isCompositeFiber(fiber)) return true;
  } catch {
  }
  return typeof fiber.tag === "number" && COMPOSITE_TAGS.has(fiber.tag);
}

function isWrapperComponentName(name: string): boolean {
  return WRAPPER_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function closestMeaningfulFiber(core: ReactCoreApi, fiber: BippyFiber): BippyFiber | null {
  try {
    const found = core.traverseFiber(
      fiber,
      (candidate) => isComposite(core, candidate) && isMeaningfulComponentName(displayNameForFiber(core, candidate)),
      true,
    );
    if (found && "then" in Object(found)) return null;
    if (found) return found as BippyFiber;
  } catch {
  }
  let current: BippyFiber | null | undefined = fiber;
  while (current) {
    if (isComposite(core, current) && isMeaningfulComponentName(displayNameForFiber(core, current))) return current;
    current = current.return;
  }
  return null;
}

function fiberFrames(core: ReactCoreApi, fiber: BippyFiber, limit: number): FiberFrame[] {
  const stack: FiberFrame[] = [];
  let current: BippyFiber | null | undefined = fiber;
  while (current && stack.length < limit) {
    if (isComposite(core, current)) {
      const name = displayNameForFiber(core, current);
      if (name && stack[stack.length - 1]?.name !== name) {
        const source = sourceFor(current);
        stack.push({ fiber: current, name, key: normalizeKey(current.key), source: withSourceKind(source), depth: stack.length });
      }
    }
    current = current.return;
  }
  return stack;
}

function stackFromFrames(frames: FiberFrame[], limit = 6): ReactComponentFrame[] {
  return frames.slice(0, limit).map((frame) => ({
    name: frame.name,
    key: frame.key,
    source: cloneLocation(frame.source),
  }));
}

function sourceBaseScore(kind: ReactSourceKind): number {
  if (kind === "app") return 80;
  if (kind === "shared-ui") return 45;
  if (kind === "package") return 30;
  if (kind === "unknown") return 20;
  return 0;
}

function scoreFrame(frame: FiberFrame): number {
  const source = frame.source;
  let score = source ? sourceBaseScore(source.kind || "unknown") + 20 : 5;
  if (source?.lineNumber) score += 5;
  score += Math.max(0, 10 - frame.depth);
  if (isWrapperComponentName(frame.name)) score -= 20;
  if (source?.kind === "shared-ui") score -= 15;
  if (source?.kind === "generated") score -= 40;
  return score;
}

function selectResolvedSource(frames: FiberFrame[]): SourceCandidate | null {
  const candidates = frames
    .filter((frame) => frame.source && frame.source.kind !== "generated")
    .map((frame) => ({ ...frame, score: scoreFrame(frame) }))
    .sort((a, b) => b.score - a.score || a.depth - b.depth);
  return candidates[0] || null;
}

function usefulSource(source: ReactSourceLocation | undefined): ReactSourceLocation | undefined {
  return source?.kind === "generated" ? undefined : source;
}

function findNearestListItemKey(hostFiber: BippyFiber, componentFiber: BippyFiber): string | undefined {
  let current: BippyFiber | null | undefined = hostFiber;
  let crossedComposite = false;
  while (current) {
    const key = normalizeKey(current.key);
    if (key) return key;
    if (current === componentFiber) crossedComposite = true;
    if (crossedComposite && current !== componentFiber && current.return) break;
    current = current.return;
  }
  return normalizeKey(componentFiber.key);
}

function contextCacheKey(fiber: BippyFiber, context: ReactContext): string {
  const sourceKey = context.source
    ? `${context.source.fileName}:${context.source.lineNumber || 0}:${context.source.columnNumber || 0}`
    : "no-source";
  return `${context.component}:${context.key || ""}:${sourceKey}`;
}

function cloneLocation(source: ReactSourceLocation | undefined): ReactSourceLocation | undefined {
  return source ? { ...source } : undefined;
}

export function toJsonSafeReactContext(context: ReactContext | null): ReactContext | undefined {
  if (!context?.component) return undefined;
  const stack = context.stack
    .filter((frame) => !!frame.name)
    .slice(0, 6)
    .map((frame) => ({ name: frame.name, key: frame.key, source: cloneLocation(frame.source) }));
  return {
    component: context.component,
    key: context.key,
    stack,
    source: cloneLocation(context.source),
    sourceStatus: context.sourceStatus,
  };
}

export function reactContextMarkdownLines(context: ReactContext): string[] {
  const lines = [`- Component: ${context.component}${context.key ? ` (key: ${context.key})` : ""}`];
  if (context.stack.length) lines.push(`- Stack: ${context.stack.map((frame) => frame.name).join(" > ")}`);
  if (context.source) {
    const suffix = context.source.lineNumber ? `:${context.source.lineNumber}${context.source.columnNumber ? `:${context.source.columnNumber}` : ""}` : "";
    lines.push(`- Source: ${context.source.fileName}${suffix}`);
  } else if (context.sourceStatus && context.sourceStatus !== "resolved") {
    lines.push(`- Source: ${context.sourceStatus}`);
  }
  return lines;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = (): void => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
    timedOut: () => timedOut,
  };
}

export function createReactAdapter(
  core: ReactCoreApi = defaultCore,
): ReactAdapter {
  const sourceCache = new WeakMap<BippyFiber, Map<string, ReactSourceLocation | null>>();
  return {
    detect(element) {
      try {
        return !!latestFiber(core, element);
      } catch {
        return false;
      }
    },
    getComponentContext(element) {
      try {
        const hostFiber = latestFiber(core, element);
        if (!hostFiber) return null;
        const componentFiber = closestMeaningfulFiber(core, hostFiber);
        if (!componentFiber) return null;
        const frames = fiberFrames(core, componentFiber, 10);
        if (!frames.length) return null;
        const selected = selectResolvedSource(frames);
        const primaryFrame = selected || frames.find((frame) => !isWrapperComponentName(frame.name)) || frames[0];
        const component = primaryFrame.name;
        const key = findNearestListItemKey(hostFiber, primaryFrame.fiber);
        const source = selected?.source || usefulSource(primaryFrame.source);
        return toJsonSafeReactContext({
          component,
          key,
          stack: stackFromFrames(frames),
          source,
          sourceStatus: source ? "resolved" : "pending",
        }) || null;
      } catch {
        return null;
      }
    },
    async getSourceLocation(element, options = {}) {
      const timeoutMs = Math.max(250, Math.min(2000, options.timeoutMs || 1200));
      const timeout = withTimeout(options.signal, timeoutMs);
      try {
        const hostFiber = latestFiber(core, element);
        const componentFiber = hostFiber ? closestMeaningfulFiber(core, hostFiber) : null;
        if (!componentFiber || timeout.signal.aborted) return null;
        const context = this.getComponentContext(element);
        if (!context) return null;
        const cacheKey = contextCacheKey(componentFiber, context);
        const fiberCache = sourceCache.get(componentFiber);
        if (fiberCache?.has(cacheKey)) return fiberCache.get(cacheKey) || null;
        await Promise.resolve();
        const frames = fiberFrames(core, componentFiber, 10);
        const selected = selectResolvedSource(frames);
        const source = timeout.signal.aborted ? null : selected?.source || context.source || null;
        const writableCache = fiberCache || new Map<string, ReactSourceLocation | null>();
        writableCache.set(cacheKey, source);
        sourceCache.set(componentFiber, writableCache);
        return source;
      } catch {
        return null;
      } finally {
        timeout.cleanup();
      }
    },
  };
}

export function createReactSourceCoordinator(
  adapter: ReactAdapter,
  timeoutMs = 1200,
  concurrency = 1,
): ReactSourceCoordinator {
  let requestId = 0;
  let controller: AbortController | null = null;
  let active = 0;
  const queue: Array<() => void> = [];
  const runNext = (): void => {
    if (active >= concurrency) return;
    const next = queue.shift();
    if (next) next();
  };
  return {
    request(element, context, onResolve) {
      controller?.abort();
      controller = new AbortController();
      const currentId = ++requestId;
      queue.length = 0;
      queue.push(() => {
        active += 1;
        void adapter.getSourceLocation(element, { signal: controller?.signal, timeoutMs })
          .then((source) => {
            if (currentId !== requestId || controller?.signal.aborted) return;
            onResolve(toJsonSafeReactContext({
              ...context,
              source: source || context.source,
              sourceStatus: source ? "resolved" : context.source ? "resolved" : "unavailable",
            })!);
          })
          .catch(() => {
          })
          .finally(() => {
            active = Math.max(0, active - 1);
            runNext();
          });
      });
      runNext();
    },
    cancel() {
      requestId += 1;
      controller?.abort();
      controller = null;
      queue.length = 0;
    },
  };
}
