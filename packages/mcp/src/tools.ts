import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ANNOTE_INTENT_AGENT_GUIDANCE,
  type AnnoteCompactAnnotationDTO,
  type AnnoteSessionSummaryDTO,
} from "../../protocol/src/index.js";
import type { BridgeClient } from "./bridge-client.js";

function result(structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

const sessionId = z.string().optional().describe("Required when an annotation id is ambiguous across sessions.");
const annotationId = z.string().describe("Annote annotation id.");

const INTENT_CONTRACT =
  "Every annotation carries an intent. " +
  ANNOTE_INTENT_AGENT_GUIDANCE.fix +
  " " +
  ANNOTE_INTENT_AGENT_GUIDANCE.ask +
  " " +
  ANNOTE_INTENT_AGENT_GUIDANCE.note;

export function registerAnnoteTools(server: McpServer, bridge: BridgeClient): void {
  server.registerTool(
    "annote_list_sessions",
    {
      title: "List Annote sessions",
      description: "List Annote browser sessions without annotation contents. Use this before operating when multiple tabs may be connected.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => result(await bridge.get<{ sessions: AnnoteSessionSummaryDTO[] }>("/internal/sessions")),
  );

  server.registerTool(
    "annote_list",
    {
      title: "List annotations",
      description: `List current Annote UI feedback with each annotation's intent. Use this to discover work before making interface changes. ${INTENT_CONTRACT}`,
      inputSchema: { sessionId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sessionId }) => {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      return result(await bridge.get<{ annotations: AnnoteCompactAnnotationDTO[] }>(`/internal/annotations${qs}`));
    },
  );

  server.registerTool(
    "annote_get",
    {
      title: "Get annotation details",
      description: `Get complete context for an Annote annotation, including its intent, the selected element, React/source context, requested CSS or Motion edits, and conversation. ${INTENT_CONTRACT}`,
      inputSchema: { id: annotationId, sessionId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, sessionId }) => result(await bridge.post(`/internal/annotations/${encodeURIComponent(id)}/get`, { sessionId })),
  );

  server.registerTool(
    "annote_get_pending",
    {
      title: "Get pending feedback",
      description: `Get pending Annote feedback for a browser session. ${INTENT_CONTRACT}`,
      inputSchema: { sessionId: z.string().describe("Browser session id from annote_list_sessions.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sessionId }) => result(await bridge.get(`/internal/pending?sessionId=${encodeURIComponent(sessionId)}`)),
  );

  server.registerTool(
    "annote_get_all_pending",
    {
      title: "Get all pending feedback",
      description: `Get pending Annote feedback across browser sessions. Each result remains scoped to its session and page. ${INTENT_CONTRACT}`,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => result(await bridge.get("/internal/pending")),
  );

  server.registerTool(
    "annote_watch_annotations",
    {
      title: "Watch for Annote feedback",
      description: `Wait for new Annote feedback. Useful for an interactive loop while a user reviews the browser. When claim is true, returned annotations are atomically claimed before the tool returns. ${INTENT_CONTRACT}`,
      inputSchema: {
        sessionId,
        timeoutSeconds: z.number().min(1).max(600).optional().describe("Default 120."),
        batchWindowMs: z.number().min(0).max(10000).optional().describe("Default 2000."),
        claim: z.boolean().optional().describe("Default true. If true, this tool changes pending annotations to acknowledged."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ sessionId, timeoutSeconds, batchWindowMs, claim }) =>
      result(await bridge.post("/internal/watch", { sessionId, timeoutSeconds, batchWindowMs, claim, claimant: "annote-mcp" })),
  );

  server.registerTool(
    "annote_claim",
    {
      title: "Claim feedback",
      description: "Claim a pending annotation before implementing it so another coding agent does not work on the same feedback.",
      inputSchema: { id: annotationId, sessionId, claimedBy: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ id, sessionId, claimedBy }) =>
      result(await bridge.post(`/internal/annotations/${encodeURIComponent(id)}/claim`, { sessionId, claimant: claimedBy || "annote-mcp" })),
  );

  server.registerTool(
    "annote_reply",
    {
      title: "Reply to feedback",
      description: "Add an agent reply to an annotation thread. The browser appends the message to the annotation conversation.",
      inputSchema: { id: annotationId, sessionId, message: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, sessionId, message }) => result(await bridge.post(`/internal/annotations/${encodeURIComponent(id)}/reply`, { sessionId, message })),
  );

  server.registerTool(
    "annote_resolve",
    {
      title: "Resolve feedback",
      description: "Mark feedback as resolved after completing or confirming the requested work.",
      inputSchema: { id: annotationId, sessionId, message: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, sessionId, message }) => result(await bridge.post(`/internal/annotations/${encodeURIComponent(id)}/resolve`, { sessionId, message })),
  );

  server.registerTool(
    "annote_dismiss",
    {
      title: "Dismiss feedback",
      description: "Dismiss feedback intentionally without implementing it. This does not delete the annotation.",
      inputSchema: { id: annotationId, sessionId, reason: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, sessionId, reason }) => result(await bridge.post(`/internal/annotations/${encodeURIComponent(id)}/dismiss`, { sessionId, reason })),
  );
}
