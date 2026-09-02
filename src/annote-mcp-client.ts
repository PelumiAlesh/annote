import {
  ANNOTE_PROTOCOL_VERSION,
  annotationsToDTO,
  isProtocolCompatible,
  type AnnoteBridgeEventDTO,
  type AnnoteHealthDTO,
  type AnnoteSessionDTO,
} from "../packages/protocol/src/index";

export type AnnoteMcpState =
  | "companion-not-found"
  | "permission-required"
  | "connected"
  | "protocol-incompatible"
  | "error";

export type AnnoteMcpClientOptions = {
  getAnnotations: () => unknown[];
  applyEvent: (event: AnnoteBridgeEventDTO) => void;
  onStateChange: (state: AnnoteMcpState) => void;
};

export type AnnoteMcpClient = {
  check: () => Promise<AnnoteMcpState>;
  startSettingsChecks: () => void;
  stopSettingsChecks: () => void;
  sync: () => void;
  requestPairing: () => Promise<void>;
  revoke: () => Promise<void>;
  destroy: () => void;
  state: () => AnnoteMcpState;
};

const BRIDGE_URL = "http://127.0.0.1:4747";
const FUTURE_SETUP_COMMAND = "npx annote init";
export const ANNOTE_LOCAL_SETUP_COMMAND = "npm run mcp:init";
export const ANNOTE_FUTURE_SETUP_COMMAND = FUTURE_SETUP_COMMAND;

function createSessionId(): string {
  return `sess_${crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2)}`;
}

function pageOrigin(): string {
  return location.origin;
}

function requestJson<T>(url: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; ok: boolean; body: T }> {
  if (typeof fetch === "function") {
    return fetch(url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    }).then(async (response) => ({
      status: response.status,
      ok: response.ok,
      body: response.status === 204 ? ({} as T) : ((await response.json()) as T),
    }));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method || "GET", url);
    Object.entries(options.headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.onload = () => {
      try {
        resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, body: xhr.responseText ? JSON.parse(xhr.responseText) : ({} as T) });
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.send(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

export function createAnnoteMcpClient(options: AnnoteMcpClientOptions): AnnoteMcpClient {
  let currentState: AnnoteMcpState = "companion-not-found";
  let health: AnnoteHealthDTO | null = null;
  let sessionId = createSessionId();
  let sessionToken: string | null = null;
  let eventSource: EventSource | null = null;
  let settingsTimer: number | null = null;
  let syncTimer: number | null = null;
  let lastInstanceId: string | null = null;
  const seenEvents = new Set<string>();

  function setState(next: AnnoteMcpState): AnnoteMcpState {
    if (currentState !== next) {
      currentState = next;
      options.onStateChange(next);
    }
    return currentState;
  }

  function headers(): HeadersInit {
    return sessionToken ? { "content-type": "application/json", "x-annote-session-token": sessionToken } : { "content-type": "application/json" };
  }

  function sessionDTO(): AnnoteSessionDTO {
    const now = new Date().toISOString();
    return {
      protocolVersion: ANNOTE_PROTOCOL_VERSION,
      sessionId,
      page: { url: location.href, title: document.title || undefined, origin: pageOrigin() },
      annotations: annotationsToDTO(options.getAnnotations()),
      updatedAt: now,
    };
  }

  async function check(): Promise<AnnoteMcpState> {
    try {
      const response = await requestJson<AnnoteHealthDTO>(`${BRIDGE_URL}/health`);
      if (!response.ok) return setState("companion-not-found");
      health = response.body;
      if (!isProtocolCompatible(health.protocolVersion)) return setState("protocol-incompatible");
      if (lastInstanceId && lastInstanceId !== health.instanceId) {
        sessionToken = null;
        closeEvents();
      }
      lastInstanceId = health.instanceId;
      if (!sessionToken) return createSession();
      sync();
      connectEvents();
      return setState("connected");
    } catch {
      sessionToken = null;
      closeEvents();
      return setState("companion-not-found");
    }
  }

  async function createSession(): Promise<AnnoteMcpState> {
    try {
      const response = await requestJson<{ sessionId: string; sessionToken: string }>(`${BRIDGE_URL}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: sessionDTO(),
      });
      if (response.status === 403) return setState("permission-required");
      if (!response.ok) return setState("error");
      const body = response.body;
      sessionId = body.sessionId || sessionId;
      sessionToken = body.sessionToken;
      connectEvents();
      return setState("connected");
    } catch {
      return setState("error");
    }
  }

  function sync(): void {
    if (!sessionToken || currentState !== "connected") return;
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      void requestJson(`${BRIDGE_URL}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        headers: headers() as Record<string, string>,
        body: sessionDTO(),
      }).then((response) => {
        if (response.status === 403) setState("permission-required");
      }).catch(() => setState("companion-not-found"));
    }, 350);
  }

  function connectEvents(): void {
    if (!sessionToken || eventSource) return;
    if (typeof EventSource !== "function") return;
    eventSource = new EventSource(`${BRIDGE_URL}/api/sessions/${encodeURIComponent(sessionId)}/events?token=${encodeURIComponent(sessionToken)}`);
    eventSource.onmessage = (message) => {
      const event = JSON.parse(message.data) as AnnoteBridgeEventDTO;
      if (seenEvents.has(event.eventId)) return;
      seenEvents.add(event.eventId);
      if (seenEvents.size > 500) seenEvents.clear();
      if (event.type === "connected") {
        if (lastInstanceId && lastInstanceId !== event.instanceId) {
          sessionToken = null;
          closeEvents();
          void check();
        }
        lastInstanceId = event.instanceId;
        return;
      }
      if (event.type === "resync-required") {
        sync();
        return;
      }
      options.applyEvent(event);
    };
    eventSource.onerror = () => {
      closeEvents();
      setState("companion-not-found");
    };
  }

  function closeEvents(): void {
    eventSource?.close();
    eventSource = null;
  }

  async function requestPairing(): Promise<void> {
    const response = await requestJson<{ pairUrl?: string }>(`${BRIDGE_URL}/pair/request`, { method: "POST" });
    if (!response.ok) {
      setState("error");
      return;
    }
    const body = response.body;
    if (body.pairUrl) window.open(body.pairUrl, "annote-pair", "popup,width=420,height=360");
  }

  async function revoke(): Promise<void> {
    await requestJson(`${BRIDGE_URL}/pair/revoke`, { method: "POST" }).catch(() => undefined);
    if (sessionToken) {
      await requestJson(`${BRIDGE_URL}/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", headers: headers() as Record<string, string> }).catch(() => undefined);
    }
    sessionToken = null;
    closeEvents();
    setState("permission-required");
  }

  function startSettingsChecks(): void {
    if (settingsTimer !== null) return;
    void check();
    settingsTimer = window.setInterval(() => void check(), 3000);
  }

  function stopSettingsChecks(): void {
    if (settingsTimer !== null) window.clearInterval(settingsTimer);
    settingsTimer = null;
  }

  function destroy(): void {
    stopSettingsChecks();
    closeEvents();
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = null;
    if (sessionToken) {
      void requestJson(`${BRIDGE_URL}/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", headers: headers() as Record<string, string> }).catch(() => undefined);
    }
  }

  return { check, startSettingsChecks, stopSettingsChecks, sync, requestPairing, revoke, destroy, state: () => currentState };
}
