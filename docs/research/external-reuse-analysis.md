# External Reuse Analysis

## Executive summary

- Adopt Bippy behind a local `ReactAdapter` boundary for DOM element to Fiber, closest meaningful component, display name, stable Fiber identity, and best-effort source location. Do not expose Bippy types to the rest of Feedback Mark.
- Use Bippy directly for `getFiberFromHostInstance`, `getLatestFiber`, `getDisplayName`, `isCompositeFiber`, `traverseFiber`, and optional `bippy/source` source resolution. Avoid Bippy renderer override and hook-inspection APIs in V1.
- Do not depend on all of React Grab immediately. Its `react-grab/primitives` export still pulls context/freeze/open-file/source paths and the package depends on Bippy; the DOM hit-testing algorithms are better copy/adapt candidates.
- Adapt React Grab's deep hit-testing, composed selector boundaries, grabbability filters, source path ranking, keyed-list identity, source fetch queue, and hit-test-shield architecture. Keep our existing Shadow DOM UI, composer, annotation protocol, CSS GUI, localStorage model, and direct-DOM transient update contract.
- Do not use React Grab's broad `freeze()` as the default picker behavior. It patches React update internals, freezes global interactions, pauses page animations, and intercepts animation frame loops. That is too invasive for an always-available bookmarklet annotator.
- DialKit is the strongest immediate animation reference. Its framework-neutral `timeline-core`, `transition-math`, `TimelineStore`, and `TimelineUiStore` can inform our animation editor without mounting the React UI.
- Do not mount DialKit's complete React timeline UI in the current runtime. It imports React, React DOM, and `motion/react`, portals to `document.body`, and would replace the existing CSS GUI direction.
- Expected code reduction is modest in picker/selector code if we adapt locally, but high in future React context and animation math: Bippy can remove most custom React-internals work before it exists, and DialKit can prevent us from hand-rolling spring/easing/timeline sampling.
- Biggest risks: Bippy source resolution can perform sourcemap fetches and has invasive owner-stack fallbacks; React Grab freeze/update code is too broad for host-page safety; DialKit's model authors animations while Feedback Mark inspects existing browser animations, so an adapter is required.
- License status: all three inspected repositories are MIT. Copying substantial code requires retaining the relevant MIT notice.

## Current architecture

Current system
├─ picker
│  ├─ `onPointerMove`, `onPointerDown`, `onClick`, `onKeyDown`, `onKeyUp`
│  ├─ `deepElementFromPoint(x, y)` using `document.elementFromPoint` and open Shadow DOM descent
│  ├─ `isUsefulElement(element)` for visibility, display, pointer-events, body/root, and annotator exclusion
│  ├─ `choosePickTarget(element)` for collapsing wrapper elements with near-identical parent bounds
│  └─ shift multi-select via `toggleSelectionElement` and `openMultiSelectionComposer`
├─ DOM context
│  ├─ `snapshotForElement`
│  ├─ `nearbyText`
│  ├─ `accessibilityInfo`
│  ├─ `computedStylesSnapshot`
│  └─ `displayName`
├─ selector and paths
│  ├─ `selectorAlternativesForElement`
│  ├─ `selectorForElement`
│  ├─ `fullPath`
│  └─ `resolveElement`
├─ React context
│  └─ currently absent; no React detection, Fiber inspection, component stack, or source-location adapter exists
├─ annotation model
│  ├─ `Annotation`, `LiveAnnotation`, `ElementSnapshot`, `ThreadMessage`
│  ├─ statuses: `pending`, `acknowledged`, `resolved`, `dismissed`, `detached`
│  ├─ local persistence through `storageKey`, `loadAnnotations`, `saveAnnotations`
│  └─ export/import through `markdownOutput`, `copyMarkdown`, review/import event handling
├─ CSS editor
│  ├─ `inspectElementStyles`, `inspectCommonElementStyles`, `inspectSharedParentStyles`
│  ├─ pseudo/state discovery through CSSOM rule walking and inferred interactive states
│  ├─ token hints through CSS variables and typed token inference
│  ├─ validation/autocomplete from `src/style-intelligence.ts`
│  └─ preview/commit through `applyPreview`, `restorePreview`, `commitAnnotationEffects`
├─ animation editor
│  └─ not yet implemented beyond internal UI motion and a few Web Animations API calls for composer/toolbar clamp effects
└─ positioning
   ├─ marker positioning through `markerPosition` and `updateMarkerPositions`
   ├─ hover/selection overlays through `updateHoverOverlay` and `updateSelectionOverlay`
   ├─ composer placement through `composerPositionFor`, `clampComposerToViewport`, drag handlers
   ├─ toolbar rail drag through `beginToolbarRailDrag` and related handlers
   └─ layout invalidation through `ResizeObserver`, `MutationObserver`, scroll/resize listeners, and one scheduled `requestAnimationFrame`

Responsibilities currently live mostly in `src/annotator.ts`. CSS parsing, validation, stepping, color parsing, token validity, and property metadata live in `src/style-intelligence.ts`. The interaction contract in `docs/interaction-motion.md` is important: high-frequency hover/marker/tooltip/composer updates should mutate existing Shadow DOM nodes and not call `render()`.

No current implementation was found for React detection, Fiber inspection, source-file/source-location detection, animation discovery, animation preview/editing, easing controls, spring controls, or timeline/scrubbing. Local UI motion uses CSS keyframes/transitions plus `Element.animate()` in `animateComposerClamp` and toolbar collapse.

## Bippy

