// MCP presentation coverage: stable machine names, human-readable titles,
// operational descriptions, preserved annotation hints, server identity.
import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "/tmp/annote-mcp.mjs";

const EXPECTED_TITLES = {
  annote_list_sessions: "List Annote sessions",
  annote_list: "List annotations",
  annote_get: "Get annotation details",
  annote_get_pending: "Get pending feedback",
  annote_get_all_pending: "Get all pending feedback",
  annote_watch_annotations: "Watch for Annote feedback",
  annote_claim: "Claim feedback",
  annote_reply: "Reply to feedback",
  annote_resolve: "Resolve feedback",
  annote_dismiss: "Dismiss feedback",
};

const READ_ONLY = new Set([
  "annote_list_sessions",
  "annote_list",
  "annote_get",
  "annote_get_pending",
  "annote_get_all_pending",
]);

async function withClient(fn) {
  const server = await createMcpServer(
    { machineSecret: "test-secret-for-metadata-probe-00", createdAt: new Date().toISOString() },
    1,
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "metadata-probe", version: "1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await fn(client);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

test("tools/list keeps machine names and exposes human-readable titles", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, Object.keys(EXPECTED_TITLES).sort());
    for (const tool of tools) {
      assert.equal(tool.title, EXPECTED_TITLES[tool.name], `${tool.name} title`);
      assert.ok(!tool.title.includes("_"), `${tool.name} title has underscores`);
      assert.ok(tool.description && tool.description.length > 20, `${tool.name} description`);
    }
  });
});

test("feedback discovery tools document the intent contract", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of ["annote_list", "annote_get", "annote_get_pending", "annote_get_all_pending", "annote_watch_annotations"]) {
      const description = byName.get(name).description;
      assert.match(description, /intent=fix/, `${name} missing fix semantics`);
      assert.match(description, /intent=ask/, `${name} missing ask semantics`);
      assert.match(description, /intent=note/, `${name} missing note semantics`);
    }
  });
});

test("tool annotation hints stay read-appropriate without behavior change", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      if (READ_ONLY.has(tool.name)) {
        assert.notEqual(tool.annotations?.readOnlyHint, false, `${tool.name} lost read-only hint`);
      } else {
        assert.equal(tool.annotations?.readOnlyHint, false, `${tool.name} gained read-only hint`);
      }
    }
    // Watch can atomically claim (claim defaults true), so it stays
    // explicitly non-read-only — preserved as-is, not migrated.
    const watch = tools.find((tool) => tool.name === "annote_watch_annotations");
    assert.equal(watch.annotations?.readOnlyHint, false);
  });
});

test("server identity is Annote with a display title", async () => {
  await withClient(async (client) => {
    const info = client.getServerVersion();
    assert.equal(info?.name, "annote");
    assert.equal(info?.title, "Annote");
  });
});
