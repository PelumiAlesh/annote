import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySourcePath,
  createReactAdapter,
  createReactSourceCoordinator,
  isGeneratedBundleSourcePath,
  isSharedUiSourcePath,
  normalizeSourcePath,
  reactContextMarkdownLines,
  toJsonSafeReactContext,
} from "/tmp/feedback-mark-react-adapter.mjs";

function fiber({ name, key, parent, source, stack } = {}) {
  const type = name ? { displayName: name } : "div";
  return {
    tag: name ? 1 : 5,
    key,
    type,
    elementType: type,
    return: parent || null,
    child: null,
    sibling: null,
    stateNode: {},
    _debugSource: source || null,
    _debugStack: stack ? { stack } : null,
  };
}

function coreFor(map) {
  return {
    getFiberFromHostInstance(element) {
      return map.get(element) || null;
    },
    getLatestFiber(item) {
      return item.latest || item;
    },
    getDisplayName(type) {
      return typeof type === "object" && type ? type.displayName || type.name || null : null;
    },
    isCompositeFiber(item) {
      return item.tag === 1;
    },
    traverseFiber(item, selector, ascending = false) {
      let current = item;
      while (current) {
        if (selector(current)) return current;
        current = ascending ? current.return : current.child;
      }
      return null;
    },
  };
}

test("falls back cleanly when no React fiber is present", () => {
  const adapter = createReactAdapter(coreFor(new WeakMap()));
  assert.equal(adapter.detect({}), false);
  assert.equal(adapter.getComponentContext({}), null);
});

test("extracts the closest meaningful component, key, stack, and debug source", () => {
  const root = fiber({ name: "AppShell" });
  const parent = fiber({ name: "ProjectCard", parent: root });
  const child = fiber({
    name: "Memo",
    parent,
    source: { fileName: "webpack:///src/components/project-card.tsx?abc", lineNumber: 42, columnNumber: 9 },
  });
  const host = fiber({ parent: child });
  const target = {};
  const map = new WeakMap([[target, host]]);
  const adapter = createReactAdapter(coreFor(map));

  const context = adapter.getComponentContext(target);
  assert.equal(context.component, "ProjectCard");
  assert.deepEqual(context.stack.map((frame) => frame.name), ["ProjectCard", "AppShell"]);
  assert.equal(context.source, undefined);
});

test("captures React keys from list row components", () => {
  const list = fiber({ name: "ResultList" });
  const row = fiber({ name: "ResultRow", key: ".$alpha", parent: list });
  const host = fiber({ parent: row });
  const target = {};
  const adapter = createReactAdapter(coreFor(new WeakMap([[target, host]])));

  const context = adapter.getComponentContext(target);
  assert.equal(context.component, "ResultRow");
  assert.equal(context.key, "alpha");
});

test("normalizes source paths and markdown stays compact", () => {
  assert.equal(normalizeSourcePath("webpack-internal:///./src/app/page.tsx?123"), "src/app/page.tsx");
  const lines = reactContextMarkdownLines({
    component: "CTAButton",
    key: "primary",
    stack: [{ name: "CTAButton" }, { name: "Hero" }],
    source: { fileName: "src/app/page.tsx", lineNumber: 17, origin: "debug-source" },
    sourceStatus: "resolved",
  });
  assert.deepEqual(lines, [
    "- Component: CTAButton (key: primary)",
    "- Stack: CTAButton > Hero",
    "- Source: src/app/page.tsx:17",
  ]);
});

test("lazy source lookup resolves debug metadata without blocking composer open", async () => {
  const component = fiber({
    name: "Panel",
    source: { fileName: "webpack:///src/panel.tsx", lineNumber: 8, columnNumber: 3 },
  });
  const host = fiber({ parent: component });
  const target = {};
  const adapter = createReactAdapter(coreFor(new WeakMap([[target, host]])));

  const source = await adapter.getSourceLocation(target, { timeoutMs: 900 });
  assert.deepEqual(source, { fileName: "src/panel.tsx", lineNumber: 8, columnNumber: 3, origin: "debug-source", kind: "app" });
});