### Relevant architecture

Bippy is a React-internals utility package. The inspected package is `bippy@0.7.3`, branch `main`, commit `049a43de8e5966ea88c250aafd1c886e50fff10a`, MIT license, copyright 2024-present Aiden Bai.

The public package exports:

- `bippy`: imports `./install-hook-only.js`, then exports `core.ts` and `react.ts`.
- `bippy/install-hook-only`: hook installation only.
- `bippy/source`: source, stack, sourcemap, hook-name, and owner-stack helpers.

Primary runtime dependency is `@types/react-reconciler`; peer dependency is `react >=16.0.0`. The implementation does not import React at runtime in `core.ts`; React is type-only there. Dev/test coverage spans React 17, 18, 19, production renderers, portals, Suspense, and React DevTools compatibility.

### Exact files inspected

- `packages/bippy/package.json`
- `LICENSE`
- `packages/bippy/src/index.ts`
- `packages/bippy/src/core.ts`
- `packages/bippy/src/rdt-hook.ts`
- `packages/bippy/src/react.ts`
- `packages/bippy/src/react-internals/index.ts`
- `packages/bippy/src/react-internals/generated/react-work-tags.ts`
- `packages/bippy/src/react-internals/types.ts`
- `packages/bippy/src/source/index.ts`
- `packages/bippy/src/source/get-source.ts`
- `packages/bippy/src/source/owner-stack.ts`
- `packages/bippy/src/source/symbolication.ts`
- `packages/bippy/tests/get-fiber-from-host-instance-no-hook.test.ts`
- `packages/bippy/tests/fiber-id.test.ts`
- `packages/bippy/tests/get-latest-fiber.test.ts`
- `packages/bippy/tests/get-renderer.test.ts`
- `packages/bippy/tests/get-source.test.ts`
- `packages/bippy/tests/owner-stack.test.ts`
- `packages/bippy/tests/symbolication.test.ts`
- `packages/bippy/tests/use-fiber-version-matrix.test.ts`
- `packages/bippy/tests/react-refresh-late-load.test.ts`
- `packages/bippy/tests/portal.test.tsx`

### Useful APIs

- `getFiber` / `getFiberFromHostInstance`: DOM or host instance to Fiber.
- `getLatestFiber`: resolves alternate/double-buffered Fiber to the current one.
- `getFiberId` / `getFiberById`: stable IDs across alternates, released on unmount when instrumentation sees unmounts.
- `getDisplayName` / `getType`: display-name and wrapper unwrapping for memo/forwardRef-like objects.
- `isFiber`, `isHostFiber`, `isCompositeFiber`: work-tag aware Fiber predicates.
- `traverseFiber`: up/down Fiber traversal with sync or async selectors.
- `getRenderer`: root to owning renderer through tracked roots or DevTools hook `getFiberRoots`.
- `instrument`: wraps React DevTools global hook commit/unmount/post-commit/schedule callbacks.
- `getSource`, `getRawSource`, `getOwnerStack`, `getParentStack`, `normalizeFileName`, `symbolicateStack`, `getSourceMap`: source and sourcemap resolution.

### Late-injection analysis

Bippy can partially work when injected after React has initialized.

`getFiber(hostInstance)` first tries the existing `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` renderers and their `findFiberByHostInstance` methods. If no hook or renderer path is available, it inspects the host object for React private fields: `_reactRootContainer`, `__internalInstanceHandle` / `_internalInstanceHandle`, cached known keys, then keys that start with `__reactContainer$`, `__reactInternalInstance$`, or `__reactFiber`. That means DOM element to Fiber can work after page load on React DOM pages that expose private keys on DOM nodes.

The fallback that traverses known Fiber roots is less reliable after late injection unless a real DevTools/React Refresh hook already exists or Bippy instrumentation has observed commits. Bippy's `rdt-hook.ts` says the hook module must load before React so renderers can inject into it. If Bippy is loaded after React and no real hook existed, Bippy cannot retroactively receive renderer injection for already-mounted roots.

Late-injection API classification:

- Reliable or mostly reliable late: `getFiberFromHostInstance` via private DOM keys, `getLatestFiber` once a Fiber is found, `getDisplayName`, `getType`, `isCompositeFiber`, `traverseFiber` up the return chain, `_debugSource` / `_debugStack`-based `getSource` when debug fields exist.
- Requires existing hook or pre-instrumentation for best results: `getRenderer`, root traversal fallback, `getFiberId` cleanup on unmount, `traverseRenderedFibers`, commit hooks, rendered Fiber traversal, renderer override APIs, React update instrumentation.
- Not appropriate for default bookmarklet behavior: hook inspection, renderer overrides, DevTools-like mutation APIs, and any path that invokes components to synthesize owner stacks unless explicitly requested.

### What overlaps our implementation

Feedback Mark has no React context implementation today. Bippy should define the React boundary rather than replace existing DOM/CSS annotation code.

### Reuse recommendations

- A. USE PACKAGE DIRECTLY: use `bippy` behind `ReactAdapter.detect(element)` and `ReactAdapter.getComponentContext(element)`. Minimum import surface: `getFiberFromHostInstance`, `getLatestFiber`, `getDisplayName`, `isCompositeFiber`, `traverseFiber`, and maybe `getFiberId`.
- A. USE PACKAGE DIRECTLY, OPTIONAL: use `bippy/source` only when the user asks for component/source context or export includes source context. Use `getSource` first; consider `getOwnerStack` only in an advanced/deep context path.
- C. BORROW ARCHITECTURE: keep a local adapter interface so the rest of the app never depends on Bippy Fiber shapes.
- E. SKIP: do not use renderer override APIs, hook inspection, commit instrumentation, or React update freezing in V1.

