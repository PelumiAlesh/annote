import assert from "node:assert/strict";
import test from "node:test";

import {
  ANNOTE_PROTOCOL_VERSION,
  annotationToDTO,
  compactAnnotation,
  sessionSummary,
} from "/tmp/annote-protocol.mjs";

test("sanitizes annotations into JSON-safe transport DTOs", () => {
  const dto = annotationToDTO({
    id: "ann_1",
    comment: "Use the primary token sk-secretkey123456789",
    element: "Submit button",
    elementPath: "button[data-testid=submit]",
    computedStyles: "password: hunter2",
    targetElement: { nodeType: 1 },
    styleEdits: [{ property: "color", originalValue: "#000", value: "var(--color-primary)", state: "hover", valid: true }],
    reactContext: { component: "CheckoutButton", source: { fileName: "webpack:///src/button.tsx", lineNumber: 12 } },
    timestamp: 1700000000000,
  });

  assert.equal(dto.protocolVersion, ANNOTE_PROTOCOL_VERSION);
  assert.equal(dto.id, "ann_1");
  assert.equal(dto.feedback, "Use the primary token [redacted]");
  assert.equal(dto.target.selector, "button[data-testid=submit]");
  assert.equal(dto.cssEdits[0].property, "color");
  assert.deepEqual(dto.designTokens, ["--color-primary"]);
  assert.equal(dto.source.fileName, "src/button.tsx");
  assert.equal("computedStyles" in dto, false);
  assert.equal("targetElement" in dto, false);
});

test("summaries and compact annotations avoid full annotation payloads", () => {
  const session = {
    protocolVersion: ANNOTE_PROTOCOL_VERSION,
    sessionId: "sess_1",
    page: { url: "http://localhost:4173", title: "Demo", origin: "http://localhost:4173" },
    annotations: [
      annotationToDTO({ id: "ann_1", status: "pending", comment: "Fix spacing", element: "Card", elementPath: ".card", timestamp: Date.now() }),
      annotationToDTO({ id: "ann_2", status: "acknowledged", comment: "Fix color", element: "Button", elementPath: ".button", timestamp: Date.now() }),
    ],
    updatedAt: new Date().toISOString(),
  };

  assert.deepEqual(sessionSummary(session), {
    sessionId: "sess_1",
    page: session.page,
    pendingCount: 1,
    acknowledgedCount: 1,
    updatedAt: session.updatedAt,
  });
  assert.deepEqual(compactAnnotation(session, session.annotations[0]), {
    id: "ann_1",
    status: "pending",
    comment: "Fix spacing",
    intent: "fix",
    element: "Card",
    component: undefined,
    sourceFile: undefined,
    sessionId: "sess_1",
    page: session.page,
  });
});
