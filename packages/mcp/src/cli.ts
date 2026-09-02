#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { stat } from "node:fs/promises";
import { ANNOTE_PROTOCOL_VERSION } from "../../protocol/src/index.js";
import { health } from "./bridge-server.js";
import { BridgeClient } from "./bridge-client.js";
import { canonicalServerCommand, configureClient, detectClients, getAdapters, type DetectedClient } from "./client-config.js";
import { bridgeBaseUrl, CONFIG_PATH, DEFAULT_BRIDGE_PORT, ensureConfig, readConfig } from "./config.js";
import { runStdioServer } from "./mcp-server.js";

function parsePort(args: string[]): number {
  const index = args.indexOf("--port");
  const value = index >= 0 ? Number(args[index + 1]) : DEFAULT_BRIDGE_PORT;
  return Number.isInteger(value) && value >= 0 && value < 65536 ? value : DEFAULT_BRIDGE_PORT;
}

function mark(value: boolean): string {
  return value ? "✓" : "○";
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function init(): Promise<void> {
  console.log("Annote MCP setup\n");
  const { created } = await ensureConfig();
  const adapters = getAdapters();
  const detected: DetectedClient[] = [];
  const all: Array<{ adapter: typeof adapters[number]; client: DetectedClient | null }> = [];
  for (const adapter of adapters) {
    const client = await adapter.detect();
    all.push({ adapter, client });
    if (client) detected.push(client);
  }

  console.log("Coding agents detected:\n");
  for (const { adapter, client } of all) {
    const isDetected = !!client;
    console.log(`${mark(isDetected)} ${adapter.name}`);
  }

  const canonical = canonicalServerCommand();
  console.log("\nAnnote MCP command:");
  console.log(`  ${canonical.command} ${canonical.args.join(" ")}`);

  if (!detected.length) {
    console.log("\nNo supported client config was detected. Manual MCP entry:");
    console.log(JSON.stringify({ annote: { command: canonical.command, args: canonical.args } }, null, 2));
    console.log("\nAdapt this entry to your client's MCP configuration format.");
    return;
  }

  console.log("\nConfigure Annote for:");
  for (const client of detected) {
    console.log(`  ${mark(true)} ${client.name}`);
  }

  // Show preview for detected clients
  for (const client of detected) {
    const adapter = adapters.find((a) => a.id === client.id);
    if (adapter) {
      console.log(`\n${client.name}`);
      console.log(`  ${client.path}`);
      console.log(`  ${adapter.getConfigPreview().trim().split("\n").join("\n  ")}`);
      if (client.reason) console.log(`  ${client.reason}`);
    }
  }

  if (!(await askYesNo("\nContinue? [y/N]"))) {
    console.log("No changes made.");
    return;
  }
  for (const client of detected) {
    const outcome = await configureClient(client);
    if (outcome === "manual") {
      console.log(`○ ${client.name}: manual setup required`);
      const adapter = adapters.find((a) => a.id === client.id);
      if (adapter) console.log(adapter.getConfigPreview().trim());
      else console.log(client.entry.trim());
      if (client.reason) console.log(client.reason);
    } else if (outcome === "exists") {
      console.log(`✓ ${client.name}: already configured`);
    } else {
      console.log(`✓ ${client.name}: configured`);
    }
  }
  console.log(created ? "✓ Local security key created" : "✓ Local security key exists");
  console.log("\nRestart affected coding agents, then open Annote -> Settings -> MCP.");
  console.log("If your client uses a CLI, you may need to run its reload command (e.g., /reload-mcp for Hermes).");
}

async function status(port = DEFAULT_BRIDGE_PORT): Promise<void> {
  const config = await readConfig();
  console.log("Annote MCP\n");
  if (!config) {
    console.log("Bridge      Not running");
    console.log(`Port        ${port}`);
    console.log(`Protocol    ${ANNOTE_PROTOCOL_VERSION}`);
    return;
  }
  const bridge = await health(port);
  if (!bridge) {
    console.log("Bridge      Not running");
    console.log(`Port        ${port}`);
    console.log(`Protocol    ${ANNOTE_PROTOCOL_VERSION}`);
    return;
  }
  const info = await new BridgeClient(config, port).get<{ sessions: number; protocolVersion: number }>("/internal/status");
  console.log("Bridge      Running");
  console.log(`Port        ${port}`);
  console.log(`Sessions    ${info.sessions}`);
  console.log(`Protocol    ${info.protocolVersion}`);
}

async function doctor(port = DEFAULT_BRIDGE_PORT): Promise<void> {
  const checks: Array<{ ok: boolean; label: string; fix?: string }> = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ ok: major >= 18, label: `Node ${process.versions.node}`, fix: "Install Node 18 or newer." });
  const config = await readConfig();
  checks.push({ ok: !!config, label: "Annote config", fix: "Run npx annote init." });
  if (config) {
    try {
      const mode = (await stat(CONFIG_PATH)).mode & 0o777;
      checks.push({ ok: (mode & 0o077) === 0, label: "Config permissions", fix: `chmod 600 ${CONFIG_PATH}` });
    } catch {
      checks.push({ ok: false, label: "Config permissions", fix: "Run npx annote init." });
    }
  }
  const clients = await detectClients();
  clients.filter((client) => client.detected).forEach((client: DetectedClient) => {
    checks.push({ ok: true, label: `${client.name} config detected` });
  });
  const bridge = await health(port);
  checks.push({ ok: !!bridge, label: bridge ? "Annote bridge health" : `Bridge port ${port}`, fix: bridge ? undefined : `Run npx annote server --port ${port}` });
  if (bridge) checks.push({ ok: bridge.protocolVersion === ANNOTE_PROTOCOL_VERSION, label: "Protocol version", fix: "Rebuild/reinstall Annote MCP." });
  checks.forEach((check) => console.log(`${check.ok ? "✓" : "✗"} ${check.label}`));
  const fixes = checks.filter((check) => !check.ok && check.fix);
  if (fixes.length) {
    console.log("\nFix:");
    fixes.forEach((check) => console.log(check.fix));
  }
}

async function main(): Promise<void> {
  const [command = "server", ...args] = process.argv.slice(2);
  const port = parsePort(args);
  if (command === "init") return init();
  if (command === "status") return status(port);
  if (command === "doctor") return doctor(port);
  if (command === "server") return runStdioServer({ port });
  console.error(`Unknown command: ${command}`);
  console.log(`Available commands: npx annote init, npx annote status, npx annote doctor, npx annote server`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