Recommended local boundary:

ReactAdapter
├─ `detect(element): boolean`
├─ `getComponentContext(element): { name, stack?, fiberId?, key? } | null`
├─ `getSource(element): Promise<{ filePath, lineNumber, columnNumber, origin } | null>`
└─ `getAdvancedInspection(element): Promise<...>` behind an explicit user action

### Risks

- Bookmarklet late injection cannot guarantee a DevTools hook was present before React.
- React private DOM key names are internal and version-sensitive, although Bippy tracks several generations.
- `getSource` depends on dev metadata, sourcemaps, fetch access, CORS/CSP, source map size limits, and production build behavior.
- `getOwnerStack` can use legacy re-invocation techniques in `owner-stack.ts`; this is too invasive for hover and should never run on pointermove.
- Multiple roots and portals are handled by Bippy traversal tests, but renderer ownership is more robust with hook instrumentation than with private-key-only lookup.
- Production builds often omit useful debug source metadata and source maps. The fallback should be "DOM annotation still works."

## React Grab

### Relevant architecture

React Grab is an injected selection/context tool. The inspected package is `react-grab@0.2.0`, branch `main`, commit `ea4bbec9e80f4802e8ae19ad18431edb9ddbb670`, MIT license, copyright 2025 Aiden Bai.

Public exports:

- `react-grab`
- `react-grab/core`
- `react-grab/primitives`
- `react-grab/styles.css`

The package depends on `bippy ^0.7.2` and `@react-grab/cli`. It has optional peer dependency `react >=17.0.0`, but the full UI source uses React and Tailwind-generated CSS. The lower-level `grab` package has similar exports but no source directory in the clone; it appears packaged from the React Grab source/build system.

### Exact files inspected

- `package.json`
- `LICENSE`
- `packages/react-grab/package.json`
- `packages/grab/package.json`
- `packages/react-grab/src/primitives.ts`
- `packages/react-grab/src/core/context.ts`
- `packages/react-grab/src/core/element-adapter.ts`
- `packages/react-grab/src/core/html-preview.ts`
- `packages/react-grab/src/core/three-selection.ts`
- `packages/react-grab/src/utils/get-deep-element-at-point.ts`
- `packages/react-grab/src/utils/get-deep-elements-at-point.ts`
- `packages/react-grab/src/utils/get-unfiltered-elements-at-point.ts`
- `packages/react-grab/src/utils/matches-element-at-point-options.ts`
- `packages/react-grab/src/utils/is-valid-grabbable-element.ts`
- `packages/react-grab/src/utils/create-element-selector.ts`
- `packages/react-grab/src/utils/find-selector-target.ts`
- `packages/react-grab/src/utils/source-fetch-queue.ts`
- `packages/react-grab/src/utils/create-hit-test-shield.ts`
- `packages/react-grab/src/utils/freeze-animations.ts`
- `packages/react-grab/src/utils/freeze-updates.ts`
- `packages/react-grab/src/utils/freeze-global-interactions.ts`
- `packages/react-grab/src/utils/freeze-animation-frame-loops.ts`
- `packages/react-grab/tests/primitives-hit-testing.test.ts`
- `packages/react-grab/tests/create-element-selector.test.ts`
- `packages/react-grab/tests/source-fetch-queue.test.ts`
- `packages/react-grab/e2e/shadow-dom.spec.ts`
- `packages/react-grab/e2e/iframe.spec.ts`
- `packages/react-grab/e2e/freeze-animations.spec.ts`
- `packages/react-grab/e2e/hit-test-shield.spec.ts`
- `.changeset/shield-gated-hit-testing.md`

### Useful primitives

`react-grab/primitives` exports:

- `isElementGrabbable`
- `getElementBounds`
- `getElementSelector`
- `getElementContext`
- `getElementAtPoint`
- `getElementsAtPoint`
- `getElementsAtPosition`
- `freeze`
- `unfreeze`
- `isFreezeActive`
- `openFile`
- `copyContent`
- `disposeBaselineStyles`

This subpath is convenient but too broad for us as-is. It imports freeze modules, context resolution, open-file behavior, Bippy types, source/CSS extraction, and Three.js/R3F selection. Even if tree-shaking removes unused exports, the package boundary is not as small or framework-neutral as the name suggests.

### Picker analysis

React Grab's picker is stronger than ours in these areas:

- `getDeepElementsAtPoint` uses `elementsFromPoint` to get the paint-order stack, descends into open shadow roots, and recurses into same-origin iframes after coordinate conversion.
- `getElementAtPoint` iterates the paint-order stack and returns the first candidate matching default or custom filter. This lets it continue past transparent wrappers and overlays.
- `isValidGrabbableElement` excludes roots, React Grab UI, user-ignored subtrees, invisible elements, devtool overlays, and full-viewport transparent/high-z overlays. It caches visibility with a short TTL and defers expensive `getComputedStyle` until an element looks viewport-covering.
- `data-react-grab-ignore` is a first-class user ignore marker.
- `createHitTestShield` avoids full-document `pointer-events` flips. The recent commit/changeset says this fixed hover lag caused by restyling the full document for hit-testing.
- `getElementAtPoint` accepts `{ container, filter }`, which matches our need to ignore our Shadow DOM and optional scopes.

Our picker should remain responsible for:

