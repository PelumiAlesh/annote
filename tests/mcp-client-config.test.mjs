import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalServerCommand, getAdapters } from "/tmp/feedback-mark-mcp-client-config.mjs";

async function withTempHome(fn) {
  const dir = await mkdtemp(join(tmpdir(), "annote-home-"));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  try {
    return await fn(dir);
  } finally {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    await rm(dir, { recursive: true, force: true });
  }
}

test("canonical command is npx -y annote server", () => {
  const cmd = canonicalServerCommand();
  assert.deepEqual(cmd, { command: "npx", args: ["-y", "annote", "server"] });
  assert.equal(cmd.args.join(" "), "-y annote server");
});

test("all adapters have unique ids and required fields", async () => {
  const adapters = getAdapters();
  const ids = adapters.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const adapter of adapters) {
    assert.ok(adapter.id, `${adapter.name} missing id`);
    assert.ok(adapter.name, `${adapter.id} missing name`);
    assert.equal(typeof adapter.detect, "function");
    assert.equal(typeof adapter.getConfigPreview, "function");
    assert.equal(typeof adapter.configure, "function");
    const preview = adapter.getConfigPreview();
    assert.ok(preview.includes("annote"), `${adapter.id} preview missing annote`);
    // No bad paths
    assert.ok(!preview.includes("dist/mcp/cli.js"), `${adapter.id} preview contains bad path`);
    assert.ok(!preview.includes("node_modules"), `${adapter.id} preview contains bad path`);
    assert.ok(!preview.includes("import.meta.url"), `${adapter.id} preview contains bad path`);
  }
});