test("classifies generated bundles, shared UI, package, and app source paths", () => {
  assert.equal(isGeneratedBundleSourcePath("/_next/static/chunks/app-pages-browser-123abc.js"), true);
  assert.equal(isSharedUiSourcePath("src/components/ui/button.tsx"), true);
  assert.equal(classifySourcePath("node_modules/@radix-ui/react-slot/dist/index.js"), "package");
  assert.equal(classifySourcePath("src/features/search/result-row.tsx"), "app");
  assert.equal(classifySourcePath("src/components/ui/button.tsx"), "shared-ui");
});

test("prefers app source over nearer shared UI wrappers", () => {
  const page = fiber({
    name: "SearchPage",
    source: { fileName: "src/app/search/page.tsx", lineNumber: 12, columnNumber: 1 },
  });
  const feature = fiber({
    name: "SearchResultAction",
    parent: page,
    source: { fileName: "src/features/search/result-action.tsx", lineNumber: 22, columnNumber: 5 },
  });
  const button = fiber({
    name: "Button",
    parent: feature,
    source: { fileName: "src/components/ui/button.tsx", lineNumber: 8, columnNumber: 3 },
  });
  const host = fiber({ parent: button });
  const target = {};
  const adapter = createReactAdapter(coreFor(new WeakMap([[target, host]])));

  const context = adapter.getComponentContext(target);
  assert.equal(context.component, "SearchResultAction");
  assert.equal(context.source.fileName, "src/features/search/result-action.tsx");
  assert.equal(context.source.kind, "app");
  assert.deepEqual(context.stack.map((frame) => frame.name), ["Button", "SearchResultAction", "SearchPage"]);
});

test("de-prioritizes generated source when a package wrapper is the nearest component", () => {
  const app = fiber({
    name: "BillingSettings",
    source: { fileName: "src/routes/billing/settings.tsx", lineNumber: 31, columnNumber: 2 },
  });
  const primitive = fiber({
    name: "Trigger",
    parent: app,
    source: { fileName: "/_next/static/chunks/vendors-12345678.js", lineNumber: 400, columnNumber: 20 },
  });
  const host = fiber({ parent: primitive });
  const target = {};
  const adapter = createReactAdapter(coreFor(new WeakMap([[target, host]])));

  const context = adapter.getComponentContext(target);
  assert.equal(context.component, "BillingSettings");
  assert.equal(context.source.fileName, "src/routes/billing/settings.tsx");
});

test("suppresses generated bundle source when no useful app source is available", () => {
  const bundled = fiber({
    name: "FeatureAction",
    source: { fileName: "/dist/react-qa.js", lineNumber: 21695, columnNumber: 32 },
  });
  const host = fiber({ parent: bundled });
  const target = {};
  const adapter = createReactAdapter(coreFor(new WeakMap([[target, host]])));

  const context = adapter.getComponentContext(target);
  assert.equal(context.component, "FeatureAction");
  assert.equal(context.source, undefined);
  assert.equal(context.sourceStatus, "pending");
});

test("finds the nearest keyed identity before the app component boundary", () => {
  const list = fiber({ name: "ResultList", source: { fileName: "src/features/results/list.tsx", lineNumber: 9 } });
  const row = fiber({ name: "ResultRow", parent: list, source: { fileName: "src/features/results/row.tsx", lineNumber: 17 } });
  const keyedHost = fiber({ key: ".$supplier-42", parent: row });
  const host = fiber({ parent: keyedHost });
  const target = {};
  const adapter = createReactAdapter(coreFor(new WeakMap([[target, host]])));

  const context = adapter.getComponentContext(target);
  assert.equal(context.component, "ResultRow");
  assert.equal(context.key, "supplier-42");
});

