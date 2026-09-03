import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { ANNOTE_HEALTH_NAME, ANNOTE_PROTOCOL_VERSION, isProtocolCompatible, type AnnoteHealthDTO, type AnnoteSessionDTO } from "../../protocol/src/index.js";
import { bridgeBaseUrl, DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT, type AnnoteConfig } from "./config.js";
import { EventBus } from "./event-bus.js";
import { PairingStore } from "./pairing.js";
import { isOriginAllowed, originFromHeader, revokeOrigin } from "./permissions.js";
import { SessionStore } from "./session-store.js";

export type BridgeServer = {
  server: http.Server;
  store: SessionStore;
  bus: EventBus;
  instanceId: string;
  port: number;
  close: () => Promise<void>;
};

type JsonResponse = Record<string, unknown> | Array<unknown>;

const MAX_BODY_BYTES = 2_000_000;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function isLoopbackHost(hostHeader: string | string[] | undefined, activePort: number): boolean {
  if (Array.isArray(hostHeader) || !hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();
  if (!host) return false;
  // Split host / port, accounting for IPv6 literals like [::1]:4747.
  let hostname = host;
  let port: string | null = null;
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close === -1) return false;
    hostname = host.slice(0, close + 1);
    const rest = host.slice(close + 1);
    if (rest.startsWith(":")) port = rest.slice(1);
    else if (rest) return false;
  } else {
    const lastColon = host.lastIndexOf(":");
    // Single colon => host:port. Multiple colons without brackets => invalid.
    if (lastColon !== -1) {
      if (host.indexOf(":") !== lastColon) return false;
      hostname = host.slice(0, lastColon);
      port = host.slice(lastColon + 1);
    }
  }
  const allowed = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
  if (!allowed) return false;
  if (port !== null && port !== "") {
    if (!/^\d+$/.test(port)) return false;
    if (Number(port) !== activePort) return false;
  }
  return true;
}

export const SSE_HEARTBEAT_MS = 15_000;

export async function readJson<T = unknown>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Malformed JSON body");
  }
}

function sendJson(response: ServerResponse, status: number, body: JsonResponse, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body);
}