- activation/deactivation lifecycle
- cursor style
- hover outline node updates
- composer opening and marker editing behavior
- shift multi-select behavior
- annotation-specific duplicate detection and status logic
- respecting the existing render-vs-direct-DOM contract

### React/source analysis

React Grab delegates React internals to Bippy. Its added value is ranking and caching:

- `getReactFiberForElement` calls an element adapter first, then `getFiberFromHostInstance`.
- `findNearestFiberElement` climbs DOM and open Shadow DOM hosts when instrumentation is active.
- `getNearestComponentName` walks the Bippy owner stack and filters internal/noisy names.
- `resolveSource` prefers Solid source when the build flag is on, otherwise uses Bippy `getSource` and `getOwnerStack`.
- `selectResolvedSource` ranks app source above package source and de-prioritizes generated bundle paths and shared UI wrappers.
- `classifySourcePath`, `isSharedUiSourcePath`, `isGeneratedBundleSourcePath`, and `normalizeFilePath` are useful architecture for avoiding `components/ui` or design-system wrapper source when a meaningful app frame is available.
- `findNearestListItemKey` walks up at most one component boundary and surfaces the nearest keyed sibling identity so repeated list instances sharing a JSX location can still be distinguished.
- `source-fetch-queue` caps source-resolution fetches, adds timeout/abort behavior, swallows late rejection, and avoids connection-pool fanout during hover/copy storms.

This belongs inside our `ReactAdapter`, not in the picker itself.

### Performance techniques

- Never resolve source context on `pointermove`; cache by Fiber revision and abort superseded work.
- Use a queue/concurrency cap for sourcemap fetches.
- Keep visibility cache with targeted invalidation.
- Use a hit-test shield instead of document-wide pointer-events changes.
- Split page-freeze animation collection into a read phase before DOM writes.
- Coalesce scroll redetection into animation frames.
- Use `nativeRequestAnimationFrame` references when patching is possible. For Feedback Mark, avoid patching `requestAnimationFrame` by default.

### What overlaps our implementation

| Area | Current Feedback Mark | React Grab |
| --- | --- | --- |
| Deep hit testing | Single deepest `elementFromPoint`, open Shadow DOM only | Paint-order stack, open Shadow DOM, same-origin iframes, ignored subtrees |
| Grabbability | Basic visibility/display/pointer-events/body/root checks | Overlay heuristics, visibility cache, ignore attr, UI exclusion, adapters |
| Selector persistence | Unique id/test/aria/class/path selectors, document only | Semantic selectors, Shadow DOM and iframe boundary markers |
| Source context | absent | Bippy-backed source and stack selection |
| Page freeze | absent | broad freeze: React updates, animations, interactions, pseudo-states, rAF loops |
| UI | custom Shadow DOM CSS GUI | React/Tailwind UI |

### Reuse recommendations

- B. COPY / ADAPT: hit-testing primitives from `get-deep-element-at-point.ts`, `get-deep-elements-at-point.ts`, `get-unfiltered-elements-at-point.ts`, and `matches-element-at-point-options.ts`.
- B. COPY / ADAPT: grabbability filters from `is-valid-grabbable-element.ts`, but simplify for our runtime and keep our UI exclusion logic.
- B. COPY / ADAPT: selector boundary strategy from `create-element-selector.ts`, plus a matching resolver for `>>>` and `>>iframe>>`.
- C. BORROW ARCHITECTURE: source ranking, source fetch queue, Fiber revision cache, list key identity.
- C. BORROW ARCHITECTURE: hit-test shield for future mode where we need to block page hover/click without restyling the entire document.
- D. ALREADY SOLVED: existing direct-DOM hover outline/marker/composer updates, localStorage annotations, CSS GUI, CSS property editor.
- E. SKIP: full React Grab UI, `freeze()` as default, `openFile`, plugin registry, CLI, and global React update patching.

### Risks

- Importing `react-grab/primitives` directly pulls a package that depends on Bippy and includes broad side-effect-prone capabilities. Bundle impact was not measured.
- Same-origin iframe traversal is useful; cross-origin frames remain unavailable.
- React Grab source resolution assumes dev-server/source-map access and has Next/Vite-specific behavior that should be best effort in a bookmarklet.
- The hit-test shield is more machinery than our current picker needs unless we choose to block host interaction during selection.

## DialKit

### Relevant architecture

DialKit is a multi-framework animation/parameter authoring toolkit. The inspected package is `dialkit@1.4.3`, branch `main`, commit `9dd1c68e3850a92d8be4525fd3016e61329751b3`, MIT license, copyright 2026 Josh Puckett.

Public exports:

- `dialkit`
- `dialkit/store`
- `dialkit/timeline`
- `dialkit/solid`
- `dialkit/vue`
- `dialkit/svelte`
- `dialkit/styles.css`

Peer dependencies are optional except when using a framework UI: `motion >=11`, `motion-v >=2`, `react >=18`, `react-dom >=18`, `solid-js >=1.6`, `svelte >=5.8`, `vue >=3.3`.

### Exact files inspected

- `package.json`
- `LICENSE`
- `src/index.ts`
- `src/timeline/index.ts`
- `src/timeline/adapter.ts`
- `src/timeline-core.ts`
- `src/transition-math.ts`
- `src/store/DialStore.ts`
- `src/store/TimelineStore.ts`
- `src/store/TimelineUiStore.ts`
- `src/components/Timeline/DialTimeline.tsx`
- `src/components/TransitionControl.tsx`
- `src/components/SpringControl.tsx`
- `src/components/EasingVisualization.tsx`
- `src/components/SpringVisualization.tsx`
- `src/copy-instruction.ts`
- `src/timeline-core.test.ts`
- `src/timeline-store.test.ts`
- `src/timeline-frameworks.test.ts`
- `src/timeline-react.test.ts`