test("Codex preview and idempotent TOML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-codex-"));
  try {
    const { configureClient } = await import("/tmp/feedback-mark-mcp-client-config.mjs");
    const tomlPath = join(dir, "config.toml");
    const client = {
      id: "codex",
      name: "Codex",
      path: tomlPath,
      detected: true,
      safeMutation: true,
      entry: "",
    };
    // First add
    let result = await configureClient(client);
    assert.equal(result, "added");
    let content = await readFile(tomlPath, "utf8");
    assert.ok(content.includes('command = "npx"'));
    assert.ok(content.includes('"annote"'));
    assert.ok(content.includes('"server"'));
    assert.ok(!content.includes("dist/mcp/cli.js"));
    assert.ok(!content.includes("node_modules"));
    // Duplicate prevention
    result = await configureClient(client);
    assert.equal(result, "exists");
    content = await readFile(tomlPath, "utf8");
    const matches = content.match(/\[mcp_servers\.annote\]/g) || [];
    assert.equal(matches.length, 1);
    // Preserve unrelated
    await writeFile(tomlPath, `[mcp_servers.other]\ncommand = "node"\nargs = ["other"]\n\n${content}`);
    result = await configureClient(client);
    assert.equal(result, "exists");
    const after = await readFile(tomlPath, "utf8");
    assert.ok(after.includes("other"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Cursor JSON preserves unrelated and prevents duplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-cursor-"));
  try {
    const { configureClient } = await import("/tmp/feedback-mark-mcp-client-config.mjs");
    const jsonPath = join(dir, "mcp.json");
    await mkdir(dir, { recursive: true });
    await writeFile(jsonPath, JSON.stringify({ mcpServers: { existing: { command: "node", args: ["old"] } } }, null, 2));
    const client = { id: "cursor", name: "Cursor", path: jsonPath, detected: true, safeMutation: true, entry: "" };
    let result = await configureClient(client);
    assert.equal(result, "added");
    let content = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.deepEqual(content.mcpServers.annote, { command: "npx", args: ["-y", "annote", "server"] });
    assert.deepEqual(content.mcpServers.existing, { command: "node", args: ["old"] });
    result = await configureClient(client);
    assert.equal(result, "exists");
    // Malformed
    await writeFile(jsonPath, "{ not json");
    result = await configureClient(client);
    assert.equal(result, "manual");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude manual entry uses canonical command", async () => {
  const adapters = getAdapters();
  const claude = adapters.find((a) => a.id === "claude");
  assert.ok(claude);
  const preview = claude.getConfigPreview();
  assert.ok(preview.includes("npx"));
  assert.ok(preview.includes("annote"));
  assert.ok(preview.includes("server"));
  assert.ok(!preview.includes("dist/mcp/cli.js"));
});

test("Hermes YAML preserves and prevents duplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-hermes-"));
  const origPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const { configureClient } = await import("/tmp/feedback-mark-mcp-client-config.mjs?v=hermes");
    const yamlPath = join(dir, "config.yaml");
    const client = { id: "hermes", name: "Hermes Agent", path: yamlPath, detected: true, safeMutation: true, entry: "" };
    let result = await configureClient(client);
    assert.equal(result, "added");
    let content = await readFile(yamlPath, "utf8");
    assert.ok(content.includes("annote:"));
    assert.ok(content.includes('command: "npx"'));
    result = await configureClient(client);
    assert.equal(result, "exists");
    // Preserve unrelated
    await writeFile(yamlPath, `models:\n  deepseek: {}\n\n${content}`);
    result = await configureClient(client);
    assert.equal(result, "exists");
    const after = await readFile(yamlPath, "utf8");
    assert.ok(after.includes("deepseek"));
  } finally {
    process.env.PATH = origPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test("OpenCode preserves format and prevents duplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-opencode-"));
  try {
    const { configureClient } = await import("/tmp/feedback-mark-mcp-client-config.mjs");
    const jsonPath = join(dir, "opencode.json");
    const client = { id: "opencode", name: "OpenCode", path: jsonPath, detected: true, safeMutation: true, entry: "" };
    await writeFile(jsonPath, JSON.stringify({ mcp: { servers: { other: { command: "node", args: ["x"] } } } }, null, 2));
    let result = await configureClient(client);
    assert.equal(result, "added");
    let content = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.ok(content.mcp.servers.annote);
    assert.deepEqual(content.mcp.servers.annote, { command: "npx", args: ["-y", "annote", "server"] });
    assert.ok(content.mcp.servers.other);
    result = await configureClient(client);
    assert.equal(result, "exists");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Gemini preserves unrelated config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-gemini-"));
  try {
    const { configureClient } = await import("/tmp/feedback-mark-mcp-client-config.mjs");
    const jsonPath = join(dir, "settings.json");
    await writeFile(jsonPath, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "node", args: ["old"] } } }, null, 2));
    const client = { id: "gemini", name: "Gemini CLI", path: jsonPath, detected: true, safeMutation: true, entry: "" };
    let result = await configureClient(client);
    assert.equal(result, "added");
    const content = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.equal(content.theme, "dark");
    assert.ok(content.mcpServers.annote);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("VS Code preserves servers and prevents duplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-vscode-"));
  try {
    const { configureClient } = await import("/tmp/feedback-mark-mcp-client-config.mjs");
    const jsonPath = join(dir, "mcp.json");
    await writeFile(jsonPath, JSON.stringify({ servers: { existing: { type: "stdio", command: "node", args: ["old"] } } }, null, 2));
    const client = { id: "vscode", name: "VS Code", path: jsonPath, detected: true, safeMutation: true, entry: "" };
    let result = await configureClient(client);
    assert.equal(result, "added");
    let content = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.deepEqual(content.servers.annote, { type: "stdio", command: "npx", args: ["-y", "annote", "server"] });
    assert.ok(content.servers.existing);
    result = await configureClient(client);
    assert.equal(result, "exists");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Kilo preserves and handles array command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "annote-kilo-"));
  try {
    const { configureClient } = await import("/tmp/feedback-mark-mcp-client-config.mjs");
    const jsonPath = join(dir, "kilo.json");
    await writeFile(jsonPath, JSON.stringify({ mcp: { other: { type: "local", command: ["node", "old"], enabled: true } } }, null, 2));
    const client = { id: "kilo", name: "Kilo Code", path: jsonPath, detected: true, safeMutation: true, entry: "" };
    let result = await configureClient(client);
    assert.equal(result, "added");
    const content = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.deepEqual(content.mcp.annote, { type: "local", command: ["npx", "-y", "annote", "server"], enabled: true });
    result = await configureClient(client);
    assert.equal(result, "exists");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no generated preview contains bad paths", async () => {
  const adapters = getAdapters();
  for (const adapter of adapters) {
    const preview = adapter.getConfigPreview();
    assert.ok(!preview.includes("dist/mcp/cli.js"), `${adapter.id} bad path`);
    assert.ok(!preview.includes("node_modules/annote"), `${adapter.id} bad path`);
    assert.ok(!preview.includes("import.meta.url"), `${adapter.id} bad path`);
    assert.ok(!preview.includes("fileURLToPath"), `${adapter.id} bad path`);
    // Must contain canonical
    assert.ok(preview.includes("annote"), `${adapter.id} missing annote`);
    if (adapter.id !== "kilo") {
      // Kilo uses array form, still contains npx
      assert.ok(preview.includes("npx"), `${adapter.id} missing npx`);
    }
  }
});

test("registry detects without false positives for model providers", async () => {
  const adapters = getAdapters();
  const modelIds = ["deepseek", "claude-model", "gpt", "gemini-model", "qwen"];
  for (const id of modelIds) {
    assert.ok(!adapters.find((a) => a.id === id), `should not have adapter for model ${id}`);
  }
  // Ensure harness ids exist
  const harnessIds = ["codex", "opencode", "hermes", "gemini", "vscode", "kilo", "cursor", "claude"];
  for (const id of harnessIds) {
    assert.ok(adapters.find((a) => a.id === id), `missing harness ${id}`);
  }
});
