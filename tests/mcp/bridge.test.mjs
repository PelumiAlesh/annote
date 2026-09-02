import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ANNOTE_PROTOCOL_VERSION } from "/tmp/annote-protocol.mjs";
import { BridgeClient, PairingStore, createBridgeServer, ensureConfig } from "/tmp/annote-mcp.mjs";

async function withBridge(fn) {
  const dir = await mkdtemp(join(tmpdir(), "annote-bridge-"));
  const configPath = join(dir, "config.json");
  const permissionsPath = join(dir, "permissions.json");
  process.env.ANNOTE_TEST_PERMISSIONS_PATH = permissionsPath;
  const { config } = await ensureConfig(configPath);
  const bridge = await createBridgeServer(config, { port: 0 });
  const address = bridge.server.address();
  const port = address.port;
  try {
    await fn({ bridge, config, port, permissionsPath });
  } finally {
    await bridge.close();
    delete process.env.ANNOTE_TEST_PERMISSIONS_PATH;
    await rm(dir, { recursive: true, force: true });
  }
}

function session(origin = "http://localhost:4173") {
  return {
    protocolVersion: ANNOTE_PROTOCOL_VERSION,
    sessionId: "sess_1",
    page: { url: `${origin}/demo`, title: "Demo", origin },
    annotations: [
      {
        protocolVersion: ANNOTE_PROTOCOL_VERSION,
        id: "ann_1",
        status: "pending",
        feedback: "Fix spacing",
        thread: [],
        target: { element: "Card", selector: ".card" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

test("health is minimal and does not expose session data", async () => {
  await withBridge(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: "https://example.com" } });
    const body = await response.json();
    assert.equal(response.ok, true);
    assert.equal(body.name, "annote");
    assert.equal(body.protocolVersion, 1);
    assert.equal("sessions" in body, false);
    assert.equal("annotations" in body, false);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://example.com");
  });
});

test("unapproved origins cannot create sessions and approved origins receive exact CORS", async () => {
  await withBridge(async ({ port, permissionsPath }) => {
    const base = `http://127.0.0.1:${port}`;
    let response = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json" },
      body: JSON.stringify(session()),
    });
    assert.equal(response.status, 403);
    assert.notEqual(response.headers.get("access-control-allow-origin"), "*");

    response = await fetch(`${base}/pair/request`, { method: "POST", headers: { Origin: "http://localhost:4173" } });
    const pair = await response.json();
    await fetch(pair.pairUrl.replace("/pair/", "/pair/") + "/allow", { method: "POST" });
    const permissions = JSON.parse(await readFile(permissionsPath, "utf8"));
    assert.deepEqual(permissions.allowedOrigins, ["http://localhost:4173"]);

    response = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json" },
      body: JSON.stringify(session()),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:4173");
  });
});

test("origin revocation removes browser access without exposing wildcard CORS", async () => {
  await withBridge(async ({ port, permissionsPath }) => {
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(permissionsPath, JSON.stringify({ allowedOrigins: ["http://localhost:4173"] })),
    );
    const base = `http://127.0.0.1:${port}`;
    let response = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json" },
      body: JSON.stringify(session()),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/pair/revoke`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:4173");

    response = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json" },
      body: JSON.stringify(session()),
    });
    assert.equal(response.status, 403);
    assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
  });
});

test("session tokens are scoped and internal auth rejects browser access", async () => {
  await withBridge(async ({ port, permissionsPath, config }) => {
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(permissionsPath, JSON.stringify({ allowedOrigins: ["http://localhost:4173"] })),
    );
    const base = `http://127.0.0.1:${port}`;
    const created = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json" },
      body: JSON.stringify(session()),
    }).then((response) => response.json());
    const bad = await fetch(`${base}/api/sessions/sess_1`, {
      method: "PUT",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json", "x-annote-session-token": "bad" },
      body: JSON.stringify(session()),
    });
    assert.equal(bad.status, 403);
    const internalBad = await fetch(`${base}/internal/sessions`);
    assert.equal(internalBad.status, 403);
    const client = new BridgeClient(config, port);
    assert.equal((await client.get("/internal/sessions")).sessions.length, 1);
    const good = await fetch(`${base}/api/sessions/sess_1`, {
      method: "PUT",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json", "x-annote-session-token": created.sessionToken },
      body: JSON.stringify(session()),
    });
    assert.equal(good.status, 200);
  });
});

test("claim is atomic at the shared session store layer", async () => {
  await withBridge(async ({ port, permissionsPath, config }) => {
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(permissionsPath, JSON.stringify({ allowedOrigins: ["http://localhost:4173"] })),
    );
    const base = `http://127.0.0.1:${port}`;
    await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { Origin: "http://localhost:4173", "content-type": "application/json" },
      body: JSON.stringify(session()),
    });
    const client = new BridgeClient(config, port);
    const [a, b] = await Promise.all([
      client.post("/internal/annotations/ann_1/claim", { claimant: "agent-a" }),
      client.post("/internal/annotations/ann_1/claim", { claimant: "agent-b" }),
    ]);
    assert.equal([a.claimed, b.claimed].filter(Boolean).length, 1);
  });
});

test("pairing approvals are one-use and expire", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-pairing-"));
  const permissionsPath = join(dir, "permissions.json");
  process.env.ANNOTE_TEST_PERMISSIONS_PATH = permissionsPath;
  try {
    const store = new PairingStore(5);
    const request = store.create("http://localhost:4173");
    assert.equal(await store.approve(request.requestId), "http://localhost:4173");
    assert.equal(await store.approve(request.requestId), null);

    const expiring = store.create("http://localhost:4174");
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(await store.approve(expiring.requestId), null);
  } finally {
    delete process.env.ANNOTE_TEST_PERMISSIONS_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});
