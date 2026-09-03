import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml } from "/tmp/feedback-mark-html-escape.mjs";
import { annotationToDTO } from "/tmp/annote-protocol.mjs";

const PAYLOADS = [
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(1)">',
  '"><svg onload=alert(1)>',
  "'\"<>&",
  "&lt;script&gt;",
  "var(--x); </style><script>alert(1)</script>",
];

test("escapeHtml neutralizes all payloads as text", () => {
  for (const p of PAYLOADS) {
    const out = escapeHtml(p);
    assert.ok(!out.includes("<script"), `leaked: ${out}`);
    assert.ok(!out.includes("<img"), `leaked: ${out}`);
    assert.ok(!out.includes("<svg"), `leaked: ${out}`);
    assert.ok(out.includes("&lt;") || out.includes("&gt;") || out.includes("&amp;") || out.includes("&quot;") || !/[<>&"']/.test(out));
  }
});

test("quotes and angle brackets are fully entity-encoded", () => {
  assert.equal(escapeHtml(`'"<>&`), "&#39;&quot;&lt;&gt;&amp;");
});

test("protocol DTO keeps hostile text as inert JSON data and redacts secrets", () => {
  const dto = annotationToDTO({
    id: "a1",
    comment: "Bearer sk-1234567890abcdef token eyJh.e30.c2ln",
    element: "<img src=x onerror=alert(1)>",
    elementPath: ".card",
    reactContext: { component: "<script>alert(1)</script>", source: { fileName: "src/App.tsx?<script>" } },
  });
  assert.ok(dto);
  // JSON transport must not execute — content stays inert text; renderer escapes it.
  // Verify the render boundary neutralizes what the DTO faithfully carries.
  assert.ok(!dto.feedback.includes("sk-1234567890abcdef"));
  for (const s of [dto.feedback, dto.target.element, dto.react?.component || ""]) {
    assert.equal(escapeHtml(s).includes("<script"), false);
    assert.equal(escapeHtml(s).includes("<img"), false);
  }
});

test("thread and agent replies stay inert through the render boundary", () => {
  const dto = annotationToDTO({
    id: "a1",
    comment: "ok",
    element: "Card",
    elementPath: ".c",
    thread: [{ id: "m1", role: "agent", content: "<svg onload=alert(1)>hello" }],
  });
  assert.ok(dto.thread[0].content.includes("hello"));
  assert.equal(escapeHtml(dto.thread[0].content).includes("<svg"), false);
});