### Timeline model

The framework-neutral core supports:

- `TimelineConfig` with total duration.
- `TimelineClipConfig` with `at`, `duration`, `transition`, and loop.
- Three clip shapes: from/to, sequential `steps`, or independent per-property `props`.
- One-level grouping for layers.
- Track delay, per-track duration, per-track transition, and per-track steps.
- `parseTimelineConfig` to derive editable DialStore config and clip metadata.
- `computeStaticTimeline` / `computeStaticClips` for edit-time static geometry.
- `computeClipState` for deterministic per-frame `current`, `progress`, `step`, `started`, `active`, and `done`.
- Hold-rule semantics: untouched properties preserve prior values through later steps.
- Loop folding and wrap continuity through `TimelineStore.foldLoopTime` and `wraps`.
- Numeric and hex-color interpolation; non-numeric/non-hex values switch at midpoint.
- CSS transition export for single-curve clips.

This model can be used without mounting `DialRoot` or the complete React UI if imported through the framework-neutral modules, but adopting it as a package still needs bundling discipline so React UI entrypoints are not pulled into the IIFE.

### Timeline UI

The React timeline UI provides:

- dock visibility store
- play/pause/replay
- playhead flag with pointer scrubbing
- full-range overview scrubber
- adaptive ruler ticks
- zoom through Alt-drag
- Shift-drag reset
- horizontal scroll syncing
- clip rows, group collapse, property-track expansion
- clip popovers using standard DialKit controls
- clip movement and edge resize helpers
- preset/version controls
- copy button for agent handoff

It uses React hooks, React portal to `document.body`, `motion/react`, and shared DialKit CSS. Direct reuse would drag React/Motion into the bookmarklet and would bypass our Shadow DOM GUI strategy.

### Easing

`transition-math.ts` implements cubic-bezier solving with Newton-Raphson and bisection fallback. `TransitionControl.tsx` exposes an easing mode with `[x1, y1, x2, y2]`, sliders, a text input, and visualization. `transitionToCss` can emit CSS-friendly timing data for single-curve clips.

### Springs

`transition-math.ts` uses a damped harmonic oscillator:

- physics config: `stiffness`, `damping`, `mass`
- simple config: `visualDuration`, `bounce`
- `springParams` maps `visualDuration`/`bounce` into stiffness/damping
- `springProgress` samples underdamped, critically damped, and overdamped springs
- `springSettleDuration` estimates the time to settle within 0.5%
- `resolveClipTransition` treats physics springs as duration-owning and time springs/easings as bar-duration-owned

This is the highest-value copy/adapt candidate for our immediate animation editor.

### Browser Animation to DialKit adapter feasibility

DialKit authors animation configuration; Feedback Mark inspects animations already present in a page. Direct model reuse is viable only through an adapter:

Existing browser animation
↓
AnimationAdapter
↓
NormalizedAnimation
↓
Timeline model/math/store
↓
PreviewPatch
↓
host page

Required normalized representation:

```ts
type NormalizedAnimation = {
  id: string;
  targetSelector: string;
  source: "css-animation" | "css-transition" | "waapi" | "js-observed";
  propertyTracks: Array<{
    property: string;
    keyframes: Array<{ offset: number; value: string | number }>;
    delay: number;
    duration: number;
    easing?: string;
    composite?: CompositeOperationOrAuto;
  }>;
  iterations: number | "infinite";
  direction?: PlaybackDirection;
  fill?: FillMode;
  playbackRate?: number;
};
```

Mapping browser forms:

- CSS transition: one property track with current computed value as `from`, transitioned value as `to` only when a triggered state can be observed. Without a before/after state, persist timing metadata and current value, not a false `to`.
- CSS keyframes: use `CSSAnimation.effect.getKeyframes()` where available. Preserve keyframe offsets, property values, easing per keyframe, duration, delay, iteration count, direction, fill, and animation name.
- Web Animations API animation: use `animation.effect instanceof KeyframeEffect`, `effect.getKeyframes()`, `effect.getTiming()`, `animation.currentTime`, `playbackRate`, and target.
- Multiple animations on one element: one normalized animation per `Animation`, grouped by target. DialKit's `props` tracks can represent independent property tracks; multiple independent browser `Animation` objects may need separate clips.
- Transform animation: browser keyframes often expose `transform` as a string. DialKit does not parse transform components, so V1 should treat transform as a string track or add a transform parser before offering per-component editing.
- Opacity animation: maps cleanly to numeric from/to/steps.
- Spring-like JS animation with no metadata: represent as `js-observed` with sampled keyframes only, and label the spring controls unavailable. Do not infer stiffness/damping from sampled motion in V1.

Preview/rollback:

- Never mutate host styles permanently during preview.
- Pause or clone the target animation state before preview.
- Apply preview through a generated WAAPI `Animation` or a scoped inline style patch with original inline/style priority stored.
- Keep a `PreviewPatch` with target, changed properties, original inline values/priorities, paused animation handles, created animation handles, and cleanup callbacks.
- Roll back on cancel, target detach, selection change, annotator deactivate, and destroy.
- Commit should create an annotation patch, not silently alter host source or page styles.

