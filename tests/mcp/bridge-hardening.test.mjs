import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ANNOTE_PROTOCOL_VERSION } from "/tmp/annote-protocol.mjs";
import { createBridgeServer, ensureConfig, isLoopbackHost } from "/tmp/annote-mcp.mjs";

async function withBridge(fn) {
  const dir = await mkdtemp(join(tmpdir(), "annote-harden-"));
  const configPath = join(dir, "config.json");
  const permissionsPath = join(dir, "permissions.json");
  process.env.ANNOTE_TEST_PERMISSIONS_PATH = permissionsPath;
  const { config } = await ensureConfig(configPath);
  const bridge = await createBridgeServer(config, { port: 0 });
  const address = bridge.server.address();
  const port = address.port;
  try {
    await fn({ bridge, config, port });
  } finally {
    await bridge.close();
    delete process.env.ANNOTE_TEST_PERMISSIONS_PATH;
    await rm(dir, { recursive: true, force: true });
  }
}

test("isLoopbackHost accepts loopback forms and rejects rebinding hosts", () => {
  assert.equal(isLoopbackHost("127.0.0.1:4747", 4747), true);
  assert.equal(isLoopbackHost("localhost:4747", 4747), true);
  assert.equal(isLoopbackHost("127.0.0.1", 4747), true);
  assert.equal(isLoopbackHost("[::1]:4747", 4747), true);
  assert.equal(isLoopbackHost("evil.com", 4747), false);
  assert.equal(isLoopbackHost("attacker.example:4747", 4747), false);
  assert.equal(isLoopbackHost("127.0.0.1:9999", 4747), false);
  assert.equal(isLoopbackHost(undefined, 4747), false);
  assert.equal(isLoopbackHost(["127.0.0.1:4747"], 4747), false);
});

test("DNS-rebinding style Host header is rejected before processing", async () => {
  await withBridge(async ({ port }) => {
    const { default: http } = await import("node:http");
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/health", method: "GET", headers: { Host: "evil.example.com" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  });
});

test("malformed JSON returns 400 without leaking internals", async () => {
  await withBridge(async ({ port }) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(process.env.ANNOTE_TEST_PERMISSIONS_PATH, JSON.stringify({ allowedOrigins: ["http://localhost:4173"] }));
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json" },
      body: "{not-json",
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "Malformed JSON body");
  });
});

test("unauthenticated session access returns 403 (not empty 204)", async () => {
  await withBridge(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/sess_missing`, {
      method: "PUT",
      headers: { Origin: "https://unapproved.example", "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: ANNOTE_PROTOCOL_VERSION }),
    });
    assert.equal(response.status, 403);
  });
});

test("unknown resource returns 404", async () => {
  await withBridge(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(response.status, 404);
  });
});

test("SSE connection opens, receives connected event, and closes cleanly", async () => {
  await withBridge(async ({ port }) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(process.env.ANNOTE_TEST_PERMISSIONS_PATH, JSON.stringify({ allowedOrigins: ["http://localhost:4173"] }));
    const base = `http://127.0.0.1:${port}`;
    const created = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: ANNOTE_PROTOCOL_VERSION,
        sessionId: "sess_sse",
        page: { url: "http://localhost:4173/demo", origin: "http://localhost:4173" },
        annotations: [],
        updatedAt: new Date().toISOString(),
      }),
    }).then((r) => r.json());
    const controller = new AbortController();
    const response = await fetch(`${base}/api/sessions/sess_sse/events`, {
      headers: { Origin: "http://localhost:4173", "x-annote-session-token": created.sessionToken },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    assert.match(text, /connected/);
    controller.abort();
    await reader.cancel().catch(() => {});
    // Server must still serve after SSE disconnect (no leaked interval crash).
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
  });
});