function methodNotAllowed(response: ServerResponse): void {
  sendJson(response, 405, { error: "Method not allowed" });
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function internalAuthorized(request: IncomingMessage, config: AnnoteConfig): boolean {
  const header = request.headers["x-annote-internal-secret"];
  return typeof header === "string" && safeEqual(header, config.machineSecret);
}

async function protectedHeaders(request: IncomingMessage): Promise<{ origin: string; headers: Record<string, string> } | null> {
  const origin = originFromHeader(request.headers.origin);
  if (!origin || !(await isOriginAllowed(origin))) return null;
  return {
    origin,
    headers: {
      "access-control-allow-origin": origin,
      vary: "Origin",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-annote-session-token",
      "access-control-allow-private-network": "true",
    },
  };
}

function publicCorsHeaders(request: IncomingMessage): Record<string, string> {
  const origin = originFromHeader(request.headers.origin);
  return origin
    ? {
        "access-control-allow-origin": origin,
        vary: "Origin",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-private-network": "true",
      }
    : {};
}

function pairPage(requestId: string, origin: string): string {
  const escapedOrigin = origin.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Allow Annote</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#f5f5f5;font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(360px,calc(100vw - 32px));display:grid;gap:16px}
    h1{margin:0;font-size:18px;font-weight:500}
    p{margin:0;color:#c7c7c7}
    code{display:block;padding:10px 12px;border-radius:8px;background:#1d1d1d;color:#fff;overflow-wrap:anywhere}
    .actions{display:flex;gap:8px}
    button{border:0;border-radius:999px;padding:8px 13px;cursor:pointer}
    button[type=submit]{background:#ff7a1a;color:#120804}
    .secondary{background:#242424;color:#f2f2f2}
  </style>
</head>
<body>
  <main>
    <h1>Allow Annote on:</h1>
    <code>${escapedOrigin}</code>
    <form method="post" action="/pair/${requestId}/allow" class="actions">
      <button type="submit">Allow</button>
      <button class="secondary" type="submit" formaction="/pair/${requestId}/cancel">Cancel</button>
    </form>
  </main>
</body>
</html>`;
}

function eventStreamHeaders(origin: string): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": origin,
    vary: "Origin",
  };
}

function writeSse(response: ServerResponse, event: unknown): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function createBridgeServer(config: AnnoteConfig, options: { port?: number } = {}): Promise<BridgeServer> {
  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  let activePort = port;
  const instanceId = randomUUID();
  const bus = new EventBus();
  const store = new SessionStore(bus);
  const pairing = new PairingStore();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", bridgeBaseUrl(activePort));

      if (!isLoopbackHost(request.headers.host, activePort)) {
        sendJson(response, 403, { error: "Invalid Host" });
        return;
      }

      if (request.method === "OPTIONS") {
        if (url.pathname === "/health") {
          response.writeHead(204, publicCorsHeaders(request));
          response.end();
          return;
        }
        const protectedCors = await protectedHeaders(request);
        if (!protectedCors) {
          response.writeHead(204, {
            ...publicCorsHeaders(request),
            "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
            "access-control-allow-headers": "content-type,x-annote-session-token",
            "access-control-allow-private-network": "true",
          });
          response.end();
          return;
        }
        response.writeHead(204, protectedCors.headers);
        response.end();
        return;
      }

      if (url.pathname === "/health") {
        if (request.method !== "GET") return methodNotAllowed(response);
        const body: AnnoteHealthDTO = { ok: true, name: ANNOTE_HEALTH_NAME, protocolVersion: ANNOTE_PROTOCOL_VERSION, instanceId };
        sendJson(response, 200, body, publicCorsHeaders(request));
        return;
      }

      if (url.pathname === "/pair/request") {
        if (request.method !== "POST") return methodNotAllowed(response);
        const origin = originFromHeader(request.headers.origin);
        if (!origin) {
          sendJson(response, 400, { error: "Pairing requires a browser Origin header" });
          return;
        }
        const pair = pairing.create(origin);
        sendJson(response, 200, { requestId: pair.requestId, pairUrl: `${bridgeBaseUrl(activePort)}/pair/${pair.requestId}` }, publicCorsHeaders(request));
        return;
      }

      if (url.pathname === "/pair/revoke") {
        if (request.method !== "POST") return methodNotAllowed(response);
        const protectedCors = await protectedHeaders(request);
        if (!protectedCors) {
          sendJson(response, 403, { error: "Origin is not approved" }, publicCorsHeaders(request));
          return;
        }
        await revokeOrigin(protectedCors.origin);
        sendJson(response, 200, { ok: true }, protectedCors.headers);
        return;
      }

      const pairMatch = url.pathname.match(/^\/pair\/([^/]+)(?:\/(allow|cancel))?$/);
      if (pairMatch) {
        const [, requestId, action] = pairMatch;
        const pair = pairing.get(requestId);
        if (!pair) {
          sendText(response, 404, "<!doctype html><title>Annote</title><p>Pairing request expired.</p>");
          return;
        }
        if (!action) {
          if (request.method !== "GET") return methodNotAllowed(response);
          sendText(response, 200, pairPage(requestId, pair.origin));
          return;
        }
        if (request.method !== "POST") return methodNotAllowed(response);
        if (action === "allow") {
          await pairing.approve(requestId);
          sendText(response, 200, "<!doctype html><title>Annote</title><p>Annote is allowed on this site. You can close this tab.</p>");
          return;
        }
        pairing.cancel(requestId);
        sendText(response, 200, "<!doctype html><title>Annote</title><p>Permission was not changed.</p>");
        return;
      }

      if (url.pathname === "/api/sessions") {
        const protectedCors = await protectedHeaders(request);
        if (!protectedCors) {
          sendJson(response, 403, { error: "Origin is not approved" }, publicCorsHeaders(request));
          return;
        }
        if (request.method !== "POST") return methodNotAllowed(response);
        const body = await readJson<AnnoteSessionDTO>(request);
        if (!isProtocolCompatible(body.protocolVersion) || body.page?.origin !== protectedCors.origin) {
          sendJson(response, 400, { error: "Invalid Annote session" }, protectedCors.headers);
          return;
        }
        sendJson(response, 200, store.create(body, protectedCors.origin), protectedCors.headers);
        return;
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/events)?$/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const protectedCors = await protectedHeaders(request);
        if (!protectedCors) {
          sendJson(response, 403, { error: "Origin is not approved" }, publicCorsHeaders(request));
          return;
        }
        const token = request.headers["x-annote-session-token"] || url.searchParams.get("token");
        const record = store.validateToken(sessionId, Array.isArray(token) ? null : token);
        if (!record || record.origin !== protectedCors.origin) {
          sendJson(response, 403, { error: "Invalid session token" }, protectedCors.headers);
          return;
        }
        if (url.pathname.endsWith("/events")) {
          if (request.method !== "GET") return methodNotAllowed(response);
          response.writeHead(200, eventStreamHeaders(protectedCors.origin));
          writeSse(response, bus.event({ type: "connected", instanceId }));
          const unsubscribe = bus.subscribe(sessionId, (event) => writeSse(response, event));
          const heartbeat = setInterval(() => {
            try {
              response.write(": heartbeat\n\n");
            } catch {
              // Client gone; cleanup below handles it.
            }
          }, SSE_HEARTBEAT_MS);
          // Avoid keeping the process alive for idle SSE connections alone.
          heartbeat.unref?.();
          let cleaned = false;
          const cleanup = (): void => {
            if (cleaned) return;
            cleaned = true;
            clearInterval(heartbeat);
            unsubscribe();
          };
          request.on("close", cleanup);
          response.on("close", cleanup);
          return;
        }
        if (request.method === "PUT") {
          const body = await readJson<AnnoteSessionDTO>(request);
          if (!isProtocolCompatible(body.protocolVersion) || body.sessionId !== sessionId || body.page?.origin !== protectedCors.origin) {
            sendJson(response, 400, { error: "Invalid Annote session" }, protectedCors.headers);
            return;
          }
          sendJson(response, store.update(sessionId, record.token, body) ? 200 : 403, { ok: true }, protectedCors.headers);
          return;
        }
        if (request.method === "DELETE") {
          sendJson(response, store.close(sessionId, record.token) ? 200 : 403, { ok: true }, protectedCors.headers);
          return;
        }
        return methodNotAllowed(response);
      }

      if (url.pathname.startsWith("/internal/")) {
        if (!internalAuthorized(request, config)) {
          sendJson(response, 403, { error: "Invalid internal auth" });
          return;
        }
        await handleInternal(url, request, response, store);
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (response.headersSent) {
        try {
          response.destroy();
        } catch {
          // Ignore — connection already gone.
        }
        return;
      }
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: "Internal error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, DEFAULT_BRIDGE_HOST, () => {
      const address = server.address();
      activePort = typeof address === "object" && address ? address.port : port;
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    store,
    bus,
    instanceId,
    port: activePort,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function handleInternal(url: URL, request: IncomingMessage, response: ServerResponse, store: SessionStore): Promise<void> {
  if (url.pathname === "/internal/status") {
    sendJson(response, 200, { bridge: "running", port: Number(url.port) || DEFAULT_BRIDGE_PORT, sessions: store.sessionCount(), protocolVersion: ANNOTE_PROTOCOL_VERSION });
    return;
  }
  if (url.pathname === "/internal/sessions") {
    sendJson(response, 200, { sessions: store.listSessions() });
    return;
  }
  if (url.pathname === "/internal/annotations") {
    const sessionId = url.searchParams.get("sessionId") || undefined;
    sendJson(response, 200, { annotations: store.listAnnotations(sessionId) });
    return;
  }
  if (url.pathname === "/internal/pending") {
    const sessionId = url.searchParams.get("sessionId") || undefined;
    sendJson(response, 200, { annotations: store.pending(sessionId) });
    return;
  }
  if (url.pathname === "/internal/watch") {
    const body = request.method === "POST" ? await readJson<{ sessionId?: string; timeoutSeconds?: number; batchWindowMs?: number; claim?: boolean; claimant?: string }>(request) : {};
    const annotations = await store.watch({
      sessionId: body.sessionId,
      timeoutMs: Math.max(1, Math.min(body.timeoutSeconds || 120, 600)) * 1000,
      batchWindowMs: Math.max(0, Math.min(body.batchWindowMs || 2000, 10_000)),
      claim: body.claim !== false,
      claimant: body.claimant || "annote-mcp",
    });
    sendJson(response, 200, { annotations });
    return;
  }
  const actionMatch = url.pathname.match(/^\/internal\/annotations\/([^/]+)\/(get|claim|reply|resolve|dismiss)$/);
  if (actionMatch) {
    const [, id, action] = actionMatch;
    const body = request.method === "POST" ? await readJson<{ sessionId?: string; message?: string; reason?: string; claimant?: string }>(request) : {};
    if (action === "get") {
      const result = store.getAnnotation(id, body.sessionId);
      if (!result) return sendJson(response, 404, { error: "Annotation not found" });
      if ("ambiguous" in result) return sendJson(response, 409, { error: "Annotation exists in multiple sessions. Provide sessionId." });
      return sendJson(response, 200, { sessionId: result.session.sessionId, page: result.session.page, annotation: result.annotation });
    }
    if (action === "claim") return sendJson(response, 200, store.claim(id, body.claimant || "annote-mcp", body.sessionId));
    if (action === "reply") return sendJson(response, 200, store.reply(id, body.message || "", body.sessionId));
    if (action === "resolve") return sendJson(response, 200, store.resolve(id, body.message, body.sessionId));
    if (action === "dismiss") return sendJson(response, 200, store.dismiss(id, body.reason, body.sessionId));
  }
  sendJson(response, 404, { error: "Not found" });
}

export async function health(port = DEFAULT_BRIDGE_PORT): Promise<AnnoteHealthDTO | null> {
  try {
    const response = await fetch(`${bridgeBaseUrl(port)}/health`);
    if (!response.ok) return null;
    const body = (await response.json()) as AnnoteHealthDTO;
    return body?.ok && body.name === ANNOTE_HEALTH_NAME ? body : null;
  } catch {
    return null;
  }
}