### What overlaps our implementation

Current Feedback Mark has no external-page animation discovery/editor yet. DialKit overlaps only with future animation work, not with the existing CSS GUI.

### Reuse recommendations

- B. COPY / ADAPT: `transition-math.ts` spring/easing sampling and `transitionToCss`.
- C. BORROW ARCHITECTURE: `timeline-core.ts` normalized static/pass separation, `from/to` vs `steps` vs `props`, hold rule, duration inference, loop folding, and deterministic sampling.
- C. BORROW ARCHITECTURE: React timeline UI drag math for ruler scrub, overview scrub, zoom, clip movement, clip resizing, and property track expansion.
- E. SKIP for now: complete `DialTimeline` React UI and `DialRoot`.
- A. USE PACKAGE DIRECTLY, LATER ONLY: evaluate `dialkit/timeline` or `dialkit/store` as a dependency only after measuring tree-shaken IIFE size and verifying no React/Motion code lands in the bookmarklet.

### Risks

- DialKit is authoring-first, not inspection-first.
- It interpolates numbers and hex colors but not arbitrary CSS strings, complex transforms, filters, CSS variables, or unit math.
- Complete UI brings React/Motion and portals outside our Shadow DOM.
- Spring mapping matches Motion semantics, not necessarily arbitrary JS spring libraries on host pages.
- CSS animations/transitions may not expose enough original authoring metadata to edit safely.

## Responsibility matrix

| Responsibility | Current | Bippy | React Grab | Recommendation |
|---|---|---|---|---|
| DOM to Fiber | absent | `getFiberFromHostInstance` via renderer/private keys/root traversal | delegates via `getReactFiberForElement` | Use Bippy directly inside `ReactAdapter` |
| Fiber name | absent | `getDisplayName`, `getType`, `isCompositeFiber`, traversal | filters useful/internal names | Use Bippy plus React Grab-style filtering |
| source location | absent | `getSource`, `getOwnerStack`, sourcemap symbolication | ranks app/shared/package frames, queues fetches | Use Bippy/source behind adapter; borrow React Grab ranking/queue |
| owner stack | absent | `getOwnerStack`, `getParentStack` | formats and budgets stack context | Optional advanced context only, never hover |
| element picker | custom, works for document/open shadow only | no | stronger paint-stack/shadow/iframe/filter logic | Keep picker lifecycle; adapt React Grab hit testing |
| selector generation | custom document selectors | no | semantic selectors with Shadow DOM/iframe boundaries | Adapt selector algorithm and resolver |
| source maps | absent | robust v3/index map decoding, caching, size/time limits | concurrency/abort/ranking wrapper | Use Bippy; add React Grab-style queue |
| list identity | absent | Fiber `key` available | nearest keyed sibling heuristic | Borrow inside ReactAdapter |
| freeze page | absent | no direct page freeze | broad update/animation/pseudo/global freeze | Skip by default; maybe targeted snapshot mode later |
| hover perf | direct DOM updates, rAF marker updates | no | shield avoids document pointer-events restyle, visibility cache | Keep direct DOM model; borrow shield/cache ideas |
| animation discovery | absent | no | freeze only | Use browser APIs: `getAnimations`, CSSOM, WAAPI |
| animation timeline | absent | no | no editor timeline | Borrow/adapt DialKit core/math |
| annotation protocol | ours | no | copy-to-agent context | Keep ours; borrow structured patch output idea |

## Dependency matrix

| Package | Why | Runtime size | Framework coupling | Bookmarklet safe | Required? |
|---|---|---|---|---|---|
| `bippy` | Robust React Fiber lookup, display names, latest Fiber, optional source | not measured | React internals; peer React but no React runtime import for core | Mostly; late injection works partially, source/instrumentation best effort | Yes for React context phase |
| `bippy/source` | Source, owner stack, sourcemap symbolication | not measured | React debug/source metadata and sourcemap fetches | Mostly for explicit source lookup; not hover-safe | Optional but recommended |
| `react-grab/primitives` | Convenient picker/context/freeze primitives | not measured | Depends on Bippy; package includes React-oriented context/freeze/open-file paths | Mostly for selected pure APIs, but broad import is risky | No |
| `react-grab` | Full injected selection/context UI | not measured | React UI/Tailwind/Bippy/CLI assumptions | No for our V1 UI | No |
| `dialkit/timeline` | Timeline model and adapter | not measured | likely framework-neutral subpath, but must verify built output | Maybe after bundle audit | Later |
| `dialkit/store` | Generic store/persistence and timeline transport | not measured | framework-neutral source, browser storage | Mostly, if tree-shaken and namespaced | Later |
| `dialkit` | Full controls and React UI | not measured | React/React DOM/Motion peers for default UI | No for current dependency-free bookmarklet | No |

## Copy/adapt candidates

### Candidate: React DOM to Fiber adapter

Source: Bippy
Exact files: `packages/bippy/src/core.ts`, `packages/bippy/src/react-internals/*`
License: MIT
Current equivalent: none
Why better: Tracks React 16-19 work tags, private DOM keys, alternates, Fiber IDs, renderer ownership, portals/Suspense behavior.
Estimated complexity: Low if used as dependency; high if copied.
Recommendation: A. USE PACKAGE DIRECTLY. Do not copy.
Attribution needed: none for npm dependency beyond normal dependency metadata.

### Candidate: Source resolution and symbolication

