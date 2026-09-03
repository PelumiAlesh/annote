import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function resolveCliPath() {
  // Hermetic fixture built by scripts/build-test-fixtures.mjs; fall back to
  // the tracked dist build for ad-hoc runs without the fixture step.
  try {
    const pinned = (await readFile("/tmp/annote-test-cli-path", "utf8")).trim();
    if (pinned) return pinned;
  } catch {}
  return "dist/mcp/cli.js";
}

test("stdio MCP server initializes, lists tools, and invokes a read tool", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-stdio-"));
  const cliPath = await resolveCliPath();
  const transport = new StdioClientTransport({
    command: "node",
    args: [cliPath, "server", "--port", "0"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      ...process.env,
      ANNOTE_TEST_CONFIG_PATH: join(dir, "config.json"),
      ANNOTE_TEST_PERMISSIONS_PATH: join(dir, "permissions.json"),
    },
  });
  const client = new Client({ name: "annote-test-client", version: "0.1.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.ok(names.includes("annote_list_sessions"));
    assert.ok(names.includes("annote_get"));
    assert.ok(names.includes("annote_watch_annotations"));
    const result = await client.callTool({ name: "annote_list_sessions", arguments: {} });
    assert.equal(result.isError, undefined);
    const text = result.content.find((item) => item.type === "text")?.text;
    assert.deepEqual(JSON.parse(text).sessions, []);
  } finally {
    await client.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