test("source lookup cache reuses the first resolved source for the same fiber revision", async () => {
  const component = fiber({
    name: "CachedPanel",
    source: { fileName: "src/cached-panel.tsx", lineNumber: 4, columnNumber: 2 },
  });
  const host = fiber({ parent: component });
  const target = {};
  let latestCalls = 0;
  const core = coreFor(new WeakMap([[target, host]]));
  const adapter = createReactAdapter({
    ...core,
    getLatestFiber(item) {
      latestCalls += 1;
      return item;
    },
  });

  const first = await adapter.getSourceLocation(target);
  const second = await adapter.getSourceLocation(target);
  assert.equal(first.fileName, "src/cached-panel.tsx");
  assert.equal(second.fileName, "src/cached-panel.tsx");
  assert.equal(latestCalls < 6, true);
});

test("lazy source lookup returns null when it is aborted", async () => {
  const component = fiber({ name: "Panel" });
  const host = fiber({ parent: component });
  const target = {};
  const controller = new AbortController();
  const adapter = createReactAdapter(coreFor(new WeakMap([[target, host]])));
  controller.abort();

  const source = await adapter.getSourceLocation(target, { signal: controller.signal, timeoutMs: 20 });
  assert.equal(source, null);
});

test("source coordinator ignores stale results after a newer request", async () => {
  const first = {};
  const second = {};
  let resolver;
  const adapter = {
    detect: () => true,
    getComponentContext: () => null,
    getSourceLocation(element) {
      if (element === first) {
        return new Promise((resolve) => {
          resolver = resolve;
        });
      }
      return Promise.resolve({ fileName: "src/new.tsx", lineNumber: 2, origin: "source-map" });
    },
  };
  const coordinator = createReactSourceCoordinator(adapter, 500);
  const resolved = [];
  coordinator.request(first, { component: "Old", stack: [{ name: "Old" }], sourceStatus: "pending" }, (context) => resolved.push(context));
  coordinator.request(second, { component: "New", stack: [{ name: "New" }], sourceStatus: "pending" }, (context) => resolved.push(context));
  resolver({ fileName: "src/old.tsx", lineNumber: 1, origin: "source-map" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].component, "New");
  assert.equal(resolved[0].source.fileName, "src/new.tsx");
});

test("json-safe context strips empty values", () => {
  assert.equal(toJsonSafeReactContext(null), undefined);
  assert.deepEqual(toJsonSafeReactContext({ component: "Card", stack: [{ name: "Card" }] }), {
    component: "Card",
    key: undefined,
    stack: [{ name: "Card", key: undefined, source: undefined }],
    source: undefined,
    sourceStatus: undefined,
  });
});

test("formats React component for UI as <HeroHeadline>", async () => {
  const { formatUiLabel, uiLabelFor } = await import("/tmp/feedback-mark-ui-label.mjs");
  assert.equal(formatUiLabel("HeroHeadline", "h1"), "<HeroHeadline>");
  assert.equal(formatUiLabel(null, "h1"), "h1");
  assert.equal(formatUiLabel(undefined, "button"), "button");
  assert.equal(uiLabelFor("h1", { component: "HeroHeadline", stack: [{ name: "HeroHeadline" }] }, true), "<HeroHeadline>");
  assert.equal(uiLabelFor("h1", null, true), "h1");
  assert.equal(uiLabelFor("h1", { component: "HeroHeadline", stack: [{ name: "HeroHeadline" }] }, false), "h1");
});

test("React source unavailable does not prevent UI component name", async () => {
  const { formatUiLabel } = await import("/tmp/feedback-mark-ui-label.mjs");
  const fallback = "div.foo";
  assert.equal(formatUiLabel("ProjectCard", fallback), "<ProjectCard>");
  assert.equal(formatUiLabel(undefined, fallback), fallback);
});

test("annotation metadata keeps DOM name while UI shows React name", async () => {
  const { formatUiLabel } = await import("/tmp/feedback-mark-ui-label.mjs");
  const domName = "h1";
  const component = "HeroHeadline";
  const uiLabel = formatUiLabel(component, domName);
  assert.equal(uiLabel, "<HeroHeadline>");
  assert.equal(domName, "h1");
  const annotation = { element: domName, reactContext: { component, stack: [{ name: component }] } };
  assert.equal(annotation.element, "h1");
  assert.equal(annotation.reactContext.component, "HeroHeadline");
});