Source: Bippy
Exact files: `packages/bippy/src/source/get-source.ts`, `owner-stack.ts`, `symbolication.ts`
License: MIT
Current equivalent: none
Why better: Handles `_debugSource`, React 19 `_debugStack`, owner stacks, v3/index sourcemaps, ignore lists, inline maps, timeout options.
Estimated complexity: Medium integration, high if copied.
Recommendation: A. USE PACKAGE DIRECTLY through `ReactAdapter.getSource`. Gate slow/invasive paths.
Attribution needed: none for npm dependency.

### Candidate: Deep paint-stack hit testing

Source: React Grab
Exact files: `packages/react-grab/src/utils/get-deep-element-at-point.ts`, `get-deep-elements-at-point.ts`, `get-unfiltered-elements-at-point.ts`, `matches-element-at-point-options.ts`
License: MIT
Current equivalent: `deepElementFromPoint`
Why better: Paint-order stack, open Shadow DOM descent, same-origin iframe descent, filter/container options, non-finite coordinate guard.
Estimated complexity: Medium, because we need matching iframe coordinate helpers and tests.
Recommendation: B. COPY / ADAPT locally with MIT attribution.
Attribution needed: Add `docs/third-party-notices.md` or a source header note retaining React Grab MIT notice if substantial code is copied.

### Candidate: Grabbability and overlay filtering

Source: React Grab
Exact files: `packages/react-grab/src/utils/is-valid-grabbable-element.ts`, `is-element-visible.ts`, `is-user-ignored-element.ts`, `is-react-grab-element.ts`
License: MIT
Current equivalent: `isUsefulElement`
Why better: Handles transparent full-page overlays, devtool overlays, ignore attr, visibility cache, and adapter targets.
Estimated complexity: Low to medium.
Recommendation: B. COPY / ADAPT selected heuristics, not the full adapter system.
Attribution needed: Required if copying substantial implementation.

### Candidate: Selector boundary grammar

Source: React Grab
Exact files: `packages/react-grab/src/utils/create-element-selector.ts`, `find-unique-selector.ts`, `preferred-selector-attribute-names.ts`, `actionable-selector-roles.ts`
License: MIT
Current equivalent: `selectorAlternativesForElement`, `selectorForElement`, `resolveElement`
Why better: Encodes open Shadow DOM and same-origin iframe boundaries; distinguishes semantic selector confidence.
Estimated complexity: Medium; we must implement resolver and migration fallback for existing stored annotations.
Recommendation: B. COPY / ADAPT.
Attribution needed: Required if copying substantial implementation.

### Candidate: Source ranking and fetch queue

Source: React Grab
Exact files: `packages/react-grab/src/core/context.ts`, `utils/classify-source-path.ts`, `utils/is-shared-ui-source-path.ts`, `utils/is-generated-bundle-source-path.ts`, `utils/source-fetch-queue.ts`, `utils/create-fiber-revision.ts`
License: MIT
Current equivalent: none
Why better: Avoids wrapper noise, ranks app source over design-system/package frames, aborts stale source fetches.
Estimated complexity: Medium.
Recommendation: C. BORROW ARCHITECTURE; copy only small pure utilities if needed.
Attribution needed: Required if copying utility implementations.

### Candidate: Hit-test shield

Source: React Grab
Exact files: `packages/react-grab/src/utils/create-hit-test-shield.ts`, `subtract-rect.ts`, `.changeset/shield-gated-hit-testing.md`
License: MIT
Current equivalent: none; current picker does not use a shield.
Why better: Blocks host interactions without document-wide pointer-events restyle and preserves nested scrolling through wheel forwarding.
Estimated complexity: Medium to high.
Recommendation: C. BORROW ARCHITECTURE for a future blocked-interaction mode; not needed for immediate picker.
Attribution needed: Required if copying implementation.

### Candidate: Animation freeze learnings

Source: React Grab
Exact files: `packages/react-grab/src/utils/freeze-animations.ts`, `freeze-animation-frame-loops.ts`
License: MIT
Current equivalent: none
Why better: Documents `getAnimations()` flush behavior, WAAPI pause/restore, SVG animation pause, and threshold fallback to CSS freeze.
Estimated complexity: Medium.
Recommendation: C. BORROW ARCHITECTURE for animation preview snapshotting; do not copy global freeze default.
Attribution needed: Required if copying implementation.

### Candidate: Spring/easing math

Source: DialKit
Exact files: `src/transition-math.ts`
License: MIT
Current equivalent: none
Why better: Deterministic cubic-bezier solving and damped spring sampling with settle duration and Motion-compatible simple spring mapping.
Estimated complexity: Low to medium.
Recommendation: B. COPY / ADAPT into a local framework-neutral animation math module.
Attribution needed: Required; retain DialKit MIT notice in `docs/third-party-notices.md` or file header.

### Candidate: Timeline normalized model

Source: DialKit
Exact files: `src/timeline-core.ts`, `src/store/TimelineStore.ts`
License: MIT
Current equivalent: none
Why better: Static vs per-frame passes, property tracks, sequences, hold rule, loop folding, deterministic sampling, drag/resize constraints.
Estimated complexity: Medium to high because browser animation inspection requires an adapter.
Recommendation: C. BORROW ARCHITECTURE first; copy/adapt selected helpers after the adapter contract is stable.
Attribution needed: Required if implementation is copied.

## Architecture after reuse

