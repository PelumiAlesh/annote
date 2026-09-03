import {
  cssSuggestions,
  cssValueStatus,
  boxValueIsLinked,
  colorPartsToCss,
  getCssPropertyMeta,
  getPropertyEditorConfig,
  hasWebrefMetadata,
  isColorProperty,
  isConcreteColorValue,
  isCustomSegmentValue,
  isTokenValueValidForProperty,
  isValidCssValue,
  mergeBoxValuePart,
  parseCssColorParts,
  serializeEditedStyles,
  splitBoxValue,
  stepCssNumericValue,
  type StyleStateKey,
} from "./style-intelligence";
import { isDefaultBackgroundValue } from "./background-helpers";
import { escapeHtml } from "./html-escape";
import { sanitizeStoredAnnotations } from "./annotation-storage";
import { CONFIRM_INITIAL_FOCUS, confirmDialogContent, type ConfirmKind } from "./confirm-dialog";
import { isMacPlatform, matchGlobalShortcut, shortcutLabel } from "./shortcuts";
import {
  mcpNeedsApprovalStatus,
  renderSettingsContent,
  renderSettingsPageContent,
  type McpConnectionStatus,
  type SettingsView,
  type SettingsViewData,
} from "./settings-view";
import { formatUiLabel } from "./ui-label";
import {
  animationEditSignature,
  animationPatchFromEdit,
  applyAnimationInput,
  discoverElementAnimations,
  editForAnimation,
} from "./animation-adapter";
import {
  animationPatchLabel,
  animationPatchMarkdownLines,
  animationPatchOriginalTimingEntries,
  animationPatchTimingEntries,
} from "./animation-format";
import {
  cubicBezierPoint,
  formatCubicBezier,
  parseCubicBezier,
  parseSpringEasing,
  springProgress,
  type CubicBezier,
} from "./animation-math";
import { createAnimationPreviewSession, type AnimationPreviewSession } from "./animation-preview";
import type { AnimationEdit, AnimationPatch, NormalizedAnimation } from "./animation-types";
import {
  createReactAdapter,
  createReactSourceCoordinator,
  reactContextMarkdownLines,
  toJsonSafeReactContext,
  type ReactContext,
} from "./react-adapter";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings as persistSettings,
  updateSetting as updateSettingsValue,
  type FeedbackMarkSettings,
} from "./settings";
import {
  ANNOTE_LOCAL_SETUP_COMMAND,
  createAnnoteMcpClient,
  type AnnoteMcpClient,
} from "./annote-mcp-client";
import type { AnnoteBridgeEventDTO } from "../packages/protocol/src/index";

(() => {
  type Intent = "fix" | "change" | "question";
  type Status = "pending" | "acknowledged" | "resolved" | "dismissed" | "detached";
  type Role = "human" | "agent";

  type Box = {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  type ThreadMessage = {
    id: string;
    role: Role;
    content: string;
    timestamp: number;
  };

  type StyleEdit = {
    property: string;
    originalValue: string;
    value: string;
    state: StyleStateKey;
    valid: boolean;
  };

  type TextEdit = {
    originalValue: string;
    value: string;
    path: number[];
  };

  type StateInfo = {
    key: StyleStateKey;
    label: string;
    declarations: Record<string, string>;
    source: "current" | "css" | "attribute" | "inferred";
    selectors: string[];
  };

  type StyleRow = {
    group: "Text" | "Typography" | "Layout" | "Spacing" | "Size" | "Appearance" | "Border";
    property: string;
    value: string;
    inherited: boolean;
    tokenHints: Array<{ name: string; value: string }>;
  };

  type StyleInspection = {
    elementPath: string;
    states: StateInfo[];
    rowsByState: Record<string, StyleRow[]>;
    editableText?: TextEdit;
    fontSuggestions: string[];
    fontWeightSuggestions: string[];
  };

  type AutocompleteSuggestion = {
    value: string;
    label: string;
  };

  type AnnotationDraft = {
    comment: string;
    initialComment: string;
    intent: Intent;
    initialIntent: Intent;
    activeState: StyleStateKey;
    motionPaneTab: "easing" | "time" | "physics";
    styleEdits: StyleEdit[];
    initialStyleEdits: StyleEdit[];
    selectedAnimationId: string | null;
    animationEdits: AnimationEdit[];
    initialAnimationEdits: AnimationEdit[];
    reactContext?: ReactContext;
    textEdit?: TextEdit;
    initialTextValue?: string;
    undoStack: Array<
      | { kind: "style"; state: StyleStateKey; property: string; previousValue: string; previousValid: boolean; originalValue: string }
      | { kind: "text"; previousValue: string }
    >;
  };

  type PreviewRecord = {
    inlineValue: string;
    priority: string;
  };

  type PreviewSession = {
    element: HTMLElement;
    styleOriginals: Map<string, PreviewRecord>;
    multiStyleOriginals?: Map<HTMLElement, Map<string, PreviewRecord>>;
    pseudoTargetOriginal?: string | null;
    pseudoStyle?: HTMLStyleElement;
    textNode?: Text;
    textOriginal?: string;
    animationPreview?: AnimationPreviewSession;
  };

  type CommittedMutation = {
    element: HTMLElement;
    styleOriginals: Map<string, PreviewRecord>;
    multiStyleOriginals?: Map<HTMLElement, Map<string, PreviewRecord>>;
    pseudoTargetOriginal?: string | null;
    pseudoStyles: HTMLStyleElement[];
    textNode?: Text;
    textOriginal?: string;
    animationSessions?: Map<string, AnimationPreviewSession>;
    animationPausedInfos?: Array<{ animation: Animation; originalPlayState: AnimationPlayState }>;
  };

  type Annotation = {
    id: string;
    comment: string;
    elementPath: string;
    timestamp: number;
    x: number;
    y: number;
    element: string;
    url?: string;
    boundingBox?: Box;
    cssClasses?: string;
    computedStyles?: string;
    accessibility?: string;
    nearbyText?: string;
    selectedText?: string;
    textEdit?: TextEdit;
    styleEdits?: StyleEdit[];
    animationPatch?: AnimationPatch;
    animationPatches?: AnimationPatch[];
    reactContext?: ReactContext;
    intent?: Intent;
    kind?: "feedback";
    status?: Status;
    resolvedAt?: string;
    resolvedBy?: Role;
    thread?: ThreadMessage[];
    fullPath?: string;
    selectorAlternatives?: string[];
    isMultiSelect?: boolean;
    selectionScope?: "individual" | "parent";
    targets?: Array<{ element: string; selector: string }>;
    sharedParent?: ElementSnapshot;
    multiSelectElements?: ElementSnapshot[];
  };

  type ElementSnapshot = {
    element: string;
    elementPath: string;
    boundingBox: Box;
    fullPath?: string;
    cssClasses?: string;
    nearbyText?: string;
    accessibility?: string;
    selectorAlternatives?: string[];
  };

  type LiveAnnotation = Annotation & {
    targetElement?: HTMLElement;
    targetElements?: HTMLElement[];
  };

  type ComposerPosition = {
    left: number;
    top?: number;
    bottom?: number;
    opensUp: boolean;
    dragged?: boolean;
  };

  type Api = {
    mount: () => void;
    toggle: () => void;
    activate: () => void;
    deactivate: () => void;
    destroy: () => void;
    getAnnotations: () => Annotation[];
    clear: () => void;
  };

  const GLOBAL_NAME = "__ANNOTE__";
  const LEGACY_GLOBAL_NAME = "__UI_ANNOTATOR__";
  const ROOT_ID = "annote-root";
  const CURSOR_STYLE_ID = "annote-cursor-style";
  const PSEUDO_TARGET_ATTR = "data-annote-pseudo-target";
  const COLORIS_STYLE_ID = "annote-coloris-style";
  const COLORIS_LINK_ID = "annote-coloris-link";
  const COLORIS_SCRIPT_ID = "annote-coloris-script";
  const COLORIS_CSS_URL = "https://cdn.jsdelivr.net/gh/mdbassit/Coloris@v0.25.0/dist/coloris.min.css";
  const COLORIS_JS_URL = "https://cdn.jsdelivr.net/gh/mdbassit/Coloris@v0.25.0/dist/coloris.min.js";
  // Fail closed if the CDN payload ever changes: vendor/coloris/README.md records
  // the frozen v0.25.0 bytes these hashes were computed from.
  const COLORIS_CSS_INTEGRITY = "sha384-DY3umZptOgjUNshBFbvu1+3RVFPoD1/CgGcc1yyJ77/aFOJ7jtN4BORnz/D/xF0n";
  const COLORIS_JS_INTEGRITY = "sha384-olpkBKjEFqOOAAUzqL1y4xnKDCVmmXNaoRDWmHnRTutomMnUySX9hqDgVQVcvMdc";
  const STORAGE_PREFIX = "annote:annotations:";
  const LEGACY_STORAGE_PREFIX = "feedback-mark:annotations:";
  const Z_INDEX = 2147483646;
  const TOOLBAR_RAIL_HEIGHT = 264;
  const TOOLBAR_COLLAPSED_HEIGHT = 58;
  const SHIELD_ID = "annote-interaction-shield";

  const IS_MAC = typeof navigator !== "undefined" && isMacPlatform((navigator as Navigator).platform);

  const SHORTCUTS: Record<string, string> = {
    "toggle-pick": shortcutLabel("toggle-pick", IS_MAC),
    copy: shortcutLabel("copy", IS_MAC),
    clear: shortcutLabel("delete", IS_MAC),
    "delete-current": shortcutLabel("delete-current", IS_MAC),
    destroy: shortcutLabel("destroy", IS_MAC),
  };

  function isTypingInInput(target: EventTarget | null): boolean {
    const element = target instanceof HTMLElement ? target : null;
    if (element) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true;
      if (element.isContentEditable) return true;
      if (element.closest('[contenteditable="true"]')) return true;
      if (element.closest("input, textarea, [contenteditable]")) return true;
    }
    const active =
      (document.activeElement as HTMLElement | null) ||
      (state.shadow?.activeElement as HTMLElement | null);
    if (active) {
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
      if (active.isContentEditable) return true;
      if (active.closest('[contenteditable="true"]')) return true;
    }
    return false;
  }

  function handleGlobalShortcut(event: KeyboardEvent): boolean {
    if (isTypingInInput(event.target)) return false;
    const action = matchGlobalShortcut(event);
    if (!action) return false;
    if (action === "toggle-pick") {
      event.preventDefault();
      togglePick();
      return true;
    }
    if (action === "copy") {
      if (unresolvedAnnotations().length) {
        event.preventDefault();
        void copyMarkdown();
      }
      return true;
    }
    if (state.editingId) {
      event.preventDefault();
      requestDeleteCurrent();
      return true;
    }
    if (state.annotations.length) {
      event.preventDefault();
      requestClearAnnotations();
      return true;
    }
    return true;
  }

  function shortcutForAction(action: string | null): string | null {
    return action ? SHORTCUTS[action] || null : null;
  }

  function prefersReducedMotion(): boolean {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function shortcutForControl(control: HTMLElement): string | null {
    const action = control.getAttribute("data-action");
    if (action) {
      const fromAction = shortcutForAction(action);
      if (fromAction) return fromAction;
    }
    return control.getAttribute("data-shortcut");
  }

  function tooltipAttributes({ label, shortcut }: { label: string; shortcut?: string | null }): string {
    const attrs = [`aria-label="${escapeHtml(label)}"`, `data-tooltip="${escapeHtml(label)}"`];
    if (shortcut) attrs.push(`data-shortcut="${escapeHtml(shortcut)}"`);
    return attrs.join(" ");
  }

  function shouldPreventUnderlyingAction(): boolean {
    if (!state.active || !state.settings.preventPageActions) return false;
    return !!(state.hoverElement || state.selectedElement || state.selectedElements.length);
  }

  function preventUnderlyingAction(event: Event): void {
    if (!shouldPreventUnderlyingAction() || isAnnotatorNode(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if ("stopImmediatePropagation" in event) (event as Event & { stopImmediatePropagation(): void }).stopImmediatePropagation();
  }

  type ColorisApi = {
    (options: Record<string, unknown>): void;
    setInstance?: (selector: string | HTMLElement | HTMLElement[], options: Record<string, unknown>) => void;
    close?: (revert?: boolean) => void;
  };

  type ColorisWindow = Window & { Coloris?: ColorisApi };
  type SelectionPausedAnimation = {
    animation: Animation;
    originalPlayState: AnimationPlayState;
  };

  let toolbarTooltipOpenTimer: number | null = null;
  let toolbarTooltipCloseTimer: number | null = null;
  let toolbarTooltipCoolTimer: number | null = null;
  let toolbarTooltipActive: HTMLElement | null = null;
  let toolbarTooltipPending: HTMLElement | null = null;
  let toolbarTooltipWarm = false;
  let toolbarTooltipLastCenter: number | null = null;
  let colorisLoadPromise: Promise<void> | null = null;
  let settingsTransitioning = false;

  const state: {
    mounted: boolean;
    active: boolean;
    toolbarOpen: boolean;
    toolbarOpening: boolean;
    toolbarClosing: boolean;
    toolbarTooltipsReady: boolean;
    visible: boolean;
    panelMode: "review" | "settings";
    settingsView: SettingsView;
    settings: FeedbackMarkSettings;
    mcpStatus: McpConnectionStatus;
    mcpSetupCopyState: "idle" | "copied" | "failed";
    annotations: LiveAnnotation[];
    hoverElement: HTMLElement | null;
    structurePreviewElement: HTMLElement | null;
    selectedElement: HTMLElement | null;
    selectedElements: HTMLElement[];
    selectionScope: "individual" | "parent";
    shiftSelecting: boolean;
    rootHost: HTMLElement | null;
    shadow: ShadowRoot | null;
    raf: number | null;
    resizeObserver: ResizeObserver | null;
    mutationObserver: MutationObserver | null;
    composerPosition: ComposerPosition | null;
    composerAnchor: { x: number; y: number } | null;
    editingId: string | null;
    hoveredMarkerId: string | null;
    copyState: "idle" | "copied" | "failed";
    cssOpen: boolean;
    draft: AnnotationDraft | null;
    inspection: StyleInspection | null;
    animations: NormalizedAnimation[];
    reactContext: ReactContext | null;
    motionScrub: { animationId: string; wasRunning: boolean; duration: number; scrubber: HTMLElement } | null;
    motionPaneTab: "easing" | "time" | "physics";
    motionFrame: number | null;
    motionGraphDrag: { animationId: string; handle: 1 | 2 } | null;
    selectionPausedAnimations: SelectionPausedAnimation[];
    preview: PreviewSession | null;
    committed: Map<string, CommittedMutation>;
    autocomplete: { property: string; index: number } | null;
    openFontMenu: string | null;
    unlinkedBoxProperties: Record<string, boolean>;
    unlinkedTokenProperties: Record<string, boolean>;
    openTokenMenu: string | null;
    composerDrag: { startX: number; startY: number; left: number; top: number; width: number; height: number } | null;
    toolbarRailTop: number;
    toolbarRailPinnedToDefault: boolean;
    toolbarDrag: { startY: number; top: number; moved: boolean } | null;
    suppressNextToolbarClick: boolean;
    interactionShield: HTMLElement | null;
    structureOpen: boolean;
    structureAnimating: boolean;
    structureChildrenExpanded: boolean;
    structureSiblingsExpanded: boolean;
    styleScrollTop: number;
    focusComposerOnRender: boolean;
    styleEditorOpening: boolean;
    styleEditorClosing: boolean;
    composerShake: boolean;
    previousCursor: string | null;
    previousBodyCursor: string | null;
    notice: string;
    noticeKind: "info" | "error";
    noticeTimer: number | null;
    shadowClickBound: boolean;
    colorisInput: HTMLInputElement | null;
    mcpClient: AnnoteMcpClient | null;
    confirm: { kind: ConfirmKind; targetId: string | null; count: number } | null;
    confirmClosing: boolean;
    confirmFocus: "cancel" | "delete";
    confirmInvoker: HTMLElement | null;
    confirmTimer: number | null;
    confirmResumePick: boolean;
  } = {
    mounted: false,
    active: false,
    toolbarOpen: false,
    toolbarOpening: false,
    toolbarClosing: false,
    toolbarTooltipsReady: false,
    visible: false,
    panelMode: "review",
    settingsView: "root",
    settings: { ...DEFAULT_SETTINGS },
    mcpStatus: "companion-not-found",
    mcpSetupCopyState: "idle",
    annotations: [],
    hoverElement: null,
    structurePreviewElement: null,
    selectedElement: null,
    selectedElements: [],
    selectionScope: "individual",
    shiftSelecting: false,
    rootHost: null,
    shadow: null,
    raf: null,
    resizeObserver: null,
    mutationObserver: null,
    composerPosition: null,
    composerAnchor: null,
    editingId: null,
    hoveredMarkerId: null,
    copyState: "idle",
    cssOpen: false,
    draft: null,
    inspection: null,
    animations: [],
    reactContext: null,
    motionScrub: null,
    motionPaneTab: "time",
    motionFrame: null,
    motionGraphDrag: null,
    selectionPausedAnimations: [],
    preview: null,
    committed: new Map(),
    autocomplete: null,
    openFontMenu: null,
    unlinkedBoxProperties: {},
    unlinkedTokenProperties: {},
    openTokenMenu: null,
    composerDrag: null,
    toolbarRailTop: Number.POSITIVE_INFINITY,
    toolbarRailPinnedToDefault: true,
    toolbarDrag: null,
    suppressNextToolbarClick: false,
    interactionShield: null,
    structureOpen: false,
    structureAnimating: false,
    structureChildrenExpanded: false,
    structureSiblingsExpanded: false,
    styleScrollTop: 0,
    focusComposerOnRender: false,
    styleEditorOpening: false,
    styleEditorClosing: false,
    composerShake: false,
    previousCursor: null,
    previousBodyCursor: null,
    notice: "",
    noticeKind: "info",
    noticeTimer: null,
    shadowClickBound: false,
    colorisInput: null,
    mcpClient: null,
    confirm: null,
    confirmClosing: false,
    confirmFocus: CONFIRM_INITIAL_FOCUS,
    confirmInvoker: null,
    confirmTimer: null,
    confirmResumePick: false,
  };

  const reactAdapter = createReactAdapter();
  const reactSourceCoordinator = createReactSourceCoordinator(reactAdapter);

  function storageKey(): string {
    return `${STORAGE_PREFIX}${location.origin}${location.pathname}`;
  }

  function legacyStorageKey(): string {
    return `${LEGACY_STORAGE_PREFIX}${location.origin}${location.pathname}`;
  }

  function uid(prefix: string): string {
    const cryptoId = crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10);
    return `${prefix}_${cryptoId || Math.random().toString(36).slice(2, 12)}`;
  }

  function cloneAnnotation(annotation: LiveAnnotation): Annotation {
    const { targetElement: _targetElement, targetElements: _targetElements, ...serializable } = annotation;
    return { ...serializable, thread: serializable.thread ? [...serializable.thread] : undefined };
  }

  function loadAnnotations(): LiveAnnotation[] {
    try {
      let raw = localStorage.getItem(storageKey());
      if (!raw) {
        raw = localStorage.getItem(legacyStorageKey());
        if (raw) localStorage.setItem(storageKey(), raw);
      }
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Annotation[];
      if (!Array.isArray(parsed)) return [];
      const { valid } = sanitizeStoredAnnotations(parsed);
      return (valid as Annotation[])
        .filter((item) => item && typeof item.id === "string" && typeof item.elementPath === "string")
        .map((item) => {
          const targetElements = resolveMultiElements(item);
          return {
            ...item,
            targetElement: resolveElement(item.elementPath) || targetElements[0],
            targetElements,
          };
        });
    } catch {
      return [];
    }
  }

  function saveAnnotations(): void {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(state.annotations.map(cloneAnnotation)));
    } catch {
      setNotice("Storage unavailable. Annotations will remain in memory only.", "error");
    }
    syncMcpSession();
  }

  function syncMcpSession(): void {
    state.mcpClient?.sync();
  }

  function updateSetting<K extends keyof FeedbackMarkSettings>(
    key: K,
    value: FeedbackMarkSettings[K],
    renderAfter = true,
  ): void {
    state.settings = updateSettingsValue(state.settings, key, value);
    if (!persistSettings(state.settings)) {
      setNotice("Storage unavailable. Settings will remain in memory only.", "error");
      return;
    }
    if (key === "reactContext" && !value) reactSourceCoordinator.cancel();
    if (renderAfter) render();
    ensureInteractionShield();
  }

  function restoreSelectionPausedAnimations(): void {
    const paused = state.selectionPausedAnimations;
    state.selectionPausedAnimations = [];
    paused.forEach(({ animation, originalPlayState }) => {
      try {
        if (originalPlayState === "running") void animation.play();
      } catch {
        // Page-owned animations can disappear while the annotator is open.
      }
    });
  }

  function pauseAnimationsForSelection(element: HTMLElement): void {
    restoreSelectionPausedAnimations();
    if (!state.settings.pauseAnimationOnSelect) return;
    const animations = element.getAnimations();
    animations.forEach((animation) => {
      const originalPlayState = animation.playState;
      if (originalPlayState !== "running") return;
      try {
        animation.pause();
        state.selectionPausedAnimations.push({ animation, originalPlayState });
      } catch {
        // Ignore page-owned animations that cannot be paused.
      }
    });
  }

  function clearSentAnnotations(ids: string[]): void {
    if (!ids.length) return;
    const sent = new Set(ids);
    state.annotations
      .filter((annotation) => sent.has(annotation.id))
      .forEach((annotation) => restoreCommittedMutation(annotation.id));
    state.annotations = state.annotations.filter((annotation) => !sent.has(annotation.id));
    saveAnnotations();
    observeTargets();
  }

  function onAnnotationsSent(ids: string[]): void {
    if (!state.settings.clearAfterSend) return;
    clearSentAnnotations(ids);
    if (state.editingId && ids.includes(state.editingId)) clearComposerState();
    render();
  }

  function setNotice(message: string, kind: "info" | "error" = "info"): void {
    if (state.noticeTimer !== null) {
      window.clearTimeout(state.noticeTimer);
      state.noticeTimer = null;
    }
    state.notice = message;
    state.noticeKind = kind;
    render();
    if (!message) return;
    state.noticeTimer = window.setTimeout(
      () => {
        state.noticeTimer = null;
        if (!state.shadow) return;
        state.notice = "";
        render();
      },
      kind === "error" ? 4000 : 1800,
    );
  }

  function noticeHtml(): string {
    if (!state.notice) return "";
    return `<div class="notice ${state.noticeKind === "error" ? "notice-error" : ""}" role="status">${escapeHtml(state.notice)}</div>`;
  }

  function ensureColorisTheme(): void {
    if (document.getElementById(COLORIS_STYLE_ID)) return;
    const theme = document.createElement("style");
    theme.id = COLORIS_STYLE_ID;
    theme.textContent = `
          .clr-picker {
            z-index: ${Z_INDEX} !important;
            border-radius: 8px !important;
            background: #101010 !important;
            box-shadow: 0 20px 55px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.12) !important;
            cursor: auto !important;
          }
          .clr-picker input,
          .clr-picker button {
            border-radius: 6px !important;
            cursor: pointer !important;
          }
          .clr-picker input {
            height: 26px !important;
            border: 1px solid rgba(255,255,255,.12) !important;
            background: rgba(255,255,255,.05) !important;
            color: #fff !important;
            font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
            cursor: text !important;
          }
          .clr-picker .clr-gradient,
          .clr-picker .clr-hue,
          .clr-picker .clr-alpha {
            border-radius: 6px !important;
          }
        `;
    document.head.appendChild(theme);
  }

  function ensureColorisAssets(): Promise<void> {
    ensureColorisTheme();
    const colorisWindow = window as ColorisWindow;
    if (colorisWindow.Coloris) return Promise.resolve();
    if (colorisLoadPromise) return colorisLoadPromise;
    colorisLoadPromise = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${COLORIS_CSS_URL}"]`)) {
        const link = document.createElement("link");
        link.id = COLORIS_LINK_ID;
        link.rel = "stylesheet";
        link.href = COLORIS_CSS_URL;
        link.integrity = COLORIS_CSS_INTEGRITY;
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.id = COLORIS_SCRIPT_ID;
      script.src = COLORIS_JS_URL;
      script.integrity = COLORIS_JS_INTEGRITY;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        colorisLoadPromise = null;
        reject(new Error("Coloris failed to load"));
      };
      document.head.appendChild(script);
    });
    return colorisLoadPromise;
  }

  function configureColoris(input: HTMLInputElement): void {
    if (state.colorisInput === input) return;
    const coloris = (window as ColorisWindow).Coloris;
    if (!coloris) return;
    coloris({
      el: input,
      wrap: false,
      theme: "default",
      themeMode: "dark",
      format: "mixed",
      formatToggle: true,
      alpha: true,
      swatches: [],
      onChange: (_color: string, input: HTMLInputElement | null) => {
        if (!input?.matches?.("[data-coloris-input]")) return;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
    });
    state.colorisInput = input;
  }

  function prepareColoris(input: HTMLInputElement): void {
    void ensureColorisAssets()
      .then(() => configureColoris(input))
      .catch(() => {
        // Native text editing still works when the optional picker cannot load.
      });
  }

  function cleanupColorisAssets(): void {
    document.getElementById(COLORIS_STYLE_ID)?.remove();
    document.getElementById(COLORIS_LINK_ID)?.remove();
    const script = document.getElementById(COLORIS_SCRIPT_ID);
    script?.remove();
    if (script) document.querySelector(".clr-picker")?.remove();
    state.colorisInput = null;
    colorisLoadPromise = null;
  }

  function cssEscape(value: string): string {
    const css = window.CSS as typeof window.CSS | undefined;
    if (css?.escape) return css.escape(value);
    return value.replace(/["\\#.:,[\]>+~*'()]/g, "\\$&");
  }

  function cssStringEscape(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function isAnnotatorNode(node: EventTarget | null): boolean {
    if (isShieldElement(node)) return false;
    if (!(node instanceof Node)) return false;
    if (state.rootHost?.contains(node)) return true;
    const element = node instanceof Element ? node : node.parentElement;
    return !!element?.closest?.(".clr-picker");
  }

  function isShieldEventTarget(node: EventTarget | null): boolean {
    if (isShieldElement(node)) return true;
    if (node instanceof Element && !!node.closest(`#${SHIELD_ID}, [data-annote-shield]`)) return true;
    return false;
  }

  function isControlUiEventTarget(node: EventTarget | null): boolean {
    if (isShieldElement(node)) return false;
    return isAnnotatorNode(node);
  }

  function isUsefulElement(element: Element | null): element is HTMLElement {
    if (!(element instanceof HTMLElement)) return false;
    if (element === document.documentElement || element === document.body) return false;
    if (state.rootHost?.contains(element)) return false;
    if (element.getRootNode() === state.shadow) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none";
  }

  function deepElementFromPoint(x: number, y: number): HTMLElement | null {
    let element = document.elementFromPoint(x, y);
    while (element instanceof HTMLElement && element.shadowRoot) {
      const deeper = element.shadowRoot.elementFromPoint(x, y);
      if (!deeper || deeper === element) break;
      element = deeper;
    }
    if (!isUsefulElement(element)) return null;
    return element;
  }

  function choosePickTarget(element: HTMLElement): HTMLElement {
    let current: HTMLElement | null = element;
    while (current?.parentElement && current.textContent && current.children.length === 1) {
      const rect = current.getBoundingClientRect();
      const parentRect = current.parentElement.getBoundingClientRect();
      const closeSize =
        Math.abs(rect.width - parentRect.width) < 4 && Math.abs(rect.height - parentRect.height) < 4;
      if (!closeSize || current.parentElement === document.body) break;
      current = current.parentElement;
    }
    return current || element;
  }

  function uniqueSelector(selector: string): string | null {
    try {
      return document.querySelectorAll(selector).length === 1 ? selector : null;
    } catch {
      return null;
    }
  }

  function stableClassNames(element: HTMLElement): string[] {
    return Array.from(element.classList)
      .filter((name) => {
        if (name.length < 2) return false;
        if (/^[a-f0-9]{6,}$/i.test(name)) return false;
        if (/^css-[a-z0-9_-]{5,}$/i.test(name)) return false;
        if (/__[a-z0-9_-]{5,}$/i.test(name)) return false;
        return true;
      })
      .slice(0, 3);
  }

  function selectorAlternativesForElement(element: HTMLElement): string[] {
    const selectors: string[] = [];
    const add = (selector: string): void => {
      const unique = uniqueSelector(selector);
      if (unique && !selectors.includes(unique)) selectors.push(unique);
    };

    if (element.id) add(`#${cssEscape(element.id)}`);
    ["data-testid", "data-test", "data-cy", "data-qa", "data-ui", "aria-label", "name", "role"].forEach((attr) => {
      const value = element.getAttribute(attr);
      if (value) add(`${element.localName}[${attr}="${cssStringEscape(value)}"]`);
    });

    const classes = stableClassNames(element);
    if (classes.length) {
      add(`${element.localName}${classes.map((name) => `.${cssEscape(name)}`).join("")}`);
      add(`.${classes.map(cssEscape).join(".")}`);
    }

    return selectors;
  }

  function selectorForElement(element: HTMLElement): string {
    const alternatives = selectorAlternativesForElement(element);
    if (alternatives.length) return alternatives[0];

    const parts: string[] = [];
    let current: HTMLElement | null = element;
    while (current && current !== document.body && current !== document.documentElement) {
      let part = current.localName;
      const attr = ["data-testid", "data-test", "data-cy", "aria-label"].find((name) =>
        current?.hasAttribute(name),
      );
      if (attr) {
        part += `[${attr}="${cssEscape(current.getAttribute(attr) || "")}"]`;
      } else {
        const classes = stableClassNames(current).slice(0, 2);
        if (classes.length) part += classes.map((name) => `.${cssEscape(name)}`).join("");
        if (current.parentElement) {
          const siblings = Array.from(current.parentElement.children).filter(
            (sibling) => sibling.localName === current?.localName,
          );
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      if (document.querySelectorAll(candidate).length === 1) return candidate;
      current = current.parentElement;
    }

    return `body > ${parts.join(" > ")}`;
  }

  function fullPath(element: HTMLElement): string {
    const parts: string[] = [];
    let current: HTMLElement | null = element;
    while (current && current !== document.documentElement) {
      let part = current.localName;
      if (current.id) part += `#${current.id}`;
      if (current.classList.length) part += `.${Array.from(current.classList).slice(0, 3).join(".")}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function resolveElement(selector: string): HTMLElement | null {
    try {
      const element = document.querySelector(selector);
      return element instanceof HTMLElement && !state.rootHost?.contains(element) ? element : null;
    } catch {
      return null;
    }
  }

  function boxFor(element: HTMLElement): Box {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + scrollX),
      y: Math.round(rect.top + scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function unionBoxForElements(elements: HTMLElement[]): Box {
    const rects = elements.map((element) => element.getBoundingClientRect());
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return {
      x: Math.round(left + scrollX),
      y: Math.round(top + scrollY),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    };
  }

  function snapshotForElement(element: HTMLElement): ElementSnapshot {
    return {
      element: displayName(element),
      elementPath: selectorForElement(element),
      boundingBox: boxFor(element),
      fullPath: fullPath(element),
      cssClasses: Array.from(element.classList).join(" "),
      nearbyText: nearbyText(element),
      accessibility: accessibilityInfo(element),
      selectorAlternatives: selectorAlternativesForElement(element),
    };
  }

  function resolveMultiElements(annotation: Annotation): HTMLElement[] {
    return (annotation.multiSelectElements || [])
      .map((item) => resolveElement(item.elementPath))
      .filter((element): element is HTMLElement => !!element);
  }

  function sharedParentForElements(elements: HTMLElement[]): HTMLElement | null {
    if (elements.length < 2) return null;
    const [first, ...rest] = elements;
    let current = first.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      if (rest.every((element) => current!.contains(element))) return current;
      current = current.parentElement;
    }
    return null;
  }

  function activeStyleTargets(): HTMLElement[] {
    if (state.selectedElements.length > 1 && state.selectionScope === "parent") {
      const parent = sharedParentForElements(state.selectedElements);
      return parent ? [parent] : state.selectedElements;
    }
    return state.selectedElements.length > 1 ? state.selectedElements : state.selectedElement ? [state.selectedElement] : [];
  }

  function isFixed(element: HTMLElement): boolean {
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
      const position = getComputedStyle(current).position;
      if (position === "fixed" || position === "sticky") return true;
      current = current.parentElement;
    }
    return false;
  }

  function nearbyText(element: HTMLElement): string {
    const texts = new Set<string>();
    const own = element.innerText || element.textContent || "";
    if (own.trim()) texts.add(own.trim().replace(/\s+/g, " ").slice(0, 180));
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const label = document.getElementById(id)?.textContent?.trim();
        if (label) texts.add(label.replace(/\s+/g, " ").slice(0, 120));
      });
    }
    Array.from(element.parentElement?.children || [])
      .slice(0, 8)
      .forEach((sibling) => {
        if (sibling === element) return;
        const text = sibling.textContent?.trim().replace(/\s+/g, " ");
        if (text && text.length < 120) texts.add(text);
      });
    return Array.from(texts).join(" | ").slice(0, 400);
  }

  function accessibilityInfo(element: HTMLElement): string {
    const attrs = ["role", "aria-label", "aria-labelledby", "aria-describedby", "alt", "title"];
    return attrs
      .map((attr) => {
        const value = element.getAttribute(attr);
        return value ? `${attr}="${value}"` : "";
      })
      .filter(Boolean)
      .join(" ");
  }

  function computedStylesSnapshot(element: HTMLElement): string {
    const styles = getComputedStyle(element);
    const keys = [
      "display",
      "position",
      "width",
      "height",
      "margin",
      "padding",
      "font-size",
      "font-weight",
      "line-height",
      "color",
      "background-color",
      "border-radius",
      "z-index",
    ];
    return keys.map((key) => `${key}: ${styles.getPropertyValue(key)}`).join("; ");
  }

  const PROPERTY_GROUPS: Record<StyleRow["group"], string[]> = {
    Text: [
      "text-align",
      "text-decoration",
      "text-transform",
      "color",
    ],
    Typography: [
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "font-stretch",
      "line-height",
      "letter-spacing",
    ],
    Layout: [
      "display",
      "position",
      "align-items",
      "align-content",
      "align-self",
      "justify-content",
      "justify-self",
      "place-items",
      "place-content",
      "flex",
      "flex-grow",
      "flex-shrink",
      "flex-basis",
      "flex-direction",
      "flex-wrap",
      "grid-template-columns",
      "grid-template-rows",
      "grid-auto-flow",
      "overflow",
      "overflow-x",
      "overflow-y",
      "z-index",
    ],
    Spacing: [
      "padding",
      "margin",
      "gap",
      "row-gap",
      "column-gap",
    ],
    Size: [
      "width",
      "height",
      "min-width",
      "max-width",
      "min-height",
      "max-height",
    ],
    Appearance: [
      "background",
      "background-color",
      "background-image",
      "background-position",
      "background-size",
      "background-repeat",
      "opacity",
      "box-shadow",
      "transform",
      "cursor",
    ],
    Border: [
      "border-width",
      "border-style",
      "border-radius",
      "outline-width",
      "outline-offset",
    ],
  };

  const STATE_LABELS: Record<StyleStateKey, string> = {
    current: "Default",
    hover: "Hover",
    "focus-visible": "Focus visible",
    focus: "Focus",
    active: "Active",
    disabled: "Disabled",
    loading: "Loading",
    open: "Open",
    selected: "Selected",
  };

  const STATE_PATTERNS: Array<[StyleStateKey, RegExp]> = [
    ["hover", /:hover\b/],
    ["focus-visible", /:focus-visible\b/],
    ["focus", /:focus\b/],
    ["active", /:active\b/],
    ["disabled", /:disabled\b|\.disabled\b|\[disabled\]/],
    ["loading", /\.loading\b|\[aria-busy=["']?true["']?\]|\[data-loading\]/],
    ["open", /\.open\b|\[open\]|\[aria-expanded=["']?true["']?\]|\[data-state=["']?open["']?\]/],
    ["selected", /\.selected\b|\.active\b|\[aria-selected=["']?true["']?\]|\[aria-pressed=["']?true["']?\]/],
  ];

  function meaningfulCssValue(value: string): boolean {
    const normalized = value.trim();
    return !!normalized && normalized !== "normal" && normalized !== "none" && normalized !== "0px" && normalized !== "auto";
  }

  function safeCssSelectorForMatching(selector: string): string {
    return selector
      .replace(/:(hover|focus-visible|focus|active|disabled)\b/g, "")
      .replace(/::?[-\w()]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function selectorMatchesState(selector: string, element: HTMLElement): StyleStateKey | null {
    const key = STATE_PATTERNS.find(([, pattern]) => pattern.test(selector))?.[0] || null;
    if (!key) return null;
    const stripped = safeCssSelectorForMatching(selector);
    if (!stripped) return key;
    try {
      return element.matches(stripped) ? key : null;
    } catch {
      return null;
    }
  }

  function stateSourceRank(source: StateInfo["source"]): number {
    return source === "css" ? 3 : source === "attribute" ? 2 : source === "inferred" ? 1 : 0;
  }

  function rememberState(
    found: Map<StyleStateKey, { declarations: Record<string, string>; source: StateInfo["source"]; selectors: string[] }>,
    key: StyleStateKey,
    declarations: Record<string, string>,
    source: StateInfo["source"],
    selector = "",
  ): void {
    const existing = found.get(key);
    const selectors = existing?.selectors || [];
    if (selector && !selectors.includes(selector)) selectors.push(selector);
    found.set(key, {
      declarations: { ...(existing?.declarations || {}), ...declarations },
      source: existing && stateSourceRank(existing.source) > stateSourceRank(source) ? existing.source : source,
      selectors,
    });
  }

  function isPotentiallyInteractive(element: HTMLElement): boolean {
    return (
      element.matches("a[href], button, input, select, textarea, summary, [role='button'], [role='link'], [tabindex]") ||
      getComputedStyle(element).cursor === "pointer"
    );
  }

  function inferredStatesForElement(element: HTMLElement): StyleStateKey[] {
    const states = new Set<StyleStateKey>();
    if (isPotentiallyInteractive(element)) {
      states.add("hover");
      states.add("focus");
      states.add("focus-visible");
      states.add("active");
    }
    if (element.matches("button, input, select, textarea, option, fieldset, [aria-disabled]")) states.add("disabled");
    if (element.matches("details, dialog, select, [aria-expanded], [data-state]")) states.add("open");
    if (element.matches("option, [role='tab'], [role='option'], [aria-selected], [aria-pressed]")) states.add("selected");
    return Array.from(states);
  }

  function walkCssRules(rules: CSSRuleList, visit: (rule: CSSRule) => void): void {
    Array.from(rules).forEach((rule) => {
      visit(rule);
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      if (nested) walkCssRules(nested, visit);
    });
  }

  function forEachAccessibleCssRule(visit: (rule: CSSRule) => void): void {
    Array.from(document.styleSheets).forEach((sheet) => {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        return;
      }
      walkCssRules(rules, visit);
    });
  }

  function readStateDeclarations(element: HTMLElement): StateInfo[] {
    const found = new Map<StyleStateKey, { declarations: Record<string, string>; source: StateInfo["source"]; selectors: string[] }>();
    forEachAccessibleCssRule((rule) => {
      const styleRule = rule as CSSRule & { selectorText?: string; style?: CSSStyleDeclaration };
      if (!styleRule.selectorText || !styleRule.style) return;
      const ruleStyle = styleRule.style;
      const key = selectorMatchesState(styleRule.selectorText, element);
      if (!key) return;
      const declarations = found.get(key)?.declarations || {};
      Array.from(ruleStyle).forEach((property) => {
        if (Object.values(PROPERTY_GROUPS).flat().includes(property)) {
          declarations[property] = ruleStyle.getPropertyValue(property).trim();
        }
      });
      rememberState(found, key, declarations, "css", styleRule.selectorText);
    });

    const attributeStates: StyleStateKey[] = [];
    if (element.matches(":disabled, [disabled], [aria-disabled='true']")) attributeStates.push("disabled");
    if (element.getAttribute("aria-busy") === "true" || element.hasAttribute("data-loading")) attributeStates.push("loading");
    if (element.getAttribute("aria-expanded") === "true" || element.hasAttribute("open") || element.getAttribute("data-state") === "open")
      attributeStates.push("open");
    if (element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-pressed") === "true") attributeStates.push("selected");
    attributeStates.forEach((key) => rememberState(found, key, {}, "attribute"));
    inferredStatesForElement(element).forEach((key) => rememberState(found, key, {}, "inferred"));

    return [
      { key: "current", label: STATE_LABELS.current, declarations: {}, source: "current", selectors: [] },
      ...Array.from(found.entries()).map(([key, detail]) => ({
        key,
        label: STATE_LABELS[key],
        declarations: detail.declarations,
        source: detail.source,
        selectors: detail.selectors,
      })),
    ];
  }

  function collectFontSuggestions(element: HTMLElement): { families: string[]; weights: string[] } {
    const families = new Set(["system-ui", "Arial", "sans-serif"]);
    const weights = new Set(["300", "400", "500", "600", "700", "800"]);
    const addFamilies = (value: string): void => {
      value
        .split(",")
        .map((part) => part.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .forEach((part) => families.add(part));
    };
    addFamilies(getComputedStyle(element).fontFamily);
    Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .slice(0, 160)
      .forEach((node) => addFamilies(getComputedStyle(node).fontFamily));
    try {
      document.fonts?.forEach((face) => {
        addFamilies(face.family);
        if (face.weight) {
          face.weight.split(/\s+/).forEach((weight) => weights.add(weight));
        }
      });
    } catch {
      // Font access is best-effort in injected pages.
    }
    forEachAccessibleCssRule((rule) => {
      const fontRule = rule as CSSRule & { cssText?: string; style?: CSSStyleDeclaration };
      if (!fontRule.style || !fontRule.cssText?.startsWith("@font-face")) return;
      const family = fontRule.style.getPropertyValue("font-family");
      const weight = fontRule.style.getPropertyValue("font-weight");
      if (family) addFamilies(family);
      if (weight) weight.split(/\s+/).forEach((item) => weights.add(item));
    });
    return { families: Array.from(families).slice(0, 16), weights: Array.from(weights).slice(0, 12) };
  }

  function normalizeCssValue(property: string, value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const parts = isColorProperty(property) ? parseCssColorParts(trimmed) : null;
    if (parts) return colorPartsToCss(parts.hex, parts.opacity).toLowerCase();
    return trimmed.replace(/\s+/g, " ").toLowerCase();
  }

  function rememberDesignToken(
    hints: Map<string, Array<{ name: string; value: string }>>,
    key: string,
    token: { name: string; value: string },
  ): void {
    if (!key) return;
    const existing = hints.get(key) || [];
    if (!existing.some((item) => item.name === token.name)) hints.set(key, [...existing, token]);
  }

  function tokenKeysForProperty(property: string): string[] {
    if (isColorProperty(property)) return ["token-type:color"];
    if (property === "font-family") return ["token-type:font-family"];
    if (property === "font-size" || property === "line-height" || property === "letter-spacing" || property === "font-stretch")
      return ["token-type:typography", "token-type:length"];
    if (property === "font-weight") return ["token-type:font-weight"];
    if (property === "box-shadow") return ["token-type:shadow"];
    if (property === "opacity") return ["token-type:opacity"];
    if (property === "transform") return ["token-type:transform"];
    if (/^(padding|margin|gap|row-gap|column-gap)$/.test(property)) return ["token-type:spacing", "token-type:length"];
    if (/^(width|height|min-width|max-width|min-height|max-height)$/.test(property)) return ["token-type:size", "token-type:length"];
    if (property === "border-radius") return ["token-type:radius", "token-type:length"];
    if (property === "border-width" || property === "outline-width" || property === "outline-offset") return ["token-type:border-width", "token-type:length"];
    if (property === "border-style") return ["token-type:border-style"];
    return [];
  }

  function rememberTypedDesignToken(
    hints: Map<string, Array<{ name: string; value: string }>>,
    token: { name: string; value: string },
  ): void {
    const name = token.name.toLowerCase();
    const value = token.value.trim();
    if (parseCssColorParts(value) || /color|accent|surface|background|border|fg|text|muted/i.test(name)) {
      rememberDesignToken(hints, "token-type:color", token);
    }
    if (/^-?\d*\.?\d+(px|rem|em|%|vh|vw|ch|lh)?$/i.test(value) || /space|spacing|gap|size|radius|width|height/i.test(name)) {
      rememberDesignToken(hints, "token-type:length", token);
    }
    if (/space|spacing|gap|padding|margin/i.test(name)) rememberDesignToken(hints, "token-type:spacing", token);
    if (/radius|rounded/i.test(name)) rememberDesignToken(hints, "token-type:radius", token);
    if (/border.*width|stroke/i.test(name)) rememberDesignToken(hints, "token-type:border-width", token);
    if (/^(none|solid|dashed|dotted|double)$/i.test(value) || /border.*style/i.test(name)) {
      rememberDesignToken(hints, "token-type:border-style", token);
    }
    if (/shadow/i.test(name) || /\b\d+px\b.*rgba?\(/i.test(value)) rememberDesignToken(hints, "token-type:shadow", token);
    if (/font.*family|typeface/i.test(name)) rememberDesignToken(hints, "token-type:font-family", token);
    if (/font.*weight|weight/i.test(name) || /^(300|400|500|600|700|800|900)$/.test(value)) {
      rememberDesignToken(hints, "token-type:font-weight", token);
    }
    if (/font.*size|line-height|letter-spacing|type/i.test(name)) rememberDesignToken(hints, "token-type:typography", token);
    if (/opacity|alpha/i.test(name) || /^(0?\.\d+|1|0)$/.test(value)) rememberDesignToken(hints, "token-type:opacity", token);
    if (/transform|scale|translate|rotate/i.test(name)) rememberDesignToken(hints, "token-type:transform", token);
  }

  function collectDesignTokenHints(element: HTMLElement): Map<string, Array<{ name: string; value: string }>> {
    const hints = new Map<string, Array<{ name: string; value: string }>>();
    const nodes: HTMLElement[] = [document.documentElement, document.body].filter(Boolean) as HTMLElement[];
    let current: HTMLElement | null = element;
    while (current) {
      nodes.push(current);
      current = current.parentElement;
    }
    nodes.forEach((node) => {
      const styles = getComputedStyle(node);
      Array.from(styles).forEach((property) => {
        if (!property.startsWith("--")) return;
        const rawValue = styles.getPropertyValue(property).trim();
        if (!rawValue || rawValue.length > 80) return;
        const normalizedGeneric = normalizeCssValue("", rawValue);
        const token = { name: property, value: rawValue };
        rememberDesignToken(hints, normalizedGeneric, token);
        rememberTypedDesignToken(hints, token);
        const color = parseCssColorParts(rawValue);
        if (color) {
          const normalizedColor = colorPartsToCss(color.hex, color.opacity).toLowerCase();
          rememberDesignToken(hints, normalizedColor, token);
        }
      });
    });
    return hints;
  }

  function tokenHintsForProperty(
    hints: Map<string, Array<{ name: string; value: string }>>,
    property: string,
    value: string,
  ): Array<{ name: string; value: string }> {
    const tokens: Array<{ name: string; value: string }> = [];
    const add = (items: Array<{ name: string; value: string }> = []): void => {
      items.forEach((item) => {
        if (!tokens.some((token) => token.name === item.name)) tokens.push(item);
      });
    };
    add(hints.get(normalizeCssValue(property, value)));
    tokenKeysForProperty(property).forEach((key) => add(hints.get(key)));
    return tokens.filter((token) => isTokenValueValidForProperty(property, token.value)).slice(0, 12);
  }

  function textNodePath(root: HTMLElement, target: Node): number[] {
    const path: number[] = [];
    let current: Node | null = target;
    while (current && current !== root) {
      const parent: Node | null = current.parentNode;
      if (!parent) return [];
      path.unshift(Array.from(parent.childNodes).indexOf(current as ChildNode));
      current = parent;
    }
    return path;
  }

  function resolveTextNode(root: HTMLElement, path: number[]): Text | null {
    let current: Node = root;
    for (const index of path) {
      const next = current.childNodes[index];
      if (!next) return null;
      current = next;
    }
    return current.nodeType === Node.TEXT_NODE ? (current as Text) : null;
  }

  function findSafeTextEdit(element: HTMLElement): TextEdit | undefined {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    if (nodes.length !== 1) return undefined;
    return { originalValue: nodes[0].textContent || "", value: nodes[0].textContent || "", path: textNodePath(element, nodes[0]) };
  }

  function sameSafeTextEdit(elements: HTMLElement[]): TextEdit | undefined {
    if (elements.length < 2) return undefined;
    const edits = elements.map(findSafeTextEdit);
    if (edits.some((edit) => !edit)) return undefined;
    const [first] = edits as TextEdit[];
    return edits.every((edit) => edit?.originalValue === first.originalValue && edit.path.join("/") === first.path.join("/"))
      ? { ...first, path: [...first.path] }
      : undefined;
  }

  function inspectElementStyles(element: HTMLElement): StyleInspection {
    const elementPath = selectorForElement(element);
    const computed = getComputedStyle(element);
    const states = readStateDeclarations(element);
    const tokenHints = collectDesignTokenHints(element);
    const rowsByState: Record<string, StyleRow[]> = {};
    const properties = Object.entries(PROPERTY_GROUPS).flatMap(([group, props]) =>
      props.map((property) => ({ group: group as StyleRow["group"], property })),
    );
    states.forEach((styleState) => {
      const rows = properties
        .map(({ group, property }) => {
          const value = styleState.declarations[property] || computed.getPropertyValue(property).trim();
          const inherited = !!getCssPropertyMeta(property)?.inherited;
          const tokenHintsForValue = tokenHintsForProperty(tokenHints, property, value);
          return { group, property, value, inherited, tokenHints: tokenHintsForValue };
        })
        .filter((row) => {
          if (!hasWebrefMetadata(row.property)) return false;
          if (styleState.declarations[row.property]) return true;
          if (
            ["display", "position", "font-family", "font-size", "font-weight", "line-height", "color", "padding", "border-width"].includes(
              row.property,
            )
          )
            return true;
          return meaningfulCssValue(row.value);
        });
      rowsByState[styleState.key] = rows.filter((row) => {
        if (row.property === "background") return false;
        if (["background-image", "background-position", "background-size", "background-repeat"].includes(row.property)) {
          if (styleState.declarations[row.property]) return true;
          return !isDefaultBackgroundValue(row.property, row.value);
        }
        return true;
      });
    });
    const fonts = collectFontSuggestions(element);
    return {
      elementPath,
      states,
      rowsByState,
      editableText: findSafeTextEdit(element),
      fontSuggestions: fonts.families,
      fontWeightSuggestions: fonts.weights,
    };
  }

  function inspectCommonElementStyles(elements: HTMLElement[]): StyleInspection {
    const [first] = elements;
    const firstInspection = inspectElementStyles(first);
    const inspections = elements.map((element) => ({ element, computed: getComputedStyle(element), tokens: collectDesignTokenHints(element) }));
    const rowsByState: Record<string, StyleRow[]> = {};
    const currentRows = firstInspection.rowsByState.current || [];
    rowsByState.current = currentRows
      .map((row) => {
        const values = inspections.map(({ computed }) => computed.getPropertyValue(row.property).trim());
        const firstValue = values[0] || row.value;
        const mixed = values.some((value) => value !== firstValue);
        const tokenHints = inspections.reduce<Array<{ name: string; value: string }>>((tokens, item) => {
          tokenHintsForProperty(item.tokens, row.property, firstValue).forEach((token) => {
            if (!tokens.some((existing) => existing.name === token.name)) tokens.push(token);
          });
          return tokens;
        }, []);
        return {
          ...row,
          value: mixed ? "Mixed" : firstValue,
          tokenHints,
        };
      })
      .filter((row) => {
        if (row.property === "background") return false;
        if (["background-image", "background-position", "background-size", "background-repeat"].includes(row.property)) {
          return !isDefaultBackgroundValue(row.property, row.value) || row.value === "Mixed";
        }
        return true;
      });
    const fonts = collectFontSuggestions(first);
    return {
      elementPath: "multi-select",
      states: [{ key: "current", label: "Current", declarations: {}, source: "current", selectors: [] }],
      rowsByState,
      editableText: sameSafeTextEdit(elements),
      fontSuggestions: fonts.families,
      fontWeightSuggestions: fonts.weights,
    };
  }

  function inspectSharedParentStyles(parent: HTMLElement): StyleInspection {
    const inspection = inspectElementStyles(parent);
    const relationshipProperties = new Set([
      "display",
      "gap",
      "row-gap",
      "column-gap",
      "grid-template-columns",
      "grid-template-rows",
      "grid-auto-flow",
      "justify-content",
      "align-items",
      "align-content",
      "place-items",
      "place-content",
      "flex-direction",
      "flex-wrap",
      "padding",
    ]);
    inspection.rowsByState.current = (inspection.rowsByState.current || []).filter((row) => relationshipProperties.has(row.property));
    inspection.states = [{ key: "current", label: "Current", declarations: {}, source: "current", selectors: [] }];
    inspection.rowsByState = { current: inspection.rowsByState.current };
    inspection.editableText = undefined;
    return inspection;
  }

  function restorePreview(): void {
    const preview = state.preview;
    if (!preview) return;
    preview.animationPreview?.restore();
    stopMotionReadoutLoop();
    preview.pseudoStyle?.remove();
    if (preview.pseudoTargetOriginal !== undefined) {
      if (preview.pseudoTargetOriginal === null) preview.element.removeAttribute(PSEUDO_TARGET_ATTR);
      else preview.element.setAttribute(PSEUDO_TARGET_ATTR, preview.pseudoTargetOriginal);
    }
    preview.styleOriginals.forEach((record, property) => {
      if (record.inlineValue) preview.element.style.setProperty(property, record.inlineValue, record.priority);
      else preview.element.style.removeProperty(property);
    });
    preview.multiStyleOriginals?.forEach((records, element) => {
      records.forEach((record, property) => {
        if (record.inlineValue) element.style.setProperty(property, record.inlineValue, record.priority);
        else element.style.removeProperty(property);
      });
    });
    if (preview.textNode && preview.textOriginal !== undefined) preview.textNode.textContent = preview.textOriginal;
    state.preview = null;
  }

  function restoreCommittedMutation(id: string): void {
    const committed = state.committed.get(id);
    if (!committed) return;
    committed.pseudoStyles.forEach((style) => style.remove());
    if (committed.pseudoTargetOriginal !== undefined) {
      if (committed.pseudoTargetOriginal === null) committed.element.removeAttribute(PSEUDO_TARGET_ATTR);
      else committed.element.setAttribute(PSEUDO_TARGET_ATTR, committed.pseudoTargetOriginal);
    }
    committed.styleOriginals.forEach((record, property) => {
      if (record.inlineValue) committed.element.style.setProperty(property, record.inlineValue, record.priority);
      else committed.element.style.removeProperty(property);
    });
    committed.multiStyleOriginals?.forEach((records, element) => {
      records.forEach((record, property) => {
        if (record.inlineValue) element.style.setProperty(property, record.inlineValue, record.priority);
        else element.style.removeProperty(property);
      });
    });
    if (committed.textNode && committed.textOriginal !== undefined) committed.textNode.textContent = committed.textOriginal;
    committed.animationSessions?.forEach((session) => {
      try {
        session.restore();
      } catch {
        // Committed animation restore should never break teardown.
      }
    });
    committed.animationPausedInfos?.forEach(({ animation, originalPlayState }) => {
      try {
        if (originalPlayState === "running") void animation.play();
        else animation.pause();
      } catch {
        // Page-owned animation may have been removed.
      }
    });
    state.committed.delete(id);
  }

  function restoreAllCommittedMutations(): void {
    Array.from(state.committed.keys()).forEach(restoreCommittedMutation);
  }

  function applyCommittedMutation(annotation: LiveAnnotation): void {
    const multiElements = annotation.isMultiSelect
      ? annotation.targetElements?.length
        ? annotation.targetElements
        : resolveMultiElements(annotation)
      : [];
    const parentElement = annotation.selectionScope === "parent" ? annotation.sharedParent ? resolveElement(annotation.sharedParent.elementPath) : sharedParentForElements(multiElements) : null;
    const element = parentElement || multiElements[0] || annotation.targetElement || resolveElement(annotation.elementPath);
    if (!element) return;
    annotation.targetElement = element;
    if (multiElements.length) annotation.targetElements = multiElements;
    restoreCommittedMutation(annotation.id);
    const committed: CommittedMutation = { element, styleOriginals: new Map(), pseudoStyles: [] };
    const edits = annotation.styleEdits || [];
    let hasStyleContent = false;
    if (multiElements.length && annotation.selectionScope !== "parent") {
      committed.multiStyleOriginals = new Map();
      edits
        .filter((edit) => edit.state === "current" && edit.valid && edit.value.trim() !== edit.originalValue.trim())
        .forEach((edit) => {
          multiElements.forEach((target) => {
            const originals = committed.multiStyleOriginals!.get(target) || new Map<string, PreviewRecord>();
            if (!originals.has(edit.property)) {
              originals.set(edit.property, {
                inlineValue: target.style.getPropertyValue(edit.property),
                priority: target.style.getPropertyPriority(edit.property),
              });
            }
            committed.multiStyleOriginals!.set(target, originals);
            target.style.setProperty(edit.property, edit.value.trim(), "important");
          });
        });
      hasStyleContent = committed.multiStyleOriginals.size > 0;
    } else {
      edits
        .filter((edit) => edit.state === "current" && edit.valid && edit.value.trim() !== edit.originalValue.trim())
        .forEach((edit) => {
          if (!committed.styleOriginals.has(edit.property)) {
            committed.styleOriginals.set(edit.property, {
              inlineValue: element.style.getPropertyValue(edit.property),
              priority: element.style.getPropertyPriority(edit.property),
            });
          }
          element.style.setProperty(edit.property, edit.value.trim(), "important");
        });
      const pseudoGroups = new Map<StyleStateKey, Map<string, string>>();
      edits
        .filter((edit) => edit.state !== "current" && edit.valid && edit.value.trim() !== edit.originalValue.trim())
        .forEach((edit) => {
          const key = edit.state as StyleStateKey;
          if (!pseudoSelectorForState(key)) return;
          const group = pseudoGroups.get(key) || new Map<string, string>();
          group.set(edit.property, edit.value.trim());
          pseudoGroups.set(key, group);
        });
      if (pseudoGroups.size) {
        committed.pseudoTargetOriginal = element.getAttribute(PSEUDO_TARGET_ATTR);
        element.setAttribute(PSEUDO_TARGET_ATTR, annotation.id);
      }
      pseudoGroups.forEach((declarations, key) => {
        const style = pseudoStyleElement(pseudoTargetSelector(annotation.id), key, declarations.entries());
        if (style) committed.pseudoStyles.push(style);
      });
      if (annotation.textEdit) {
        const textNode = resolveTextNode(element, annotation.textEdit.path);
        if (textNode) {
          committed.textNode = textNode;
          committed.textOriginal = textNode.textContent || "";
          textNode.textContent = annotation.textEdit.value;
        }
      }
      hasStyleContent = committed.styleOriginals.size > 0 || committed.pseudoStyles.length > 0 || !!committed.textNode;
    }

    const animationPatches = annotation.animationPatches?.length
      ? annotation.animationPatches
      : annotation.animationPatch
        ? [annotation.animationPatch]
        : [];
    let hasAnimationContent = false;
    if (animationPatches.length) {
      const liveAnimations = discoverElementAnimations(element, element ? selectorForElement(element) : "");
      const sessions = new Map<string, AnimationPreviewSession>();
      const pausedInfos: Array<{ animation: Animation; originalPlayState: AnimationPlayState }> = [];
      animationPatches.forEach((patch) => {
        const targetAnimations = patch.targetSelector ? discoverElementAnimations(element, patch.targetSelector) : liveAnimations;
        const pool = targetAnimations.length ? targetAnimations : liveAnimations;
        const match =
          pool.find((anim) => anim.id === patch.animationId) ||
          pool.find((anim) => !!patch.animationName && anim.animationName === patch.animationName) ||
          pool.find((anim) => !!patch.transitionProperty && anim.transitionProperty === patch.transitionProperty) ||
          pool.find((anim) => patch.animatedProperties?.some((prop) => anim.animatedProperties.includes(prop))) ||
          pool[0];
        if (!match) return;
        if (sessions.has(match.id)) return;
        const session = createAnimationPreviewSession(match);
        session.applyAnnotationPatch(patch);
        try {
          if (match.runtime.playState === "paused") {
            const pausedEntry = state.selectionPausedAnimations.find((entry) => entry.animation === match.runtime);
            if (pausedEntry?.originalPlayState === "running") {
              void match.runtime.play();
              try {
                match.runtime.currentTime = 0;
              } catch {
                // Some runtimes do not allow currentTime reset.
              }
              void match.runtime.play();
            } else {
              void match.runtime.play();
              try {
                match.runtime.currentTime = 0;
              } catch {}
              void match.runtime.play();
            }
          } else if (match.runtime.playState !== "running") {
            void match.runtime.play();
          }
        } catch {
          // Preview play should never break committed apply.
        }
        const pausedEntry = state.selectionPausedAnimations.find((entry) => entry.animation === match.runtime);
        if (pausedEntry) {
          pausedInfos.push({ animation: match.runtime, originalPlayState: pausedEntry.originalPlayState });
        }
        sessions.set(match.id, session);
        hasAnimationContent = true;
      });
      if (sessions.size) committed.animationSessions = sessions;
      if (pausedInfos.length) committed.animationPausedInfos = pausedInfos;
    }

    if (hasStyleContent || hasAnimationContent || committed.pseudoStyles.length || committed.textNode || committed.animationSessions?.size) {
      state.committed.set(annotation.id, committed);
    }
  }

  function commitAnnotationEffects(annotation: LiveAnnotation): void {
    restorePreview();
    applyCommittedMutation(annotation);
  }

  function ensurePreview(element: HTMLElement): PreviewSession {
    if (state.preview?.element === element) return state.preview;
    restorePreview();
    state.preview = { element, styleOriginals: new Map() };
    return state.preview;
  }

  function pseudoSelectorForState(key: StyleStateKey): string | null {
    const pseudos: Partial<Record<StyleStateKey, string>> = {
      hover: ":hover",
      focus: ":focus",
      "focus-visible": ":focus-visible",
      active: ":active",
    };
    return pseudos[key] || null;
  }

  function declarationsCssText(declarations: Iterable<[string, string]>): string {
    const scratch = document.createElement("div");
    Array.from(declarations).forEach(([property, value]) => {
      scratch.style.setProperty(property, value, "important");
    });
    return scratch.getAttribute("style") || "";
  }

  function cssString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function pseudoTargetSelector(value: string): string {
    return `[${PSEUDO_TARGET_ATTR}="${cssString(value)}"]`;
  }

  function pseudoStyleElement(selector: string, key: StyleStateKey, declarations: Iterable<[string, string]>): HTMLStyleElement | null {
    const pseudo = pseudoSelectorForState(key);
    if (!pseudo) return null;
    const cssText = declarationsCssText(declarations);
    if (!cssText) return null;
    const style = document.createElement("style");
    style.textContent = `${selector}${pseudo}{${cssText}}`;
    document.head.appendChild(style);
    return style;
  }

  function syntheticStyleElement(selector: string, declarations: Iterable<[string, string]>): HTMLStyleElement | null {
    const cssText = declarationsCssText(declarations);
    if (!cssText) return null;
    const style = document.createElement("style");
    style.textContent = `${selector}{${cssText}}`;
    document.head.appendChild(style);
    return style;
  }

  function applyPreview(): void {
    const element = state.selectedElement;
    const draft = state.draft;
    if (!element || !draft) {
      restorePreview();
      return;
    }
    const preview = ensurePreview(element);
    preview.pseudoStyle?.remove();
    preview.pseudoStyle = undefined;
    preview.styleOriginals.forEach((record, property) => {
      if (record.inlineValue) element.style.setProperty(property, record.inlineValue, record.priority);
      else element.style.removeProperty(property);
    });
    preview.styleOriginals.clear();
    preview.multiStyleOriginals?.forEach((records, target) => {
      records.forEach((record, property) => {
        if (record.inlineValue) target.style.setProperty(property, record.inlineValue, record.priority);
        else target.style.removeProperty(property);
      });
    });
    preview.multiStyleOriginals?.clear();
    const previewTargets = activeStyleTargets();
    if (previewTargets.length > 1 || (state.selectedElements.length > 1 && state.selectionScope === "parent")) {
      preview.multiStyleOriginals = new Map();
      draft.styleEdits
        .filter((edit) => edit.state === "current" && edit.valid && edit.value.trim() !== edit.originalValue.trim())
        .forEach((edit) => {
          previewTargets.forEach((target) => {
            const originals = preview.multiStyleOriginals!.get(target) || new Map<string, PreviewRecord>();
            if (!originals.has(edit.property)) {
              originals.set(edit.property, {
                inlineValue: target.style.getPropertyValue(edit.property),
                priority: target.style.getPropertyPriority(edit.property),
              });
            }
            preview.multiStyleOriginals!.set(target, originals);
            target.style.setProperty(edit.property, edit.value.trim(), "important");
          });
        });
      applyAnimationPreview();
      return;
    }
    const stateInfo = state.inspection?.states.find((item) => item.key === draft.activeState);
    const pseudo = pseudoSelectorForState(draft.activeState);
    if (pseudo) {
      if (preview.pseudoTargetOriginal === undefined) {
        preview.pseudoTargetOriginal = element.getAttribute(PSEUDO_TARGET_ATTR);
      }
      element.setAttribute(PSEUDO_TARGET_ATTR, "preview");
      const declarations = new Map<string, string>(Object.entries(stateInfo?.declarations || {}));
      draft.styleEdits
        .filter((edit) => edit.state === draft.activeState && edit.valid && edit.value.trim() !== edit.originalValue.trim())
        .forEach((edit) => declarations.set(edit.property, edit.value.trim()));
      if (declarations.size) {
        const style = syntheticStyleElement(pseudoTargetSelector("preview"), declarations.entries());
        if (style) preview.pseudoStyle = style;
      }
    } else if (draft.activeState !== "current") {
      Object.entries(stateInfo?.declarations || {}).forEach(([property, value]) => {
        preview.styleOriginals.set(property, {
          inlineValue: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        });
        element.style.setProperty(property, value, "important");
      });
    }
    if (!pseudo) {
      draft.styleEdits
        .filter((edit) => edit.state === draft.activeState && edit.valid && edit.value.trim() !== edit.originalValue.trim())
        .forEach((edit) => {
          if (!preview.styleOriginals.has(edit.property)) {
            preview.styleOriginals.set(edit.property, {
              inlineValue: element.style.getPropertyValue(edit.property),
              priority: element.style.getPropertyPriority(edit.property),
            });
          }
          element.style.setProperty(edit.property, edit.value.trim(), "important");
        });
    }
    if (draft.textEdit) {
      const textNode = resolveTextNode(element, draft.textEdit.path);
      if (textNode) {
        if (!preview.textNode) {
          preview.textNode = textNode;
          preview.textOriginal = draft.textEdit.originalValue;
        }
        textNode.textContent = draft.textEdit.value;
      }
    }
    applyAnimationPreview();
  }

  function captureBaseInspection(element: HTMLElement): StyleInspection {
    const shield = state.interactionShield;
    const prev = shield?.style.pointerEvents;
    if (shield) shield.style.pointerEvents = "none";
    // Force hover to be recalculated without shield hit-testing
    void element.offsetHeight;
    const inspection = inspectElementStyles(element);
    if (shield && prev !== undefined) shield.style.pointerEvents = prev;
    return inspection;
  }

  function startDraft(element: HTMLElement, annotation?: LiveAnnotation): void {
    restorePreview();
    const styleTargets = activeStyleTargets();
    if (state.selectedElements.length > 1 && state.selectionScope === "individual") {
      state.inspection = inspectCommonElementStyles(state.selectedElements);
    } else if (state.selectedElements.length > 1 && state.selectionScope === "parent" && styleTargets[0]) {
      state.inspection = inspectSharedParentStyles(styleTargets[0]);
    } else {
      const target = styleTargets[0] || element;
      // Capture Default without hover contamination
      state.inspection = captureBaseInspection(target);
    }
    const comment = annotation?.comment || "";
    const intent = annotation?.intent || "fix";
    const styleEdits = annotation?.styleEdits ? annotation.styleEdits.map((edit) => ({ ...edit })) : [];
    const animationTarget = state.selectedElements.length > 1 ? null : styleTargets[0] || element;
    const animationSelector = animationTarget ? selectorForElement(animationTarget) : "";
    state.animations = animationTarget ? discoverElementAnimations(animationTarget, animationSelector) : [];
    const savedAnimationPatches = annotation?.animationPatches || (annotation?.animationPatch ? [annotation.animationPatch] : []);
    const animationEdits = state.animations.map((animation) => editForAnimation(animation, savedAnimationPatches));
    const selectedAnimationId =
      savedAnimationPatches[0] && animationEdits.some((edit) => edit.animationId === savedAnimationPatches[0].animationId)
        ? savedAnimationPatches[0].animationId
        : animationEdits[0]?.animationId || null;
    state.reactContext = state.settings.reactContext ? resolveReactContext(animationTarget || element, annotation) : null;
    const textEdit =
      state.selectedElements.length > 1
        ? undefined
        : annotation?.textEdit
          ? { ...annotation.textEdit, path: [...annotation.textEdit.path] }
          : state.inspection.editableText;
    state.draft = {
      comment,
      initialComment: comment,
      intent,
      initialIntent: intent,
      activeState: "current",
      motionPaneTab: state.motionPaneTab,
      styleEdits,
      initialStyleEdits: styleEdits.map((edit) => ({ ...edit })),
      selectedAnimationId,
      animationEdits,
      initialAnimationEdits: animationEdits.map(cloneAnimationEdit),
      reactContext: state.reactContext ? toJsonSafeReactContext(state.reactContext) : undefined,
      textEdit,
      initialTextValue: textEdit?.value,
      undoStack: [],
    };
    state.unlinkedBoxProperties = {};
    applyPreview();
    if (state.settings.reactContext && state.reactContext && animationTarget) requestReactSource(animationTarget);
  }

  function draftIsDirty(): boolean {
    const draft = state.draft;
    if (!draft) return false;
    if (draft.comment.trim() !== draft.initialComment.trim()) return true;
    if (draft.intent !== draft.initialIntent) return true;
    if ((draft.textEdit?.value || "") !== (draft.initialTextValue || "")) return true;
    if (styleEditsSignature(draft.styleEdits) !== styleEditsSignature(draft.initialStyleEdits)) return true;
    return animationEditSignature(draft.animationEdits) !== animationEditSignature(draft.initialAnimationEdits);
  }

  function draftIsMeaningful(): boolean {
    const draft = state.draft;
    if (!draft) return false;
    if (state.editingId) return draftIsDirty() && !draftHasInvalidChangedStyle() && !draftHasInvalidChangedAnimation();
    if (draft.comment.trim()) return true;
    if (draft.textEdit && draft.textEdit.value !== draft.textEdit.originalValue) return true;
    if (draft.styleEdits.some((edit) => edit.valid && edit.value.trim() !== edit.originalValue.trim())) return true;
    return !!changedAnimationPatch();
  }

  function draftHasInvalidChangedStyle(): boolean {
    const draft = state.draft;
    if (!draft) return false;
    const initial = new Map(draft.initialStyleEdits.map((edit) => [`${edit.state}:${edit.property}`, edit]));
    return draft.styleEdits.some((edit) => {
      const baseline = initial.get(`${edit.state}:${edit.property}`);
      const changedFromOpen =
        !baseline ||
        edit.value.trim() !== baseline.value.trim() ||
        edit.originalValue.trim() !== baseline.originalValue.trim() ||
        edit.valid !== baseline.valid;
      return changedFromOpen && !edit.valid;
    });
  }

  function styleEditsSignature(edits: StyleEdit[]): string {
    return edits
      .map((edit) => [
        edit.state,
        edit.property,
        edit.originalValue.trim(),
        edit.value.trim(),
        edit.valid ? "1" : "0",
      ].join("\u0001"))
      .sort()
      .join("\u0002");
  }

  function changedStyleEdits(): StyleEdit[] {
    return (state.draft?.styleEdits || []).filter(
      (edit) => edit.valid && edit.value.trim() !== edit.originalValue.trim(),
    );
  }

  function cloneAnimationEdit(edit: AnimationEdit): AnimationEdit {
    return {
      ...edit,
      animatedProperties: [...edit.animatedProperties],
      original: { ...edit.original },
      value: { ...edit.value },
    };
  }

  function selectedAnimationEdit(): AnimationEdit | null {
    const draft = state.draft;
    if (!draft?.selectedAnimationId) return null;
    return draft.animationEdits.find((edit) => edit.animationId === draft.selectedAnimationId) || null;
  }

  function selectedAnimation(): NormalizedAnimation | null {
    const selectedId = state.draft?.selectedAnimationId;
    if (!selectedId) return null;
    return state.animations.find((animation) => animation.id === selectedId) || null;
  }

  function draftHasInvalidChangedAnimation(): boolean {
    const draft = state.draft;
    if (!draft) return false;
    return draft.animationEdits.some((edit, index) => {
      const baseline = draft.initialAnimationEdits[index];
      const changedFromOpen = !baseline || animationEditSignature([edit]) !== animationEditSignature([baseline]);
      return changedFromOpen && (!edit.validDuration || !edit.validDelay || !edit.validEasing || !edit.validIterations);
    });
  }

  function changedAnimationPatch(): AnimationPatch | undefined {
    const animation = selectedAnimation();
    const edit = selectedAnimationEdit();
    if (!animation || !edit) return undefined;
    return animationPatchFromEdit(edit, animation.targetSelector) || undefined;
  }

  function changedAnimationPatches(): AnimationPatch[] {
    const draft = state.draft;
    if (!draft) return [];
    return draft.animationEdits
      .map((edit) => {
        const animation = state.animations.find((item) => item.id === edit.animationId);
        return animation ? animationPatchFromEdit(edit, animation.targetSelector) : null;
      })
      .filter((patch): patch is AnimationPatch => patch !== null);
  }

  function ensureAnimationPreview(animation: NormalizedAnimation): AnimationPreviewSession {
    const effectTarget =
      typeof KeyframeEffect !== "undefined" &&
      animation.runtime.effect instanceof KeyframeEffect &&
      animation.runtime.effect.target instanceof HTMLElement
        ? animation.runtime.effect.target
        : null;
    const preview = ensurePreview(state.selectedElement || effectTarget || document.body);
    if (preview.animationPreview?.animationId !== animation.id) {
      preview.animationPreview?.restore();
      preview.animationPreview = createAnimationPreviewSession(animation);
    }
    return preview.animationPreview;
  }

  function applyAnimationPreview(): void {
    const animation = selectedAnimation();
    const patch = changedAnimationPatch();
    if (!animation || !patch) return;
    const session = ensureAnimationPreview(animation);
    session.applyAnnotationPatch(patch);
    const runtime = animation.runtime;
    const wasPausedForInspection = state.selectionPausedAnimations.some((entry) => entry.animation === runtime);
    const shouldReplay = wasPausedForInspection || runtime.playState === "paused";
    if (shouldReplay) {
      try {
        try {
          runtime.currentTime = 0;
        } catch {
          // Some runtimes disallow currentTime mutation.
        }
        void runtime.play();
        if (wasPausedForInspection) {
          try {
            runtime.currentTime = 0;
          } catch {}
          void runtime.play();
        }
      } catch {
        // Preview replay must never break editing.
      }
    } else if (runtime.playState !== "running") {
      try {
        void runtime.play();
      } catch {}
    }
    syncMotionReadout();
  }

  function resolveReactContext(element: HTMLElement, annotation?: LiveAnnotation): ReactContext | null {
    if (!state.settings.reactContext) return null;
    if (state.selectedElements.length > 1) return annotation?.reactContext ? toJsonSafeReactContext(annotation.reactContext) || null : null;
    return reactAdapter.getComponentContext(element) || (annotation?.reactContext ? toJsonSafeReactContext(annotation.reactContext) || null : null);
  }

  function requestReactSource(element: HTMLElement): void {
    if (!state.settings.reactContext) return;
    const context = state.reactContext;
    if (!context || context.source || context.sourceStatus === "resolved") return;
    reactSourceCoordinator.request(element, context, (resolved) => {
      if (state.selectedElement !== element || !state.draft) return;
      state.reactContext = resolved;
      state.draft.reactContext = resolved;
      render();
    });
  }

  function updateStyleEdit(property: string, value: string, sourceValue: string, trackUndo = true, validOverride?: boolean): void {
    const draft = state.draft;
    if (!draft) return;
    const valid = validOverride ?? cssValueStatus(property, value) !== "invalid";
    const existing = draft.styleEdits.find((edit) => edit.state === draft.activeState && edit.property === property);
    const previousValue = existing?.value ?? sourceValue;
    const previousValid = existing?.valid ?? true;
    if (trackUndo && previousValue !== value) {
      draft.undoStack.push({
        kind: "style",
        state: draft.activeState,
        property,
        previousValue,
        previousValid,
        originalValue: sourceValue,
      });
    }
    if (existing) {
      existing.value = value;
      existing.valid = valid;
    } else {
      draft.styleEdits.push({ state: draft.activeState, property, originalValue: sourceValue, value, valid });
    }
    applyPreview();
  }

  function updateTextDraft(value: string, trackUndo = true): void {
    if (!state.draft || !state.inspection?.editableText) return;
    const previousValue = state.draft.textEdit?.value ?? state.inspection.editableText.value;
    if (trackUndo && previousValue !== value) state.draft.undoStack.push({ kind: "text", previousValue });
    state.draft.textEdit = { ...state.inspection.editableText, value };
    applyPreview();
  }

  function undoDraftEdit(): void {
    const draft = state.draft;
    if (!draft) return;
    const entry = draft.undoStack.pop();
    if (!entry) return;
    if (entry.kind === "text") {
      updateTextDraft(entry.previousValue, false);
      const input = state.shadow?.querySelector<HTMLInputElement>("[data-text-edit]");
      if (input) input.value = entry.previousValue;
    } else {
      draft.activeState = entry.state;
      const existing = draft.styleEdits.find((edit) => edit.state === entry.state && edit.property === entry.property);
      if (existing) {
        existing.value = entry.previousValue;
        existing.valid = entry.previousValid;
      } else {
        draft.styleEdits.push({
          state: entry.state,
          property: entry.property,
          originalValue: entry.originalValue,
          value: entry.previousValue,
          valid: entry.previousValid,
        });
      }
      applyPreview();
      render();
    }
    syncComposerSubmitState();
  }

  function clearComposerState(): void {
    reactSourceCoordinator.cancel();
    stopMotionReadoutLoop();
    restoreSelectionPausedAnimations();
    state.selectedElement = null;
    state.selectedElements = [];
    state.selectionScope = "individual";
    state.composerPosition = null;
    state.composerAnchor = null;
    state.editingId = null;
    state.structurePreviewElement = null;
    updateStructurePreviewOverlay();
    state.cssOpen = false;
    state.styleEditorOpening = false;
    state.styleEditorClosing = false;
    state.draft = null;
    state.inspection = null;
    state.animations = [];
    state.reactContext = null;
    state.motionScrub = null;
    state.motionGraphDrag = null;
    state.autocomplete = null;
    state.shiftSelecting = false;
    updateSelectionOverlay();
    resetStylePanelUiState();
  }

  function closeComposerPreservingSelection(): void {
    reactSourceCoordinator.cancel();
    restorePreview();
    stopMotionReadoutLoop();
    restoreSelectionPausedAnimations();
    state.selectedElement = null;
    state.composerPosition = null;
    state.composerAnchor = null;
    state.editingId = null;
    state.cssOpen = false;
    state.styleEditorOpening = false;
    state.styleEditorClosing = false;
    state.draft = null;
    state.inspection = null;
    state.animations = [];
    state.reactContext = null;
    state.motionScrub = null;
    state.motionGraphDrag = null;
    state.autocomplete = null;
    resetStylePanelUiState();
  }

  function requestCancelComposer(): void {
    animateComposerOut(() => {
      restorePreview();
      clearComposerState();
      render();
    });
  }

  function computedStylesList(element: HTMLElement): string {
    return computedStylesSnapshot(element)
      .split("; ")
      .map((row) => {
        const separator = row.indexOf(":");
        if (separator === -1) return `<span class="style-row">${escapeHtml(row)}</span>`;
        const key = row.slice(0, separator);
        const value = row.slice(separator + 1).trim();
        return `<span class="style-row"><span class="style-key">${escapeHtml(key)}</span><span class="style-punc">:</span> <span class="style-value">${escapeHtml(value)}</span></span>`;
      })
      .join("");
  }

  function displayName(element: HTMLElement): string {
    const label =
      element.getAttribute("data-testid") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("name") ||
      element.id;
    return label ? `${element.localName}.${label}` : element.localName;
  }

  const uiLabelCache = new WeakMap<HTMLElement, string | null>();

  function uiElementLabel(
    element: HTMLElement,
    context?: ReactContext | null,
  ): string {
    if (!state.settings.reactContext) return displayName(element);
    if (context?.component) return formatUiLabel(context.component, displayName(element));
    if (uiLabelCache.has(element)) {
      const cached = uiLabelCache.get(element);
      return cached ?? displayName(element);
    }
    try {
      const ctx = reactAdapter.getComponentContext(element);
      const label = ctx?.component ? formatUiLabel(ctx.component, "") : null;
      uiLabelCache.set(element, label);
      return label ?? displayName(element);
    } catch {
      uiLabelCache.set(element, null);
      return displayName(element);
    }
  }

  function isStructureCandidate(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    if (element === document.documentElement || element === document.body) return false;
    if (state.rootHost?.contains(element)) return false;
    if (element.closest(`#${SHIELD_ID}, [data-annote-shield]`)) return false;
    if (element.closest(".clr-picker")) return false;
    const tag = element.tagName.toLowerCase();
    if (["script", "style", "template", "noscript"].includes(tag)) return false;
    return true;
  }

  function structureLabel(element: HTMLElement): { primary: string; secondary: string | null } {
    const domLabel = displayName(element);
    if (state.settings.reactContext) {
      try {
        const ctx = reactAdapter.getComponentContext(element);
        if (ctx?.component) {
          const primary = `<${ctx.component}>`;
          const secondary = domLabel !== element.localName ? domLabel : null;
          // For elements like button.primary, show both; for plain h1, secondary is null
          if (secondary && secondary !== primary) return { primary, secondary };
          return { primary, secondary: domLabel !== primary ? domLabel : null };
        }
      } catch {}
    }
    const text = element.textContent?.trim();
    if (element.children.length === 0 && text && text.length > 0 && text.length <= 24) {
      const truncated = text.slice(0, 20).replace(/\s+/g, " ");
      return { primary: domLabel, secondary: `"${truncated}"` };
    }
    return { primary: domLabel, secondary: null };
  }

  function getStructureData(element: HTMLElement): {
    parent: HTMLElement | null;
    selected: HTMLElement;
    children: HTMLElement[];
    siblings: HTMLElement[];
    childrenTruncated: number;
    siblingsTruncated: number;
  } {
    let parent: HTMLElement | null = element.parentElement;
    while (parent && !isStructureCandidate(parent)) {
      parent = parent.parentElement;
    }
    if (parent === document.documentElement || parent === document.body) parent = null;
    const allChildren = Array.from(element.children).filter(isStructureCandidate) as HTMLElement[];
    const children = allChildren.slice(0, 8);
    const childrenTruncated = Math.max(0, allChildren.length - 8);
    const parentForSiblings = element.parentElement;
    let siblings: HTMLElement[] = [];
    let siblingsTruncated = 0;
    if (parentForSiblings) {
      const allSiblings = Array.from(parentForSiblings.children).filter(
        (el) => el !== element && isStructureCandidate(el as Element),
      ) as HTMLElement[];
      siblings = allSiblings.slice(0, 8);
      siblingsTruncated = Math.max(0, allSiblings.length - 8);
    }
    return { parent, selected: element, children, siblings, childrenTruncated, siblingsTruncated };
  }

  function commentCursor(fill = "#ff7a1a"): string {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="${fill}" stroke="#000000" stroke-width="1.5" d="M5.5 4.5h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.7 3.1c-.7.5-1.6-.1-1.4-1l.7-2.1h-.6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 4, crosshair`;
  }

  function setAnnotatingCursor(enabled: boolean): void {
    if (enabled) {
      if (state.previousCursor === null) state.previousCursor = document.documentElement.style.cursor;
      if (state.previousBodyCursor === null) state.previousBodyCursor = document.body.style.cursor;
      const cursor = commentCursor(state.shiftSelecting ? "#7dd3fc" : "#ff7a1a");
      document.documentElement.style.cursor = cursor;
      document.body.style.cursor = cursor;
      document.documentElement.classList.add("feedback-mark-picking");
      let style = document.getElementById(CURSOR_STYLE_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = CURSOR_STYLE_ID;
        document.head.appendChild(style);
      }
      style.textContent = `
        html.feedback-mark-picking,
        html.feedback-mark-picking body,
        html.feedback-mark-picking body *:not(#${ROOT_ID}):not(#${ROOT_ID} *):not(.clr-picker):not(.clr-picker *) {
          cursor: ${cursor} !important;
        }
        #${ROOT_ID}, #${ROOT_ID} *, .clr-picker, .clr-picker * {
          cursor: auto !important;
        }
      `;
      return;
    }
    document.documentElement.classList.remove("feedback-mark-picking");
    document.getElementById(CURSOR_STYLE_ID)?.remove();
    if (state.previousCursor !== null) {
      document.documentElement.style.cursor = state.previousCursor;
      state.previousCursor = null;
    }
    if (state.previousBodyCursor !== null) {
      document.body.style.cursor = state.previousBodyCursor;
      state.previousBodyCursor = null;
    }
  }

  function makeAnnotation(element: HTMLElement, form: HTMLFormElement): LiveAnnotation {
    const rect = element.getBoundingClientRect();
    const comment = new FormData(form).get("comment")?.toString().trim() || "";
    const intent = (new FormData(form).get("intent")?.toString() || "fix") as Intent;
    const selectedElements = state.selectedElements.length > 1 ? state.selectedElements : [];
    const multiBox = selectedElements.length ? unionBoxForElements(selectedElements) : null;
    const multiSnapshots = selectedElements.map(snapshotForElement);
    const sharedParent = selectedElements.length ? sharedParentForElements(selectedElements) : null;
    const styleTarget = selectedElements.length && state.selectionScope === "parent" && sharedParent ? sharedParent : element;
    const styleRect = styleTarget.getBoundingClientRect();
    const elementNames = multiSnapshots
      .slice(0, 4)
      .map((item) => item.element)
      .join(", ");
    const multiSuffix = multiSnapshots.length > 4 ? ` +${multiSnapshots.length - 4} more` : "";
    const annotation: LiveAnnotation = {
      id: uid("ann"),
      comment,
      elementPath: selectedElements.length ? "multi-select" : selectorForElement(element),
      timestamp: Date.now(),
      x: selectedElements.length && multiBox ? ((multiBox.x - scrollX + multiBox.width / 2) / innerWidth) * 100 : ((styleRect.left + styleRect.width / 2) / innerWidth) * 100,
      y: selectedElements.length && multiBox ? multiBox.y : Math.round(styleRect.top + scrollY),
      element:
        selectedElements.length && state.selectionScope === "parent" && sharedParent
          ? `Shared parent: ${displayName(sharedParent)}`
          : selectedElements.length
            ? `${selectedElements.length} elements: ${elementNames}${multiSuffix}`
            : displayName(element),
      url: location.href,
      boundingBox: multiBox || boxFor(styleTarget),
      cssClasses: Array.from(styleTarget.classList).join(" "),
      computedStyles: computedStylesSnapshot(styleTarget),
      accessibility: accessibilityInfo(styleTarget),
      nearbyText: nearbyText(styleTarget),
      selectedText: getSelection()?.toString().trim().slice(0, 500) || undefined,
      intent,
      kind: "feedback",
      status: "pending",
      thread: [{ id: uid("msg"), role: "human", content: comment, timestamp: Date.now() }],
      fullPath: fullPath(styleTarget),
      selectorAlternatives: selectorAlternativesForElement(styleTarget),
      isMultiSelect: selectedElements.length ? true : undefined,
      selectionScope: selectedElements.length ? state.selectionScope : undefined,
      targets: selectedElements.length
        ? multiSnapshots.map((item) => ({ element: item.element, selector: item.elementPath }))
        : undefined,
      sharedParent: selectedElements.length && sharedParent ? snapshotForElement(sharedParent) : undefined,
      multiSelectElements: selectedElements.length ? multiSnapshots : undefined,
      targetElement: styleTarget,
      targetElements: selectedElements.length ? selectedElements : undefined,
    };
    return annotation;
  }

  function markerPosition(annotation: LiveAnnotation): { left: number; top: number } | null {
    if (annotation.isMultiSelect) {
      const elements = annotation.targetElements?.length ? annotation.targetElements : resolveMultiElements(annotation);
      const visibleElements = elements.filter((element) => element.isConnected && isUsefulElement(element));
      if (visibleElements.length) {
        annotation.targetElements = visibleElements;
        annotation.targetElement = visibleElements[0];
        const box = unionBoxForElements(visibleElements);
        annotation.boundingBox = box;
        if (annotation.status === "detached") annotation.status = "pending";
        return {
          left: Math.min(innerWidth - 36, Math.max(8, box.x - scrollX + box.width - 18)),
          top: Math.min(innerHeight - 36, Math.max(8, box.y - scrollY - 18)),
        };
      }
      if (annotation.boundingBox) {
        return {
          left: Math.min(innerWidth - 36, Math.max(8, annotation.boundingBox.x - scrollX + annotation.boundingBox.width - 18)),
          top: Math.min(innerHeight - 36, Math.max(8, annotation.boundingBox.y - scrollY - 18)),
        };
      }
    }
    const element = annotation.targetElement || resolveElement(annotation.elementPath);
    if (!element) {
      annotation.status = annotation.status === "resolved" || annotation.status === "dismissed" ? annotation.status : "detached";
      annotation.targetElement = undefined;
      return null;
    }
    annotation.targetElement = element;
    if (annotation.status === "detached") annotation.status = "pending";
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      left: Math.min(innerWidth - 36, Math.max(8, rect.right - 18)),
      top: Math.min(innerHeight - 36, Math.max(8, rect.top - 18)),
    };
  }

  function composerPositionFor(element: HTMLElement, anchor = state.composerAnchor): ComposerPosition {
    const rect = element.getBoundingClientRect();
    const width = Math.min(state.cssOpen ? 410 : 340, innerWidth - 24);
    const estimatedHeight = state.cssOpen ? 540 : 72;
    const anchorX = anchor?.x ?? rect.right;
    const anchorY = anchor?.y ?? rect.top;
    const left = anchorX + 16 + width < innerWidth ? anchorX + 16 : anchorX - width - 16;
    const clampedLeft = Math.min(innerWidth - width - 12, Math.max(12, left));
    const spaceBelow = innerHeight - anchorY - 16;
    const opensUp = spaceBelow < estimatedHeight;
    if (opensUp) {
      return {
        left: clampedLeft,
        bottom: Math.max(12, innerHeight - anchorY + 16),
        opensUp: true,
      };
    }
    return {
      left: clampedLeft,
      top: Math.min(innerHeight - estimatedHeight - 12, Math.max(12, anchorY + 16)),
      opensUp: false,
    };
  }

  function clampedToolbarRailTop(value = state.toolbarRailTop, railHeight = TOOLBAR_RAIL_HEIGHT): number {
    return Math.round(Math.min(innerHeight - railHeight - 16, Math.max(24, value)));
  }

  function defaultToolbarRailTop(railHeight = TOOLBAR_RAIL_HEIGHT): number {
    return clampedToolbarRailTop(Number.POSITIVE_INFINITY, railHeight);
  }

  function createRoot(): void {
    const existing = document.getElementById(ROOT_ID);
    if (existing) existing.remove();

    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.setAttribute("data-feedback-mark", "root");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = String(Z_INDEX);
    host.style.pointerEvents = "none";
    document.body.appendChild(host);
    state.rootHost = host;
    state.shadow = host.attachShadow({ mode: "open" });
    state.shadowClickBound = false;
  }

  function ensureInteractionShield(): void {
    const shouldShow = !!(state.active && state.settings.preventPageActions);
    if (shouldShow) {
      if (state.interactionShield?.isConnected) return;
      const shield = document.createElement("div");
      shield.id = SHIELD_ID;
      shield.setAttribute("data-annote-shield", "true");
      shield.style.position = "fixed";
      shield.style.inset = "0";
      shield.style.zIndex = String(Z_INDEX - 1);
      shield.style.pointerEvents = "auto";
      shield.style.background = "transparent";
      shield.style.touchAction = "pan-y";
      // Ensure shield doesn't block scroll - wheel events will bubble
      document.body.appendChild(shield);
      state.interactionShield = shield;
    } else if (state.interactionShield) {
      state.interactionShield.remove();
      state.interactionShield = null;
    }
  }

  function isShieldElement(node: EventTarget | null): boolean {
    return node instanceof HTMLElement && (node.id === SHIELD_ID || node.hasAttribute("data-annote-shield"));
  }

  function isControlUi(node: EventTarget | null): boolean {
    if (!(node instanceof Element)) return false;
    if (node.closest(`#${ROOT_ID}`)) return true;
    if (node.closest(".clr-picker")) return true;
    return false;
  }

  function underlyingElementFromPoint(x: number, y: number): HTMLElement | null {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      if (el instanceof HTMLElement) {
        if (el.id === SHIELD_ID || el.hasAttribute("data-annote-shield")) continue;
        if (el.closest(`#${ROOT_ID}`)) continue;
        if (el.closest(".clr-picker")) continue;
        if (isUsefulElement(el)) return el;
      }
    }
    if (state.interactionShield) {
      const original = state.interactionShield.style.pointerEvents;
      state.interactionShield.style.pointerEvents = "none";
      const found = deepElementFromPoint(x, y);
      state.interactionShield.style.pointerEvents = original;
      return found;
    }
    return deepElementFromPoint(x, y);
  }

  function styles(): string {
    return `
      :host, * { box-sizing: border-box; }
      :host { all: initial; color-scheme: dark; }
      .fm-layer {
        position: fixed;
        inset: 0;
        z-index: ${Z_INDEX};
        pointer-events: none;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #fff;
        --fm-orange: #ff7a1a;
        --fm-orange-strong: #ff8f3d;
        --fm-orange-soft: rgba(255,122,26,.16);
      }
      button, textarea, select, input { font: inherit; font-weight: 400; }
      button, select, label { cursor: pointer; font-weight: 400; }
      .toolbar, .composer, .panel, .tip, .launcher-wrap, .confirm, .confirm-scrim {
        pointer-events: auto;
        background: #1a1a1a;
        border: 0;
        box-shadow: 0 4px 24px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.08);
        border-radius: 8px;
      }
      .toolbar {
        position: fixed;
        right: 0;
        top: var(--fm-rail-top, 260px);
        width: 46px;
        height: ${TOOLBAR_RAIL_HEIGHT}px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px 6px 12px;
        overflow: visible;
        backdrop-filter: blur(18px);
        transform-origin: right center;
        color: rgba(255,255,255,.85);
        border-radius: 14px 0 0 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,.2), 0 4px 16px rgba(0,0,0,.1), 0 0 0 1px rgba(255,255,255,.06);
      }
      .toolbar::before,
      .toolbar::after,
      .launcher-wrap::before,
      .launcher-wrap::after {
        content: "";
        position: absolute;
        right: 0;
        width: 18px;
        height: 18px;
        background: transparent;
        pointer-events: none;
      }
      .toolbar::before,
      .launcher-wrap::before {
        top: -18px;
        right: -1px;
        width: 19px;
        height: 19px;
        background: #1a1a1a;
        -webkit-mask: radial-gradient(circle at 0 0, transparent 18px, #000 19px);
        mask: radial-gradient(circle at 0 0, transparent 18px, #000 19px);
      }
      .toolbar::after,
      .launcher-wrap::after {
        bottom: -18px;
        right: -1px;
        width: 19px;
        height: 19px;
        background: #1a1a1a;
        -webkit-mask: radial-gradient(circle at 0 100%, transparent 18px, #000 19px);
        mask: radial-gradient(circle at 0 100%, transparent 18px, #000 19px);
      }
      .toolbar.opening {
        animation: fm-toolbar-open 400ms cubic-bezier(.19,1,.22,1);
        pointer-events: none;
      }
      .toolbar.closing {
        pointer-events: none;
      }
      .toolbar-controls {
        width: 30px;
        flex: 0 0 auto;
        max-height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        transform-origin: right center;
      }
      .toolbar.opening .toolbar-controls {
        animation: fm-toolbar-controls-open 560ms cubic-bezier(.19,1,.22,1);
      }
      .toolbar.closing .toolbar-controls {
        animation: fm-toolbar-controls-close 220ms cubic-bezier(.4,0,.2,1) forwards;
      }
      .toolbar-divider {
        width: 18px;
        height: 1px;
        margin: 0;
        background: rgba(255,255,255,.18);
      }
      .launcher-wrap {
        position: fixed;
        right: 0;
        top: var(--fm-rail-top, 260px);
        width: 46px;
        height: ${TOOLBAR_COLLAPSED_HEIGHT}px;
        border-radius: 14px 0 0 14px;
        display: grid;
        place-items: center;
        background: #1a1a1a;
        cursor: pointer;
        transition: background 140ms ease, box-shadow 140ms ease;
      }
      .launcher-wrap:hover,
      .launcher-wrap:focus-visible {
        background: #232323;
        box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.24);
        outline: none;
      }
      .launcher-badge {
        position: absolute;
        top: 5px;
        right: 5px;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--fm-orange);
        color: #170700;
        font-size: 10px;
        font-weight: 600;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .launcher-wrap.dragging { cursor: grabbing; }
      .launcher {
        width: 34px;
        height: 34px;
        min-width: 34px;
        min-height: 34px;
        border-radius: 9px;
        background: transparent;
        border-color: transparent;
        color: rgba(255,255,255,.86);
        box-shadow: none;
        pointer-events: none;
      }
      .icon-btn, .btn {
        min-width: 40px;
        min-height: 40px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 8px;
        background: rgba(255,255,255,.05);
        color: rgba(255,255,255,.85);
        padding: 0;
        font-size: 12px;
        font-weight: 400;
        display: inline-grid;
        place-items: center;
        position: relative;
        transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, color 140ms ease;
      }
      .icon-btn:hover, .btn:hover {
        transform: translateY(-1px);
        border-color: rgba(255,255,255,0.28);
        background: rgba(255,255,255,.12);
      }
      .toolbar .icon-btn {
        position: relative;
        width: 30px;
        height: 30px;
        min-width: 30px;
        min-height: 30px;
        border-color: transparent;
        background: transparent;
        border-radius: 7px;
        box-shadow: none;
      }
      .launcher.icon-btn {
        background: transparent;
        border-color: transparent;
        box-shadow: none;
        color: rgba(255,255,255,.86);
      }
      .toolbar .icon-btn:hover {
        border-color: transparent;
        background: rgba(255,255,255,.1);
      }
      .launcher.icon-btn:hover {
        background: rgba(255,255,255,.08);
        border-color: transparent;
      }
      .toolbar .icon-btn.active-control {
        color: var(--fm-orange);
        background: rgba(255,255,255,.1);
      }
      .toolbar .icon-btn.needs-attention::before {
        content: "";
        position: absolute;
        top: 4px;
        right: 4px;
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #f04438;
        box-shadow: 0 0 0 2px #0b0b0c, 0 0 12px rgba(240,68,56,.6);
      }
      .icon-btn:active, .btn:active {
        transform: translateY(0) scale(.96);
      }
      .icon-btn:disabled {
        cursor: default;
        opacity: .32;
      }
      .icon-btn[aria-disabled="true"] {
        cursor: default;
        opacity: .38;
      }
      .icon-btn[aria-disabled="true"]:hover {
        transform: none;
      }
      .icon-btn.danger[aria-disabled="true"]:hover {
        color: rgba(255,255,255,.86);
      }
      .icon-btn:disabled:hover {
        transform: none;
        background: transparent;
        border-color: transparent;
        color: rgba(255,255,255,.86);
      }
      .icon-btn svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .toolbar-group-tooltip {
        position: fixed;
        z-index: 2147483647;
        width: 0;
        min-height: 28px;
        display: grid;
        place-items: center;
        overflow: hidden;
        pointer-events: none;
        visibility: hidden;
        opacity: 0;
        transform: translateY(7px) scale(.92);
        transform-origin: 50% 100%;
        border-radius: 8px;
        background: #1a1a1a;
        color: rgba(255,255,255,.9);
        box-shadow: 0 2px 8px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.12);
        transition:
          left 280ms cubic-bezier(.2,.8,.2,1),
          top 280ms cubic-bezier(.2,.8,.2,1),
          width 280ms cubic-bezier(.2,.8,.2,1),
          opacity 140ms ease,
          transform 220ms cubic-bezier(.2,.8,.2,1),
          visibility 0s linear 140ms;
      }
      .toolbar-group-tooltip.visible {
        visibility: visible;
        opacity: 1;
        transform: translateY(0) scale(1);
        transition:
          left 280ms cubic-bezier(.2,.8,.2,1),
          top 280ms cubic-bezier(.2,.8,.2,1),
          width 280ms cubic-bezier(.2,.8,.2,1),
          opacity 140ms ease,
          transform 220ms cubic-bezier(.2,.8,.2,1),
          visibility 0s;
      }
      .toolbar-tooltip-copy,
      .toolbar-tooltip-sizer {
        white-space: nowrap;
        padding: 6px 10px;
        font-size: 12px;
        line-height: 16px;
        font-weight: 400;
      }
      .toolbar-tooltip-copy {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }
      .toolbar-tooltip-shortcut {
        color: rgba(255,255,255,.42);
        font-size: 11px;
        font-weight: 400;
        letter-spacing: 0.02em;
        flex: 0 0 auto;
      }
      .toolbar-group-tooltip.multiline .toolbar-tooltip-copy {
        white-space: normal;
        font-size: 11px;
        line-height: 14px;
      }
      .toolbar-tooltip-copy.swapping {
        animation: fm-toolbar-tooltip-swap 260ms cubic-bezier(.2,.8,.2,1);
      }
      .toolbar-tooltip-sizer {
        position: fixed;
        left: -10000px;
        top: -10000px;
        visibility: hidden;
        pointer-events: none;
      }
      .btn.primary, .active .pick-toggle, .icon-btn.primary {
        background: var(--fm-orange);
        border-color: var(--fm-orange);
        color: #140700;
      }
      .toolbar .icon-btn.primary,
      .active .toolbar .pick-toggle {
        background: transparent;
        border-color: transparent;
        color: var(--fm-orange);
      }
      .toolbar .icon-btn.primary:hover,
      .active .toolbar .pick-toggle:hover {
        background: rgba(255,255,255,.1);
        border-color: transparent;
      }
      .icon-btn.success {
        background: #12b76a;
        border-color: #12b76a;
        color: #fff;
      }
      .toolbar .icon-btn.success,
      .toolbar .icon-btn.success:hover,
      .toolbar .icon-btn.success:active {
        pointer-events: none;
        cursor: default;
        transform: none;
        background: transparent;
        border-color: transparent;
        color: #12b76a;
      }
      .toolbar .icon-btn.success::after {
        opacity: 0 !important;
        visibility: hidden !important;
        animation: none !important;
      }
      .icon-btn.danger { color: rgba(255,255,255,.86); }
      .icon-btn.danger:hover { color: #f04438; }
      .icon-btn.danger:disabled:hover { color: rgba(255,255,255,.86); }
      .icon-btn.borderless {
        border-color: transparent;
        background: transparent;
        box-shadow: none;
      }
      .icon-btn.borderless:hover {
        border-color: transparent;
        background: rgba(255,255,255,.08);
      }
      .outline {
        position: fixed;
        border: 2px solid var(--fm-orange);
        background: var(--fm-orange-soft);
        border-radius: 4px;
        pointer-events: none;
        box-shadow: 0 0 0 1px #050505, 0 12px 34px rgba(0,0,0,.25);
        transition: left 90ms ease, top 90ms ease, width 90ms ease, height 90ms ease;
      }
      .outline.selection-mode {
        border-color: #7dd3fc;
        background: rgba(125,211,252,.08);
      }
      .structure-preview-outline {
        position: fixed;
        border: 2px solid #7dd3fc;
        background: rgba(125,211,252,.12);
        border-radius: 4px;
        pointer-events: none;
        box-shadow: 0 0 0 1px #050505, 0 12px 34px rgba(0,0,0,.25);
        transition: left 90ms ease, top 90ms ease, width 90ms ease, height 90ms ease;
      }
      .selection-outlines {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }
      .selection-outline {
        position: fixed;
        border: 1px solid rgba(125,211,252,.9);
        background: rgba(125,211,252,.08);
        border-radius: 4px;
        box-shadow: 0 0 0 1px rgba(0,0,0,.58);
      }
      .selection-count {
        position: fixed;
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        background: #7dd3fc;
        color: #031016;
        font-size: 11px;
        font-weight: 500;
        box-shadow: 0 10px 26px rgba(0,0,0,.32);
        pointer-events: none;
      }
      .marker.multi {
        border-radius: 8px;
        background: #7dd3fc;
        color: #031016;
      }
      .label {
        position: fixed;
        transform: translateY(-100%);
        background: var(--fm-orange);
        color: #140700;
        border-radius: 5px;
        padding: 5px 7px;
        font-size: 11px;
        font-weight: 400;
        pointer-events: none;
        max-width: 280px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .label.selection-mode {
        background: #7dd3fc;
        color: #031016;
      }
      .marker {
        position: fixed;
        width: 28px;
        height: 28px;
        border: 2px solid #fff;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background: var(--fm-orange);
        color: #140700;
        font-size: 12px;
        font-weight: 400;
        box-shadow: 0 12px 34px rgba(0,0,0,0.38);
        pointer-events: auto;
        transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
      }
      .marker-count {
        pointer-events: none;
        transition: opacity 120ms ease, transform 120ms ease;
      }
      .marker-edit {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        opacity: 0;
        pointer-events: none;
        transform: scale(.78);
        transition: opacity 120ms ease, transform 120ms ease;
      }
      .marker-edit svg {
        width: 14px;
        height: 14px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .marker:hover { transform: translateY(-2px) scale(1.05); }
      .marker:hover .marker-count,
      .marker:focus-visible .marker-count,
      .marker.editing .marker-count {
        opacity: 0;
        transform: scale(.75);
      }
      .marker:hover .marker-edit,
      .marker:focus-visible .marker-edit,
      .marker.editing .marker-edit {
        opacity: 1;
        transform: scale(1);
      }
      .marker-tip {
        position: absolute;
        opacity: 0;
        visibility: hidden;
        width: max-content;
        min-width: 118px;
        max-width: min(280px, calc(100vw - 48px));
        pointer-events: none;
        background: #1a1a1a;
        border: 0;
        border-radius: 8px;
        padding: 10px;
        box-shadow: 0 4px 24px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.08);
        transition: opacity 130ms ease, transform 130ms ease, visibility 130ms ease;
        text-align: left;
        color: rgba(255,255,255,.85);
      }
      .marker-tip.tip-left {
        right: calc(100% + 10px);
      }
      .marker-tip.tip-right {
        left: calc(100% + 10px);
        transform: translateY(-50%) translateX(4px);
      }
      .marker-tip.tip-middle {
        top: 50%;
        transform: translateY(-50%) translateX(-4px);
      }
      .marker-tip.tip-above {
        bottom: 0;
        transform: translateY(0) translateX(-4px);
      }
      .marker-tip.tip-below {
        top: 0;
        transform: translateY(0) translateX(-4px);
      }
      .marker-tip.tip-right.tip-middle {
        transform: translateY(-50%) translateX(4px);
      }
      .marker-tip.tip-right.tip-above,
      .marker-tip.tip-right.tip-below {
        transform: translateY(0) translateX(4px);
      }
      .marker:hover .marker-tip,
      .marker:focus-visible .marker-tip {
        opacity: 1;
        visibility: visible;
        transform: translateY(-50%) translateX(0);
      }
      .marker:hover .marker-tip.tip-above,
      .marker:hover .marker-tip.tip-below,
      .marker:focus-visible .marker-tip.tip-above,
      .marker:focus-visible .marker-tip.tip-below {
        transform: translateY(0) translateX(0);
      }
      .marker-tip-title { display: block; max-width: 100%; overflow-wrap: anywhere; font-size: 11px; margin-bottom: 5px; color: #fff; font-weight: 400; }
      .marker-tip-copy { display: block; max-width: 100%; margin: 0; overflow-wrap: anywhere; font-size: 12px; line-height: 1.4; color: rgba(255,255,255,.85); }
      .composer {
        position: fixed;
        width: min(340px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        overflow: hidden;
        padding: 8px 10px;
        display: grid;
        gap: 6px;
        transform-origin: top left;
        color: #fff;
        border-radius: 14px;
      }
      .composer.entering {
        animation: fm-compose 220ms cubic-bezier(.2,.8,.2,1);
      }
      .composer.expanded {
        width: min(410px, calc(100vw - 24px));
        border-radius: 14px;
        padding: 10px;
        gap: 8px;
        grid-template-rows: auto minmax(0, 1fr) auto;
      }
      .composer.opens-up {
        transform-origin: bottom left;
      }
      .composer.entering.opens-up {
        animation-name: fm-compose-up;
      }
      .composer.shake {
        animation: fm-shake 260ms ease;
      }
      .composer.exiting {
        animation: fm-compose-out 150ms ease-in forwards;
        pointer-events: none;
      }
      .composer.positioning {
        will-change: transform;
      }
      .composer h2, .panel h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 400;
        line-height: 1.25;
      }
      .meta {
        color: rgba(255,255,255,.66);
        font-size: 11px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .composer-context {
        display: grid;
        gap: 0;
        min-height: 0;
      }
      .composer-meta-row {
        min-height: 26px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .composer-meta-row .meta {
        min-width: 0;
        flex: 1 1 auto;
      }
      .css-toggle {
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        min-width: 28px;
        min-height: 28px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: rgba(255,255,255,.45);
        box-shadow: none;
      }
      .css-toggle:hover,
      .css-toggle.open {
        border-color: transparent;
        background: rgba(255,255,255,.08);
        color: rgba(255,255,255,.9);
      }
      .css-toggle svg {
        width: 14px;
        height: 14px;
        transition: transform 240ms cubic-bezier(.2,.8,.2,1);
      }
      .css-toggle.open svg { transform: rotate(90deg); }
      .css-toggle.closing svg { transform: rotate(0); }
      textarea {
        width: 100%;
        min-height: 56px;
        resize: vertical;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 6px;
        padding: 8px;
        color: #fff;
        background: rgba(255,255,255,.05);
        font-size: 11px;
        line-height: 1.45;
      }
      input {
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 6px;
        color: #fff;
        background: rgba(255,255,255,.05);
      }
      .composer textarea { resize: none; }
      .composer-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 36px;
      }
      .composer-bar textarea {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 32px;
        max-height: 92px;
        padding: 7px 8px;
        transition: flex-basis 220ms cubic-bezier(.2,.8,.2,1), min-height 220ms cubic-bezier(.2,.8,.2,1);
      }
      .submit-icon,
      .mic-affordance {
        flex: 0 0 30px;
        width: 30px;
        min-width: 30px;
        height: 30px;
        min-height: 30px;
        opacity: 1;
        transform: scale(1);
        transition:
          opacity 180ms ease,
          transform 220ms cubic-bezier(.2,.8,.2,1),
          flex-basis 220ms cubic-bezier(.2,.8,.2,1),
          width 220ms cubic-bezier(.2,.8,.2,1),
          min-width 220ms cubic-bezier(.2,.8,.2,1);
      }
      .composer.expanded .submit-icon {
        flex-basis: 0;
        width: 0;
        min-width: 0;
        opacity: 0;
        transform: scale(.82);
        overflow: hidden;
        pointer-events: none;
        border-width: 0;
      }
      .mic-affordance {
        pointer-events: none;
        color: rgba(255,255,255,.42);
        background: transparent;
        border-color: transparent;
      }
      textarea:focus, select:focus, input:focus {
        outline: none;
        border-color: rgba(255,122,26,.82);
        box-shadow: inset 0 0 0 1px rgba(255,122,26,.42);
      }
      textarea::placeholder { color: rgba(255,255,255,.55); }
      .row { display: flex; gap: 8px; align-items: center; }
      .row > .text-btn { flex: 1; }
      .composer-actions {
        gap: 6px;
        justify-content: flex-end;
        margin: 8px -10px -10px;
        padding: 8px 10px 10px;
        border-top: 1px solid rgba(255,255,255,.1);
      }
      .composer-actions .text-btn {
        flex: 0 0 auto;
      }
      .composer-action-spacer {
        flex: 1 1 auto;
      }
      .delete-current {
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        min-width: 28px;
        min-height: 28px;
        border: 0;
        background: transparent;
        color: rgba(255,255,255,.4);
        box-shadow: none;
      }
      .delete-current:hover {
        border-color: transparent;
        background: rgba(255,255,255,.08);
      }
      .text-btn {
        min-height: 28px;
        border: 0;
        border-radius: 999px;
        background: rgba(255,255,255,.05);
        color: rgba(255,255,255,.9);
        font-size: 11px;
        font-weight: 400;
        padding: 0 12px;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
      }
      .text-btn:hover { border-color: rgba(255,122,26,.5); }
      .text-btn.ghost {
        border-color: transparent;
        background: transparent;
        color: rgba(255,255,255,.66);
      }
      .text-btn.ghost:hover {
        border-color: transparent;
        background: rgba(255,255,255,.08);
      }
      .text-btn.primary {
        background: var(--fm-orange);
        border-color: var(--fm-orange);
        color: #140700;
      }
      .text-btn:disabled {
        cursor: default;
        opacity: .38;
        transform: none;
      }
      .text-btn:disabled:hover {
        border-color: transparent;
        background: transparent;
        transform: none;
      }
      .text-btn.compact {
        min-height: 28px;
        font-size: 11px;
      }
      .intent-field {
        display: grid;
        gap: 7px;
        margin-top: 8px;
      }
      .field-label {
        color: rgba(255,255,255,.66);
        font-size: 11px;
      }
      .intent-radios {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .intent-radios label { flex: 0 0 auto; }
      .intent-radios input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .intent-radios span {
        min-height: 28px;
        border: 1px solid transparent;
        border-radius: 7px;
        display: grid;
        place-items: center;
        padding: 0 10px;
        color: rgba(255,255,255,.5);
        background: transparent;
        font-size: 11px;
        font-weight: 400;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease;
      }
      .intent-radios label:hover span {
        transform: translateY(-1px);
        border-color: transparent;
        background: rgba(255,255,255,.08);
      }
      .intent-radios input:checked + span {
        background: #fff;
        border-color: #fff;
        color: #050505;
      }
      .style-details {
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 7px;
        background: rgba(255,255,255,.05);
        overflow: hidden;
        max-height: 0;
        margin-top: 0;
        opacity: 0;
        transform: translateY(-4px) scale(.985);
      }
      .style-details.open {
        max-height: min(450px, calc(100vh - 156px));
        margin-top: 8px;
        opacity: 1;
        border-color: rgba(255,255,255,.08);
        transform: translateY(0) scale(1);
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
      }
      .style-details.opening {
        animation: fm-style-expand 220ms cubic-bezier(.2,.8,.2,1);
      }
      .style-details.closing {
        max-height: min(450px, calc(100vh - 156px));
        margin-top: 8px;
        opacity: 1;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        animation: fm-style-collapse 180ms cubic-bezier(.4,0,.2,1) forwards;
      }
      .state-tabs {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        gap: 4px;
        overflow-x: auto;
        padding: 7px;
        background: #222;
        white-space: nowrap;
      }
      .state-tab {
        flex: 0 0 auto;
        min-height: 26px;
        border: 0;
        border-radius: 6px;
        padding: 0 9px;
        color: rgba(255,255,255,.58);
        background: transparent;
        font-size: 11px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .state-tab:hover,
      .state-tab.active {
        color: #fff;
        background: rgba(255,255,255,.1);
      }
      .state-tab.active {
        box-shadow: none;
      }
      .state-source-dot {
        flex: 0 0 auto;
        width: 4px;
        height: 4px;
        border-radius: 999px;
        background: rgba(255,255,255,.38);
      }
      .state-tab.source-css .state-source-dot { background: #7dd3fc; }
      .state-tab.source-attribute .state-source-dot { background: #32d583; }
      .state-tab.source-inferred .state-source-dot { background: rgba(255,255,255,.32); }
      .state-count {
        min-width: 16px;
        height: 16px;
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        padding: 0 5px;
        background: rgba(255,255,255,.08);
        color: rgba(255,255,255,.62);
        font-size: 9px;
      }
      .state-tab.active .state-count {
        background: rgba(255,255,255,.14);
        color: #fff;
      }
      .style-identity {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        color: rgba(255,255,255,.74);
        font-size: 11px;
        overflow: hidden;
      }
      .identity-label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .scope-toggle {
        margin-left: auto;
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border-radius: 6px;
        background: rgba(255,255,255,.06);
      }
      .scope-option {
        min-height: 22px;
        border: 0;
        border-radius: 4px;
        padding: 0 7px;
        background: transparent;
        color: rgba(255,255,255,.58);
        font: inherit;
        font-size: 10px;
        white-space: nowrap;
      }
      .scope-option.active {
        background: #7dd3fc;
        color: #031016;
      }
      .drag-handle,
      .link-toggle {
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        min-width: 22px;
        min-height: 22px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: rgba(255,255,255,.44);
        padding: 0;
      }
      .drag-handle { cursor: grab; }
      .drag-handle:active { cursor: grabbing; }
      .drag-handle:hover,
      .link-toggle:hover,
      .link-toggle.linked {
        background: rgba(255,255,255,.08);
        color: rgba(255,255,255,.9);
      }
      .drag-handle svg,
      .link-toggle svg {
        width: 13px;
        height: 13px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .style-grid-wrap {
        overflow: auto;
        min-height: 0;
      }
      .style-grid {
        display: grid;
        gap: 3px;
        padding: 8px 9px 9px;
      }
      .style-grid.token-menu-open {
        padding-bottom: 190px;
      }
      .style-grid.autocomplete-open {
        padding-bottom: 150px;
      }
      .style-grid h3 {
        margin: 8px 0 2px;
        padding-top: 8px;
        border-top: 1px solid rgba(255,255,255,.08);
        color: rgba(255,255,255,.45);
        font-size: 10px;
        font-weight: 400;
        text-transform: uppercase;
      }
      .style-grid h3:first-of-type {
        margin-top: 0;
        padding-top: 0;
        border-top: 0;
      }
      .style-row {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 10px;
        line-height: 1.5;
      }
      .css-row,
      .text-edit-row {
        display: grid;
        grid-template-columns: minmax(86px, .38fr) minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        min-height: 28px;
        font-size: 11px;
      }
      .css-name {
        position: relative;
        padding-right: 12px;
        color: rgba(255,255,255,.55);
        display: flex;
        align-items: center;
        gap: 5px;
        overflow: hidden;
      }
      .css-name > span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .css-value-wrap {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        min-width: 0;
      }
      .css-row.changed .css-name::after {
        content: "";
        flex: 0 0 auto;
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: var(--fm-orange);
      }
      .motion-section {
        display: grid;
        gap: 10px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,.08);
        font-size: 11px;
      }
      .react-section {
        display: grid;
        gap: 7px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,.08);
        font-size: 11px;
      }
      .react-header,
      .react-component {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
      }
      .react-header {
        justify-content: space-between;
      }
      .react-header h3 {
        margin: 0;
        padding: 0;
        border: 0;
      }
      .react-header span,
      .react-source,
      .react-stack li span {
        color: rgba(255,255,255,.46);
        font-size: 10px;
      }
      .react-component strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(255,255,255,.86);
        font-size: 12px;
        font-weight: 500;
      }
      .react-chip {
        flex: 0 0 auto;
        border-radius: 999px;
        padding: 2px 6px;
        background: rgba(97,218,251,.12);
        color: rgba(166,236,255,.92);
        box-shadow: inset 0 0 0 1px rgba(97,218,251,.18);
        font-size: 10px;
      }
      .react-stack {
        display: grid;
        gap: 3px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .react-stack li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-width: 0;
        color: rgba(255,255,255,.72);
      }
      .react-stack li::before {
        content: "";
        flex: 0 0 auto;
        width: 4px;
        height: 4px;
        border-radius: 999px;
        background: rgba(97,218,251,.55);
      }
      .react-stack li span {
        margin-left: auto;
      }
      .react-source {
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .motion-header,
      .motion-controls,
      .motion-meta,
      .motion-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .motion-header {
        justify-content: space-between;
      }
      .motion-header h3 {
        margin: 0;
        padding: 0;
        border: 0;
      }
      .motion-header span,
      .motion-meta,
      .motion-keyframes {
        color: rgba(255,255,255,.46);
        font-size: 10px;
      }
      .motion-meta {
        justify-content: space-between;
      }
      .motion-meta span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .motion-picker {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        min-width: 0;
        flex: 0 1 auto;
      }
      .motion-title-row {
        justify-content: flex-start;
        gap: 3px;
        width: min(100%, 246px);
      }
      .motion-chip,
      .motion-button,
      .motion-pane-tab {
        height: 24px;
        border: 0;
        border-radius: 6px;
        padding: 0 8px;
        background: rgba(255,255,255,.08);
        color: rgba(255,255,255,.72);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
        cursor: pointer;
      }
      .motion-chip.active,
      .motion-button:focus-visible,
      .motion-pane-tab.active {
        background: rgba(255,255,255,.13);
        color: #fff;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.12);
      }
      .motion-chip {
        max-width: 170px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .motion-icon-controls {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      .motion-icon-button {
        width: 26px;
        height: 26px;
        min-width: 26px;
        min-height: 26px;
        border-radius: 6px;
        color: rgba(255,255,255,.72);
      }
      .motion-pane {
        display: grid;
        gap: 7px;
        border-radius: 8px;
      }
      .motion-block {
        display: grid;
        grid-template-columns: minmax(86px, .38fr) minmax(0, 1fr);
        align-items: start;
        gap: 8px;
        min-width: 0;
      }
      .motion-block-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(255,255,255,.55);
        font-size: 11px;
        font-weight: 400;
        line-height: 26px;
      }
      .motion-graph {
        position: relative;
        width: 100%;
        height: 148px;
        border-radius: 8px;
        overflow: hidden;
        background: rgba(255,255,255,.055);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
      }
      .motion-graph svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .motion-graph-grid {
        stroke: rgba(255,255,255,.095);
        stroke-width: 1;
      }
      .motion-graph-guide {
        stroke: rgba(255,255,255,.16);
        stroke-width: 1;
        stroke-dasharray: 6 6;
      }
      .motion-graph-curve {
        fill: none;
        stroke: rgba(255,255,255,.7);
        stroke-width: 2;
        stroke-linecap: round;
      }
      .motion-graph-handle {
        fill: rgba(255,255,255,.84);
        stroke: rgba(0,0,0,.38);
        stroke-width: 1;
        cursor: grab;
        pointer-events: auto;
      }
      .motion-graph-handle:active {
        cursor: grabbing;
      }
      .motion-tabs {
        position: relative;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 2px;
        border-radius: 7px;
        background: rgba(255,255,255,.055);
        padding: 2px;
        overflow: hidden;
      }
      .motion-tab-indicator {
        position: absolute;
        top: 2px;
        bottom: 2px;
        left: 2px;
        width: calc((100% - 4px) / 3);
        border-radius: 5px;
        background: rgba(255,255,255,.13);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.04);
        transform: translateX(calc(var(--motion-tab-index, 0) * 100%));
        transition: transform 260ms cubic-bezier(.2, .8, .2, 1), width 260ms cubic-bezier(.2, .8, .2, 1);
        pointer-events: none;
      }
      .motion-pane-tab {
        position: relative;
        z-index: 1;
        width: 100%;
        height: 24px;
        border-radius: 5px;
        background: transparent;
        box-shadow: none;
        color: rgba(255,255,255,.62);
        transition: color 160ms ease;
      }
      .motion-pane-tab.active {
        color: #fff;
      }
      .motion-tab-panel {
        display: grid;
        gap: 5px;
        min-width: 0;
        overflow: hidden;
        transform-origin: top;
        animation: motion-panel-enter 180ms cubic-bezier(.2,.8,.2,1);
      }
      .motion-tab-panel.exiting {
        opacity: .55;
        transform: translateY(3px) scaleY(.985);
        transition: opacity 160ms ease, transform 160ms ease;
      }
      @keyframes motion-panel-enter {
        from {
          opacity: .62;
          transform: translateY(-3px) scaleY(.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scaleY(1);
        }
      }
      .motion-scrubber {
        position: relative;
        width: 100%;
        height: 28px;
        border-radius: 999px;
        background: transparent;
        box-shadow: none;
        cursor: ew-resize;
        --motion-progress: 0%;
      }
      .motion-ticks {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0;
        pointer-events: none;
      }
      .motion-tick {
        width: 1px;
        height: 10px;
        border-radius: 999px;
        background: rgba(255,255,255,.2);
        transition: height 160ms cubic-bezier(.2,.8,.2,1), background 120ms ease, opacity 120ms ease;
      }
      .motion-tick.filled {
        background: rgba(255,255,255,.9);
      }
      .motion-tick.active {
        height: 18px;
        background: rgba(255,255,255,.98);
      }
      .motion-scrubber:hover .motion-tick.active,
      .motion-scrubber.scrubbing .motion-tick.active {
        height: 26px;
      }
      .motion-timeline-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 46px;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .motion-progress {
        display: none;
      }
      .motion-tick-strip {
        display: none;
      }
      .motion-thumb {
        display: none;
      }
      .motion-timeline-time {
        color: rgba(255,255,255,.56);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .motion-fields {
        display: grid;
        gap: 5px;
      }
      .motion-field {
        position: relative;
        display: grid;
        grid-template-columns: minmax(64px, .62fr) minmax(72px, 1fr) minmax(62px, .58fr);
        align-items: center;
        gap: 7px;
        min-width: 0;
        min-height: 28px;
      }
      .motion-field.input-only .motion-input {
        grid-column: 2 / 4;
      }
      .motion-label {
        position: relative;
        z-index: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(255,255,255,.54);
        font-size: 12px;
        font-family: inherit;
        font-weight: 400;
      }
      .motion-input {
        position: relative;
        z-index: 3;
        width: 100%;
        min-width: 0;
        height: 26px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 6px;
        padding: 0 7px;
        background: rgba(255,255,255,.05);
        color: rgba(255,255,255,.88);
        box-shadow: none;
        text-align: left;
        font-variant-numeric: tabular-nums;
        font-family: inherit;
      }
      .motion-input:focus {
        outline: none;
        background: rgba(255,255,255,.13);
        box-shadow: 0 0 0 1px rgba(255,255,255,.16);
      }
      .motion-slider {
        position: relative;
        min-width: 0;
        height: 28px;
        display: flex;
        align-items: center;
      }
      .motion-range-fill {
        position: absolute;
        left: 0;
        top: 50%;
        width: var(--motion-fill, 0%);
        height: 3px;
        border-radius: 999px;
        background: rgba(255,255,255,.54);
        transform: translateY(-50%);
        pointer-events: none;
      }
      .motion-range {
        position: relative;
        z-index: 2;
        width: 100%;
        height: 28px;
        border: 0;
        box-shadow: none;
        outline: none;
        margin: 0;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        cursor: ew-resize;
      }
      .motion-range::-webkit-slider-runnable-track {
        height: 3px;
        border-radius: 999px;
        background: rgba(255,255,255,.12);
      }
      .motion-range::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        width: 16px;
        height: 22px;
        margin-top: -9px;
        border: 0;
        border-radius: 4px;
        background: rgba(205,208,218,.92);
        box-shadow: 0 1px 2px rgba(0,0,0,.36);
      }
      .motion-range::-moz-range-track {
        height: 3px;
        border-radius: 999px;
        background: rgba(255,255,255,.12);
      }
      .motion-range::-moz-range-progress {
        height: 3px;
        border-radius: 999px;
        background: rgba(255,255,255,.54);
      }
      .motion-range::-moz-range-thumb {
        width: 16px;
        height: 22px;
        border: 0;
        border-radius: 4px;
        background: rgba(205,208,218,.92);
        box-shadow: 0 1px 2px rgba(0,0,0,.36);
      }
      .motion-field.invalid .motion-input {
        color: #f97066;
      }
      .motion-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px;
      }
      .motion-metric {
        min-width: 0;
        display: grid;
        gap: 2px;
        border-radius: 6px;
        background: rgba(255,255,255,.045);
        padding: 6px 7px;
      }
      .motion-metric span {
        color: rgba(255,255,255,.48);
        font-size: 9px;
        text-transform: uppercase;
      }
      .motion-metric strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(255,255,255,.78);
        font-size: 11px;
        font-weight: 400;
      }
      .tokenized-control {
        position: relative;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 5px;
        justify-self: end;
        width: 100%;
      }
      .token-normal-control {
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex: 1 1 auto;
      }
      .token-pill {
        min-width: 0;
        max-width: min(100%, 206px);
        height: 26px;
        display: flex;
        align-items: center;
        gap: 7px;
        border-radius: 6px;
        padding: 0 8px;
        background: rgba(14,165,233,.16);
        color: #7dd3fc;
        box-shadow: inset 0 0 0 1px rgba(125,211,252,.28);
      }
      .token-pill > span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
      }
      .token-pill small {
        flex: 0 0 auto;
        max-width: 70px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(224,242,254,.62);
        font-size: 9px;
      }
      .token-menu-anchor {
        position: relative;
        flex: 0 0 auto;
      }
      .token-button {
        width: 26px;
        height: 26px;
        min-width: 26px;
        min-height: 26px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 6px;
        padding: 0;
        background: rgba(255,255,255,.08);
        color: rgba(255,255,255,.84);
      }
      .token-button.bound {
        background: rgba(14,165,233,.16);
        color: #7dd3fc;
      }
      .token-button:hover,
      .token-button[aria-expanded="true"] {
        background: rgba(255,255,255,.14);
        color: #fff;
      }
      .token-button.bound:hover {
        background: rgba(14,165,233,.24);
        color: #e0f2fe;
      }
      .token-button svg {
        width: 13px;
        height: 13px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .token-menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 45;
        width: min(276px, calc(100vw - 42px));
        display: grid;
        gap: 5px;
        max-height: 240px;
        overflow: auto;
        padding: 7px;
        border-radius: 7px;
        background: #101010;
        box-shadow: 0 8px 28px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.1);
      }
      .token-menu-group {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .token-menu-group {
        color: rgba(255,255,255,.45);
        font-size: 9px;
        text-transform: uppercase;
      }
      .token-menu-group {
        padding: 2px 2px 0;
      }
      .token-option {
        min-width: 0;
        min-height: 30px;
        display: flex;
        align-items: center;
        gap: 7px;
        border: 0;
        border-radius: 5px;
        padding: 4px 7px;
        background: transparent;
        color: rgba(255,255,255,.8);
        font-size: 10px;
      }
      .token-option:hover,
      .token-option.current {
        background: rgba(125,211,252,.14);
        color: #fff;
      }
      .token-preview {
        flex: 0 0 12px;
        width: 12px;
        height: 12px;
        overflow: hidden;
        border-radius: 999px;
        box-shadow: 0 0 0 1px rgba(255,255,255,.3);
      }
      .token-copy {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 7px;
      }
      .token-name {
        min-width: 0;
        flex: 0 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .token-value {
        min-width: 0;
        flex: 0 2 auto;
        max-width: 104px;
        color: rgba(255,255,255,.48);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 9px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .token-current {
        flex: 0 0 auto;
        color: #7dd3fc;
      }
      .token-current svg {
        width: 13px;
        height: 13px;
      }
      .css-input,
      .text-edit-input {
        width: auto;
        min-width: 0;
        height: 26px;
        padding: 0 7px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        text-align: left;
      }
      .font-family-input {
        font-family: inherit;
      }
      .text-edit-input {
        width: min(100%, max(150px, var(--fm-text-input-width, 150px)));
        font-family: inherit;
        justify-self: end;
      }
      .font-control {
        position: relative;
      }
      .property-font-weight .font-control {
        width: 82px;
        justify-self: end;
      }
      .property-font-family .font-control {
        width: min(100%, 176px);
        justify-self: end;
      }
      .font-trigger {
        width: 100%;
        min-width: 0;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 6px;
        color: #fff;
        background: rgba(255,255,255,.05);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 11px;
        padding: 0 7px;
        text-align: left;
      }
      .font-trigger span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .font-trigger svg {
        width: 12px;
        height: 12px;
        flex: 0 0 12px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .font-menu {
        position: absolute;
        top: calc(100% + 3px);
        left: 0;
        right: 0;
        z-index: 6;
        display: grid;
        max-height: 172px;
        overflow: auto;
        padding: 4px;
        border-radius: 7px;
        background: #101010;
        box-shadow: 0 8px 28px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.1);
      }
      .font-option {
        min-height: 24px;
        border: 0;
        border-radius: 5px;
        padding: 0 7px;
        background: transparent;
        color: rgba(255,255,255,.74);
        font-size: 11px;
        text-align: left;
      }
      .font-option:hover,
      .font-option.active {
        background: rgba(255,255,255,.1);
        color: #fff;
      }
      .segmented-control,
      .stepper-control,
      .font-control,
      .color-control,
      .compound-control,
      .box-control,
      .padding-control {
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        justify-self: end;
      }
      .segmented-control {
        flex-wrap: wrap;
      }
      .segment,
      .stepper-btn {
        min-height: 24px;
        border: 1px solid transparent;
        border-radius: 5px;
        background: rgba(255,255,255,.05);
        color: rgba(255,255,255,.62);
        font-size: 10px;
        line-height: 1;
        padding: 0 7px;
        transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
      }
      .segment:hover,
      .stepper-btn:hover {
        background: rgba(255,255,255,.1);
        color: rgba(255,255,255,.9);
      }
      .segment.active {
        background: #fff;
        border-color: #fff;
        color: #111;
      }
      .icon-segment {
        width: 26px;
        min-width: 26px;
        padding: 0;
      }
      .icon-segment svg {
        width: 13px;
        height: 13px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .link-state {
        display: inline-grid;
        place-items: center;
        min-height: 22px;
        border-radius: 999px;
        padding: 0 7px;
        background: rgba(255,255,255,.06);
        color: rgba(255,255,255,.66);
        font-size: 10px;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .compact-custom {
        flex: 1 1 118px;
      }
      .number-field {
        position: relative;
        display: block;
        min-width: 0;
        flex: 0 1 116px;
      }
      .control-number .number-field { max-width: 116px; }
      .control-compound .number-field { max-width: 128px; }
      .property-font-stretch .css-input,
      .property-flex-grow .css-input,
      .property-flex-shrink .css-input,
      .property-opacity .number-field {
        max-width: 92px;
      }
      .number-field .css-input {
        width: 100%;
        padding-right: 24px;
      }
      .stepper-stack {
        position: absolute;
        right: 2px;
        top: 2px;
        bottom: 2px;
        display: grid;
        width: 18px;
        overflow: hidden;
        border-radius: 4px;
      }
      .stepper-btn {
        position: relative;
        width: 18px;
        min-width: 18px;
        min-height: 11px;
        height: 11px;
        padding: 0;
        border-radius: 0;
        background: transparent;
        color: rgba(255,255,255,.66);
      }
      .stepper-btn::after {
        content: "";
        position: absolute;
        inset: -12px;
      }
      .stepper-btn svg {
        width: 12px;
        height: 12px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .color-control {
        width: min(100%, 184px);
        height: 26px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 7px;
        background: rgba(255,255,255,.05);
        padding: 2px 2px 2px 3px;
      }
      .color-control:focus-within {
        border-color: rgba(125,211,252,.5);
        box-shadow: 0 0 0 2px rgba(125,211,252,.12);
      }
      .color-control .css-swatch {
        width: 20px;
        height: 20px;
        flex-basis: 20px;
        margin-left: 0;
        border-radius: 5px;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.28);
      }
      .coloris-input {
        flex: 1 1 auto !important;
        width: 100%;
        height: 20px;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        padding: 0 5px !important;
        color: #fff;
        text-align: right;
      }
      .box-control {
        width: min(100%, 246px);
      }
      .padding-control {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 52px));
        justify-content: end;
        gap: 3px;
        width: min(100%, 220px);
      }
      .box-side {
        position: relative;
        min-width: 0;
        display: block;
        overflow: visible;
      }
      .box-input {
        width: 100%;
        min-width: 0;
        padding-left: 4px;
        padding-right: 4px;
        font-size: 10px;
        text-align: center;
      }
      .color-control .css-swatch,
      .css-value-wrap .css-swatch {
        order: -1;
      }
      .css-row.invalid .css-input {
        border-color: #f04438;
        box-shadow: inset 0 0 0 1px rgba(240,68,56,.35);
      }
      .css-row.changed .css-name { color: rgba(255,255,255,.82); }
      .css-swatch {
        flex: 0 0 12px;
        width: 12px;
        height: 12px;
        border-radius: 999px;
        box-shadow: 0 0 0 1px rgba(255,255,255,.35);
      }
      .autocomplete {
        position: absolute;
        top: calc(100% + 3px);
        left: 0;
        right: 0;
        z-index: 40;
        display: grid;
        gap: 2px;
        padding: 4px;
        border-radius: 7px;
        background: #101010;
        box-shadow: 0 8px 28px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.1);
      }
      .suggestion {
        min-height: 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border: 0;
        border-radius: 5px;
        padding: 0 7px;
        color: rgba(255,255,255,.76);
        background: transparent;
        text-align: left;
        font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .suggestion:hover,
      .suggestion.active {
        color: #fff;
        background: rgba(255,122,26,.18);
      }
      .suggestion small {
        max-width: 92px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(255,255,255,.46);
        font-size: 9px;
      }
      .suggestion.token-suggestion {
        color: #bae6fd;
      }
      .suggestion.token-suggestion:hover,
      .suggestion.token-suggestion.active {
        background: rgba(14,165,233,.18);
      }
      .style-key { color: #7dd3fc; }
      .style-punc { color: #667085; }
      .style-value { color: #fbbf24; }
      .panel {
        position: fixed;
        right: 62px;
        top: var(--fm-rail-top, 260px);
        width: min(289px, calc(100vw - 28px));
        max-height: min(440px, calc(100vh - var(--fm-rail-top, 260px) - 16px));
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto auto;
        overflow: hidden;
        animation: fm-panel 180ms cubic-bezier(.2,.8,.2,1);
        transform-origin: right center;
      }
      .panel-head {
        padding: 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      .panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .panel-title {
        display: grid;
        gap: 2px;
      }
      .panel-head.detail {
        justify-content: flex-start;
      }
      .panel-head.detail .panel-title {
        display: block;
      }
      .list {
        overflow: auto;
        padding: 8px;
        display: grid;
        grid-auto-rows: max-content;
        align-content: start;
        gap: 12px;
      }
      .settings-list {
        overflow: auto;
        padding: 8px 12px 12px;
        display: grid;
        gap: 0;
      }
      .settings-section {
        display: grid;
        gap: 0;
        padding: 2px 0;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      .settings-section:last-child {
        border-bottom: 0;
      }
      .settings-section-label {
        margin: 0;
        padding: 4px 8px 6px;
        color: rgba(255,255,255,.42);
        font-size: 10px;
        font-weight: 500;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .settings-row {
        width: 100%;
        min-height: 34px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 0;
        border-radius: 6px;
        padding: 6px 8px;
        background: transparent;
        color: rgba(255,255,255,.58);
        font-size: 11px;
        text-align: left;
        cursor: pointer;
      }
      .settings-row:hover {
        background: rgba(255,255,255,.055);
      }
      .settings-row:focus-visible,
      .settings-back:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px rgba(255,122,26,.42);
      }
      .settings-row strong {
        display: block;
        color: rgba(255,255,255,.9);
        font-weight: 400;
      }
      .settings-row > span:first-child,
      .settings-row > span:first-child span {
        min-width: 0;
      }
      .settings-row-label {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .settings-help-tip {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 15px;
        height: 15px;
        flex: 0 0 15px;
        border: 0;
        padding: 0;
        border-radius: 999px;
        background: rgba(255,255,255,.09);
        color: rgba(255,255,255,.62);
        font: inherit;
        font-size: 10px;
        line-height: 1;
        cursor: help;
      }
      .settings-help-tip::after {
        content: "";
        position: absolute;
        inset: -6px;
      }
      .settings-switch {
        border: 0;
        background: transparent;
        padding: 6px 8px;
        margin: -6px -8px;
        display: inline-flex;
        align-items: center;
        cursor: pointer;
      }
      .settings-help-tip:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px rgba(255,122,26,.42);
      }
      .settings-row-meta {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: rgba(255,255,255,.48);
        white-space: nowrap;
      }
      .settings-version {
        margin-left: auto;
        color: rgba(255,255,255,.38);
        font-size: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .settings-approval-dot {
        width: 7px;
        height: 7px;
        flex: 0 0 7px;
        border-radius: 999px;
        background: #f04438;
        box-shadow: 0 0 12px rgba(240,68,56,.58);
      }
      .settings-chevron {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: rgba(255,255,255,.54);
        font-size: 17px;
        line-height: 1;
      }
      .settings-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: rgba(255,255,255,.28);
      }
      .settings-toggle {
        position: relative;
        width: 32px;
        height: 18px;
        border-radius: 999px;
        background: rgba(255,255,255,.18);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.1);
      }
      .settings-toggle::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: rgba(255,255,255,.74);
        transition: transform 150ms ease, background 150ms ease;
      }
      .settings-row[aria-checked="true"] .settings-toggle {
        background: var(--fm-orange);
        box-shadow: 0 0 0 1px rgba(255,143,61,.34), 0 0 16px rgba(255,122,26,.22);
      }
      .settings-row[aria-checked="true"] .settings-toggle::after {
        transform: translateX(14px);
        background: #fff;
      }
      .settings-back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 24px;
        border: 0;
        border-radius: 6px;
        padding: 0 7px;
        background: rgba(255,255,255,.07);
        color: rgba(255,255,255,.72);
        cursor: pointer;
      }
      .settings-detail {
        display: grid;
        gap: 10px;
        padding: 12px;
        overflow: auto;
      }
      .settings-copy {
        margin: 0;
        color: rgba(255,255,255,.58);
        font-size: 11px;
        line-height: 1.45;
      }
      .settings-kv {
        display: grid;
        gap: 6px;
      }
      .settings-kv-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        min-height: 28px;
        color: rgba(255,255,255,.56);
        font-size: 11px;
      }
      .settings-kv-row strong,
      .settings-kbd {
        color: rgba(255,255,255,.86);
        font-weight: 500;
      }
      .settings-kbd {
        border-radius: 5px;
        padding: 2px 6px;
        background: rgba(255,255,255,.08);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
        font-size: 10px;
      }
      .settings-state-title {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        margin: 0;
        color: rgba(255,255,255,.92);
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0;
      }
      .settings-live-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #22c55e;
        box-shadow: 0 0 12px rgba(34,197,94,.55);
      }
      .settings-state-title.approval .settings-live-dot {
        background: #f04438;
        box-shadow: 0 0 12px rgba(240,68,56,.58);
      }
      .settings-viewport {
        display: grid;
        min-height: 0;
        overflow: hidden;
        position: relative;
      }
      .settings-page {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
      }
      .settings-page.animating {
        grid-area: 1 / 1;
        width: 100%;
        height: 100%;
      }
      .settings-page.enter-forward {
        animation: fm-settings-enter-forward 200ms cubic-bezier(.25,.8,.25,1) both;
      }
      .settings-page.exit-forward {
        animation: fm-settings-exit-forward 200ms cubic-bezier(.25,.8,.25,1) both;
      }
      .settings-page.enter-back {
        animation: fm-settings-enter-back 200ms cubic-bezier(.25,.8,.25,1) both;
      }
      .settings-page.exit-back {
        animation: fm-settings-exit-back 200ms cubic-bezier(.25,.8,.25,1) both;
      }
      .settings-viewport.animating {
        transition: height 200ms cubic-bezier(.25,.8,.25,1);
      }
      .settings-command {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        border-radius: 7px;
        padding: 6px 6px 6px 9px;
        background: rgba(255,255,255,.07);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
      }
      .settings-command code {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        color: rgba(255,255,255,.9);
        font: 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        white-space: nowrap;
      }
      .settings-command button,
      .settings-link-button {
        border: 0;
        border-radius: 999px;
        background: rgba(255,255,255,.1);
        color: rgba(255,255,255,.86);
        cursor: pointer;
        font: inherit;
        font-size: 11px;
      }
      .settings-command button {
        padding: 5px 9px;
      }
      .settings-link-button {
        justify-self: start;
        padding: 0;
        background: transparent;
        color: rgba(255,122,26,.95);
      }
      .item {
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 7px;
        padding: 0;
        display: grid;
        overflow: visible;
        min-height: max-content;
        position: relative;
      }
      .item-head {
        min-height: 32px;
        padding: 7px 9px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        background: rgba(255,255,255,.05);
        border-radius: 6px 6px 0 0;
      }
      .item-head:hover {
        background: rgba(255,255,255,.1);
      }
      .item-focus {
        min-width: 0;
        flex: 1 1 auto;
        border: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .item-status { flex: 0 0 auto; }
      .item-body {
        padding: 8px 9px;
        display: grid;
        gap: 5px;
        position: relative;
      }
      .item strong { font-size: 12px; font-weight: 400; }
      .item-index {
        color: rgba(255,255,255,.36);
      }
      .item p { margin: 0; font-size: 12px; line-height: 1.4; color: rgba(255,255,255,.85); }
      .item .meta { color: rgba(255,255,255,.4); }
      .react-chipline {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        color: rgba(255,255,255,.72);
        font-size: 11px;
      }
      .react-chipline strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 500;
      }
      .style-change-list {
        display: grid;
        gap: 6px;
        margin-top: 2px;
      }
      .style-change {
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 6px;
        background: rgba(255,255,255,.035);
      }
      .style-change-head {
        display: flex;
        align-items: center;
        gap: 5px;
        min-height: 22px;
        padding: 0 7px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.055);
        color: rgba(255,255,255,.52);
        font-size: 10px;
        text-transform: uppercase;
      }
      .style-change-head strong {
        color: rgba(255,255,255,.78);
        font-size: inherit;
        font-weight: 500;
      }
      .style-change-diff {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        font-size: 11px;
      }
      .style-change-side {
        display: flex;
        align-items: center;
        min-width: 0;
        min-height: 26px;
        padding: 5px 7px 5px 9px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        color: #fff;
        position: relative;
      }
      .style-change-side::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 4px;
        opacity: .9;
      }
      .style-change-old {
        background: rgba(248,81,73,.12);
      }
      .style-change-new {
        background: rgba(46,160,67,.14);
      }
      .style-change-old::before {
        background: repeating-linear-gradient(45deg, rgba(248,81,73,.38) 0 3px, rgba(248,81,73,.12) 3px 6px);
      }
      .style-change-new::before {
        background: repeating-linear-gradient(45deg, rgba(46,160,67,.4) 0 3px, rgba(46,160,67,.14) 3px 6px);
      }
      .style-change-side code {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: inherit;
        font: inherit;
        background: transparent;
      }
      .pill {
        display: inline-flex;
        width: max-content;
        border-radius: 999px;
        background: rgba(255,255,255,.1);
        color: rgba(255,255,255,.9);
        padding: 2px 7px;
        font-size: 10px;
        font-weight: 400;
        text-transform: uppercase;
      }
      .pill.pending { background: rgba(255,122,26,.14); color: var(--fm-orange-strong); }
      .pill.resolved { background: rgba(18,183,106,.14); color: #32d583; }
      .pill.detached { background: #fff1f3; color: #c01048; }
      .notice {
        color: #fdb022;
        font-size: 11px;
        padding: 0 12px 12px;
      }
      .notice-error {
        color: #f97066;
      }
      .hidden { display: none; }
      @keyframes fm-tooltip-in {
        from { opacity: 0; visibility: visible; }
        to { opacity: 1; visibility: visible; }
      }
      @keyframes fm-toolbar-tooltip-in {
        from { opacity: 0; visibility: visible; }
        to { opacity: 1; visibility: visible; }
      }
      @keyframes fm-toolbar-tooltip-swap {
        from { opacity: 0; transform: translateY(var(--fm-tooltip-travel, 0)); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fm-toolbar-open {
        from { opacity: .96; width: 46px; height: ${TOOLBAR_COLLAPSED_HEIGHT}px; transform: translateX(0); }
        to { opacity: 1; width: 46px; height: ${TOOLBAR_RAIL_HEIGHT}px; transform: translateX(0); }
      }
      @keyframes fm-toolbar-close {
        from { opacity: 1; width: 46px; height: ${TOOLBAR_RAIL_HEIGHT}px; transform: translateX(0); }
        to { opacity: .96; width: 46px; height: ${TOOLBAR_COLLAPSED_HEIGHT}px; transform: translateX(0); }
      }
      @keyframes fm-toolbar-controls-open {
        from { opacity: 0; filter: blur(8px); transform: translateX(0); }
        to { opacity: 1; filter: blur(0); transform: translateX(0); }
      }
      @keyframes fm-toolbar-controls-close {
        from { opacity: 1; filter: blur(0); transform: translateX(0); }
        to { opacity: 0; filter: blur(8px); transform: translateX(0); }
      }
      @keyframes fm-rise {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fm-panel {
        from { opacity: 0; transform: translateY(10px) scale(.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes fm-settings-enter-forward {
        from { opacity: 0; transform: translateX(8px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes fm-settings-exit-forward {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(-8px); }
      }
      @keyframes fm-settings-enter-back {
        from { opacity: 0; transform: translateX(-8px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes fm-settings-exit-back {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(8px); }
      }
      @keyframes fm-compose {
        from { opacity: 0; transform: translateY(10px) scale(.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes fm-compose-up {
        from { opacity: 0; transform: translateY(8px) scale(.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes fm-compose-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(4px) scale(.95); }
      }
      @keyframes fm-pop {
        from { opacity: 0; transform: scale(.6); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes fm-confirm-in {
        from { opacity: 0; transform: translateY(6px) scale(.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes fm-confirm-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(4px) scale(.97); }
      }
      .confirm-scrim {
        position: fixed;
        inset: 0;
        z-index: 30;
        background: rgba(0,0,0,.28);
      }
      .confirm {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        z-index: 31;
        width: min(340px, calc(100vw - 48px));
        border-radius: 12px;
        padding: 18px;
        display: grid;
        gap: 8px;
        background: #1c1c1e;
        color: rgba(255,255,255,.92);
        box-shadow: 0 24px 64px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.1);
        animation: fm-confirm-in 160ms cubic-bezier(.2,.8,.2,1) both;
      }
      .confirm.closing {
        animation: fm-confirm-out 120ms cubic-bezier(.4,0,.2,1) both;
      }
      .confirm h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .confirm p {
        margin: 0;
        font-size: 12px;
        line-height: 1.55;
        color: rgba(255,255,255,.66);
      }
      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 10px;
      }
      .confirm-actions button {
        min-height: 40px;
        min-width: 44px;
        padding: 0 16px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.07);
        color: rgba(255,255,255,.88);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .confirm-actions button:hover {
        background: rgba(255,255,255,.13);
      }
      .confirm-actions button.destructive {
        border-color: transparent;
        background: #f04438;
        color: #fff;
      }
      .confirm-actions button.destructive:hover {
        background: #d92d20;
      }
      .confirm-actions button:focus-visible,
      .icon-btn:focus-visible,
      .btn:focus-visible,
      .text-btn:focus-visible {
        outline: 2px solid #ff7a1a;
        outline-offset: 2px;
      }
      .fm-layer :focus-visible {
        outline: 2px solid #ff7a1a;
        outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        .confirm, .confirm.closing { animation: none; }
        .fm-layer *, .fm-layer *::before, .fm-layer *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }
      @keyframes fm-style-expand {
        from { opacity: 0; max-height: 0; transform: translateY(-4px) scale(.985); }
        to { opacity: 1; max-height: min(450px, calc(100vh - 156px)); transform: translateY(0) scale(1); }
      }
      @keyframes fm-style-collapse {
        from { opacity: 1; max-height: min(450px, calc(100vh - 156px)); transform: translateY(0) scale(1); }
        to { opacity: 0; max-height: 0; margin-top: 0; transform: translateY(-4px) scale(.985); }
      }
      @keyframes fm-shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-6px); }
        40% { transform: translateX(6px); }
        60% { transform: translateX(-4px); }
        80% { transform: translateX(4px); }
      }
      @media (max-width: 680px) {
        .toolbar {
          right: 0;
        }
        .launcher-wrap { right: 0; }
        .panel { right: 62px; width: min(289px, calc(100vw - 78px)); }
      }
      .structure-section {
        margin-top: 8px;
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.06);
        border-radius: 0 0 6px 6px;
        padding: 6px 0;
        overflow: hidden;
      }
      .structure-header {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-height: 24px;
        border: 0;
        background: transparent;
        color: rgba(255,255,255,.72);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        padding: 0 9px;
      }
      .structure-header:hover { color: #fff; }
      .structure-chevron {
        display: inline-grid;
        place-items: center;
        width: 14px;
        height: 14px;
        flex: 0 0 14px;
        color: rgba(255,255,255,.45);
        transition: transform 200ms cubic-bezier(.2,.8,.2,1);
      }
      .structure-chevron svg {
        width: 12px;
        height: 12px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .structure-section.open .structure-chevron { transform: rotate(90deg); }
      .structure-toggle[aria-expanded="true"] .structure-chevron { transform: rotate(90deg); }
      .structure-body {
        display: grid;
        grid-template-rows: 1fr;
        opacity: 1;
        transition: grid-template-rows 220ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease, margin-top 220ms cubic-bezier(.2,.8,.2,1);
        margin-top: 6px;
        padding: 0 9px;
      }
      .structure-body.collapsed {
        grid-template-rows: 0fr;
        opacity: 0;
        margin-top: 0;
      }
      .structure-body-inner {
        overflow: hidden;
        display: grid;
        gap: 8px;
      }
      .structure-group {
        display: grid;
        gap: 4px;
        padding: 8px 0 0;
        border-top: 1px solid rgba(255,255,255,.06);
      }
      .structure-group:first-child { padding-top: 0; border-top: 0; }
      .structure-label {
        display: flex;
        align-items: center;
        min-height: 20px;
        color: rgba(255,255,255,.45);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0 1px;
      }
      .structure-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-height: 22px;
        border: 0;
        background: transparent;
        color: rgba(255,255,255,.45);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        cursor: pointer;
        padding: 0 1px;
        text-align: left;
      }
      .structure-toggle:hover { color: rgba(255,255,255,.72); }
      .structure-toggle .structure-chevron { color: inherit; }
      .structure-list {
        display: grid;
        grid-template-rows: 1fr;
        opacity: 1;
        transition: grid-template-rows 200ms cubic-bezier(.2,.8,.2,1), opacity 160ms ease;
        gap: 4px;
      }
      .structure-list.collapsed {
        display: none;
      }
      .structure-list-inner {
        overflow: hidden;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 2px 0 6px;
      }
      .structure-row {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 22px;
        padding: 3px 8px;
        border-radius: 6px;
        background: rgba(255,255,255,.08);
        color: rgba(255,255,255,.85);
        font-size: 11px;
        cursor: pointer;
        border: 1px solid transparent;
        text-align: left;
        width: fit-content;
        max-width: 100%;
      }
      .structure-row:hover { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.1); }
      .structure-row.selected { background: #fff; color: #111; border-color: #fff; }
      .structure-row.selected .secondary { color: rgba(17,17,17,.55); }
      .structure-row.is-parent { background: rgba(255,255,255,.08); color: rgba(255,255,255,.85); }
      .structure-row.is-parent:hover { background: rgba(255,255,255,.12); }
      .structure-row .primary { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .structure-row .secondary {
        color: rgba(255,255,255,.45);
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .structure-empty { color: rgba(255,255,255,.6); font-size: 11px; padding: 2px 0; }
    `;
  }

  function unresolvedAnnotations(): Annotation[] {
    return state.annotations
      .filter((a) => !["resolved", "dismissed"].includes(a.status || "pending"))
      .map(cloneAnnotation);
  }

  function animationPatchesFor(annotation: Annotation): AnimationPatch[] {
    return annotation.animationPatches?.length ? annotation.animationPatches : annotation.animationPatch ? [annotation.animationPatch] : [];
  }


  function markdownOutput(): string {
    const annotations = unresolvedAnnotations();
    const exportAnnotations = annotations.map((annotation) => {
      const { computedStyles: _computedStyles, ...rest } = annotation;
      return rest;
    });
    const payload = {
      protocol: "annote.annotation-request.v1",
      page: {
        url: location.href,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      },
      annotations: exportAnnotations,
      responseFormat: {
        protocol: "annote.resolution.v1",
        resolutions: [{ id: "ann_id", status: "resolved", message: "What changed or question for reviewer" }],
      },
    };
    const lines = [`## UI Annotation Request`, "", `Page: ${location.href}`, ""];
    annotations.forEach((annotation, index) => {
      lines.push(`### Annotation #${index + 1}: ${annotation.id}`);
      lines.push(`- Element: ${annotation.element}`);
      lines.push(`- Path: ${annotation.elementPath}`);
      lines.push(`- Intent: ${annotation.intent || "fix"}`);
      lines.push(`- Status: ${annotation.status || "pending"}`);
      if (annotation.boundingBox) {
        lines.push(
          `- Bounding snapshot: ${annotation.boundingBox.x}, ${annotation.boundingBox.y}, ${annotation.boundingBox.width}x${annotation.boundingBox.height}`,
        );
      }
      if (annotation.selectorAlternatives?.length) {
        lines.push(`- Selector alternatives: ${annotation.selectorAlternatives.join(", ")}`);
      }
      if (annotation.targets?.length) {
        lines.push("");
        lines.push("Targets:");
        annotation.targets.forEach((target) => lines.push(`- ${target.selector}`));
      }
      if (annotation.selectionScope === "parent" && annotation.sharedParent) {
        lines.push(`- Shared parent: ${annotation.sharedParent.elementPath}`);
      }
      if (annotation.reactContext) {
        lines.push("");
        lines.push("React:");
        lines.push(...reactContextMarkdownLines(annotation.reactContext));
      }
      if (annotation.comment) {
        lines.push("");
        lines.push("Feedback:");
        lines.push(annotation.comment);
      }
      if (annotation.multiSelectElements?.length) {
        lines.push("");
        lines.push("Target details:");
        annotation.multiSelectElements.forEach((item, itemIndex) => {
          lines.push(`${itemIndex + 1}. ${item.element} - ${item.elementPath}`);
        });
      }
      if (annotation.nearbyText) lines.push(`- Nearby text: ${annotation.nearbyText}`);
      if (annotation.textEdit) {
        lines.push("");
        lines.push("Text:");
        lines.push(annotation.textEdit.value);
      }
      const editedStyles = serializeEditedStyles(annotation.styleEdits || []);
      const stateNames = Object.keys(editedStyles);
      if (stateNames.length) {
        lines.push("");
        lines.push("Styles:");
        stateNames.forEach((styleState) => {
          lines.push("");
          lines.push(`${STATE_LABELS[styleState as StyleStateKey] || styleState}:`);
          lines.push("```css");
          Object.entries(editedStyles[styleState]).forEach(([property, value]) => {
            lines.push(`${property}: ${value};`);
          });
          lines.push("```");
        });
      }
      const motionPatches = animationPatchesFor(annotation);
      if (motionPatches.length) {
        lines.push("");
        lines.push("Motion:");
        motionPatches.forEach((patch, patchIndex) => {
          if (patchIndex) lines.push("");
          lines.push(...animationPatchMarkdownLines(patch));
        });
      }
      lines.push("");
    });
    lines.push("```json");
    lines.push(JSON.stringify(payload, null, 2));
    lines.push("```");
    return lines.join("\n");
  }

  async function copyMarkdown(): Promise<void> {
    const sentIds = unresolvedAnnotations().map((annotation) => annotation.id);
    const output = markdownOutput();
    if (!output.trim()) {
      setNotice("No unresolved annotations to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(output);
      state.copyState = "copied";
      state.notice = "";
      updateCopyControl();
      onAnnotationsSent(sentIds);
      window.setTimeout(() => {
        state.copyState = "idle";
        updateCopyControl();
      }, 1400);
    } catch {
      state.copyState = "failed";
      setNotice("Clipboard write failed. Select text from the review panel output instead.", "error");
      window.setTimeout(() => {
        state.copyState = "idle";
        render();
      }, 1800);
    }
  }

  function icon(name: string): string {
    const icons: Record<string, string> = {
      check: '<path d="m4 12 5 5L20 6"/>',
      "chevron-down": '<path d="m6 9 6 6 6-6"/>',
      "chevron-right": '<path d="m9 6 6 6-6 6"/>',
      "chevron-up": '<path d="m18 15-6-6-6 6"/>',
      copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      cross: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
      eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
      edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
      file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
      focus: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><circle cx="12" cy="12" r="2"/>',
      grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
      import: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M5 21h14"/>',
      "align-center": '<path d="M7 6h10"/><path d="M5 10h14"/><path d="M7 14h10"/><path d="M5 18h14"/>',
      "align-justify": '<path d="M5 6h14"/><path d="M5 10h14"/><path d="M5 14h14"/><path d="M5 18h14"/>',
      "align-left": '<path d="M5 6h14"/><path d="M5 10h10"/><path d="M5 14h14"/><path d="M5 18h10"/>',
      "align-right": '<path d="M5 6h14"/><path d="M9 10h10"/><path d="M5 14h14"/><path d="M9 18h10"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.14 1.14"/><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14"/>',
      mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
      minus: '<path d="M5 12h14"/>',
      note: '<path d="M21 15a2 2 0 0 1-2 2H9l-5 4v-4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 8h8"/><path d="M8 12h5"/>',
      paint: '<path d="m14.62 2.35 7.03 7.03a2 2 0 0 1 0 2.83l-9.44 9.44a2 2 0 0 1-2.83 0l-7.03-7.03a2 2 0 0 1 0-2.83l9.44-9.44a2 2 0 0 1 2.83 0Z"/><path d="m6.5 9.5 8 8"/><path d="M18 13.5 10.5 6"/><path d="M3 21h18"/>',
      panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
      pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
      play: '<path d="m6 3 15 9-15 9V3Z"/>',
      plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
      replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>',
      settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
      sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
      "side-bottom": '<path d="M6 18h12"/><path d="M12 6v8"/><path d="m8 10 4 4 4-4"/>',
      "side-left": '<path d="M6 6v12"/><path d="M18 12H10"/><path d="m14 8-4 4 4 4"/>',
      "side-right": '<path d="M18 6v12"/><path d="M6 12h8"/><path d="m10 8 4 4-4 4"/>',
      "side-top": '<path d="M6 6h12"/><path d="M12 18v-8"/><path d="m8 14 4-4 4 4"/>',
      target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>',
      token: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
      trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>',
      unlink: '<path d="M15 7h2a5 5 0 0 1 3.54 8.54l-2 2A5 5 0 0 1 12 18"/><path d="M9 17H7a5 5 0 0 1-3.54-8.54l2-2A5 5 0 0 1 12 6"/><path d="m8 12 8 0"/><path d="M3 3l18 18"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
  }

  function iconButton(
    action: string,
    label: string,
    iconName: string,
    extraClass = "",
    attrs = "",
  ): string {
    const shortcut = SHORTCUTS[action] || null;
    const tipAttrs = tooltipAttributes({ label, shortcut });
    return `<button class="icon-btn ${extraClass}" data-action="${action}" ${tipAttrs} type="button" ${attrs}>${icon(iconName)}</button>`;
  }

  function textButton(action: string, label: string, extraClass = "", type = "button", attrs = ""): string {
    const actionAttr = type === "button" ? `data-action="${action}"` : "";
    return `<button class="text-btn ${extraClass}" ${actionAttr} type="${type}" ${attrs}>${label}</button>`;
  }

  function updateCopyControl(): void {
    const control = state.shadow?.querySelector<HTMLButtonElement>('[data-action="copy"]');
    if (!control) return;
    const copied = state.copyState === "copied";
    control.innerHTML = icon(copied ? "check" : "copy");
    control.classList.toggle("success", copied);
  }

  function renderReviewStyleChanges(annotation: LiveAnnotation): string {
    const changes = (annotation.styleEdits || []).filter(
      (edit) => edit.valid && edit.value.trim() !== edit.originalValue.trim(),
    );
    const motions = animationPatchesFor(annotation);
    if (!changes.length && !motions.length) return "";
    return `<div class="style-change-list" aria-label="Style changes">
      ${changes
        .map(
          (edit) => `
            <div class="style-change">
              <div class="style-change-head">
                <span>${escapeHtml(STATE_LABELS[edit.state] || edit.state)}</span>
                <span>&gt;</span>
                <strong>${escapeHtml(propertyLabel(edit.property))}</strong>
              </div>
              <div class="style-change-diff">
                <span class="style-change-side style-change-old"><code>${escapeHtml(reviewStyleValue(edit.property, edit.originalValue || "none"))}</code></span>
                <span class="style-change-side style-change-new"><code>${escapeHtml(reviewStyleValue(edit.property, edit.value))}</code></span>
              </div>
            </div>`,
        )
        .join("")}
      ${motions
        .map((motion) => {
          const oldTiming = animationPatchOriginalTimingEntries(motion).map(([key, value]) => `${key}: ${value}`).join("; ");
          const newTiming = animationPatchTimingEntries(motion).map(([key, value]) => `${key}: ${value}`).join("; ");
          return `<div class="style-change">
              <div class="style-change-head">
                <span>Motion</span>
                <span>&gt;</span>
                <strong>${escapeHtml(animationPatchLabel(motion))}</strong>
              </div>
              <div class="style-change-diff">
                ${oldTiming ? `<span class="style-change-side style-change-old"><code>${escapeHtml(oldTiming)}</code></span>` : ""}
                <span class="style-change-side style-change-new"><code>${escapeHtml(newTiming)}</code></span>
              </div>
            </div>`;
        })
        .join("")}
    </div>`;
  }

  function renderReviewReactContext(annotation: LiveAnnotation): string {
    const context = annotation.reactContext;
    if (!context) return "";
    const source = context.source
      ? `${context.source.fileName}${context.source.lineNumber ? `:${context.source.lineNumber}` : ""}`
      : context.sourceStatus && context.sourceStatus !== "resolved"
        ? context.sourceStatus
        : "";
    return `<div class="react-chipline" aria-label="React component">
      <span class="react-chip">React</span>
      <strong>${escapeHtml(context.component)}</strong>
      ${context.key ? `<span class="meta">key ${escapeHtml(context.key)}</span>` : ""}
      ${source ? `<span class="meta">${escapeHtml(source)}</span>` : ""}
    </div>`;
  }

  function intentChecked(value: Intent): string {
    const current = state.editingId
      ? state.annotations.find((annotation) => annotation.id === state.editingId)?.intent || "fix"
      : "fix";
    return current === value ? "checked" : "";
  }

  function cssColorSwatch(value: string, extraAttrs = ""): string {
    return typeof CSS !== "undefined" && CSS.supports("color", value.trim())
      ? `<span class="css-swatch" style="background:${escapeHtml(value.trim())}" aria-hidden="true" ${extraAttrs}></span>`
      : "";
  }

  function currentRowValue(row: StyleRow): string {
    const draft = state.draft;
    const edit = draft?.styleEdits.find((item) => item.state === draft.activeState && item.property === row.property);
    return edit?.value ?? row.value;
  }

  function currentRowValid(row: StyleRow): boolean {
    const draft = state.draft;
    const edit = draft?.styleEdits.find((item) => item.state === draft.activeState && item.property === row.property);
    return edit ? edit.valid : true;
  }

  function isMultiSelectEditing(): boolean {
    return state.selectedElements.length > 1;
  }

  function selectionIdentityLabel(): string {
    if (!isMultiSelectEditing()) {
      const el = state.selectedElement;
      if (!el) return "";
      return uiElementLabel(el, state.reactContext);
    }
    if (state.selectionScope === "parent") {
      const parent = sharedParentForElements(state.selectedElements);
      return parent ? `Shared parent ${displayName(parent)}` : `${state.selectedElements.length} selected`;
    }
    return `${state.selectedElements.length} selected`;
  }

  function editorStateKey(property: string): string {
    return `${state.draft?.activeState || "current"}:${property}`;
  }

  function tokenNameFromValue(value: string): string | null {
    const match = value.trim().match(/^var\(\s*(--[\w-]+)(?:\s*,[^)]*)?\)$/);
    return match?.[1] || null;
  }

  function tokenMatchesValue(row: StyleRow, token: { name: string; value: string }, value: string): boolean {
    return normalizeCssValue(row.property, token.value) === normalizeCssValue(row.property, value);
  }

  function tokenBindingFor(row: StyleRow, value: string): { name: string; value: string } | null {
    if (value === "Mixed") return null;
    const explicit = tokenNameFromValue(value);
    if (explicit) return row.tokenHints.find((token) => token.name === explicit) || { name: explicit, value };
    if (state.unlinkedTokenProperties[editorStateKey(row.property)]) return null;
    return row.tokenHints.find((token) => tokenMatchesValue(row, token, value)) || null;
  }

  function autocompleteSuggestions(property: string, value: string): AutocompleteSuggestion[] {
    const pageValues =
      property === "font-family"
        ? state.inspection?.fontSuggestions || []
        : property === "font-weight"
          ? state.inspection?.fontWeightSuggestions || []
          : [];
    const seen = new Set<string>();
    const suggestions: AutocompleteSuggestion[] = [];
    const addSuggestion = (suggestion: AutocompleteSuggestion): void => {
      if (!suggestion.value || seen.has(suggestion.value)) return;
      seen.add(suggestion.value);
      suggestions.push(suggestion);
    };

    cssSuggestions(property, value, pageValues).forEach((suggestion) => {
      addSuggestion({ value: suggestion, label: suggestion });
    });

    return suggestions.slice(0, 8);
  }

  function renderSuggestions(property: string, value: string): string {
    const active = state.autocomplete?.property === property;
    if (!active) return "";
    const suggestions = autocompleteSuggestions(property, value);
    if (!suggestions.length) return "";
    return `<div class="autocomplete" role="listbox" data-suggestions="${escapeHtml(property)}">
      ${suggestions
        .map(
          (suggestion, index) =>
            `<button type="button" role="option" aria-selected="${index === (state.autocomplete?.index || 0)}" class="suggestion ${index === (state.autocomplete?.index || 0) ? "active" : ""}" data-action="accept-suggestion" data-property="${escapeHtml(property)}" data-value="${escapeHtml(suggestion.value)}">
              <span>${escapeHtml(suggestion.label)}</span>
            </button>`,
        )
        .join("")}
    </div>`;
  }

  function updateAutocompleteDom(root: ShadowRoot, property: string): void {
    const activeIndex = state.autocomplete?.property === property ? state.autocomplete.index : 0;
    root.querySelectorAll<HTMLElement>(`[data-suggestions="${cssEscape(property)}"] .suggestion`).forEach((suggestion, index) => {
      const active = index === activeIndex;
      suggestion.classList.toggle("active", active);
      suggestion.setAttribute("aria-selected", String(active));
      if (active) suggestion.scrollIntoView({ block: "nearest" });
    });
  }

  function propertyLabel(property: string): string {
    const labels: Record<string, string> = {
      "font-family": "Font",
      "font-size": "Size",
      "font-weight": "Weight",
      "line-height": "Line Height",
      "letter-spacing": "Tracking",
      "flex-direction": "Direction",
      "align-items": "Align",
      "justify-content": "Justify",
      "background-color": "Background color",
      "background-image": "Background image",
      "background-position": "Background position",
      "background-size": "Background size",
      "background-repeat": "Background repeat",
      "border-width": "Border Width",
      "border-radius": "Radius",
      "outline-width": "Outline Width",
      "outline-offset": "Outline Offset",
    };
    return (
      labels[property] ||
      property
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    );
  }

  function optionLabel(value: string): string {
    const labels: Record<string, string> = {
      row: "Row",
      column: "Column",
      left: "Left",
      right: "Right",
      center: "Center",
      justify: "Justify",
      start: "Start",
      end: "End",
      "flex-start": "Start",
      "flex-end": "End",
      "space-between": "Between",
      static: "Static",
      relative: "Relative",
      absolute: "Absolute",
      fixed: "Fixed",
      visible: "Visible",
      hidden: "Hidden",
      auto: "Auto",
      stretch: "Stretch",
    };
    return labels[value] || value;
  }

  function segmentContent(property: string, value: string): string {
    if (property !== "text-align") return escapeHtml(optionLabel(value));
    const icons: Record<string, string> = {
      left: "align-left",
      start: "align-left",
      center: "align-center",
      right: "align-right",
      end: "align-right",
      justify: "align-justify",
    };
    return icons[value] ? icon(icons[value]) : escapeHtml(optionLabel(value));
  }

  function stateSourceLabel(source: StateInfo["source"]): string {
    const labels: Record<StateInfo["source"], string> = {
      current: "Current",
      css: "CSS",
      attribute: "Attr",
      inferred: "Inferred",
    };
    return labels[source];
  }

  function statePropertyCount(inspection: StyleInspection, key: StyleStateKey): number {
    return inspection.rowsByState[key]?.length || 0;
  }

  function stateDeclarationCount(stateInfo: StateInfo): number {
    return Object.keys(stateInfo.declarations).length;
  }

  function renderStateTab(item: StateInfo, inspection: StyleInspection, activeState: StyleStateKey): string {
    const count = item.key === "current" ? statePropertyCount(inspection, item.key) : stateDeclarationCount(item);
    const selectorCopy = item.selectors.length ? ` from ${item.selectors.length} selector${item.selectors.length === 1 ? "" : "s"}` : "";
    const sourceCopy = `${item.label}: ${stateSourceLabel(item.source)}${selectorCopy}`;
    return `<button class="state-tab source-${item.source} ${item.key === activeState ? "active" : ""}" type="button" role="tab" aria-selected="${item.key === activeState}" data-action="switch-state" data-state="${item.key}">
      ${item.source !== "current" ? `<span class="state-source-dot" aria-hidden="true"></span>` : ""}
      <span>${escapeHtml(item.label)}</span>
      ${count ? `<span class="state-count">${count}</span>` : ""}
    </button>`;
  }

  function renderPropertyName(row: StyleRow): string {
    return `<span class="css-name">
      <span>${escapeHtml(propertyLabel(row.property))}</span>
    </span>`;
  }

  function renderTokenMenu(row: StyleRow): string {
    if (state.openTokenMenu !== editorStateKey(row.property)) return "";
    const value = currentRowValue(row);
    const currentName = tokenNameFromValue(value);
    const exact = row.tokenHints.filter((token) => token.name === currentName || tokenMatchesValue(row, token, value));
    const exactNames = new Set(exact.map((token) => token.name));
    const relevant = row.tokenHints.filter((token) => !exactNames.has(token.name));
    const renderTokenOption = (token: { name: string; value: string }): string => {
      const current = token.name === currentName || tokenMatchesValue(row, token, value);
      return `<button type="button" class="token-option ${current ? "current" : ""} ${isColorProperty(row.property) ? "has-preview" : ""}" role="option" aria-selected="${current}" data-action="apply-token" data-property="${escapeHtml(row.property)}" data-token="${escapeHtml(token.name)}" data-original-value="${escapeHtml(row.value)}">
        ${renderTokenPreview(row, token)}
        <span class="token-copy">
          <span class="token-name">${escapeHtml(token.name)}</span>
          <span class="token-value">${escapeHtml(token.value)}</span>
        </span>
        ${current ? `<span class="token-current">${icon("check")}</span>` : ""}
      </button>`;
    };
    const sections = [
      exact.length ? `<div class="token-menu-group">Current</div>${exact.map(renderTokenOption).join("")}` : "",
      relevant.length ? `<div class="token-menu-group">Relevant</div>${relevant.map(renderTokenOption).join("")}` : "",
    ].join("");
    return `<div class="token-menu" role="listbox">
      ${sections}
    </div>`;
  }

  function renderTokenPreview(row: StyleRow, token: { name: string; value: string }): string {
    const value = token.value.trim();
    if (isColorProperty(row.property) && typeof CSS !== "undefined" && CSS.supports("color", value)) {
      return `<span class="token-preview color" style="background:${escapeHtml(value)}" aria-hidden="true"></span>`;
    }
    return "";
  }

  function renderTokenButton(row: StyleRow, bound: boolean): string {
    if (!row.tokenHints.length && !bound) return "";
    const key = editorStateKey(row.property);
    const action = bound ? "unlink-token" : "toggle-token-menu";
    const label = bound ? `Unlink ${propertyLabel(row.property)} token` : `Show ${propertyLabel(row.property)} tokens`;
    const tip = bound ? "Unlink token" : "Add token";
    return `<span class="token-menu-anchor">
      <button class="token-button ${bound ? "bound" : ""}" type="button" data-action="${action}" data-property="${escapeHtml(row.property)}" data-original-value="${escapeHtml(row.value)}" aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(tip)}" aria-expanded="${state.openTokenMenu === key}">${icon("token")}</button>
      ${renderTokenMenu(row)}
    </span>`;
  }

  function renderTokenizedControl(row: StyleRow, value: string, controlHtml: string): string {
    const token = tokenBindingFor(row, value);
    if (token) {
      return `<span class="tokenized-control">
        <span class="token-pill bound">
          <span>${escapeHtml(token.name)}</span>
          <small>${escapeHtml(token.value)}</small>
        </span>
        ${renderTokenButton(row, true)}
      </span>`;
    }
    return `<span class="tokenized-control">
      <span class="token-normal-control">${controlHtml}</span>
      ${renderTokenButton(row, false)}
    </span>`;
  }

  function renderTextEditRow(): string {
    const draft = state.draft;
    const inspection = state.inspection;
    if (!draft || !inspection?.editableText) return "";
    const value = draft.textEdit?.value || "";
    const width = Math.min(260, Math.max(150, value.length * 7 + 20));
    return `<label class="text-edit-row">
      <span class="css-name">Text</span>
      <input class="text-edit-input" value="${escapeHtml(value)}" style="--fm-text-input-width:${width}px" data-text-edit aria-label="Text value">
    </label>`;
  }

  function renderCssInput(row: StyleRow, value: string, valid: boolean, extraClass = "", attrs = ""): string {
    const meta = getCssPropertyMeta(row.property);
    return `<input class="css-input ${extraClass}" name="css:${escapeHtml(row.property)}" value="${escapeHtml(value)}" ${attrs} data-css-property="${escapeHtml(row.property)}" data-original-value="${escapeHtml(row.value)}" aria-label="${escapeHtml(row.property)} value" aria-invalid="${valid ? "false" : "true"}" data-syntax="${escapeHtml(meta?.syntax || "")}">`;
  }

  function renderNumberField(row: StyleRow, value: string, valid: boolean, extraClass = ""): string {
    return `<span class="number-field">
      ${renderCssInput(row, value, valid, `number-input ${extraClass}`)}
      <span class="stepper-stack" aria-hidden="false">
        <button type="button" class="stepper-btn" data-action="step-css" data-property="${escapeHtml(row.property)}" data-direction="1" aria-label="Increase ${escapeHtml(row.property)}" data-tooltip="Increase ${escapeHtml(row.property)}">${icon("chevron-up")}</button>
        <button type="button" class="stepper-btn" data-action="step-css" data-property="${escapeHtml(row.property)}" data-direction="-1" aria-label="Decrease ${escapeHtml(row.property)}" data-tooltip="Decrease ${escapeHtml(row.property)}">${icon("chevron-down")}</button>
      </span>
    </span>`;
  }

  function firstFontFamily(value: string): string {
    return (
      value
        .split(",")
        .map((part) => part.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)[0] || value.trim()
    );
  }

  function reviewStyleValue(property: string, value: string): string {
    return property === "font-family" ? firstFontFamily(value) : value.trim();
  }

  function renderFontControl(row: StyleRow, value: string, valid: boolean): string {
    const suggestions = row.property === "font-family" ? state.inspection?.fontSuggestions || [] : state.inspection?.fontWeightSuggestions || [];
    const displayValue = row.property === "font-family" ? firstFontFamily(value) : value.trim();
    const originalValue = row.property === "font-family" ? firstFontFamily(row.value) : row.value;
    const options = Array.from(new Set([displayValue, ...suggestions])).filter(Boolean);
    return `<span class="font-control ${state.openFontMenu === row.property ? "open" : ""}">
      <button class="font-trigger" type="button" data-action="toggle-font-menu" data-property="${escapeHtml(row.property)}" data-original-value="${escapeHtml(originalValue)}" aria-label="${escapeHtml(row.property)} dropdown" aria-expanded="${state.openFontMenu === row.property}" aria-invalid="${valid ? "false" : "true"}">
        <span>${escapeHtml(displayValue)}</span>
        ${icon("chevron-down")}
      </button>
      ${
        state.openFontMenu === row.property
          ? `<div class="font-menu" role="listbox">
              ${options
                .map(
                  (option) =>
                    `<button type="button" class="font-option ${option === displayValue ? "active" : ""}" data-action="set-font-option" data-property="${escapeHtml(row.property)}" data-value="${escapeHtml(option)}" data-original-value="${escapeHtml(originalValue)}">${escapeHtml(option)}</button>`,
                )
                .join("")}
            </div>`
          : ""
      }
    </span>`;
  }

  function renderColorControl(row: StyleRow, value: string, valid: boolean): string {
    return `<span class="color-control">
      ${isConcreteColorValue(value) ? cssColorSwatch(value, `data-color-swatch="${escapeHtml(row.property)}"`) : ""}
      <input class="css-input coloris-input" value="${escapeHtml(value)}" data-coloris data-coloris-input data-property="${escapeHtml(row.property)}" data-original-value="${escapeHtml(row.value)}" aria-label="${escapeHtml(row.property)} color value" aria-invalid="${valid ? "false" : "true"}">
    </span>`;
  }

  function renderBoxSideControl(row: StyleRow, value: string, valid: boolean): string {
    const parts = splitBoxValue(value);
    if (parts.length !== 4) return renderCssInput(row, value, valid);
    const boxKey = editorStateKey(row.property);
    const linked = boxValueIsLinked(value) && !state.unlinkedBoxProperties[boxKey];
    const sides = [
      ["top", "side-top", parts[0]],
      ["right", "side-right", parts[1]],
      ["bottom", "side-bottom", parts[2]],
      ["left", "side-left", parts[3]],
    ];
    const linkTip = linked ? `Unlink ${propertyLabel(row.property)} sides` : `Link ${propertyLabel(row.property)} sides`;
    return `<span class="box-control ${linked ? "linked" : "unlinked"}">
      <button class="link-toggle ${linked ? "linked" : "unlinked"}" type="button" data-action="toggle-box-link" data-property="${escapeHtml(row.property)}" data-current-box="${escapeHtml(value)}" data-original-value="${escapeHtml(row.value)}" aria-label="${escapeHtml(linkTip)}" data-tooltip="${escapeHtml(linkTip)}">${icon(linked ? "link" : "unlink")}</button>
      <span class="padding-control">
        ${sides
          .map(
            ([side, _iconName, sideValue], index) => `<label class="box-side" aria-label="${escapeHtml(`${propertyLabel(row.property)} ${side}`)}">
              <input class="css-input box-input" value="${escapeHtml(sideValue)}" data-box-part="${index}" data-box-linked="${linked ? "true" : "false"}" data-property="${escapeHtml(row.property)}" data-original-value="${escapeHtml(row.value)}" data-current-box="${escapeHtml(value)}" aria-label="${escapeHtml(row.property)} ${side}">
            </label>`,
          )
          .join("")}
      </span>
    </span>`;
  }

  function renderPropertyControl(row: StyleRow, value: string, valid: boolean): string {
    const config = getPropertyEditorConfig(row.property, value);
    const changed = value.trim() !== row.value.trim();
    const propertyClass = `property-${row.property.replace(/[^a-z0-9]+/g, "-")}`;
    const className = `css-row control-${config.control} ${propertyClass} ${valid ? "" : "invalid"} ${changed ? "changed" : ""}`;
    if (config.control === "segmented" && config.options?.length) {
      const mixed = value === "Mixed";
      const custom = isCustomSegmentValue(config.options, value);
      const control = `<span class="segmented-control" role="radiogroup" aria-label="${escapeHtml(row.property)} value">
        ${config.options
          .map(
            (option) => {
              const label = optionLabel(option);
              return `<button class="segment ${row.property === "text-align" ? "icon-segment" : ""} ${option === value.trim() ? "active" : ""}" type="button" role="radio" aria-label="${escapeHtml(label)}"${row.property === "text-align" ? ` data-tooltip="${escapeHtml(label)}"` : ""} aria-checked="${option === value.trim()}" data-action="set-segment" data-property="${escapeHtml(row.property)}" data-value="${escapeHtml(option)}" data-original-value="${escapeHtml(row.value)}" ${mixed ? "disabled" : ""}>${segmentContent(row.property, option)}</button>`;
            },
          )
          .join("")}
        ${custom && !mixed ? renderCssInput(row, value, valid, "compact-custom") : ""}
      </span>`;
      return `<div class="${className}">
        ${renderPropertyName(row)}
        ${renderTokenizedControl(row, value, control)}
      </div>`;
    }
    if (config.control === "number") {
      return `<div class="${className}">
        ${renderPropertyName(row)}
        ${renderTokenizedControl(row, value, `<span class="stepper-control">${renderNumberField(row, value, valid)}</span>`)}
      </div>`;
    }
    if (config.control === "font") {
      return `<div class="${className}">
        ${renderPropertyName(row)}
        ${renderTokenizedControl(row, value, renderFontControl(row, value, valid))}
      </div>`;
    }
    if (config.control === "color") {
      return `<div class="${className}">
        ${renderPropertyName(row)}
        ${renderTokenizedControl(row, value, renderColorControl(row, value, valid))}
      </div>`;
    }
    if (config.control === "compound") {
      const boxKey = editorStateKey(row.property);
      const linked = boxValueIsLinked(value) && !state.unlinkedBoxProperties[boxKey];
      if (row.property === "padding" || row.property === "border-width" || (row.property === "border-radius" && !linked)) {
        return `<div class="${className}">
          ${renderPropertyName(row)}
          ${renderTokenizedControl(row, value, renderBoxSideControl(row, value, valid))}
        </div>`;
      }
      const compoundControl = `<span class="compound-control ${linked ? "linked" : "unlinked"}">
        <button class="link-toggle ${linked ? "linked" : "unlinked"}" type="button" data-action="toggle-box-link" data-property="${escapeHtml(row.property)}" data-current-box="${escapeHtml(value)}" data-original-value="${escapeHtml(row.value)}" aria-label="${escapeHtml(linked ? `Unlink ${propertyLabel(row.property)} sides` : `Link ${propertyLabel(row.property)} sides`)}" data-tooltip="${escapeHtml(linked ? "Unlink sides" : "Link sides")}">${icon(linked ? "link" : "unlink")}</button>
        ${linked && stepCssNumericValue(row.property, value, 1) ? renderNumberField(row, value, valid) : renderCssInput(row, value, valid)}
      </span>`;
      return `<div class="${className}">
        ${renderPropertyName(row)}
        ${renderTokenizedControl(row, value, compoundControl)}
      </div>`;
    }
    const textControl = `<span class="css-value-wrap">
      ${isColorProperty(row.property) && isConcreteColorValue(value) ? cssColorSwatch(value) : ""}
      ${renderCssInput(row, value, valid)}
      ${renderSuggestions(row.property, value)}
    </span>`;
    return `<div class="${className}">
      ${renderPropertyName(row)}
      ${renderTokenizedControl(row, value, textControl)}
    </div>`;
  }

  function animationSourceLabel(source: string): string {
    if (source === "css-animation") return "CSS animation";
    if (source === "css-transition") return "CSS transition";
    return "WAAPI";
  }

  function motionDuration(animation: NormalizedAnimation, edit: AnimationEdit | null): number {
    const value = edit?.value.duration ?? animation.computedDuration ?? animation.timing.duration;
    return Math.max(1, Number.isFinite(value) ? value : 1);
  }

  function animationTarget(animation: NormalizedAnimation): Element | null {
    const effect = animation.runtime.effect;
    if (typeof KeyframeEffect === "undefined" || !(effect instanceof KeyframeEffect)) return null;
    return effect.target instanceof Element ? effect.target : null;
  }

  function selectedMotionRuntimes(animation = selectedAnimation()): Animation[] {
    if (!animation) return [];
    const runtimes = new Set<Animation>([animation.runtime]);
    animationTarget(animation)?.getAnimations().forEach((runtime) => runtimes.add(runtime));
    return Array.from(runtimes);
  }

  function selectedMotionRuntime(animation = selectedAnimation()): Animation | null {
    const runtimes = selectedMotionRuntimes(animation);
    return runtimes.find((runtime) => runtime.playState === "running") || runtimes[0] || null;
  }

  function isMotionRunning(animation = selectedAnimation()): boolean {
    return selectedMotionRuntimes(animation).some((runtime) => runtime.playState === "running");
  }

  function normalizedMotionTime(animation: NormalizedAnimation, edit: AnimationEdit | null): { current: number; progress: number; duration: number } {
    const duration = motionDuration(animation, edit);
    const runtime = selectedMotionRuntime(animation) || animation.runtime;
    const rawCurrent = typeof runtime.currentTime === "number" ? Math.max(0, runtime.currentTime) : 0;
    const iterations = edit?.value.iterations ?? animation.timing.iterations;
    const shouldWrap = iterations === "infinite" || runtime.playState === "running";
    const current = shouldWrap ? rawCurrent % duration : Math.min(rawCurrent, duration);
    const progress = Math.max(0, Math.min(1, current / duration));
    return { current, progress, duration };
  }

  function motionProgress(animation: NormalizedAnimation, edit: AnimationEdit | null): number {
    return normalizedMotionTime(animation, edit).progress;
  }

  function renderMotionField(label: string, field: string, value: string, valid: boolean, attrs = ""): string {
    return `<div class="motion-field input-only ${valid ? "" : "invalid"}">
      <span class="motion-label">${escapeHtml(label)}</span>
      <input class="motion-input" value="${escapeHtml(value)}" data-animation-field="${escapeHtml(field)}" aria-label="${escapeHtml(label)}" aria-invalid="${valid ? "false" : "true"}" ${attrs}>
    </div>`;
  }

  function motionFill(value: number, min: number, max: number): number {
    if (!Number.isFinite(value) || max <= min) return 0;
    return Math.round(Math.max(0, Math.min(1, (value - min) / (max - min))) * 100);
  }

  function formatMotionSeconds(value: number): string {
    return `${(Math.round(value) / 1000).toFixed(2)}s`;
  }

  function formatMotionSpeed(value: number): string {
    return (Math.round(value * 100) / 100).toFixed(2);
  }

  const MOTION_TIMELINE_TICKS = 33;

  function motionTickIndex(progress: number): number {
    return Math.max(0, Math.min(MOTION_TIMELINE_TICKS - 1, Math.round(progress * (MOTION_TIMELINE_TICKS - 1))));
  }

  function motionTickPercent(index: number): string {
    if (MOTION_TIMELINE_TICKS <= 1) return "0%";
    return `${(Math.max(0, Math.min(MOTION_TIMELINE_TICKS - 1, index)) / (MOTION_TIMELINE_TICKS - 1)) * 100}%`;
  }

  function renderMotionTimelineTicks(progress: number): string {
    const activeIndex = motionTickIndex(progress);
    const ticks = Array.from({ length: MOTION_TIMELINE_TICKS }, (_, index) => {
      const filled = index <= activeIndex;
      return `<span class="motion-tick ${filled ? "filled" : ""} ${index === activeIndex ? "active" : ""}" data-motion-tick="${index}" aria-hidden="true"></span>`;
    }).join("");
    return `<span class="motion-ticks" data-motion-ticks>${ticks}</span>`;
  }

  function renderMotionSliderField(
    label: string,
    field: string,
    value: number,
    displayValue: string,
    min: number,
    max: number,
    step: number,
    valid = true,
  ): string {
    const clampedValue = Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    const fill = motionFill(clampedValue, min, max);
    return `<div class="motion-field ${valid ? "" : "invalid"}" style="--motion-fill:${fill}%">
      <span class="motion-label">${escapeHtml(label)}</span>
      <span class="motion-slider">
        <span class="motion-range-fill" aria-hidden="true"></span>
        <input class="motion-range" type="range" min="${min}" max="${max}" step="${step}" value="${escapeHtml(String(clampedValue))}" data-animation-field="${escapeHtml(field)}" aria-label="${escapeHtml(`${label} slider`)}">
      </span>
      <input class="motion-input" value="${escapeHtml(displayValue)}" data-animation-field="${escapeHtml(field)}" data-motion-field-value="${escapeHtml(field)}" aria-label="${escapeHtml(`${label} value`)}" aria-invalid="${valid ? "false" : "true"}">
    </div>`;
  }

  function renderMotionTabs(active: AnnotationDraft["motionPaneTab"]): string {
    const tabs: Array<[AnnotationDraft["motionPaneTab"], string]> = [
      ["easing", "Easing"],
      ["time", "Time"],
      ["physics", "Physics"],
    ];
    const activeIndex = Math.max(0, tabs.findIndex(([tab]) => tab === active));
    return `<div class="motion-tabs" role="tablist" aria-label="Motion controls" style="--motion-tab-index:${activeIndex}">
      <span class="motion-tab-indicator" aria-hidden="true"></span>
      ${tabs
        .map(
          ([tab, label]) =>
            `<button class="motion-pane-tab ${active === tab ? "active" : ""}" type="button" role="tab" aria-selected="${active === tab ? "true" : "false"}" data-action="set-motion-pane-tab" data-motion-tab="${tab}">${label}</button>`,
        )
        .join("")}
    </div>`;
  }

  function motionGraphBezierPath(bezier: CubicBezier): string {
    return motionGraphPath(motionGraphBezierPoints(bezier));
  }

  type MotionGraphPoint = { x: number; y: number };

  const MOTION_GRAPH_POINTS = 36;

  function motionGraphPath(points: MotionGraphPoint[]): string {
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"}${Math.round(point.x * 100) / 100},${Math.round(point.y * 100) / 100}`)
      .join(" ");
  }

  function motionGraphBezierPoints(bezier: CubicBezier): MotionGraphPoint[] {
    const graphWidth = 208;
    const graphHeight = 112;
    return Array.from({ length: MOTION_GRAPH_POINTS + 1 }, (_, index) => {
      const point = cubicBezierPoint(bezier, index / MOTION_GRAPH_POINTS);
      return {
        x: point.x * graphWidth,
        y: graphHeight - Math.max(-0.2, Math.min(1.2, point.y)) * graphHeight,
      };
    });
  }

  function motionGraphPointsForTab(tab: AnnotationDraft["motionPaneTab"], edit: AnimationEdit): MotionGraphPoint[] {
    const bezier = tab === "physics" ? null : parseCubicBezier(edit.easingInput);
    const spring = parseSpringEasing(edit.easingInput);
    const graphWidth = 208;
    const graphHeight = 112;
    if (bezier && tab !== "physics") return motionGraphBezierPoints(bezier);
    const points: MotionGraphPoint[] = [];
    const springConfig = spring || { stiffness: 200, damping: 25, mass: 1 };
    const springDuration = Math.max(200, edit.value.duration || springConfig.duration || 800);
    for (let index = 0; index <= MOTION_GRAPH_POINTS; index += 1) {
      const t = index / MOTION_GRAPH_POINTS;
      const progress = spring || tab === "physics" ? springProgress(t * springDuration, springConfig) : t;
      points.push({
        x: t * graphWidth,
        y: graphHeight - Math.max(-0.2, Math.min(1.2, progress)) * graphHeight,
      });
    }
    return points;
  }

  function motionGraphHandlePosition(bezier: CubicBezier, handle: 1 | 2): { x: number; y: number } {
    const x = handle === 1 ? bezier[0] : bezier[2];
    const y = handle === 1 ? bezier[1] : bezier[3];
    return { x: x * 208, y: 112 - Math.max(-0.2, Math.min(1.2, y)) * 112 };
  }

  function motionGraphSpringPath(config: { duration?: number; stiffness?: number; damping?: number; mass?: number }, duration: number): string {
    const graphLeft = 0;
    const graphTop = 0;
    const graphWidth = 208;
    const graphHeight = 112;
    const points: string[] = [];
    for (let index = 0; index <= 36; index += 1) {
      const t = index / 36;
      const progress = Math.max(-0.2, Math.min(1.2, springProgress(t * duration, config)));
      const x = Math.round((graphLeft + t * graphWidth) * 100) / 100;
      const y = Math.round((graphTop + graphHeight - progress * graphHeight) * 100) / 100;
      points.push(`${index === 0 ? "M" : "L"}${x},${y}`);
    }
    return points.join(" ");
  }

  function renderMotionGraphSvg(edit: AnimationEdit): string {
    const tab = state.draft?.motionPaneTab || state.motionPaneTab;
    const bezier = tab === "physics" ? null : parseCubicBezier(edit.easingInput);
    let curve = motionGraphPath(motionGraphPointsForTab(tab, edit));
    let handles = "";

    if (bezier) {
      const p1 = motionGraphHandlePosition(bezier, 1);
      const p2 = motionGraphHandlePosition(bezier, 2);
      handles = `<circle class="motion-graph-handle" cx="${p1.x}" cy="${p1.y}" r="5" data-motion-graph-handle="1" tabindex="0" />
        <circle class="motion-graph-handle" cx="${p2.x}" cy="${p2.y}" r="5" data-motion-graph-handle="2" tabindex="0" />`;
    }

    return `<svg viewBox="0 0 208 112" preserveAspectRatio="none" focusable="false" aria-hidden="true">
        <path class="motion-graph-grid" d="M0 0V112M52 0V112M104 0V112M156 0V112M208 0V112M0 0H208M0 56H208M0 112H208" />
        <path class="motion-graph-guide" d="M0 112L208 0" />
        <path class="motion-graph-curve" d="${escapeHtml(curve)}" />
        ${handles}
      </svg>`;
  }

  function renderMotionGraph(edit: AnimationEdit): string {
    return `<div class="motion-block">
      <span class="motion-block-label">Transition Spring</span>
      <div class="motion-graph" data-motion-graph data-animation-id="${escapeHtml(edit.animationId)}" aria-label="Transition Spring curve preview" role="img">
      ${renderMotionGraphSvg(edit)}
      </div>
    </div>`;
  }

  function renderMotionMetric(label: string, value: string): string {
    return `<div class="motion-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function renderMotionMetrics(selected: NormalizedAnimation): string {
    return `<div class="motion-metrics">
      ${renderMotionMetric("Source", animationSourceLabel(selected.source))}
      ${renderMotionMetric("Properties", selected.animatedProperties.join(", ") || "Timing")}
      ${renderMotionMetric("Keyframes", selected.keyframes.length ? String(selected.keyframes.length) : "Unavailable")}
    </div>`;
  }

  function renderMotionPaneContent(_selected: NormalizedAnimation, edit: AnimationEdit, duration: number): string {
    const tab = state.draft?.motionPaneTab || state.motionPaneTab;
    if (tab === "easing") {
      const bezier = parseCubicBezier(edit.easingInput);
      if (bezier) {
        return `<div class="motion-fields">
          ${renderMotionSliderField("x1", "easing-x1", bezier[0], String(Math.round(bezier[0] * 100) / 100), 0, 1, 0.01, edit.validEasing)}
          ${renderMotionSliderField("y1", "easing-y1", bezier[1], String(Math.round(bezier[1] * 100) / 100), -1, 2, 0.01, edit.validEasing)}
          ${renderMotionSliderField("x2", "easing-x2", bezier[2], String(Math.round(bezier[2] * 100) / 100), 0, 1, 0.01, edit.validEasing)}
          ${renderMotionSliderField("y2", "easing-y2", bezier[3], String(Math.round(bezier[3] * 100) / 100), -1, 2, 0.01, edit.validEasing)}
          ${renderMotionField("Ease", "easing", edit.easingInput, edit.validEasing, 'list="feedback-mark-motion-easings" autocomplete="on"')}
        </div>`;
      }
      return `<div class="motion-fields">
        ${renderMotionField("Ease", "easing", edit.easingInput, edit.validEasing, 'list="feedback-mark-motion-easings" autocomplete="on"')}
      </div>`;
    }
    if (tab === "physics") {
      const spring = parseSpringEasing(edit.easingInput);
      const stiffness = spring?.stiffness ?? 200;
      const damping = spring?.damping ?? 25;
      const mass = spring?.mass ?? 1;
      return `<div class="motion-fields">
        ${renderMotionSliderField("Stiffness", "spring-stiffness", stiffness, String(Math.round(stiffness * 100) / 100), 1, 500, 1, edit.validEasing)}
        ${renderMotionSliderField("Damping", "spring-damping", damping, String(Math.round(damping * 100) / 100), 1, 80, 0.5, edit.validEasing)}
        ${renderMotionSliderField("Mass", "spring-mass", mass, String(Math.round(mass * 100) / 100), 0.1, 5, 0.1, edit.validEasing)}
      </div>`;
    }
    return `<div class="motion-fields">
      ${renderMotionSliderField("Duration", "duration", edit.value.duration, formatMotionSeconds(edit.value.duration), 0, 5000, 10, edit.validDuration)}
      ${renderMotionSliderField("Delay", "delay", edit.value.delay, formatMotionSeconds(edit.value.delay), -1000, 3000, 10, edit.validDelay)}
      ${renderMotionSliderField("Speed", "speed", edit.value.playbackRate, formatMotionSpeed(edit.value.playbackRate), 0.1, 3, 0.05)}
      ${renderMotionSliderField("Iterations", "iterations", edit.value.iterations === "infinite" ? 10 : edit.value.iterations, edit.iterationsInput, 0, 10, 1, edit.validIterations)}
    </div>`;
  }

  function renderMotionSection(): string {
    const draft = state.draft;
    if (!draft || !state.animations.length) return "";
    const selected = selectedAnimation() || state.animations[0];
    const edit = selectedAnimationEdit() || draft.animationEdits[0];
    if (!selected || !edit) return "";
    const duration = motionDuration(selected, edit);
    const motionTime = normalizedMotionTime(selected, edit);
    const progress = motionTime.progress;
    const activeTick = motionTickIndex(progress);
    const progressPercent = motionTickPercent(activeTick);
    const running = isMotionRunning(selected);
    const names = state.animations
      .map((animation) => `<button class="motion-chip ${animation.id === selected.id ? "active" : ""}" type="button" data-action="select-animation" data-animation-id="${escapeHtml(animation.id)}">${escapeHtml(animation.label)}</button>`)
      .join("");
    const playLabel = running ? "Pause animation" : "Play animation";
    return `<section class="motion-section" data-motion-section>
      <div class="motion-header">
        <h3>Motion</h3>
        <span>${state.animations.length} ${state.animations.length === 1 ? "animation" : "animations"}</span>
      </div>
      <div class="motion-title-row">
        <div class="motion-picker" role="group" aria-label="Animations">${names}</div>
        <div class="motion-icon-controls">
          ${iconButton("toggle-animation-play", playLabel, running ? "pause" : "play", "motion-icon-button", `data-animation-id="${escapeHtml(selected.id)}" data-motion-play`)}
          ${iconButton("replay-animation", "Replay animation", "replay", "motion-icon-button", `data-animation-id="${escapeHtml(selected.id)}"`)}
        </div>
      </div>
      <div class="motion-pane">
        <div class="motion-block">
          <span class="motion-block-label">Timeline</span>
          <div class="motion-timeline-row">
            <div class="motion-scrubber" data-motion-scrubber data-animation-id="${escapeHtml(selected.id)}" role="slider" aria-label="Animation timeline" aria-valuemin="0" aria-valuemax="${Math.round(duration)}" aria-valuenow="${Math.round(motionTime.current)}" tabindex="0" style="--motion-progress:${progressPercent}">
              ${renderMotionTimelineTicks(progress)}
              <span class="motion-progress" data-motion-progress style="width:${progressPercent}"></span>
              <span class="motion-tick-strip" aria-hidden="true"></span>
              <span class="motion-thumb" data-motion-thumb style="left:${progressPercent}"></span>
            </div>
            <output class="motion-timeline-time" data-motion-time>${formatMotionSeconds(motionTime.current)}</output>
          </div>
        </div>
        ${renderMotionGraph(edit)}
        <div class="motion-block">
          <span class="motion-block-label">Type</span>
          ${renderMotionTabs(draft.motionPaneTab)}
        </div>
        <div class="motion-tab-panel" data-motion-tab-panel="${escapeHtml(draft.motionPaneTab)}">
          ${renderMotionPaneContent(selected, edit, duration)}
        </div>
        ${renderMotionMetrics(selected)}
        <datalist id="feedback-mark-motion-easings">
          <option value="linear"></option>
          <option value="ease"></option>
          <option value="ease-in"></option>
          <option value="ease-out"></option>
          <option value="ease-in-out"></option>
          <option value="cubic-bezier(0.22, 1, 0.36, 1)"></option>
          <option value="spring(stiffness: 200, damping: 25, mass: 1)"></option>
        </datalist>
      </div>
    </section>`;
  }

  function renderReactSection(): string {
    const context = state.reactContext;
    if (!context) return "";
    const source = context.source
      ? `${context.source.fileName}${context.source.lineNumber ? `:${context.source.lineNumber}${context.source.columnNumber ? `:${context.source.columnNumber}` : ""}` : ""}`
      : context.sourceStatus === "pending"
        ? "Resolving source..."
        : context.sourceStatus === "unavailable"
          ? "Source unavailable"
          : "";
    const stack = context.stack.slice(0, 6);
    return `<section class="react-section" data-react-section>
      <div class="react-header">
        <h3>React</h3>
        <span>${escapeHtml(context.key ? `key ${context.key}` : "detected")}</span>
      </div>
      <div class="react-component">
        <span class="react-chip">Component</span>
        <strong>${escapeHtml(context.component)}</strong>
      </div>
      ${
        stack.length
          ? `<ol class="react-stack">${stack.map((frame) => `<li>${escapeHtml(frame.name)}${frame.key ? `<span>key ${escapeHtml(frame.key)}</span>` : ""}</li>`).join("")}</ol>`
          : ""
      }
      ${source ? `<p class="react-source">${escapeHtml(source)}</p>` : ""}
    </section>`;
  }

  function renderStyleEditor(): string {
    const draft = state.draft;
    const inspection = state.inspection;
    if (!draft || !inspection) return "";
    const multi = isMultiSelectEditing();
    const rows = inspection.rowsByState[draft.activeState] || [];
    let lastGroup = "";
    const styleRows = rows
      .map((row) => {
        const value = currentRowValue(row);
        const valid = currentRowValid(row);
        const groupChanged = row.group !== lastGroup;
        const group = groupChanged ? `<h3>${row.group}</h3>${row.group === "Text" ? renderTextEditRow() : ""}` : "";
        lastGroup = row.group;
        return `${group}${renderPropertyControl(row, value, valid)}`;
      })
      .join("");
    return `<div class="style-details ${state.cssOpen ? "open" : ""} ${state.styleEditorOpening ? "opening" : ""} ${state.styleEditorClosing ? "closing" : ""}" id="feedback-mark-element-css">
      ${
        multi
          ? ""
          : `<div class="state-tabs" role="tablist" aria-label="Style state">
              ${inspection.states
                .map((item) => renderStateTab(item, inspection, draft.activeState))
                .join("")}
            </div>`
      }
      <div class="style-identity">
        <button class="drag-handle" type="button" data-drag-handle aria-label="Drag composer">${icon("grip")}</button>
        <span class="identity-label">${escapeHtml(selectionIdentityLabel())}</span>
        ${
          multi
            ? `<span class="scope-toggle" role="group" aria-label="Selection scope">
                <button class="scope-option ${state.selectionScope === "individual" ? "active" : ""}" type="button" data-action="set-selection-scope" data-scope="individual">Individual</button>
                <button class="scope-option ${state.selectionScope === "parent" ? "active" : ""}" type="button" data-action="set-selection-scope" data-scope="parent">Shared parent</button>
              </span>`
            : ""
        }
      </div>
      <div class="style-grid-wrap">
        <div class="style-grid ${state.openTokenMenu ? "token-menu-open" : ""} ${state.autocomplete ? "autocomplete-open" : ""}">
          ${styleRows}
          ${renderMotionSection()}
          <datalist id="feedback-mark-font-families">
            ${inspection.fontSuggestions.map((family) => `<option value="${escapeHtml(family)}"></option>`).join("")}
          </datalist>
          <datalist id="feedback-mark-font-weights">
            ${inspection.fontWeightSuggestions.map((weight) => `<option value="${escapeHtml(weight)}"></option>`).join("")}
          </datalist>
        </div>
      </div>
      ${renderStructureSection()}
    </div>`;
  }

  function renderStructureSection(): string {
    const target = state.selectedElement;
    if (!target) return "";
    const data = getStructureData(target);
    const isOpen = state.structureOpen;
    const renderRow = (el: HTMLElement, opts: { isSelected?: boolean; isParent?: boolean } = {}): string => {
      const { primary, secondary } = structureLabel(el);
      const selector = selectorForElement(el);
      const isSelected = !!opts.isSelected;
      const cls = `structure-row ${isSelected ? "selected" : ""} ${opts.isParent ? "is-parent" : ""}`;
      return `<button class="${cls}" type="button" data-structure-target="${escapeHtml(selector)}" aria-label="Select ${escapeHtml(primary)}">${escapeHtml(primary)}${secondary ? ` <span class="secondary">${escapeHtml(secondary)}</span>` : ""}</button>`;
    };
    const chevronIcon = (): string => `<span class="structure-chevron">${icon("chevron-right")}</span>`;
    const parentRow = data.parent ? renderRow(data.parent, { isParent: true }) : `<div class="structure-empty">No parent</div>`;
    const selectedRow = renderRow(data.selected, { isSelected: true });
    const childrenCountLabel = `${data.children.length}${data.childrenTruncated ? ` +${data.childrenTruncated} more` : ""}`;
    const siblingsCountLabel = `${data.siblings.length}${data.siblingsTruncated ? ` +${data.siblingsTruncated} more` : ""}`;
    const childrenListInner = state.structureChildrenExpanded
      ? data.children.map((el) => renderRow(el)).join("") + (data.childrenTruncated ? `<div class="structure-empty">+${data.childrenTruncated} more</div>` : "")
      : data.children.slice(0, 8).map((el) => renderRow(el)).join("") + (data.children.length ? "" : `<div class="structure-empty">No children</div>`) + (data.childrenTruncated ? `<div class="structure-empty">+${data.childrenTruncated} more</div>` : "");
    const siblingsListInner = state.structureSiblingsExpanded
      ? data.siblings.map((el) => renderRow(el)).join("") + (data.siblingsTruncated ? `<div class="structure-empty">+${data.siblingsTruncated} more</div>` : "")
      : data.siblings.slice(0, 8).map((el) => renderRow(el)).join("") + (data.siblings.length ? "" : `<div class="structure-empty">No siblings</div>`) + (data.siblingsTruncated ? `<div class="structure-empty">+${data.siblingsTruncated} more</div>` : "");
    return `<section class="structure-section ${isOpen ? "open" : ""}" data-structure-section>
      <button class="structure-header" type="button" data-action="toggle-structure" aria-expanded="${isOpen ? "true" : "false"}">
        ${chevronIcon()} Structure
      </button>
      <div class="structure-body ${isOpen ? "" : "collapsed"}">
        <div class="structure-body-inner">
          <div class="structure-group">
            <div class="structure-label">Parent</div>
            ${parentRow}
          </div>
          <div class="structure-group">
            <div class="structure-label">Selected</div>
            ${selectedRow}
          </div>
          <div class="structure-group">
            <button class="structure-toggle" type="button" data-action="toggle-structure-children" aria-expanded="${state.structureChildrenExpanded ? "true" : "false"}">${chevronIcon()} Children <span class="structure-count">${childrenCountLabel}</span></button>
            <div class="structure-list ${state.structureChildrenExpanded ? "" : "collapsed"}"><div class="structure-list-inner">${childrenListInner}</div></div>
          </div>
          <div class="structure-group">
            <button class="structure-toggle" type="button" data-action="toggle-structure-siblings" aria-expanded="${state.structureSiblingsExpanded ? "true" : "false"}">${chevronIcon()} Siblings <span class="structure-count">${siblingsCountLabel}</span></button>
            <div class="structure-list ${state.structureSiblingsExpanded ? "" : "collapsed"}"><div class="structure-list-inner">${siblingsListInner}</div></div>
          </div>
        </div>
      </div>
    </section>`;
  }

  function renderComposer(composerTarget: HTMLElement, composerPosition: ComposerPosition, editingAnnotation: LiveAnnotation | null): string {
    const draft = state.draft;
    const meaningful = draftIsMeaningful();
    const currentPromptHasText = !!(draft?.comment.trim() || (!draft && editingAnnotation?.comment.trim()));
    const showMicAffordance = !meaningful && !currentPromptHasText;
    const showCompactSubmit = meaningful || (!!editingAnnotation && currentPromptHasText);
    const entering = state.focusComposerOnRender ? "entering" : "";
    const submitLabel = editingAnnotation ? "Save" : "Add";
    const showStyleEditor = state.cssOpen || state.styleEditorClosing;
    return `<form class="composer ${entering} ${showStyleEditor ? "expanded" : ""} ${composerPosition.opensUp ? "opens-up" : ""} ${state.composerShake ? "shake" : ""}" data-composer data-placement="${composerPosition.opensUp ? "above" : "below"}" style="left:${composerPosition.left}px;${composerPosition.opensUp ? `bottom:${composerPosition.bottom}px` : `top:${composerPosition.top}px`}">
      <div class="composer-bar">
        <button class="icon-btn css-toggle ${state.cssOpen ? "open" : ""} ${state.styleEditorClosing ? "closing" : ""}" data-action="toggle-css" type="button" aria-label="${state.cssOpen ? "Hide" : "Show"} element CSS" aria-expanded="${state.cssOpen}" aria-controls="feedback-mark-element-css">${icon("paint")}</button>
        <textarea name="comment" placeholder="${state.cssOpen ? "Describe these changes..." : "Add a comment..."}" rows="1">${escapeHtml(draft?.comment ?? editingAnnotation?.comment ?? "")}</textarea>
        <span class="icon-btn mic-affordance ${showMicAffordance ? "" : "hidden"}" aria-hidden="true" data-mic-affordance>${icon("mic")}</span>
        <button class="icon-btn primary submit-icon ${showCompactSubmit ? "" : "hidden"}" aria-label="${submitLabel} annotation" type="submit" data-composer-submit ${meaningful ? "" : "disabled"}>${icon("check")}</button>
      </div>
      ${showStyleEditor ? `<div class="composer-context">${renderStyleEditor()}</div>` : ""}
      ${
        state.cssOpen
          ? `<div class="row composer-actions">
              ${editingAnnotation ? iconButton("delete-current", "Delete annotation", "trash", "borderless delete-current") : ""}
              ${textButton("undo-edit", "Undo", "ghost compact", "button", `${draft?.undoStack.length ? "" : "disabled"}`)}
              <span class="composer-action-spacer"></span>
              ${textButton("cancel-compose", "Cancel", "ghost compact")}
              ${textButton("", submitLabel, "primary compact", "submit", `data-composer-submit ${meaningful ? "" : "disabled"}`)}
            </div>`
          : ""
      }
    </form>`;
  }

  function settingsViewDepth(view: SettingsView): number {
    return view === "root" ? 0 : 1;
  }

  function settingsViewData(): SettingsViewData {
    return {
      settings: state.settings,
      mcpStatus: state.mcpStatus,
      settingsView: state.settingsView,
      mcpSetupCopyState: state.mcpSetupCopyState,
      setupCommand: ANNOTE_LOCAL_SETUP_COMMAND,
      site: location.host || location.origin,
      noticeHtml: noticeHtml(),
      shortcuts: { pick: SHORTCUTS["toggle-pick"], copy: SHORTCUTS.copy, del: SHORTCUTS.clear },
    };
  }

  function transitionSettingsView(view: SettingsView): void {
    if (settingsTransitioning || state.settingsView === view) return;
    const root = state.shadow;
    const viewport = root?.querySelector<HTMLElement>("[data-settings-viewport]");
    const currentPage = viewport?.querySelector<HTMLElement>("[data-settings-page]");
    if (!root || !viewport || !currentPage) {
      state.settingsView = view;
      render();
      return;
    }
    if (state.settingsView === "mcp" && view !== "mcp") state.mcpClient?.stopSettingsChecks();
    const previousView = state.settingsView;
    state.settingsView = view;
    if (view === "mcp") state.mcpClient?.startSettingsChecks();
    const direction = settingsViewDepth(view) > settingsViewDepth(previousView) ? "forward" : "back";
    settingsTransitioning = true;
    const nextPage = document.createElement("div");
    nextPage.className = `settings-page animating enter-${direction}`;
    nextPage.dataset.settingsPage = "";
    nextPage.dataset.settingsView = view;
    nextPage.innerHTML = renderSettingsPageContent(settingsViewData());
    currentPage.classList.add("animating", `exit-${direction}`);
    // Animate height together with the body: lock current, then ease to next.
    // The entering page is height:100% for the overlay, so its scrollHeight
    // reads the OLD viewport — measure a positioned probe for the true height.
    const currentHeight = Math.ceil(viewport.getBoundingClientRect().height);
    viewport.appendChild(nextPage);
    const probe = nextPage.cloneNode(true) as HTMLElement;
    probe.removeAttribute("data-settings-page");
    probe.classList.remove("animating", `enter-${direction}`);
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.height = "auto";
    probe.style.width = "100%";
    viewport.appendChild(probe);
    const nextHeight = probe.scrollHeight;
    probe.remove();
    viewport.style.height = `${currentHeight}px`;
    void viewport.offsetHeight;
    viewport.classList.add("animating");
    viewport.style.height = `${nextHeight}px`;
    bindShadowEvents();
    window.setTimeout(() => {
      if (!state.shadow?.contains(nextPage)) return;
      currentPage.remove();
      nextPage.classList.remove("animating", `enter-${direction}`);
      viewport.classList.remove("animating");
      viewport.style.height = "";
      settingsTransitioning = false;
    }, 200);
  }

  function renderPanelContent(): string {
    if (state.panelMode === "settings") {
      return renderSettingsContent(settingsViewData());
    }
    return `
      <div class="panel-head">
        <div class="panel-title">
          <h2>Annotations</h2>
        </div>
      </div>
      <div class="list">
        ${
          state.annotations.length
            ? state.annotations
                .map(
                  (annotation, index) => `
                    <article class="item">
                      <div class="item-head">
                        <button class="item-focus" data-action="focus" data-id="${annotation.id}" type="button">
                          <strong><span class="item-index">#${index + 1}</span> ${escapeHtml(annotation.element)}</strong>
                        </button>
                        <span class="item-status">
                          <span class="pill ${escapeHtml(annotation.status || "pending")}">${escapeHtml(annotation.status || "pending")}</span>
                        </span>
                      </div>
                      <div class="item-body">
                        <p>${annotation.status === "detached" ? "Element no longer found. " : ""}${escapeHtml(annotation.comment)}</p>
                        <p class="meta">${escapeHtml(annotation.elementPath)}</p>
                        ${renderReviewReactContext(annotation)}
                        ${renderReviewStyleChanges(annotation)}
                      </div>
                    </article>`,
                )
                .join("")
            : `<p class="meta">No annotations yet. Turn on Pick and click an element.</p>`
        }
      </div>
      ${state.notice !== "This element already has an annotation." ? noticeHtml() : ""}
    `;
  }

  function syncComposerSubmitState(): void {
    const root = state.shadow;
    const composer = root?.querySelector("[data-composer]");
    if (!root || !composer) return;
    const meaningful = draftIsMeaningful();
    const editingAnnotation = state.editingId
      ? state.annotations.find((annotation) => annotation.id === state.editingId)
      : null;
    const existingPromptHasText = !!editingAnnotation && !!(state.draft?.comment.trim() || editingAnnotation.comment.trim());
    const showMicAffordance = !meaningful && !existingPromptHasText;
    const showCompactSubmit = meaningful || existingPromptHasText;
    composer.querySelector("[data-mic-affordance]")?.classList.toggle("hidden", !showMicAffordance);
    composer.querySelectorAll<HTMLButtonElement>("[data-composer-submit]").forEach((button) => {
      button.disabled = !meaningful;
      button.classList.toggle("hidden", !showCompactSubmit && button.classList.contains("submit-icon"));
    });
    const undoButton = composer.querySelector<HTMLButtonElement>('[data-action="undo-edit"]');
    if (undoButton) undoButton.disabled = !(state.draft?.undoStack.length);
  }

  function resetStylePanelUiState(): void {
    state.styleScrollTop = 0;
    state.openFontMenu = null;
    state.openTokenMenu = null;
    state.unlinkedBoxProperties = {};
    state.unlinkedTokenProperties = {};
  }

  function stopMotionReadoutLoop(): void {
    if (state.motionFrame !== null) cancelAnimationFrame(state.motionFrame);
    state.motionFrame = null;
  }

  function syncMotionReadout(): void {
    const animation = selectedAnimation();
    const edit = selectedAnimationEdit();
    const root = state.shadow;
    if (!animation || !root) return;
    const { current, progress, duration } = normalizedMotionTime(animation, edit);
    const activeTick = motionTickIndex(progress);
    const progressPercent = motionTickPercent(activeTick);
    root.querySelectorAll<HTMLElement>("[data-motion-tick]").forEach((item) => {
      const index = Number(item.dataset.motionTick);
      item.classList.toggle("filled", Number.isFinite(index) && index <= activeTick);
      item.classList.toggle("active", index === activeTick);
    });
    root.querySelectorAll<HTMLElement>("[data-motion-progress]").forEach((item) => {
      item.style.width = progressPercent;
    });
    root.querySelectorAll<HTMLElement>("[data-motion-thumb]").forEach((item) => {
      item.style.left = progressPercent;
    });
    root.querySelectorAll<HTMLElement>("[data-motion-scrubber]").forEach((item) => {
      item.setAttribute("aria-valuenow", String(Math.round(current)));
      item.setAttribute("aria-valuemax", String(Math.round(duration)));
      item.style.setProperty("--motion-progress", progressPercent);
    });
    root.querySelectorAll<HTMLElement>("[data-motion-time]").forEach((item) => {
      item.textContent = formatMotionSeconds(current);
    });
    const play = root.querySelector<HTMLElement>("[data-motion-play]");
    if (play) {
      const running = isMotionRunning(animation);
      play.innerHTML = icon(running ? "pause" : "play");
      play.setAttribute("aria-label", running ? "Pause animation" : "Play animation");
    }
  }

  function shouldMonitorMotion(): boolean {
    return Boolean(state.cssOpen && selectedAnimation() && state.shadow?.querySelector("[data-motion-section]"));
  }

  function startMotionReadoutLoop(): void {
    stopMotionReadoutLoop();
    const tick = (): void => {
      syncMotionReadout();
      if (shouldMonitorMotion() || state.motionScrub) {
        state.motionFrame = requestAnimationFrame(tick);
      } else {
        state.motionFrame = null;
      }
    };
    state.motionFrame = requestAnimationFrame(tick);
  }

  function updateAnimationField(field: string, value: string, renderAfter = false): void {
    const edit = selectedAnimationEdit();
    if (!edit) return;
    applyAnimationInput(edit, field, value);
    applyAnimationPreview();
    syncComposerSubmitState();
    if (renderAfter) render();
  }

  function motionPaneTabIndex(tab: AnnotationDraft["motionPaneTab"]): number {
    if (tab === "time") return 1;
    if (tab === "physics") return 2;
    return 0;
  }

  function switchMotionPaneTab(tab: AnnotationDraft["motionPaneTab"]): void {
    if (!state.draft || state.draft.motionPaneTab === tab) return;
    const previousTab = state.draft.motionPaneTab;
    const root = state.shadow;
    const tabs = root?.querySelector<HTMLElement>(".motion-tabs");
    tabs?.style.setProperty("--motion-tab-index", String(motionPaneTabIndex(tab)));
    root?.querySelectorAll<HTMLElement>("[data-motion-tab]").forEach((control) => {
      const active = control.dataset.motionTab === tab;
      control.classList.toggle("active", active);
      control.setAttribute("aria-selected", active ? "true" : "false");
    });
    const panel = root?.querySelector<HTMLElement>(".motion-tab-panel");
    panel?.classList.add("exiting");
    state.motionPaneTab = tab;
    state.draft.motionPaneTab = tab;
    animateMotionGraphTab(previousTab, tab);
    window.setTimeout(() => {
      updateMotionFieldsPanel();
    }, 140);
  }

  function updateMotionFieldsPanel(): void {
    const panel = state.shadow?.querySelector<HTMLElement>(".motion-tab-panel");
    const selected = selectedAnimation();
    const edit = selectedAnimationEdit();
    if (!panel || !selected || !edit) return;
    const startHeight = panel.getBoundingClientRect().height;
    panel.style.height = `${startHeight}px`;
    panel.innerHTML = renderMotionPaneContent(selected, edit, motionDuration(selected, edit));
    panel.setAttribute("data-motion-tab-panel", state.draft?.motionPaneTab || state.motionPaneTab);
    bindMotionInputs(panel);
    const endHeight = panel.scrollHeight;
    panel.classList.remove("exiting");
    if (!prefersReducedMotion()) {
      panel.animate([{ height: `${startHeight}px`, opacity: 0.55 }, { height: `${endHeight}px`, opacity: 1 }], {
        duration: 180,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
    panel.style.height = `${endHeight}px`;
    window.setTimeout(() => {
      panel.style.height = "";
    }, 190);
  }

  function updateMotionFieldFill(input: HTMLInputElement): void {
    const field = input.dataset.animationField || "";
    const row = input.closest<HTMLElement>(".motion-field");
    const valueInput = row?.querySelector<HTMLInputElement>(`[data-motion-field-value="${cssEscape(field)}"]`);
    if (!row || input.type !== "range") return;
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    row.style.setProperty("--motion-fill", `${motionFill(value, min, max)}%`);
    if (!valueInput) return;
    if (field === "duration" || field === "delay" || field === "spring-duration") valueInput.value = formatMotionSeconds(value);
    else if (field === "speed") valueInput.value = formatMotionSpeed(value);
    else valueInput.value = String(Math.round(value * 100) / 100);
  }

  function motionFieldNumericValue(field: string, edit: AnimationEdit): number | null {
    if (field === "duration") return edit.value.duration;
    if (field === "delay") return edit.value.delay;
    if (field === "speed") return edit.value.playbackRate;
    if (field === "iterations") return edit.value.iterations === "infinite" ? 10 : edit.value.iterations;
    const bezier = parseCubicBezier(edit.easingInput);
    if (bezier) {
      if (field === "easing-x1") return bezier[0];
      if (field === "easing-y1") return bezier[1];
      if (field === "easing-x2") return bezier[2];
      if (field === "easing-y2") return bezier[3];
    }
    const spring = parseSpringEasing(edit.easingInput);
    if (field === "spring-stiffness") return spring?.stiffness ?? 200;
    if (field === "spring-damping") return spring?.damping ?? 25;
    if (field === "spring-mass") return spring?.mass ?? 1;
    return null;
  }

  function syncMotionControlRow(input: HTMLInputElement): void {
    const field = input.dataset.animationField || "";
    const edit = selectedAnimationEdit();
    const row = input.closest<HTMLElement>(".motion-field");
    const range = row?.querySelector<HTMLInputElement>(`input.motion-range[data-animation-field="${cssEscape(field)}"]`);
    if (!edit || !row || !range) return;
    if (input.type === "range") {
      updateMotionFieldFill(input);
      return;
    }
    const value = motionFieldNumericValue(field, edit);
    if (value === null || !Number.isFinite(value)) return;
    const min = Number(range.min);
    const max = Number(range.max);
    const clampedValue = Math.max(min, Math.min(max, value));
    range.value = String(clampedValue);
    row.style.setProperty("--motion-fill", `${motionFill(clampedValue, min, max)}%`);
  }

  function updateCubicBezierField(field: string, value: string): boolean {
    const edit = selectedAnimationEdit();
    if (!edit) return false;
    const bezier = parseCubicBezier(edit.easingInput) || [0.25, 0.1, 0.25, 1];
    const amount = Number(value);
    if (!Number.isFinite(amount)) return false;
    const next: CubicBezier = [...bezier];
    if (field === "easing-x1") next[0] = amount;
    else if (field === "easing-y1") next[1] = amount;
    else if (field === "easing-x2") next[2] = amount;
    else if (field === "easing-y2") next[3] = amount;
    else return false;
    applyAnimationInput(edit, "easing", formatCubicBezier(next));
    applyAnimationPreview();
    updateMotionGraphDom(next);
    syncComposerSubmitState();
    return true;
  }

  function updateSpringField(field: string, value: string): boolean {
    const edit = selectedAnimationEdit();
    if (!edit) return false;
    const current = parseSpringEasing(edit.easingInput) || {};
    const amount = Number(value);
    if (!Number.isFinite(amount)) return false;
    const stiffness = field === "spring-stiffness" ? Math.max(1, amount) : current.stiffness ?? 200;
    const damping = field === "spring-damping" ? Math.max(1, amount) : current.damping ?? 25;
    const mass = field === "spring-mass" ? Math.max(0.1, amount) : current.mass ?? 1;
    if (field !== "spring-stiffness" && field !== "spring-damping" && field !== "spring-mass") return false;
    applyAnimationInput(
      edit,
      "easing",
      `spring(stiffness: ${Math.round(stiffness * 100) / 100}, damping: ${Math.round(damping * 100) / 100}, mass: ${Math.round(mass * 100) / 100})`,
    );
    applyAnimationPreview();
    updateMotionSpringGraphDom({ stiffness, damping, mass });
    syncComposerSubmitState();
    return true;
  }

  function updateMotionGraphDom(bezier: CubicBezier): void {
    const root = state.shadow;
    if (!root) return;
    const graph = root.querySelector<HTMLElement>("[data-motion-graph]");
    const curve = graph?.querySelector<SVGPathElement>(".motion-graph-curve");
    const h1 = graph?.querySelector<SVGCircleElement>('[data-motion-graph-handle="1"]');
    const h2 = graph?.querySelector<SVGCircleElement>('[data-motion-graph-handle="2"]');
    const p1 = motionGraphHandlePosition(bezier, 1);
    const p2 = motionGraphHandlePosition(bezier, 2);
    curve?.setAttribute("d", motionGraphBezierPath(bezier));
    h1?.setAttribute("cx", String(p1.x));
    h1?.setAttribute("cy", String(p1.y));
    h2?.setAttribute("cx", String(p2.x));
    h2?.setAttribute("cy", String(p2.y));
  }

  function syncMotionGraphHandles(tab: AnnotationDraft["motionPaneTab"], edit: AnimationEdit): void {
    const graph = state.shadow?.querySelector<HTMLElement>("[data-motion-graph]");
    const svg = graph?.querySelector<SVGSVGElement>("svg");
    if (!svg) return;
    const bezier = tab === "physics" ? null : parseCubicBezier(edit.easingInput);
    if (!bezier) {
      svg.querySelectorAll("[data-motion-graph-handle]").forEach((handle) => handle.remove());
      return;
    }
    ([1, 2] as const).forEach((handleIndex) => {
      const position = motionGraphHandlePosition(bezier, handleIndex);
      let handle = svg.querySelector<SVGCircleElement>(`[data-motion-graph-handle="${handleIndex}"]`);
      if (!handle) {
        handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        handle.classList.add("motion-graph-handle");
        handle.setAttribute("r", "5");
        handle.setAttribute("tabindex", "0");
        handle.setAttribute("data-motion-graph-handle", String(handleIndex));
        handle.addEventListener("pointerdown", beginMotionGraphDrag);
        svg.appendChild(handle);
      }
      handle.setAttribute("cx", String(position.x));
      handle.setAttribute("cy", String(position.y));
    });
  }

  function animateMotionGraphTab(fromTab: AnnotationDraft["motionPaneTab"], toTab: AnnotationDraft["motionPaneTab"]): void {
    const edit = selectedAnimationEdit();
    const curve = state.shadow?.querySelector<SVGPathElement>("[data-motion-graph] .motion-graph-curve");
    if (!edit || !curve) return;
    const from = motionGraphPointsForTab(fromTab, edit);
    const to = motionGraphPointsForTab(toTab, edit);
    const duration = 240;
    const started = performance.now();
    const frame = (time: number): void => {
      const t = Math.max(0, Math.min(1, (time - started) / duration));
      const eased = 1 - (1 - t) ** 3;
      const points = from.map((point, index) => {
        const target = to[index] || point;
        return {
          x: point.x + (target.x - point.x) * eased,
          y: point.y + (target.y - point.y) * eased,
        };
      });
      curve.setAttribute("d", motionGraphPath(points));
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        curve.setAttribute("d", motionGraphPath(to));
        syncMotionGraphHandles(toTab, edit);
      }
    };
    syncMotionGraphHandles(fromTab, edit);
    requestAnimationFrame(frame);
  }

  function syncBezierControlRows(bezier: CubicBezier): void {
    const root = state.shadow;
    if (!root) return;
    const values: Array<[string, number]> = [
      ["easing-x1", bezier[0]],
      ["easing-y1", bezier[1]],
      ["easing-x2", bezier[2]],
      ["easing-y2", bezier[3]],
    ];
    values.forEach(([field, value]) => {
      const input = root.querySelector<HTMLInputElement>(`[data-motion-field-value="${cssEscape(field)}"]`);
      const range = root.querySelector<HTMLInputElement>(`input.motion-range[data-animation-field="${cssEscape(field)}"]`);
      const row = input?.closest<HTMLElement>(".motion-field") || range?.closest<HTMLElement>(".motion-field");
      const rounded = String(Math.round(value * 100) / 100);
      if (input) input.value = rounded;
      if (range) {
        range.value = String(value);
        row?.style.setProperty("--motion-fill", `${motionFill(value, Number(range.min), Number(range.max))}%`);
      }
    });
  }

  function updateMotionSpringGraphDom(config: { stiffness: number; damping: number; mass: number }): void {
    const root = state.shadow;
    const edit = selectedAnimationEdit();
    if (!root || !edit) return;
    const graph = root.querySelector<HTMLElement>("[data-motion-graph]");
    const curve = graph?.querySelector<SVGPathElement>(".motion-graph-curve");
    curve?.setAttribute("d", motionGraphSpringPath(config, Math.max(200, edit.value.duration || 800)));
  }

  function motionGraphPoint(event: PointerEvent, graph: HTMLElement): { x: number; y: number } {
    const rect = graph.getBoundingClientRect();
    const x = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    const y = rect.height ? (rect.bottom - event.clientY) / rect.height : 0;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(-0.2, Math.min(1.2, y)) };
  }

  function updateMotionGraphFromPointer(event: PointerEvent): void {
    const handle = state.motionGraphDrag;
    const edit = selectedAnimationEdit();
    const graph = state.shadow?.querySelector<HTMLElement>("[data-motion-graph]");
    if (!handle || !edit || !graph || edit.animationId !== handle.animationId) return;
    event.preventDefault();
    const current = parseCubicBezier(edit.easingInput) || [0.25, 0.1, 0.25, 1];
    const point = motionGraphPoint(event, graph);
    const next: CubicBezier =
      handle.handle === 1 ? [point.x, point.y, current[2], current[3]] : [current[0], current[1], point.x, point.y];
    const value = formatCubicBezier(next);
    const input = state.shadow?.querySelector<HTMLInputElement>('[data-animation-field="easing"]');
    if (input) input.value = value;
    applyAnimationInput(edit, "easing", value);
    applyAnimationPreview();
    updateMotionGraphDom(next);
    syncBezierControlRows(next);
    syncComposerSubmitState();
  }

  function endMotionGraphDrag(): void {
    if (!state.motionGraphDrag) return;
    state.motionGraphDrag = null;
    document.removeEventListener("pointermove", updateMotionGraphFromPointer, true);
    document.removeEventListener("pointerup", endMotionGraphDrag, true);
    document.removeEventListener("pointercancel", endMotionGraphDrag, true);
  }

  function beginMotionGraphDrag(event: PointerEvent): void {
    const handle = event.currentTarget as SVGCircleElement;
    const animationId = handle.closest<HTMLElement>("[data-motion-graph]")?.dataset.animationId;
    if (!animationId) return;
    event.preventDefault();
    event.stopPropagation();
    state.motionGraphDrag = { animationId, handle: handle.dataset.motionGraphHandle === "2" ? 2 : 1 };
    document.addEventListener("pointermove", updateMotionGraphFromPointer, true);
    document.addEventListener("pointerup", endMotionGraphDrag, true);
    document.addEventListener("pointercancel", endMotionGraphDrag, true);
    updateMotionGraphFromPointer(event);
  }

  function setAnimationTime(animation: NormalizedAnimation, duration: number, clientX: number, scrubber: HTMLElement): void {
    const rect = scrubber.getBoundingClientRect();
    const progress = rect.width ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    selectedMotionRuntimes(animation).forEach((runtime) => {
      try {
        runtime.currentTime = progress * duration;
      } catch {
        // Some browser-created animations reject currentTime writes while pending.
      }
    });
    syncMotionReadout();
  }

  function scrubberKeyStep(event: KeyboardEvent): void {
    const scrubber = event.currentTarget as HTMLElement;
    const animation = selectedAnimation();
    const edit = selectedAnimationEdit();
    if (!animation) return;
    const duration = motionDuration(animation, edit);
    if (!duration) return;
    let delta: number | null = null;
    if (event.key === "ArrowLeft") delta = -(event.shiftKey ? 0.1 : 0.05);
    else if (event.key === "ArrowRight") delta = event.shiftKey ? 0.1 : 0.05;
    else if (event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    const rect = scrubber.getBoundingClientRect();
    const progress =
      event.key === "Home" ? 0 : event.key === "End" ? 1 : Math.max(0, Math.min(1, normalizedMotionTime(animation, edit).current / duration + (delta as number)));
    setAnimationTime(animation, duration, rect.left + progress * rect.width, scrubber);
    scrubber.setAttribute("aria-valuenow", String(Math.round(progress * duration)));
  }

  function beginMotionScrub(event: PointerEvent): void {
    const scrubber = event.currentTarget as HTMLElement;
    const animation = selectedAnimation();
    const edit = selectedAnimationEdit();
    if (!animation) return;
    event.preventDefault();
    event.stopPropagation();
    const duration = motionDuration(animation, edit);
    const wasRunning = isMotionRunning(animation);
    selectedMotionRuntimes(animation).forEach((runtime) => runtime.pause());
    state.motionScrub = { animationId: animation.id, wasRunning, duration, scrubber };
    scrubber.classList.add("scrubbing");
    scrubber.setPointerCapture?.(event.pointerId);
    setAnimationTime(animation, duration, event.clientX, scrubber);
    startMotionReadoutLoop();
  }

  function moveMotionScrub(event: PointerEvent): void {
    const scrub = state.motionScrub;
    const animation = selectedAnimation();
    if (!scrub || !animation || scrub.animationId !== animation.id) return;
    event.preventDefault();
    setAnimationTime(animation, scrub.duration, event.clientX, scrub.scrubber);
  }

  function endMotionScrub(): void {
    const scrub = state.motionScrub;
    const animation = selectedAnimation();
    state.motionScrub = null;
    scrub?.scrubber.classList.remove("scrubbing");
    if (scrub?.wasRunning && animation?.id === scrub.animationId) {
      selectedMotionRuntimes(animation).forEach((runtime) => void runtime.play());
    }
    syncMotionReadout();
    if (animation) startMotionReadoutLoop();
  }

  function clearToolbarTooltipTimer(timer: number | null): null {
    if (timer !== null) window.clearTimeout(timer);
    return null;
  }

  function resetToolbarTooltipGroup(resetWarm = false): void {
    toolbarTooltipOpenTimer = clearToolbarTooltipTimer(toolbarTooltipOpenTimer);
    toolbarTooltipCloseTimer = clearToolbarTooltipTimer(toolbarTooltipCloseTimer);
    toolbarTooltipCoolTimer = clearToolbarTooltipTimer(toolbarTooltipCoolTimer);
    toolbarTooltipActive?.removeAttribute("aria-describedby");
    toolbarTooltipActive = null;
    toolbarTooltipPending = null;
    toolbarTooltipLastCenter = null;
    if (resetWarm) toolbarTooltipWarm = false;
    state.shadow?.querySelector("[data-toolbar-tooltip]")?.classList.remove("visible", "multiline");
  }

  function getTooltipContent(control: HTMLElement): { label: string; shortcut: string | null } | null {
    const label = control.getAttribute("data-tooltip") || control.getAttribute("aria-label") || "";
    if (!label) return null;
    const shortcut = shortcutForControl(control) || control.getAttribute("data-shortcut");
    return { label, shortcut: shortcut || null };
  }

  function showAnnoteTooltip(control: HTMLElement): void {
    if (!control.isConnected || control.matches(":disabled")) return;
    const tooltip = state.shadow?.querySelector<HTMLElement>("[data-toolbar-tooltip]");
    const copy = tooltip?.querySelector<HTMLElement>("[data-toolbar-tooltip-copy]");
    const sizer = state.shadow?.querySelector<HTMLElement>("[data-toolbar-tooltip-sizer]");
    if (!tooltip || !copy || !sizer) return;
    const content = getTooltipContent(control);
    if (!content) return;
    const { label, shortcut } = content;
    const displayForMeasure = shortcut ? `${label}  ${shortcut}` : label;
    const controlRect = control.getBoundingClientRect();
    const isRail = !!control.closest(".toolbar, .launcher-wrap");
    // Use toolbar's warm/ready gating only for rail, but keep animation for all
    if (isRail) {
      const toolbar = control.closest(".toolbar");
      if (toolbar && !toolbar.classList.contains("tooltips-ready")) return;
    }
    const center = controlRect.top + controlRect.height / 2;
    const travel = toolbarTooltipLastCenter === null ? 0 : Math.sign(center - toolbarTooltipLastCenter) * 10;
    const wasVisible = tooltip.classList.contains("visible");
    const multiline = displayForMeasure.length > 28;

    toolbarTooltipActive?.removeAttribute("aria-describedby");
    toolbarTooltipActive = control;
    toolbarTooltipPending = null;
    toolbarTooltipWarm = true;
    toolbarTooltipLastCenter = center;
    control.setAttribute("aria-describedby", "feedback-mark-toolbar-tooltip");

    sizer.textContent = displayForMeasure;
    if (shortcut) {
      copy.innerHTML = `<span>${escapeHtml(label)}</span><span class="toolbar-tooltip-shortcut">${escapeHtml(shortcut)}</span>`;
    } else {
      copy.textContent = label;
    }
    tooltip.classList.toggle("multiline", multiline);
    let width: number;
    let left: number;
    let top: number;
    if (isRail) {
      width = Math.min(220, Math.ceil(sizer.getBoundingClientRect().width));
      left = Math.max(8, controlRect.left - width - 12);
      top = Math.max(8, Math.min(innerHeight - 28 - 8, center - 14));
    } else {
      width = multiline ? 200 : Math.min(220, Math.max(28, Math.ceil(displayForMeasure.length * 7.2) + 20));
      left = Math.max(8, Math.min(innerWidth - width - 8, controlRect.left + controlRect.width / 2 - width / 2));
      const estimatedHeight = multiline ? 56 : 28;
      const above = controlRect.top - estimatedHeight - 8 >= 8;
      top = above ? controlRect.top - estimatedHeight - 8 : controlRect.bottom + 8;
      top = Math.max(8, Math.min(innerHeight - estimatedHeight - 8, top));
    }
    tooltip.style.width = `${width}px`;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;

    copy.classList.remove("swapping");
    copy.style.setProperty("--fm-tooltip-travel", `${travel}px`);
    if (wasVisible && travel !== 0) {
      void copy.offsetWidth;
      copy.classList.add("swapping");
    }
    if (!wasVisible) {
      requestAnimationFrame(() => {
        if (toolbarTooltipActive === control) tooltip.classList.add("visible");
      });
    }
  }

  function showToolbarTooltip(control: HTMLElement): void {
    showAnnoteTooltip(control);
  }

  function showFloatingTooltip(control: HTMLElement): void {
    showAnnoteTooltip(control);
  }

  function openFloatingTooltip(control: HTMLElement): void {
    toolbarTooltipCloseTimer = clearToolbarTooltipTimer(toolbarTooltipCloseTimer);
    toolbarTooltipOpenTimer = clearToolbarTooltipTimer(toolbarTooltipOpenTimer);
    toolbarTooltipPending = control;
    toolbarTooltipOpenTimer = window.setTimeout(() => {
      toolbarTooltipOpenTimer = null;
      if (toolbarTooltipPending === control) showFloatingTooltip(control);
    }, 120);
  }

  function closeFloatingTooltip(control: HTMLElement, immediate = false): void {
    if (toolbarTooltipPending === control) {
      toolbarTooltipOpenTimer = clearToolbarTooltipTimer(toolbarTooltipOpenTimer);
      toolbarTooltipPending = null;
    }
    if (toolbarTooltipActive !== control) return;
    const close = (): void => {
      control.removeAttribute("aria-describedby");
      if (toolbarTooltipActive === control) toolbarTooltipActive = null;
      const tooltip = state.shadow?.querySelector("[data-toolbar-tooltip]");
      tooltip?.classList.remove("visible", "multiline");
    };
    if (immediate) close();
    else toolbarTooltipCloseTimer = window.setTimeout(close, 80);
  }

  function openToolbarTooltip(control: HTMLElement, immediate = false): void {
    toolbarTooltipCloseTimer = clearToolbarTooltipTimer(toolbarTooltipCloseTimer);
    toolbarTooltipCoolTimer = clearToolbarTooltipTimer(toolbarTooltipCoolTimer);
    toolbarTooltipOpenTimer = clearToolbarTooltipTimer(toolbarTooltipOpenTimer);
    toolbarTooltipPending = control;
    if (immediate || toolbarTooltipWarm) {
      showToolbarTooltip(control);
      return;
    }
    toolbarTooltipOpenTimer = window.setTimeout(() => {
      toolbarTooltipOpenTimer = null;
      if (toolbarTooltipPending === control) showToolbarTooltip(control);
    }, 200);
  }

  function closeToolbarTooltip(control: HTMLElement, immediate = false): void {
    if (toolbarTooltipPending === control) {
      toolbarTooltipOpenTimer = clearToolbarTooltipTimer(toolbarTooltipOpenTimer);
      toolbarTooltipPending = null;
    }
    if (toolbarTooltipActive !== control) return;
    toolbarTooltipCloseTimer = clearToolbarTooltipTimer(toolbarTooltipCloseTimer);
    const close = (): void => {
      toolbarTooltipCloseTimer = null;
      control.removeAttribute("aria-describedby");
      if (toolbarTooltipActive === control) toolbarTooltipActive = null;
      state.shadow?.querySelector("[data-toolbar-tooltip]")?.classList.remove("visible", "multiline");
      toolbarTooltipCoolTimer = window.setTimeout(() => {
        toolbarTooltipCoolTimer = null;
        toolbarTooltipWarm = false;
        toolbarTooltipLastCenter = null;
      }, 400);
    };
    if (immediate) close();
    else toolbarTooltipCloseTimer = window.setTimeout(close, 120);
  }

  function openAnnoteTooltip(control: HTMLElement, immediate = false): void {
    const isRail = !!control.closest(".toolbar, .launcher-wrap");
    if (isRail) {
      openToolbarTooltip(control, immediate);
      return;
    }
    toolbarTooltipCloseTimer = clearToolbarTooltipTimer(toolbarTooltipCloseTimer);
    toolbarTooltipCoolTimer = clearToolbarTooltipTimer(toolbarTooltipCoolTimer);
    toolbarTooltipOpenTimer = clearToolbarTooltipTimer(toolbarTooltipOpenTimer);
    toolbarTooltipPending = control;
    if (immediate) {
      showAnnoteTooltip(control);
      return;
    }
    toolbarTooltipOpenTimer = window.setTimeout(() => {
      toolbarTooltipOpenTimer = null;
      if (toolbarTooltipPending === control) showAnnoteTooltip(control);
    }, 120);
  }

  function closeAnnoteTooltip(control: HTMLElement, immediate = false): void {
    const isRail = !!control.closest(".toolbar, .launcher-wrap");
    if (isRail) {
      closeToolbarTooltip(control, immediate);
      return;
    }
    if (toolbarTooltipPending === control) {
      toolbarTooltipOpenTimer = clearToolbarTooltipTimer(toolbarTooltipOpenTimer);
      toolbarTooltipPending = null;
    }
    if (toolbarTooltipActive !== control) return;
    toolbarTooltipCloseTimer = clearToolbarTooltipTimer(toolbarTooltipCloseTimer);
    const close = (): void => {
      toolbarTooltipCloseTimer = null;
      control.removeAttribute("aria-describedby");
      if (toolbarTooltipActive === control) toolbarTooltipActive = null;
      state.shadow?.querySelector("[data-toolbar-tooltip]")?.classList.remove("visible", "multiline");
      toolbarTooltipCoolTimer = window.setTimeout(() => {
        toolbarTooltipCoolTimer = null;
        toolbarTooltipWarm = false;
        toolbarTooltipLastCenter = null;
      }, 400);
    };
    if (immediate) close();
    else toolbarTooltipCloseTimer = window.setTimeout(close, 80);
  }

  function resetAnnoteTooltip(resetWarm = false): void {
    resetToolbarTooltipGroup(resetWarm);
  }

  function bindAnnoteTooltip(root: ShadowRoot): void {
    root.querySelectorAll<HTMLElement>("[data-tooltip]").forEach((control) => {
      control.addEventListener("pointerenter", () => openAnnoteTooltip(control));
      control.addEventListener("pointerleave", () => closeAnnoteTooltip(control));
      control.addEventListener("focus", () => openAnnoteTooltip(control, true));
      control.addEventListener("blur", () => closeAnnoteTooltip(control, true));
      control.addEventListener("pointerdown", () => resetAnnoteTooltip(true));
    });
  }

  function bindToolbarTooltipGroup(root: ShadowRoot): void {
    bindAnnoteTooltip(root);
  }

  function render(): void {
    if (!state.shadow) return;
    const activeElement = state.shadow.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const previousStyleScrollTop = state.shadow.querySelector<HTMLElement>(".style-grid-wrap")?.scrollTop ?? state.styleScrollTop;
    if (state.cssOpen) state.styleScrollTop = previousStyleScrollTop;
    const activeFocus =
      activeElement?.matches?.('textarea[name="comment"]')
        ? { selector: 'textarea[name="comment"]', start: activeElement.selectionStart, end: activeElement.selectionEnd }
        : activeElement?.dataset?.cssProperty
          ? {
              selector: `[data-css-property="${cssEscape(activeElement.dataset.cssProperty)}"]`,
              start: activeElement.selectionStart,
              end: activeElement.selectionEnd,
            }
          : activeElement?.matches?.("[data-text-edit]")
            ? { selector: "[data-text-edit]", start: activeElement.selectionStart, end: activeElement.selectionEnd }
            : activeElement?.dataset?.animationField
              ? {
                  selector: activeElement.dataset.motionFieldValue
                    ? `[data-motion-field-value="${cssEscape(activeElement.dataset.motionFieldValue)}"]`
                    : `[data-animation-field="${cssEscape(activeElement.dataset.animationField)}"]`,
                  start: activeElement.type === "range" ? null : activeElement.selectionStart,
                  end: activeElement.type === "range" ? null : activeElement.selectionEnd,
                }
              : null;
    resetToolbarTooltipGroup(true);
    const composerTarget = state.selectedElement;
    const composerPosition = composerTarget ? state.composerPosition || composerPositionFor(composerTarget) : null;
    const hideComposerForShiftSelect = state.shiftSelecting && state.selectedElements.length > 0;
    const editingAnnotation = state.editingId
      ? state.annotations.find((annotation) => annotation.id === state.editingId)
      : null;
    const collapsed = !state.toolbarOpen && !state.visible && !composerTarget;
    const pendingCount = state.annotations.filter((annotation) => !["resolved", "dismissed"].includes(annotation.status || "pending")).length;
    const launcherLabel = pendingCount ? `Open toolbar, ${pendingCount} annotation${pendingCount === 1 ? "" : "s"}` : "Click to open or hold to drag";
    if (state.toolbarRailPinnedToDefault) state.toolbarRailTop = defaultToolbarRailTop();
    const railTop = clampedToolbarRailTop(state.toolbarRailTop, TOOLBAR_RAIL_HEIGHT);
    const railStyle = `--fm-rail-top:${railTop}px`;
    const markers = collapsed
      ? ""
      : state.annotations
          .map((annotation, index) => {
            if (annotation.status === "resolved" || annotation.status === "dismissed") return "";
            const position = markerPosition(annotation);
            if (!position) return "";
            const sideClass = position.left < 292 ? "tip-right" : "tip-left";
            const verticalClass =
              position.top < 90 ? "tip-below" : position.top > innerHeight - 120 ? "tip-above" : "tip-middle";
            return `<button class="marker ${annotation.isMultiSelect ? "multi" : ""} ${state.hoveredMarkerId === annotation.id ? "editing" : ""}" style="left:${position.left}px;top:${position.top}px" data-marker="${annotation.id}" aria-label="Annotation ${index + 1}: ${escapeHtml(annotation.comment)}">
          <span class="marker-count">${index + 1}</span>
          <span class="marker-edit">${icon("edit")}</span>
          <span class="marker-tip ${sideClass} ${verticalClass}" role="presentation">
            <span class="marker-tip-title">${escapeHtml(annotation.element)}</span>
            <span class="marker-tip-copy">${escapeHtml(annotation.comment)}</span>
          </span>
        </button>`;
          })
          .join("");
    const copyIcon = state.copyState === "copied" ? "check" : "copy";
    const copyClass = state.copyState === "copied" ? "success" : "";

    state.shadow.innerHTML = `
      <style>${styles()}</style>
      <div class="fm-layer ${state.active ? "active" : ""}">
        ${
          collapsed
            ? `<div class="launcher-wrap ${state.toolbarDrag ? "dragging" : ""}" data-toolbar-rail data-action="open-toolbar" role="button" tabindex="0" aria-label="${launcherLabel}" data-tooltip="${launcherLabel}" style="${railStyle}"><span class="icon-btn launcher" aria-hidden="true">${icon("note")}</span>${pendingCount ? `<span class="launcher-badge" aria-hidden="true">${pendingCount}</span>` : ""}</div>`
            : `<div class="toolbar ${state.toolbarOpening ? "opening" : ""} ${state.toolbarClosing ? "closing" : ""} ${state.toolbarTooltipsReady ? "tooltips-ready" : ""}" style="${railStyle}">
                <div class="toolbar-controls">
                  ${iconButton("toggle-pick", state.active ? "Stop picking" : "Pick element", "target", "pick-toggle")}
                  ${iconButton("toggle-panel", `Review ${state.annotations.length}`, "note", state.visible && state.panelMode === "review" ? "active-control" : "")}
                  ${iconButton("copy", "Copy unresolved", copyIcon, copyClass, unresolvedAnnotations().length ? "" : 'aria-disabled="true"')}
                  ${iconButton("clear", "Clear annotations", "trash", "danger", state.annotations.length ? "" : 'aria-disabled="true"')}
                  ${iconButton("settings", "Settings", "settings", `${state.visible && state.panelMode === "settings" ? "active-control" : ""} ${mcpNeedsApprovalStatus(state.mcpStatus) ? "needs-attention" : ""}`.trim())}
                  <span class="toolbar-divider" aria-hidden="true"></span>
                  ${iconButton("collapse", "Collapse toolbar", "minus")}
                  ${iconButton("destroy", "Close annotator", "cross", "borderless")}
                </div>
              </div>`
        }
        ${
          collapsed
            ? ""
            : `<div class="toolbar-group-tooltip" id="feedback-mark-toolbar-tooltip" role="tooltip" data-toolbar-tooltip>
                <span class="toolbar-tooltip-copy" data-toolbar-tooltip-copy></span>
              </div>
              <span class="toolbar-tooltip-sizer" data-toolbar-tooltip-sizer aria-hidden="true"></span>`
        }
        <div class="outline hidden" data-hover-outline></div>
        <div class="structure-preview-outline hidden" data-structure-preview-outline></div>
        <div class="selection-outlines" data-selection-outlines></div>
        <div class="label hidden" data-hover-label></div>
        ${collapsed ? "" : markers}
        ${
          composerTarget && composerPosition && !hideComposerForShiftSelect
            ? renderComposer(composerTarget, composerPosition, editingAnnotation || null)
            : ""
        }
        <section class="panel ${state.visible ? "" : "hidden"}" style="${railStyle}" aria-label="${state.panelMode === "settings" ? "Settings panel" : "Annotation review panel"}">
          ${renderPanelContent()}
        </section>
        ${renderConfirm()}
      </div>
    `;

    bindShadowEvents();
    syncMotionReadout();
    if (state.confirm && !state.confirmClosing) {
      const active = state.shadow?.activeElement as HTMLElement | null;
      const dialog = state.shadow?.querySelector<HTMLElement>("[data-confirm]");
      if (dialog && (!active || !dialog.contains(active))) {
        const selector = state.confirmFocus === "delete" ? "[data-action='confirm-delete']" : "[data-confirm-cancel]";
        state.shadow?.querySelector<HTMLButtonElement>(selector)?.focus();
      }
    }
    if (state.cssOpen && selectedAnimation()) startMotionReadoutLoop();
    const restoreStyleScroll = (): void => {
      const styleGridWrap = state.shadow?.querySelector<HTMLElement>(".style-grid-wrap");
      if (styleGridWrap && state.styleScrollTop) styleGridWrap.scrollTop = state.styleScrollTop;
    };
    restoreStyleScroll();
    updateSelectionOverlay();
    updateHoverOverlay();
    ensureInteractionShield();
    if (composerTarget) {
      if (activeFocus || state.focusComposerOnRender) {
        const shouldInitialFocus = state.focusComposerOnRender;
        state.focusComposerOnRender = false;
        requestAnimationFrame(() => {
          const target =
            (activeFocus
              ? state.shadow?.querySelector<HTMLInputElement | HTMLTextAreaElement>(activeFocus.selector)
              : null) ||
            (shouldInitialFocus ? state.shadow?.querySelector<HTMLTextAreaElement>("[data-composer] textarea") : null);
          target?.focus();
          if (activeFocus && activeFocus.start !== null && activeFocus.end !== null) {
            target?.setSelectionRange(activeFocus.start, activeFocus.end);
          }
          restoreStyleScroll();
        });
      }
      requestAnimationFrame(restoreStyleScroll);
      requestAnimationFrame(updateSelectionOverlay);
      window.setTimeout(restoreStyleScroll, 40);
      window.setTimeout(updateSelectionOverlay, 40);
      window.setTimeout(() => {
        state.shadow?.querySelector("[data-composer]")?.classList.remove("entering");
        if (!state.styleEditorOpening) clampComposerToViewport();
      }, 230);
    }
  }

  function animateComposerOut(onComplete: () => void): void {
    const composer = state.shadow?.querySelector<HTMLElement>("[data-composer]");
    if (!composer || composer.classList.contains("exiting")) return;
    composer.classList.remove("shake");
    composer.classList.add("exiting");
    window.setTimeout(onComplete, 150);
  }

  function shakeComposer(): void {
    const composer = state.shadow?.querySelector<HTMLElement>("[data-composer]");
    composer?.classList.remove("shake");
    void composer?.offsetWidth;
    composer?.classList.add("shake");
    window.setTimeout(() => {
      composer?.classList.remove("shake");
    }, 280);
  }

  function blockPanelActionDuringComposer(): boolean {
    if (!state.selectedElement) return false;
    if (state.draft?.styleEdits.some((edit) => edit.value.trim() !== edit.originalValue.trim())) {
      state.cssOpen = true;
      state.styleEditorOpening = false;
      state.styleEditorClosing = false;
      render();
    }
    shakeComposer();
    return true;
  }

  function blockDirtyComposerSwitch(): boolean {
    if (!state.selectedElement || !draftIsDirty()) return false;
    if (state.draft?.styleEdits.some((edit) => edit.value.trim() !== edit.originalValue.trim()) || changedAnimationPatches().length) {
      state.cssOpen = true;
      state.styleEditorOpening = false;
      state.styleEditorClosing = false;
      render();
    }
    shakeComposer();
    return true;
  }

  function onShadowRootClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".font-control, .token-menu-anchor, .autocomplete")) return;
    if (!state.openFontMenu && !state.openTokenMenu && !state.autocomplete) return;
    state.openFontMenu = null;
    state.openTokenMenu = null;
    state.autocomplete = null;
    render();
  }

  function bindMotionInputs(scope: ParentNode): void {
    scope.querySelectorAll<HTMLInputElement>("[data-animation-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.animationField || "";
        if (updateCubicBezierField(field, input.value) || updateSpringField(field, input.value)) {
          syncMotionControlRow(input);
          return;
        }
        updateAnimationField(field, input.value);
        syncMotionControlRow(input);
        const edit = selectedAnimationEdit();
        const valid =
          field === "duration"
            ? !!edit?.validDuration
            : field === "delay"
              ? !!edit?.validDelay
              : field === "easing"
                ? !!edit?.validEasing
                : field === "speed"
                  ? true
                  : !!edit?.validIterations;
        input.setAttribute("aria-invalid", String(!valid));
        input.closest(".motion-field")?.classList.toggle("invalid", !valid);
      });
      input.addEventListener("blur", () => {
        const field = input.dataset.animationField || "";
        if (field === "easing") render();
      });
      input.addEventListener("change", () => {
        const field = input.dataset.animationField || "";
        if (field === "easing") render();
      });
    });
  }

  function bindShadowEvents(): void {
    const root = state.shadow;
    if (!root) return;
    // Full property names for truncated labels (e.g. Grid Template Columns
    // vs Grid Template Rows) — only when actually ellipsis-truncated.
    // The ellipsis lives on the inner span, so measure that, not the row.
    if (state.cssOpen) {
      root.querySelectorAll<HTMLElement>(".css-name > span").forEach((label) => {
        const full = label.textContent?.trim() || "";
        if (full && label.scrollWidth > label.clientWidth + 1) label.setAttribute("data-tooltip", full);
        else label.removeAttribute("data-tooltip");
      });
    }
    bindToolbarTooltipGroup(root);
    if (!state.shadowClickBound) {
      root.addEventListener("click", onShadowRootClick);
      root.addEventListener("focusin", (event) => {
        if (!state.confirm) return;
        const target = event.target as HTMLElement | null;
        if (target?.matches?.("[data-action='confirm-delete']")) state.confirmFocus = "delete";
        else if (target?.matches?.("[data-confirm-cancel]")) state.confirmFocus = "cancel";
      });
      state.shadowClickBound = true;
    }
    root.querySelectorAll<HTMLElement>("[data-action]:not([data-annote-bound])").forEach((control) => {
      control.dataset.annoteBound = "true";
      control.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const clickTarget = event.target;
        if (clickTarget instanceof Element && clickTarget.closest(".settings-help-tip")) return;
        if (state.suppressNextToolbarClick) {
          state.suppressNextToolbarClick = false;
          return;
        }
        // aria-disabled keeps tooltips working (unlike native disabled) —
        // clicks simply do nothing.
        if (control.getAttribute("aria-disabled") === "true") return;
        const action = control.dataset.action;
        const id = control.dataset.id;
        if (action === "open-toolbar") {
          openToolbar();
          state.active = true;
          setAnnotatingCursor(true);
          render();
        }
        if (action === "toggle-pick") togglePick();
        if (action === "toggle-panel") {
          if (blockPanelActionDuringComposer()) return;
          restorePreview();
          state.mcpClient?.stopSettingsChecks();
          state.visible = state.panelMode === "review" ? !state.visible : true;
          state.panelMode = "review";
          state.active = false;
          setAnnotatingCursor(false);
          state.hoverElement = null;
          clearComposerState();
          render();
        }
        if (action === "settings") {
          if (blockPanelActionDuringComposer()) return;
          restorePreview();
          if (state.panelMode === "settings" && state.visible) {
            state.visible = false;
            state.mcpClient?.stopSettingsChecks();
          } else {
            state.visible = true;
            state.panelMode = "settings";
            state.settingsView = "root";
            state.mcpClient?.stopSettingsChecks();
          }
          state.active = false;
          setAnnotatingCursor(false);
          state.hoverElement = null;
          clearComposerState();
          render();
        }
        if (action === "toggle-setting" && control.dataset.setting) {
          const key = control.dataset.setting as keyof FeedbackMarkSettings;
          if (key in state.settings) {
            updateSetting(key, !state.settings[key], false);
            const checked = state.settings[key] ? "true" : "false";
            control.setAttribute("aria-checked", checked);
            const row = control.closest?.(".settings-row");
            row?.setAttribute("aria-checked", checked);
            row?.querySelector('[role="switch"]')?.setAttribute("aria-checked", checked);
          }
        }
        if (action === "settings-view" && control.dataset.settingsView) {
          const view = control.dataset.settingsView;
          if (view === "root" || view === "mcp" || view === "help") {
            state.visible = true;
            state.panelMode = "settings";
            transitionSettingsView(view);
          }
        }
        if (action === "settings-copy-command" || action === "settings-copy-doctor") {
          const command = action === "settings-copy-doctor" ? "npm run mcp:doctor" : ANNOTE_LOCAL_SETUP_COMMAND;
          void navigator.clipboard.writeText(command).then(
            () => {
              state.mcpSetupCopyState = "copied";
              state.notice = action === "settings-copy-doctor" ? "Copied diagnostics command." : "";
              render();
              window.setTimeout(() => {
                state.mcpSetupCopyState = "idle";
                render();
              }, 1400);
            },
            () => {
              state.mcpSetupCopyState = "failed";
              setNotice("Clipboard write failed.", "error");
            },
          );
        }
        if (action === "settings-mcp-allow") {
          void state.mcpClient?.requestPairing();
        }
        if (action === "settings-mcp-revoke") {
          void state.mcpClient?.revoke();
        }
        if (action === "toggle-css") {
          const nextOpen = !state.cssOpen;
          state.styleEditorOpening = nextOpen;
          state.styleEditorClosing = !nextOpen;
          state.cssOpen = nextOpen;
          if (!nextOpen) stopMotionReadoutLoop();
          render();
          if (nextOpen) {
            window.setTimeout(() => {
              if (!state.cssOpen) return;
              state.styleEditorOpening = false;
              root.querySelector(".style-details")?.classList.remove("opening");
              clampComposerToViewport();
            }, 240);
          } else {
            window.setTimeout(() => {
              if (state.cssOpen) return;
              const previousComposer = root.querySelector<HTMLElement>("[data-composer]");
              const previousRect = previousComposer?.getBoundingClientRect();
              state.styleEditorClosing = false;
              state.composerPosition = state.selectedElement ? composerPositionFor(state.selectedElement) : null;
              render();
              const nextComposer = root.querySelector<HTMLElement>("[data-composer]");
              if (nextComposer && previousRect) {
                animateComposerClamp(nextComposer, previousRect.left, previousRect.top);
              } else {
                clampComposerToViewport();
              }
            }, 190);
          }
        }
        if (action === "collapse") {
          collapseToolbar();
        }
        if (action === "delete-current") requestDeleteCurrent();
        if (action === "copy") void copyMarkdown();
        if (action === "clear") requestClearAnnotations();
        if (action === "confirm-cancel") closeConfirm();
        if (action === "confirm-delete") executeConfirm();
        if (action === "destroy") destroy();
        if (action === "cancel-compose") {
          requestCancelComposer();
        }
        if (action === "switch-state" && control.dataset.state && state.draft) {
          state.draft.activeState = control.dataset.state as StyleStateKey;
          state.autocomplete = null;
          state.openFontMenu = null;
          state.openTokenMenu = null;
          applyPreview();
          render();
        }
        if (action === "set-selection-scope" && control.dataset.scope && state.selectedElements.length > 1 && state.selectedElement) {
          if (blockDirtyComposerSwitch()) return;
          const previousComment = state.draft?.comment || "";
          const previousIntent = state.draft?.intent || "fix";
          state.selectionScope = control.dataset.scope === "parent" ? "parent" : "individual";
          startDraft(state.selectedElement);
          if (state.draft) {
            state.draft.comment = previousComment;
            state.draft.intent = previousIntent;
          }
          state.cssOpen = true;
          state.styleEditorClosing = false;
          state.autocomplete = null;
          state.openFontMenu = null;
          state.openTokenMenu = null;
          render();
        }
        if (action === "toggle-structure") {
          if (state.structureAnimating) return;
          if (!state.structureOpen) {
            state.structureOpen = true;
            render();
            if (!prefersReducedMotion()) {
              // WAAPI (not a class dance): deterministic even when no frame
              // paints between state flips.
              state.shadow?.querySelector<HTMLElement>(".structure-body")?.animate(
                [
                  { gridTemplateRows: "0fr", opacity: 0, marginTop: "0" },
                  { gridTemplateRows: "1fr", opacity: 1, marginTop: "6px" },
                ],
                { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
              );
            }
            return;
          }
          const body = state.shadow?.querySelector<HTMLElement>(".structure-body");
          if (body && !prefersReducedMotion()) {
            state.structureAnimating = true;
            body.animate(
              [
                { gridTemplateRows: "1fr", opacity: 1, marginTop: "6px" },
                { gridTemplateRows: "0fr", opacity: 0, marginTop: "0" },
              ],
              { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
            );
            window.setTimeout(() => {
              state.structureAnimating = false;
              state.structureOpen = false;
              render();
            }, 190);
          } else {
            state.structureOpen = false;
            render();
          }
        }
        if (action === "toggle-structure-children") {
          state.structureChildrenExpanded = !state.structureChildrenExpanded;
          render();
        }
        if (action === "toggle-structure-siblings") {
          state.structureSiblingsExpanded = !state.structureSiblingsExpanded;
          render();
        }
        if (control.dataset.structureTarget) {
          if (blockDirtyComposerSwitch()) return;
          const selector = control.dataset.structureTarget;
          const target = resolveElement(selector);
          if (target && isStructureCandidate(target)) {
            const anchor = { x: target.getBoundingClientRect().left + 20, y: target.getBoundingClientRect().top + 20 };
            // Reuse canonical selection path
            state.selectedElements = [];
            updateSelectionOverlay();
            openComposerForElement(target, anchor);
          }
        }
        if (action === "undo-edit") {
          undoDraftEdit();
        }
        if (action === "select-animation" && state.draft && control.dataset.animationId) {
          state.draft.selectedAnimationId = control.dataset.animationId;
          applyAnimationPreview();
          render();
        }
        if (action === "set-motion-pane-tab" && state.draft && control.dataset.motionTab) {
          const tab = control.dataset.motionTab;
          if (tab === "easing" || tab === "time" || tab === "physics") {
            switchMotionPaneTab(tab);
          }
        }
        if (action === "toggle-animation-play") {
          const animation = selectedAnimation();
          if (animation && isMotionRunning(animation)) {
            selectedMotionRuntimes(animation).forEach((runtime) => runtime.pause());
            syncMotionReadout();
          } else if (animation) {
            selectedMotionRuntimes(animation).forEach((runtime) => void runtime.play());
            startMotionReadoutLoop();
          }
        }
        if (action === "replay-animation") {
          const animation = selectedAnimation();
          if (animation) {
            try {
              selectedMotionRuntimes(animation).forEach((runtime) => {
                runtime.currentTime = 0;
                void runtime.play();
              });
              startMotionReadoutLoop();
            } catch {
              syncMotionReadout();
            }
          }
        }
        if (action === "set-animation-speed" && control.dataset.speed) {
          updateAnimationField("speed", control.dataset.speed, true);
        }
        if (action === "set-segment") {
          const property = control.dataset.property || "";
          const value = control.dataset.value || "";
          const input = root.querySelector<HTMLInputElement>(`[data-css-property="${cssEscape(property)}"]`);
          const original = control.dataset.originalValue || input?.dataset.originalValue || "";
          updateStyleEdit(property, value, original);
          state.autocomplete = null;
          state.openFontMenu = null;
          state.openTokenMenu = null;
          render();
        }
        if (action === "toggle-font-menu") {
          const property = control.dataset.property || "";
          state.openFontMenu = state.openFontMenu === property ? null : property;
          state.openTokenMenu = null;
          state.autocomplete = null;
          render();
        }
        if (action === "set-font-option") {
          const property = control.dataset.property || "";
          const value = control.dataset.value || "";
          updateStyleEdit(property, value, control.dataset.originalValue || "");
          state.openFontMenu = null;
          state.autocomplete = null;
          state.openTokenMenu = null;
          render();
        }
        if (action === "toggle-token-menu") {
          const property = control.dataset.property || "";
          const key = editorStateKey(property);
          state.openTokenMenu = state.openTokenMenu === key ? null : key;
          state.openFontMenu = null;
          state.autocomplete = null;
          render();
        }
        if (action === "apply-token") {
          const property = control.dataset.property || "";
          const token = control.dataset.token || "";
          if (property && token) {
            const tokenValue = `var(${token})`;
            const row = state.inspection?.rowsByState[state.draft?.activeState || "current"]?.find((item) => item.property === property);
            const tokenHint = row?.tokenHints.find((item) => item.name === token);
            const valid = tokenHint ? isTokenValueValidForProperty(property, tokenHint.value) : false;
            updateStyleEdit(property, tokenValue, control.dataset.originalValue || "", true, valid);
            delete state.unlinkedTokenProperties[editorStateKey(property)];
            state.autocomplete = null;
            state.openFontMenu = null;
            state.openTokenMenu = null;
            render();
          }
        }
        if (action === "unlink-token") {
          const property = control.dataset.property || "";
          const row = state.inspection?.rowsByState[state.draft?.activeState || "current"]?.find((item) => item.property === property);
          const value = row ? currentRowValue(row) : "";
          const explicit = tokenNameFromValue(value);
          const token = row?.tokenHints.find((item) => item.name === explicit) || row?.tokenHints[0];
          state.unlinkedTokenProperties[editorStateKey(property)] = true;
          state.openTokenMenu = null;
          state.openFontMenu = null;
          state.autocomplete = null;
          if (row && explicit) updateStyleEdit(property, token?.value || row.value, control.dataset.originalValue || "", false);
          render();
        }
        if (action === "toggle-box-link") {
          const property = control.dataset.property || "";
          const key = editorStateKey(property);
          const row = state.inspection?.rowsByState[state.draft?.activeState || "current"]?.find((item) => item.property === property);
          const value = row ? currentRowValue(row) : control.dataset.currentBox || "";
          if (boxValueIsLinked(value) && !state.unlinkedBoxProperties[key]) {
            state.unlinkedBoxProperties[key] = true;
          } else {
            const first = splitBoxValue(value)[0] || value;
            updateStyleEdit(property, first, control.dataset.originalValue || "", false);
            delete state.unlinkedBoxProperties[key];
          }
          state.autocomplete = null;
          state.openFontMenu = null;
          state.openTokenMenu = null;
          render();
        }
        if (action === "step-css") {
          const property = control.dataset.property || "";
          const direction = control.dataset.direction === "-1" ? -1 : 1;
          const input = root.querySelector<HTMLInputElement>(`[data-css-property="${cssEscape(property)}"]`);
          if (input) {
            const nextValue = stepCssNumericValue(property, input.value, direction);
            if (nextValue !== null) {
              updateStyleEdit(property, nextValue, input.dataset.originalValue || "");
              state.autocomplete = null;
              state.openFontMenu = null;
              render();
            }
          }
        }
        if (action === "accept-suggestion") {
          const property = control.dataset.property || "";
          const value = control.dataset.value || "";
          const input = root.querySelector<HTMLInputElement>(`[data-css-property="${cssEscape(property)}"]`);
          if (input) {
            input.value = value;
            updateStyleEdit(property, value, input.dataset.originalValue || "");
            state.autocomplete = null;
            state.openFontMenu = null;
            render();
          }
        }
        if (action === "activate") activate();
        if (action === "resolve" && id) updateStatus(id, "resolved");
        if (action === "delete-annotation" && id) deleteAnnotation(id);
        if (action === "focus" && id) focusAnnotation(id);
      });
    });

    root.querySelectorAll<HTMLElement>("[data-marker]").forEach((marker) => {
      marker.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = marker.dataset.marker;
        const annotation = state.annotations.find((item) => item.id === id);
        const multiTargets = annotation?.isMultiSelect ? annotation.targetElements?.length ? annotation.targetElements : resolveMultiElements(annotation) : [];
        const element = multiTargets[0] || annotation?.targetElement || (annotation ? resolveElement(annotation.elementPath) : null);
        if (annotation && element) {
          if (blockDirtyComposerSwitch()) return;
          annotation.targetElements = multiTargets;
          openComposerForAnnotation(annotation, element, { x: event.clientX, y: event.clientY });
        }
      });
    });

    root.querySelector<HTMLFormElement>("[data-composer]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const form = event.currentTarget as HTMLFormElement;
      if (!state.selectedElement || !state.draft || !draftIsMeaningful()) return;
      const annotation = makeAnnotation(state.selectedElement, form);
      annotation.comment = state.draft.comment.trim();
      annotation.intent = state.draft.intent;
      annotation.textEdit =
        state.draft.textEdit && state.draft.textEdit.value !== state.draft.textEdit.originalValue
          ? { ...state.draft.textEdit, path: [...state.draft.textEdit.path] }
          : undefined;
      annotation.styleEdits = changedStyleEdits();
      annotation.animationPatches = changedAnimationPatches();
      annotation.animationPatch = annotation.animationPatches[0];
      if (!annotation.animationPatches.length) annotation.animationPatches = undefined;
      annotation.reactContext = state.settings.reactContext && state.reactContext ? toJsonSafeReactContext(state.reactContext) : undefined;
      annotation.thread = annotation.comment
        ? [{ id: uid("msg"), role: "human", content: annotation.comment, timestamp: Date.now() }]
        : [];
      const editingId = state.editingId;
      animateComposerOut(() => {
        let committedAnnotation = annotation;
        if (editingId) {
          const existing = state.annotations.find((item) => item.id === editingId);
          if (existing) {
            existing.comment = annotation.comment;
            existing.intent = annotation.intent;
            existing.textEdit = annotation.textEdit;
            existing.styleEdits = annotation.styleEdits;
            existing.animationPatch = annotation.animationPatch;
            existing.animationPatches = annotation.animationPatches;
            existing.reactContext = annotation.reactContext;
            existing.timestamp = Date.now();
            existing.boundingBox = annotation.boundingBox;
            existing.computedStyles = annotation.computedStyles;
            existing.cssClasses = annotation.cssClasses;
            existing.accessibility = annotation.accessibility;
            existing.nearbyText = annotation.nearbyText;
            existing.selectorAlternatives = annotation.selectorAlternatives;
            existing.isMultiSelect = annotation.isMultiSelect;
            existing.multiSelectElements = annotation.multiSelectElements;
            existing.targetElements = annotation.targetElements;
            existing.thread = existing.thread || [];
            if (annotation.comment) {
              existing.thread.push({ id: uid("msg"), role: "human", content: annotation.comment, timestamp: Date.now() });
            }
            committedAnnotation = existing;
          }
        } else {
          state.annotations.push(annotation);
        }
        commitAnnotationEffects(committedAnnotation);
        clearComposerState();
        state.active = true;
        saveAnnotations();
        observeTargets();
        render();
      });
    });

    const composer = root.querySelector<HTMLFormElement>("[data-composer]");
    root.querySelector<HTMLElement>("[data-drag-handle]")?.addEventListener("pointerdown", beginComposerDrag);
    root.querySelector<HTMLElement>("[data-toolbar-rail]")?.addEventListener("pointerdown", beginToolbarRailDrag);
    root.querySelector<HTMLElement>("[data-motion-scrubber]")?.addEventListener("pointerdown", beginMotionScrub);
    root.querySelector<HTMLElement>("[data-motion-scrubber]")?.addEventListener("pointermove", moveMotionScrub);
    root.querySelector<HTMLElement>("[data-motion-scrubber]")?.addEventListener("pointerup", endMotionScrub);
    root.querySelector<HTMLElement>("[data-motion-scrubber]")?.addEventListener("pointercancel", endMotionScrub);
    root.querySelector<HTMLElement>("[data-motion-scrubber]")?.addEventListener("keydown", scrubberKeyStep);
    // The confirm scrim must fully arrest the page: no scroll-through.
    root.querySelector<HTMLElement>("[data-confirm-scrim]")?.addEventListener("wheel", (event) => event.preventDefault(), { passive: false });
    root.querySelector<HTMLElement>("[data-confirm-scrim]")?.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
    root.querySelectorAll<SVGCircleElement>("[data-motion-graph-handle]").forEach((handle) => {
      handle.addEventListener("pointerdown", beginMotionGraphDrag);
    });
    root.querySelector<HTMLElement>(".style-grid-wrap")?.addEventListener("scroll", (event) => {
      state.styleScrollTop = (event.currentTarget as HTMLElement).scrollTop;
    });
    const comment = composer?.querySelector<HTMLTextAreaElement>('textarea[name="comment"]');
    if (comment) {
      comment.addEventListener("input", () => {
        if (state.draft) state.draft.comment = comment.value;
        syncComposerSubmitState();
      });
      comment.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (draftIsMeaningful()) composer?.requestSubmit();
        }
      });
    }

    root.querySelectorAll<HTMLInputElement>("[data-css-property]").forEach((input) => {
      input.addEventListener("input", () => {
        updateStyleEdit(input.dataset.cssProperty || "", input.value, input.dataset.originalValue || "");
        state.autocomplete = { property: input.dataset.cssProperty || "", index: 0 };
        state.openTokenMenu = null;
        const invalid = cssValueStatus(input.dataset.cssProperty || "", input.value) === "invalid";
        input.setAttribute("aria-invalid", String(invalid));
        input.closest(".css-row")?.classList.toggle("invalid", invalid);
        input.closest(".css-row")?.classList.toggle("changed", input.value.trim() !== (input.dataset.originalValue || "").trim());
        syncComposerSubmitState();
        if (input.closest(".css-value-wrap")) render();
      });
      input.addEventListener("focus", () => {
        state.autocomplete = { property: input.dataset.cssProperty || "", index: 0 };
      });
      input.addEventListener("blur", () => {
        const property = input.dataset.cssProperty || "";
        const edit = state.draft?.styleEdits.find((item) => item.state === state.draft?.activeState && item.property === property);
        if (edit) edit.valid = isValidCssValue(property, input.value);
        window.setTimeout(() => {
          const activeInput = state.shadow?.activeElement as HTMLInputElement | null;
          if (activeInput?.dataset?.cssProperty === property) return;
          if (state.shadow?.querySelector(`[data-suggestions="${cssEscape(property)}"]`)) return;
          state.autocomplete = null;
          render();
        }, 120);
      });
      input.addEventListener("keydown", (event) => {
        const property = input.dataset.cssProperty || "";
        const suggestions = autocompleteSuggestions(property, input.value);
        const autocompleteOpen = state.autocomplete?.property === property && suggestions.length > 0;
        if (["ArrowDown", "ArrowUp"].includes(event.key) && autocompleteOpen) {
          event.preventDefault();
          const current = state.autocomplete?.index || 0;
          state.autocomplete = {
            property,
            index: event.key === "ArrowDown" ? Math.min(suggestions.length - 1, current + 1) : Math.max(0, current - 1),
          };
          updateAutocompleteDom(root, property);
          return;
        }
        if ((event.key === "Enter" || event.key === "Tab") && autocompleteOpen) {
          event.preventDefault();
          const value = (suggestions[state.autocomplete?.index || 0] || suggestions[0]).value;
          input.value = value;
          updateStyleEdit(property, value, input.dataset.originalValue || "");
          state.autocomplete = null;
          render();
          return;
        }
        if (event.key === "Escape" && state.autocomplete?.property === property) {
          event.preventDefault();
          state.autocomplete = null;
          render();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const direction = event.key === "ArrowDown" ? -1 : 1;
          const nextValue = stepCssNumericValue(property, input.value, direction);
          if (nextValue !== null) {
            event.preventDefault();
            input.value = nextValue;
            updateStyleEdit(property, nextValue, input.dataset.originalValue || "");
            state.autocomplete = null;
            state.openTokenMenu = null;
            input.closest(".css-row")?.classList.toggle("changed", input.value.trim() !== (input.dataset.originalValue || "").trim());
            syncComposerSubmitState();
            return;
          }
        }
        if (["ArrowDown", "ArrowUp"].includes(event.key) && suggestions.length) {
          event.preventDefault();
          const current = state.autocomplete?.property === property ? state.autocomplete.index : 0;
          state.autocomplete = {
            property,
            index: event.key === "ArrowDown" ? Math.min(suggestions.length - 1, current + 1) : Math.max(0, current - 1),
          };
          render();
        }
      });
    });

    bindMotionInputs(root);

    root.querySelectorAll<HTMLInputElement>("[data-coloris-input]").forEach((input) => {
      const activateColoris = (): void => prepareColoris(input);
      input.addEventListener("pointerdown", activateColoris);
      input.addEventListener("focus", activateColoris);
      input.addEventListener("input", () => {
        const property = input.dataset.property || "";
        const value = input.value.trim();
        updateStyleEdit(property, value, input.dataset.originalValue || "");
        state.openTokenMenu = null;
        const swatch = input.closest(".color-control")?.querySelector<HTMLElement>("[data-color-swatch]");
        if (swatch) {
          swatch.style.background = typeof CSS !== "undefined" && CSS.supports("color", value) ? value : "";
        }
        const invalid = cssValueStatus(property, value) === "invalid";
        input.closest(".css-row")?.classList.toggle("invalid", invalid);
        input.closest(".css-row")?.classList.toggle("changed", value.trim() !== (input.dataset.originalValue || "").trim());
        syncComposerSubmitState();
      });
    });

    root.querySelectorAll<HTMLInputElement>("[data-box-part]").forEach((input) => {
      input.addEventListener("input", () => {
        const property = input.dataset.property || "";
        const control = input.closest(".padding-control");
        const linked = input.dataset.boxLinked === "true";
        if (linked) {
          control?.querySelectorAll<HTMLInputElement>("[data-box-part]").forEach((boxInput) => {
            boxInput.value = input.value;
          });
        }
        const parts = Array.from(control?.querySelectorAll<HTMLInputElement>("[data-box-part]") || [])
          .sort((a, b) => Number(a.dataset.boxPart || 0) - Number(b.dataset.boxPart || 0))
          .map((item) => item.value);
        if (parts.length !== 4) return;
        let value = parts.join(" ");
        value = mergeBoxValuePart(value, 0, parts[0]);
        updateStyleEdit(property, value, input.dataset.originalValue || "");
        if (!linked) state.unlinkedBoxProperties[editorStateKey(property)] = true;
        state.openTokenMenu = null;
        const invalid = cssValueStatus(property, value) === "invalid";
        input.closest(".css-row")?.classList.toggle("invalid", invalid);
        input.closest(".css-row")?.classList.toggle("changed", value.trim() !== (input.dataset.originalValue || "").trim());
        control?.querySelectorAll<HTMLInputElement>("[data-box-part]").forEach((boxInput) => {
          boxInput.dataset.currentBox = value;
        });
        syncComposerSubmitState();
      });
    });

    root.querySelector<HTMLInputElement>("[data-text-edit]")?.addEventListener("input", (event) => {
      if (!state.draft || !state.inspection?.editableText) return;
      const value = (event.currentTarget as HTMLInputElement).value;
      updateTextDraft(value);
      syncComposerSubmitState();
    });

    root.querySelectorAll<HTMLElement>("[data-structure-target]").forEach((row) => {
      row.addEventListener("pointerenter", () => {
        const selector = row.dataset.structureTarget;
        const el = selector ? resolveElement(selector) : null;
        if (el && isStructureCandidate(el)) {
          state.structurePreviewElement = el;
          updateStructurePreviewOverlay();
        }
      });
      row.addEventListener("pointerleave", () => {
        state.structurePreviewElement = null;
        updateStructurePreviewOverlay();
      });
      row.addEventListener("focus", () => {
        const selector = row.dataset.structureTarget;
        const el = selector ? resolveElement(selector) : null;
        if (el && isStructureCandidate(el)) {
          state.structurePreviewElement = el;
          updateStructurePreviewOverlay();
        }
      });
      row.addEventListener("blur", () => {
        state.structurePreviewElement = null;
        updateStructurePreviewOverlay();
      });
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (blockDirtyComposerSwitch()) return;
        const selector = row.dataset.structureTarget;
        const target = selector ? resolveElement(selector) : null;
        if (target && isStructureCandidate(target)) {
          state.structurePreviewElement = null;
          updateStructurePreviewOverlay();
          const anchor = { x: target.getBoundingClientRect().left + 20, y: target.getBoundingClientRect().top + 20 };
          state.selectedElements = [];
          updateSelectionOverlay();
          openComposerForElement(target, anchor);
        }
      });
    });

  }

  function updateHoverOverlay(): void {
    const outline = state.shadow?.querySelector<HTMLElement>("[data-hover-outline]");
    const label = state.shadow?.querySelector<HTMLElement>("[data-hover-label]");
    if (!outline || !label) return;
    const target = state.shiftSelecting ? state.hoverElement : state.selectedElement || state.hoverElement;
    if (!state.active || !target) {
      outline.classList.add("hidden");
      label.classList.add("hidden");
      return;
    }
    if (state.selectedElements.length > 1 && state.selectedElements.includes(target) && !state.shiftSelecting) {
      outline.classList.add("hidden");
      label.classList.add("hidden");
      return;
    }
    const rect = target.getBoundingClientRect();
    outline.classList.remove("hidden");
    label.classList.remove("hidden");
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
    outline.classList.toggle("selection-mode", state.shiftSelecting || state.selectedElements.includes(target));
    label.classList.toggle("selection-mode", state.shiftSelecting || state.selectedElements.includes(target));
    label.style.left = `${Math.min(innerWidth - 288, Math.max(8, rect.left))}px`;
    label.style.top = `${Math.max(24, rect.top - 6)}px`;
    label.textContent = uiElementLabel(target);
  }

  function updateStructurePreviewOverlay(): void {
    const outline = state.shadow?.querySelector<HTMLElement>("[data-structure-preview-outline]");
    if (!outline) return;
    const target = state.structurePreviewElement;
    if (!target || !target.isConnected || !isStructureCandidate(target)) {
      outline.classList.add("hidden");
      return;
    }
    if (target === state.selectedElement) {
      outline.classList.add("hidden");
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      outline.classList.add("hidden");
      return;
    }
    outline.classList.remove("hidden");
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
  }

  function updateSelectionOverlay(): void {
    const outlines = state.shadow?.querySelector<HTMLElement>("[data-selection-outlines]");
    if (!outlines) return;
    const elements = state.selectedElements.filter((element) => element.isConnected && isUsefulElement(element));
    state.selectedElements = elements;
    if (!elements.length) {
      outlines.innerHTML = "";
      return;
    }
    const union = unionBoxForElements(elements);
    const countLeft = Math.min(innerWidth - 96, Math.max(8, union.x - scrollX));
    const countTop = Math.max(8, union.y - scrollY - 28);
    outlines.innerHTML = `${elements
      .map((element) => {
        const item = element.getBoundingClientRect();
        return `<div class="selection-outline" style="left:${item.left}px;top:${item.top}px;width:${item.width}px;height:${item.height}px"></div>`;
      })
      .join("")}<div class="selection-count" style="left:${countLeft}px;top:${countTop}px">${elements.length} selected</div>`;
  }

  function toggleSelectionElement(element: HTMLElement): void {
    const existingIndex = state.selectedElements.indexOf(element);
    if (existingIndex >= 0) {
      state.selectedElements.splice(existingIndex, 1);
    } else {
      state.selectedElements.push(element);
    }
    state.selectedElement = null;
    updateSelectionOverlay();
  }

  function updateSelectionOnly(): void {
    render();
    updateSelectionOverlay();
    updateHoverOverlay();
    requestAnimationFrame(updateSelectionOverlay);
  }

  function updateMarkerHoverStates(): void {
    state.shadow?.querySelectorAll<HTMLElement>("[data-marker]").forEach((marker) => {
      marker.classList.toggle("editing", !!state.hoveredMarkerId && marker.dataset.marker === state.hoveredMarkerId);
    });
  }

  function hoveredAnnotationForElement(element: HTMLElement | null): LiveAnnotation | null {
    if (!element) return null;
    return (
      state.annotations.find((annotation) => {
        if (annotation.status === "resolved" || annotation.status === "dismissed") return false;
        if (annotation.isMultiSelect) {
          const targets = annotation.targetElements?.length ? annotation.targetElements : resolveMultiElements(annotation);
          annotation.targetElements = targets;
          annotation.targetElement = targets[0];
          return targets.some((target) => target === element || target.contains(element));
        }
        const target = annotation.targetElement || resolveElement(annotation.elementPath);
        if (!target) return false;
        annotation.targetElement = target;
        return target === element || target.contains(element);
      }) || null
    );
  }

  function updateMarkerPositions(): void {
    state.shadow?.querySelectorAll<HTMLElement>("[data-marker]").forEach((marker) => {
      const annotation = state.annotations.find((item) => item.id === marker.dataset.marker);
      const position = annotation ? markerPosition(annotation) : null;
      if (!annotation || !position) {
        marker.classList.add("hidden");
        return;
      }
      marker.classList.remove("hidden");
      marker.classList.toggle("editing", state.hoveredMarkerId === annotation.id);
      marker.style.left = `${position.left}px`;
      marker.style.top = `${position.top}px`;
      const tip = marker.querySelector<HTMLElement>(".marker-tip");
      if (!tip) return;
      tip.classList.toggle("tip-right", position.left < 292);
      tip.classList.toggle("tip-left", position.left >= 292);
      tip.classList.toggle("tip-below", position.top < 90);
      tip.classList.toggle("tip-above", position.top > innerHeight - 120);
      tip.classList.toggle("tip-middle", position.top >= 90 && position.top <= innerHeight - 120);
    });
  }

  function resetShiftSelectionState(renderAfter = false): void {
    if (!state.shiftSelecting) return;
    state.shiftSelecting = false;
    if (state.active) setAnnotatingCursor(true);
    updateSelectionOverlay();
    updateHoverOverlay();
    if (renderAfter) render();
  }

  function clampComposerToViewport(): void {
    const composer = state.shadow?.querySelector<HTMLElement>("[data-composer]");
    if (
      !composer ||
      state.composerDrag ||
      composer.classList.contains("entering") ||
      composer.classList.contains("exiting") ||
      composer.classList.contains("positioning")
    ) {
      return;
    }
    const rect = composer.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    let left = rect.left;
    if (rect.right > innerWidth - 12) left -= rect.right - innerWidth + 12;
    left = Math.max(12, left);
    composer.style.left = `${Math.round(left)}px`;
    if (composer.dataset.placement === "above") {
      let bottom = Number.parseFloat(composer.style.bottom) || 12;
      if (rect.top < 12) bottom = Math.max(12, bottom - (12 - rect.top));
      if (rect.bottom > innerHeight - 12) bottom += rect.bottom - innerHeight + 12;
      composer.style.top = "auto";
      composer.style.bottom = `${Math.round(bottom)}px`;
      state.composerPosition = { left, bottom, opensUp: true };
      animateComposerClamp(composer, startLeft, startTop);
      return;
    }
    let top = rect.top;
    if (rect.bottom > innerHeight - 12) top -= rect.bottom - innerHeight + 12;
    top = Math.max(12, top);
    composer.style.top = `${Math.round(top)}px`;
    composer.style.bottom = "auto";
    state.composerPosition = { left, top, opensUp: false };
    animateComposerClamp(composer, startLeft, startTop);
  }

  function animateComposerClamp(composer: HTMLElement, startLeft: number, startTop: number): void {
    const nextRect = composer.getBoundingClientRect();
    const deltaX = startLeft - nextRect.left;
    const deltaY = startTop - nextRect.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
    if (prefersReducedMotion()) return;
    composer.classList.add("positioning");
    const animation = composer.animate(
      [
        { transform: `translate(${Math.round(deltaX)}px, ${Math.round(deltaY)}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: 180,
        easing: "cubic-bezier(.2,.8,.2,1)",
      },
    );
    const clearPositioning = () => composer.classList.remove("positioning");
    animation.addEventListener("finish", clearPositioning, { once: true });
    animation.addEventListener("cancel", clearPositioning, { once: true });
  }

  function updateDraggedComposer(left: number, top: number): void {
    const drag = state.composerDrag;
    const composer = state.shadow?.querySelector<HTMLElement>("[data-composer]");
    if (!drag || !composer) return;
    const nextLeft = Math.min(innerWidth - drag.width - 12, Math.max(12, left));
    const nextTop = Math.min(innerHeight - drag.height - 12, Math.max(12, top));
    composer.style.left = `${Math.round(nextLeft)}px`;
    composer.style.top = `${Math.round(nextTop)}px`;
    composer.style.bottom = "auto";
    composer.dataset.placement = "below";
    composer.classList.remove("opens-up");
    state.composerPosition = { left: nextLeft, top: nextTop, opensUp: false, dragged: true };
  }

  function onComposerDragMove(event: PointerEvent): void {
    const drag = state.composerDrag;
    if (!drag) return;
    event.preventDefault();
    updateDraggedComposer(drag.left + event.clientX - drag.startX, drag.top + event.clientY - drag.startY);
  }

  function endComposerDrag(): void {
    if (!state.composerDrag) return;
    state.composerDrag = null;
    document.removeEventListener("pointermove", onComposerDragMove, true);
    document.removeEventListener("pointerup", endComposerDrag, true);
    document.removeEventListener("pointercancel", endComposerDrag, true);
  }

  function beginComposerDrag(event: PointerEvent): void {
    const composer = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-composer]");
    if (!composer) return;
    event.preventDefault();
    event.stopPropagation();
    endComposerDrag();
    const rect = composer.getBoundingClientRect();
    state.composerDrag = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    state.composerPosition = { left: rect.left, top: rect.top, opensUp: false, dragged: true };
    document.addEventListener("pointermove", onComposerDragMove, true);
    document.addEventListener("pointerup", endComposerDrag, true);
    document.addEventListener("pointercancel", endComposerDrag, true);
  }

  function updateToolbarRailTop(top: number): void {
    const nextTop = clampedToolbarRailTop(top);
    state.toolbarRailTop = nextTop;
    state.toolbarRailPinnedToDefault = false;
    const rail = state.shadow?.querySelector<HTMLElement>("[data-toolbar-rail]");
    if (rail) rail.style.setProperty("--fm-rail-top", `${nextTop}px`);
  }

  function onToolbarRailDragMove(event: PointerEvent): void {
    const drag = state.toolbarDrag;
    if (!drag) return;
    event.preventDefault();
    const delta = event.clientY - drag.startY;
    if (Math.abs(delta) > 4) {
      drag.moved = true;
      state.shadow?.querySelector("[data-toolbar-rail]")?.classList.add("dragging");
    }
    updateToolbarRailTop(drag.top + delta);
  }

  function endToolbarRailDrag(event?: PointerEvent): void {
    const drag = state.toolbarDrag;
    if (!drag) return;
    if (drag.moved) {
      state.suppressNextToolbarClick = true;
      event?.preventDefault();
      event?.stopPropagation();
    }
    state.toolbarDrag = null;
    state.shadow?.querySelector("[data-toolbar-rail]")?.classList.remove("dragging");
    document.removeEventListener("pointermove", onToolbarRailDragMove, true);
    document.removeEventListener("pointerup", endToolbarRailDrag, true);
    document.removeEventListener("pointercancel", endToolbarRailDrag, true);
  }

  function beginToolbarRailDrag(event: PointerEvent): void {
    if (state.toolbarOpen) return;
    event.stopPropagation();
    endToolbarRailDrag();
    state.toolbarDrag = {
      startY: event.clientY,
      top: clampedToolbarRailTop(),
      moved: false,
    };
    document.addEventListener("pointermove", onToolbarRailDragMove, true);
    document.addEventListener("pointerup", endToolbarRailDrag, true);
    document.addEventListener("pointercancel", endToolbarRailDrag, true);
  }

  function openComposerForAnnotation(
    annotation: LiveAnnotation,
    element: HTMLElement,
    anchor: { x: number; y: number } | null = null,
  ): void {
    const annotationHasStyleEdits = !!annotation.styleEdits?.length || !!annotation.animationPatch || !!annotation.animationPatches?.length;
    const keepCssOpen =
      annotationHasStyleEdits ||
      (state.cssOpen && (!!state.draft?.styleEdits.length || state.selectedElement !== null || state.selectedElements.length > 1));
    state.editingId = annotation.id;
    state.selectedElement = element;
    state.selectedElements = annotation.isMultiSelect
      ? annotation.targetElements?.length
        ? annotation.targetElements
        : resolveMultiElements(annotation)
      : [];
    state.selectionScope = annotation.selectionScope || "individual";
    state.composerAnchor = anchor;
    state.composerPosition = composerPositionFor(element);
    state.hoverElement = element;
    state.cssOpen = keepCssOpen;
    state.styleEditorOpening = false;
    state.styleEditorClosing = false;
    state.visible = false;
    state.toolbarOpen = true;
    state.active = true;
    setAnnotatingCursor(true);
    startDraft(element, annotation);
    state.focusComposerOnRender = true;
    render();
  }

  function focusAnnotation(id: string): void {
    const annotation = state.annotations.find((item) => item.id === id);
    const multiTargets = annotation?.isMultiSelect ? annotation.targetElements?.length ? annotation.targetElements : resolveMultiElements(annotation) : [];
    const element = multiTargets[0] || annotation?.targetElement || (annotation ? resolveElement(annotation.elementPath) : null);
    if (!annotation || !element) {
      setNotice("Element no longer found.");
      return;
    }
    annotation.targetElements = multiTargets;
    annotation.targetElement = element;
    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    openComposerForAnnotation(annotation, element, null);
  }

  function applyMcpEvent(event: AnnoteBridgeEventDTO): void {
    const annotation = "annotationId" in event ? state.annotations.find((item) => item.id === event.annotationId) : null;
    if (!annotation) return;
    if (event.type === "annotation.reply") {
      annotation.thread = annotation.thread || [];
      annotation.thread.push({ id: uid("msg"), role: "agent", content: event.message, timestamp: Date.now() });
    }
    if (event.type === "annotation.acknowledge") {
      annotation.status = "acknowledged";
    }
    if (event.type === "annotation.resolve") {
      annotation.status = "resolved";
      annotation.resolvedAt = new Date().toISOString();
      annotation.resolvedBy = "agent";
    }
    if (event.type === "annotation.dismiss") {
      annotation.status = "dismissed";
    }
    saveAnnotations();
    render();
  }

  function updateStatus(id: string, status: Status): void {
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation) return;
    annotation.status = status;
    if (status === "resolved") {
      annotation.resolvedAt = new Date().toISOString();
      annotation.resolvedBy = "human";
    }
    saveAnnotations();
    render();
  }

  function deleteAnnotation(id: string): void {
    restoreCommittedMutation(id);
    state.annotations = state.annotations.filter((annotation) => annotation.id !== id);
    clearComposerState();
    state.composerShake = false;
    saveAnnotations();
    observeTargets();
    render();
  }

  function openConfirm(kind: ConfirmKind, targetId: string | null, count: number): void {
    if (state.confirmTimer !== null) {
      window.clearTimeout(state.confirmTimer);
      state.confirmTimer = null;
    }
    const active = (state.shadow?.activeElement || document.activeElement) as HTMLElement | null;
    state.confirmInvoker = active instanceof HTMLElement ? active : null;
    state.confirm = { kind, targetId, count };
    state.confirmClosing = false;
    state.confirmFocus = CONFIRM_INITIAL_FOCUS;
    // Suspend picking so the crosshair, hover tracking, and page
    // interactions can't fight the dialog. Restored on close.
    state.confirmResumePick = state.active;
    state.active = false;
    setAnnotatingCursor(false);
    state.hoverElement = null;
    render();
    requestAnimationFrame(() => {
      state.shadow?.querySelector<HTMLButtonElement>("[data-action='confirm-delete']")?.focus();
    });
  }

  function restoreConfirmPick(): void {
    if (!state.confirmResumePick) return;
    state.confirmResumePick = false;
    if (!state.shadow) return;
    state.active = true;
    setAnnotatingCursor(true);
  }

  function closeConfirm(restoreFocus = true): void {
    if (!state.confirm || state.confirmClosing) return;
    state.confirmClosing = true;
    render();
    const done = (): void => {
      state.confirm = null;
      state.confirmClosing = false;
      state.confirmTimer = null;
      if (restoreFocus) state.confirmInvoker?.focus?.();
      state.confirmInvoker = null;
      restoreConfirmPick();
      render();
    };
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      done();
      return;
    }
    state.confirmTimer = window.setTimeout(done, 130);
  }

  function executeConfirm(): void {
    const pending = state.confirm;
    if (!pending || state.confirmClosing) return;
    if (state.confirmTimer !== null) {
      window.clearTimeout(state.confirmTimer);
      state.confirmTimer = null;
    }
    state.confirm = null;
    state.confirmClosing = false;
    state.confirmInvoker = null;
    restoreConfirmPick();
    if (pending.kind === "delete-current" && pending.targetId) {
      const id = pending.targetId;
      animateComposerOut(() => deleteAnnotation(id));
      return;
    }
    clear();
  }

  function renderConfirm(): string {
    if (!state.confirm) return "";
    const content = confirmDialogContent(
      state.confirm.kind,
      state.confirm.kind === "delete-current"
        ? { elementLabel: state.annotations.find((a) => a.id === state.confirm?.targetId)?.element }
        : { count: state.confirm.count },
    );
    return `
      <div class="confirm-scrim" data-action="confirm-cancel"></div>
      <div class="confirm ${state.confirmClosing ? "closing" : ""}" role="alertdialog" aria-modal="true" aria-labelledby="annote-confirm-title" aria-describedby="annote-confirm-body" data-confirm>
        <h2 id="annote-confirm-title">${escapeHtml(content.title)}</h2>
        <p id="annote-confirm-body">${escapeHtml(content.body)}</p>
        <div class="confirm-actions">
          <button type="button" data-action="confirm-cancel" data-confirm-cancel>${escapeHtml(content.cancelLabel)}</button>
          <button type="button" class="destructive" data-action="confirm-delete">${escapeHtml(content.confirmLabel)}</button>
        </div>
      </div>
    `;
  }

  function trapConfirmTab(event: KeyboardEvent): void {
    const dialog = state.shadow?.querySelector<HTMLElement>("[data-confirm]");
    const buttons = dialog ? Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")) : [];
    if (buttons.length < 2) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = state.shadow?.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !dialog?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function requestDeleteCurrent(): void {
    if (!state.editingId) return;
    openConfirm("delete-current", state.editingId, 1);
  }

  function requestClearAnnotations(): void {
    if (!state.annotations.length) return;
    openConfirm("clear-all", null, state.annotations.length);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!state.active) return;
    if (state.shiftSelecting && !event.shiftKey) resetShiftSelectionState();
    if (isControlUiEventTarget(event.target)) {
      if (state.hoverElement) {
        state.hoverElement = null;
        updateHoverOverlay();
      }
      if (state.hoveredMarkerId) {
        state.hoveredMarkerId = null;
        updateMarkerHoverStates();
      }
      return;
    }
    if (state.selectedElement) return;
    const element = underlyingElementFromPoint(event.clientX, event.clientY);
    const next = element ? choosePickTarget(element) : null;
    const hoveredAnnotation = hoveredAnnotationForElement(next);
    if (state.hoveredMarkerId !== hoveredAnnotation?.id) {
      state.hoveredMarkerId = hoveredAnnotation?.id || null;
      updateMarkerHoverStates();
    }
    if (next === state.hoverElement) return;
    state.hoverElement = next;
    updateHoverOverlay();
  }

  function openMultiSelectionComposer(anchor: { x: number; y: number }): void {
    const elements = state.selectedElements.filter((element) => element.isConnected && isUsefulElement(element));
    state.selectedElements = elements;
    updateSelectionOverlay();
    if (elements.length > 1) {
      openComposerForElement(elements[0], anchor, elements);
      return;
    }
    closeComposerPreservingSelection();
    render();
  }

  function openComposerForElement(target: HTMLElement, anchor: { x: number; y: number }, selectedElements: HTMLElement[] = []): void {
    state.structurePreviewElement = null;
    updateStructurePreviewOverlay();
    const keepCssOpen = state.cssOpen && (!!state.draft?.styleEdits.length || state.selectedElement !== null || state.selectedElements.length > 1);
    const targetPath = selectorForElement(target);
    const duplicate = !selectedElements.length
      ? state.annotations.find((annotation) => {
          if (annotation.status === "resolved" || annotation.status === "dismissed") return false;
          return annotation.targetElement === target || annotation.elementPath === targetPath;
        })
      : null;
    if (duplicate) {
      openComposerForAnnotation(duplicate, target, anchor);
      return;
    }
    state.selectedElement = target;
    state.selectedElements = selectedElements;
    state.selectionScope = selectedElements.length > 1 ? state.selectionScope : "individual";
    state.composerAnchor = anchor;
    state.composerPosition = composerPositionFor(state.selectedElement);
    state.hoverElement = state.selectedElement;
    state.cssOpen = keepCssOpen;
    state.styleEditorOpening = false;
    state.styleEditorClosing = false;
    startDraft(state.selectedElement);
    pauseAnimationsForSelection(state.selectedElement);
    state.focusComposerOnRender = true;
    render();
  }

  function onPointerDown(event: PointerEvent): void {
    if (!state.active || isControlUiEventTarget(event.target)) return;
    const element = underlyingElementFromPoint(event.clientX, event.clientY);
    if (!element) return;
    const target = choosePickTarget(element);
    const anchor = { x: event.clientX, y: event.clientY };
    if (event.shiftKey) {
      preventUnderlyingAction(event);
      state.shiftSelecting = true;
      setAnnotatingCursor(true);
      if (state.selectedElement && !state.selectedElements.includes(state.selectedElement)) {
        state.selectedElements = [state.selectedElement, ...state.selectedElements];
      }
      closeComposerPreservingSelection();
      toggleSelectionElement(target);
      state.composerAnchor = anchor;
      updateSelectionOnly();
      return;
    }
    preventUnderlyingAction(event);
    if (state.selectedElement) {
      const clickedAnnotation = hoveredAnnotationForElement(target);
      if (blockDirtyComposerSwitch()) return;
      if (!clickedAnnotation) {
        requestCancelComposer();
        return;
      }
    }
    state.selectedElements = [];
    updateSelectionOverlay();
    openComposerForElement(target, anchor);
  }

  function onClick(event: MouseEvent): void {
    // Outside click dismisses review/settings popovers — never the
    // destructive confirm (its scrim owns dismissal), never mid-pick.
    if (!state.active && !state.confirm && state.visible && !state.selectedElement && !state.selectedElements.length) {
      const target = event.target as HTMLElement | null;
      if (target && !isAnnotatorNode(target)) {
        state.visible = false;
        render();
        return;
      }
    }
    if (!state.active || isControlUiEventTarget(event.target)) return;
    if (!shouldPreventUnderlyingAction()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function onPointerUp(event: PointerEvent): void {
    preventUnderlyingAction(event);
  }

  function onMouseDown(event: MouseEvent): void {
    preventUnderlyingAction(event);
  }

  function onMouseUp(event: MouseEvent): void {
    preventUnderlyingAction(event);
  }

  function onAuxClick(event: MouseEvent): void {
    preventUnderlyingAction(event);
  }

  function onContextMenu(event: MouseEvent): void {
    if (!shouldPreventUnderlyingAction() || isAnnotatorNode(event.target)) return;
    // Allow Annote's own context if needed, but prevent underlying
    event.preventDefault();
    event.stopPropagation();
  }

  function onSubmit(event: SubmitEvent): void {
    preventUnderlyingAction(event);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && state.visible && state.panelMode === "settings") {
      event.preventDefault();
      event.stopPropagation();
      if (state.settingsView !== "root") {
        state.settingsView = "root";
      } else {
        state.visible = false;
        state.mcpClient?.stopSettingsChecks();
      }
      render();
      return;
    }
    if (event.key === "Shift" && state.active && !state.shiftSelecting) {
      if (state.selectedElement && !state.selectedElements.includes(state.selectedElement)) {
        state.selectedElements = [state.selectedElement, ...state.selectedElements];
      }
      state.shiftSelecting = true;
      setAnnotatingCursor(true);
      closeComposerPreservingSelection();
      state.hoverElement = null;
      updateSelectionOnly();
      return;
    }
    if (state.confirm) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeConfirm();
        return;
      }
      if (event.key === "Tab") {
        trapConfirmTab(event);
        return;
      }
      // No other globals while the confirmation is open.
      if (isTypingInInput(event.target)) return;
      return;
    }
    if (handleGlobalShortcut(event)) return;

    if ((event.key === "Enter" || event.key === " ") && shouldPreventUnderlyingAction() && !isTypingInInput(event.target)) {
      const target = event.target as HTMLElement | null;
      if (target && (target.matches('a, button, [role="button"]') || !!target.closest('a, button, [role="button"]'))) {
        if (!isAnnotatorNode(target)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const launcher = (target.matches("[data-action='open-toolbar']") ? target : target.closest("[data-action='open-toolbar']")) as HTMLElement | null;
        if (launcher && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
          openToolbar();
          state.active = true;
          setAnnotatingCursor(true);
          render();
          requestAnimationFrame(() => {
            state.shadow?.querySelector<HTMLButtonElement>('[data-action="toggle-pick"]')?.focus();
          });
          return;
        }
        // Div-based rows (settings navigation) are keyboard-activated here;
        // native buttons activate natively and must not double-fire.
        const row = target instanceof HTMLButtonElement || target.closest("button")
          ? null
          : target.closest?.("div.settings-row[data-action]");
        if (row) {
          event.preventDefault();
          event.stopPropagation();
          (row as HTMLElement).click();
          return;
        }
      }
    }

    if (event.key === "Escape") {
      if (state.selectedElements.length) {
        restorePreview();
        clearComposerState();
        state.hoverElement = null;
        updateHoverOverlay();
        render();
        return;
      }
      if (state.selectedElement) {
        requestCancelComposer();
        return;
      }
      // Collapse (never destroy): the launcher stays so the tool is findable.
      // Explicit close remains on the toolbar × button.
      collapseToolbar();
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.key !== "Shift" || !state.shiftSelecting) return;
    state.shiftSelecting = false;
    if (state.active) setAnnotatingCursor(true);
    updateSelectionOverlay();
    if (state.selectedElements.length > 1) {
      openMultiSelectionComposer(state.composerAnchor || { x: innerWidth / 2, y: innerHeight / 2 });
      return;
    }
    render();
  }

  function onWindowBlur(): void {
    resetShiftSelectionState(true);
  }

  function onVisibilityChange(): void {
    if (document.visibilityState !== "visible") resetShiftSelectionState(true);
  }

  function scheduleRender(): void {
    if (state.raf !== null) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = null;
      updateMarkerPositions();
      updateSelectionOverlay();
      updateHoverOverlay();
      updateStructurePreviewOverlay();
      clampComposerToViewport();
    });
  }

  function observeTargets(): void {
    state.resizeObserver?.disconnect();
    state.resizeObserver = "ResizeObserver" in window ? new ResizeObserver(scheduleRender) : null;
    state.annotations.forEach((annotation) => {
      const multiTargets = annotation.isMultiSelect ? resolveMultiElements(annotation) : [];
      if (multiTargets.length) {
        annotation.targetElements = multiTargets;
        annotation.targetElement = multiTargets[0];
        multiTargets.forEach((element) => state.resizeObserver?.observe(element));
        return;
      }
      const element = annotation.targetElement || resolveElement(annotation.elementPath);
      if (element) {
        annotation.targetElement = element;
        state.resizeObserver?.observe(element);
      }
    });
  }

  function attachGlobalListeners(): void {
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onAuxClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("dragstart", preventUnderlyingAction as EventListener, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur, true);
    document.addEventListener("visibilitychange", onVisibilityChange, true);
    scrollRoot().addEventListener("scroll", scheduleRender, { passive: true, capture: true });
    window.addEventListener("resize", scheduleRender, { passive: true });
    state.mutationObserver = new MutationObserver(() => {
      state.annotations.forEach((annotation) => {
        if (annotation.isMultiSelect) {
          annotation.targetElements = resolveMultiElements(annotation);
          annotation.targetElement = annotation.targetElements[0];
          return;
        }
        if (!annotation.targetElement?.isConnected) {
          annotation.targetElement = resolveElement(annotation.elementPath) || undefined;
        }
      });
      observeTargets();
      scheduleRender();
    });
    state.mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  }

  function removeGlobalListeners(): void {
    endComposerDrag();
    state.shadow?.removeEventListener("click", onShadowRootClick);
    state.shadowClickBound = false;
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onAuxClick, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("dragstart", preventUnderlyingAction as EventListener, true);
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onWindowBlur, true);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
    scrollRoot().removeEventListener("scroll", scheduleRender, true);
    window.removeEventListener("resize", scheduleRender);
    state.mutationObserver?.disconnect();
    state.resizeObserver?.disconnect();
    state.mutationObserver = null;
    state.resizeObserver = null;
    if (state.raf !== null) cancelAnimationFrame(state.raf);
    state.raf = null;
  }

  function scrollRoot(): Document {
    return document;
  }

  function mount(): void {
    if (state.mounted) {
      render();
      ensureInteractionShield();
      return;
    }
    createRoot();
    state.settings = loadSettings();
    state.annotations = loadAnnotations();
    state.mcpClient = createAnnoteMcpClient({
      getAnnotations,
      applyEvent: applyMcpEvent,
      onStateChange: (status) => {
        state.mcpStatus = status;
        if (state.panelMode === "settings" && state.settingsView === "mcp") render();
      },
    });
    state.annotations.forEach(applyCommittedMutation);
    state.mounted = true;
    state.visible = false;
    attachGlobalListeners();
    observeTargets();
    render();
    void state.mcpClient.check();
  }

  function togglePick(): void {
    state.active ? deactivate() : activate();
  }

  function playToolbarOpening(): void {
    state.toolbarOpening = true;
    state.toolbarClosing = false;
    state.toolbarTooltipsReady = false;
    window.setTimeout(() => {
      state.toolbarOpening = false;
      const toolbar = state.shadow?.querySelector(".toolbar");
      toolbar?.classList.remove("opening");
    }, 400);
    window.setTimeout(() => {
      if (!state.toolbarOpen || state.toolbarClosing) return;
      state.toolbarTooltipsReady = true;
      state.shadow?.querySelector(".toolbar")?.classList.add("tooltips-ready");
    }, 850);
  }

  function openToolbar(): void {
    if (state.toolbarOpen) return;
    state.toolbarOpen = true;
    playToolbarOpening();
  }

  function toggle(): void {
    if (!state.mounted) {
      mount();
      activate();
      return;
    }
    if (!state.toolbarOpen) {
      openToolbar();
      state.active = true;
      setAnnotatingCursor(true);
      render();
      return;
    }
    state.active = !state.active;
    setAnnotatingCursor(state.active);
    restorePreview();
    clearComposerState();
    state.hoverElement = null;
    render();
  }

  function activate(): void {
    mount();
    state.active = true;
    openToolbar();
    state.toolbarClosing = false;
    setAnnotatingCursor(true);
    state.visible = false;
    state.hoveredMarkerId = null;
    render();
    ensureInteractionShield();
  }

  function deactivate(): void {
    restorePreview();
    state.active = false;
    setAnnotatingCursor(false);
    state.hoverElement = null;
    clearComposerState();
    state.composerShake = false;
    render();
    ensureInteractionShield();
  }

  function collapseToolbar(): void {
    if (!state.toolbarOpen) return;
    state.toolbarClosing = true;
    state.toolbarOpening = false;
    state.toolbarTooltipsReady = false;
    state.active = false;
    setAnnotatingCursor(false);
    restorePreview();
    state.visible = false;
    state.hoverElement = null;
    clearComposerState();
    const toolbar = state.shadow?.querySelector<HTMLElement>(".toolbar");
    state.shadow?.querySelector<HTMLElement>(".panel")?.remove();
    state.shadow?.querySelector<HTMLElement>("[data-composer]")?.remove();
    state.shadow?.querySelector<HTMLElement>("[data-toolbar-tooltip]")?.remove();
    if (!toolbar) render();
    toolbar?.classList.remove("opening", "tooltips-ready");
    toolbar?.classList.add("closing");
    toolbar?.style.setProperty("width", "46px");
    toolbar?.style.setProperty("height", `${TOOLBAR_RAIL_HEIGHT}px`);
    if (!prefersReducedMotion()) {
      toolbar?.animate(
      [
        { width: "46px", height: `${TOOLBAR_RAIL_HEIGHT}px`, opacity: 1, transform: "translateX(0)" },
        { width: "46px", height: `${TOOLBAR_COLLAPSED_HEIGHT}px`, opacity: 0.96, transform: "translateX(0)" },
      ],
      {
        duration: 280,
        easing: "cubic-bezier(.4,0,.2,1)",
        fill: "forwards",
      },
      );
    }
    window.setTimeout(() => {
      state.toolbarOpen = false;
      state.toolbarOpening = false;
      state.toolbarClosing = false;
      state.toolbarTooltipsReady = false;
      render();
    }, 280);
  }

  function destroy(): void {
    state.mcpClient?.destroy();
    state.mcpClient = null;
    if (state.confirmTimer !== null) {
      window.clearTimeout(state.confirmTimer);
      state.confirmTimer = null;
    }
    state.confirm = null;
    state.confirmClosing = false;
    state.confirmInvoker = null;
    state.confirmResumePick = false;
    state.structureAnimating = false;
    if (state.noticeTimer !== null) {
      window.clearTimeout(state.noticeTimer);
      state.noticeTimer = null;
    }
    removeGlobalListeners();
    endComposerDrag();
    endToolbarRailDrag();
    setAnnotatingCursor(false);
    restorePreview();
    cleanupColorisAssets();
    state.interactionShield?.remove();
    state.interactionShield = null;
    state.rootHost?.remove();
    state.rootHost = null;
    state.shadow = null;
    state.mounted = false;
    state.active = false;
    state.toolbarOpen = false;
    state.toolbarOpening = false;
    state.toolbarClosing = false;
    state.toolbarTooltipsReady = false;
    state.toolbarRailTop = Number.POSITIVE_INFINITY;
    state.toolbarRailPinnedToDefault = true;
    state.visible = false;
    state.hoverElement = null;
    clearComposerState();
    state.composerDrag = null;
    state.toolbarDrag = null;
    state.suppressNextToolbarClick = false;
    state.composerShake = false;
  }

  function getAnnotations(): Annotation[] {
    return state.annotations.map(cloneAnnotation);
  }

  function clear(): void {
    restorePreview();
    restoreAllCommittedMutations();
    state.annotations = [];
    state.hoveredMarkerId = null;
    state.hoverElement = null;
    clearComposerState();
    state.composerShake = false;
    try {
      localStorage.removeItem(storageKey());
    } catch {
      // Local storage may be unavailable; in-memory state is still cleared.
    }
    observeTargets();
    render();
  }

  const api: Api = {
    mount,
    toggle,
    activate,
    deactivate,
    destroy,
    getAnnotations,
    clear,
  };

  const annotatorWindow = window as Window & { __ANNOTE__?: Api; __UI_ANNOTATOR__?: Api; __FEEDBACK_MARK__?: Api };
  const existing = annotatorWindow[GLOBAL_NAME] || annotatorWindow[LEGACY_GLOBAL_NAME] || annotatorWindow.__FEEDBACK_MARK__;
  if (existing) {
    existing.toggle();
  } else {
    annotatorWindow[GLOBAL_NAME] = api;
    annotatorWindow[LEGACY_GLOBAL_NAME] = api;
    annotatorWindow.__FEEDBACK_MARK__ = api;
    mount();
  }
})();