Proposed architecture
├─ Browser
│  ├─ DOM / CSSOM / WAAPI
│  └─ host framework unknown
├─ Picker
│  ├─ Feedback Mark lifecycle and mode state
│  ├─ React Grab-adapted hit testing
│  ├─ React Grab-adapted grabbability filters
│  └─ existing direct-DOM hover/selection overlay updates
├─ TargetResolver
│  ├─ React Grab-adapted selector generation
│  ├─ legacy selector fallback for existing annotations
│  └─ Shadow DOM / same-origin iframe resolver
├─ DOMContext
│  ├─ current element snapshot
│  ├─ accessibility and nearby text
│  └─ CSS state/style inspection
├─ ReactAdapter
│  ├─ Bippy DOM to Fiber
│  ├─ closest meaningful component
│  ├─ list key identity
│  ├─ optional source and owner-stack resolution
│  └─ React Grab-style source ranking/fetch queue
├─ AnimationAdapter
│  ├─ `element.getAnimations({ subtree?: false })`
│  ├─ CSS animation/transition timing extraction
│  ├─ WAAPI `KeyframeEffect` normalization
│  └─ reversible preview patches
├─ TimelineEngine
│  ├─ DialKit-inspired normalized clips/tracks
│  ├─ DialKit-adapted easing/spring math
│  └─ deterministic scrub sampling
├─ Feedback Mark Shadow DOM UI
│  ├─ existing CSS GUI preserved
│  ├─ future animation panel rendered in our style
│  └─ no external UI replacement
└─ AnnotationStore
   ├─ DOM target
   ├─ text edit
   ├─ CSS patch
   ├─ React context
   └─ animation patch

Annotations remain our system. A future animation annotation can look like:

```json
{
  "comment": "This easing feels too abrupt",
  "animationPatch": {
    "target": "button[data-testid=\"checkout\"]",
    "source": "css-animation",
    "animationName": "enter",
    "property": "opacity",
    "timingFunction": "cubic-bezier(.2,.8,.2,1)",
    "duration": 0.22
  }
}
```

## Recommended implementation phases

### Phase 1: React context adapter

- Files affected: add `src/react-adapter.ts`; update `src/annotator.ts` annotation snapshot/export types; add tests under `tests/`.
- External APIs used: `bippy` core APIs only; optionally `bippy/source` behind explicit async source lookup.
- Old code removable: none, because this capability is currently absent.
- Tests required: mocked Fiber adapter tests, no-React fallback, React private-key fixture, source timeout/fallback tests.
- Browser QA required: non-React page still annotates; React dev page shows component names; production React without sourcemaps degrades gracefully; multiple roots and portals do not break DOM annotation.
- Rollback strategy: feature flag or adapter returning `null`; DOM annotation path remains unchanged.

### Phase 2: Selector and hit-testing hardening

- Files affected: add `src/targeting.ts` or split `src/dom-targeting.ts`; update `deepElementFromPoint`, `selectorForElement`, `resolveElement`; keep legacy selector fallback.
- External APIs used: none if copied/adapted; React Grab source used as MIT reference.
- Old code removable: current `deepElementFromPoint`, parts of `isUsefulElement`, and some selector generation once compatibility fallback is in place.
- Tests required: open Shadow DOM selection/resolution, same-origin iframe selection/resolution, ignored subtree, transparent overlay, full-page overlay, legacy stored selector migration.
- Browser QA required: hover remains flicker-free; marker positions persist; composer opens near selected target; shift multi-select still works; cross-origin iframe fails safely.
- Rollback strategy: keep current selector string in annotations and store a new `targetPathV2` alongside it until stable.

### Phase 3: Animation adapter and preview model

- Files affected: add `src/animation-adapter.ts`, `src/animation-math.ts`, `src/animation-preview.ts`; extend annotation types in `src/annotator.ts`.
- External APIs used: browser `Animation`, `KeyframeEffect`, CSSOM; DialKit math copied/adapted with attribution.
- Old code removable: none initially.
- Tests required: normalize CSS animation, normalize WAAPI animation, multiple animations, opacity numeric interpolation, transform string fallback, rollback restores inline styles and paused animations.
- Browser QA required: selecting animated element lists animations; scrubbing preview is reversible; cancel/destroy restores page; no permanent host mutation without explicit commit.
- Rollback strategy: animation panel disabled if normalization fails; previews tracked in one cleanup registry and restored on every mode change.

### Phase 4: Timeline UI in Feedback Mark style

- Files affected: extend existing Shadow DOM render functions or add a small internal timeline renderer module; do not replace CSS GUI.
- External APIs used: DialKit-inspired track/ruler math; no React/Motion UI.
- Old code removable: none.
- Tests required: scrub math, zoom/ruler ticks, clip resize/move constraints, keyboard accessibility, reduced-motion behavior.
- Browser QA required: desktop/mobile panel fit, no overlap with composer/review, pointer capture works, timeline does not trigger full `render()` on every frame unless explicitly designed.
- Rollback strategy: keep animation editor behind panel mode; CSS/text annotation flows unchanged.

### Phase 5: Optional dependency audit

- Files affected: `package.json`, build config, bundle-size check script if direct dependencies are adopted.
- External APIs used: evaluate `dialkit/timeline`, `dialkit/store`, and `react-grab/primitives` built artifacts.
- Old code removable: locally adapted math/store code only if direct import is proven smaller and safe.
- Tests required: bundle content audit proving no React/Motion UI in IIFE, typecheck/build/test, CSP smoke test.
- Browser QA required: hosted IIFE still loads as bookmarklet, strict-ish CSP failure mode is clean, inactive host page behavior unchanged.
- Rollback strategy: remove dependency and use local adapted modules.
