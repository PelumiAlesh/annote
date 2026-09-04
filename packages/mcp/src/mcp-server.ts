import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ANNOTE_PROTOCOL_VERSION } from "../../protocol/src/index.js";
import { BridgeClient } from "./bridge-client.js";
import { createBridgeServer, health } from "./bridge-server.js";
import { DEFAULT_BRIDGE_PORT, ensureConfig, type AnnoteConfig } from "./config.js";
import { registerAnnoteTools } from "./tools.js";

export type ServerStartResult = {
  mode: "leader" | "follower";
  port: number;
  close?: () => Promise<void>;
};

export async function ensureBridge(config: AnnoteConfig, port = DEFAULT_BRIDGE_PORT): Promise<ServerStartResult> {
  try {
    const bridge = await createBridgeServer(config, { port });
    return { mode: "leader", port: bridge.port, close: bridge.close };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "EADDRINUSE") throw error;
    const existing = await health(port);
    if (existing?.name === "annote" && existing.protocolVersion === ANNOTE_PROTOCOL_VERSION) {
      return { mode: "follower", port };
    }
    throw new Error(`Port ${port} is already in use by another application. Run annote-mcp doctor or choose another port with --port.`);
  }
}

export async function createMcpServer(config: AnnoteConfig, port = DEFAULT_BRIDGE_PORT): Promise<McpServer> {
  const server = new McpServer({ name: "annote", version: "0.1.0", title: "Annote" });
  registerAnnoteTools(server, new BridgeClient(config, port));
  return server;
}

export async function runStdioServer(options: { port?: number } = {}): Promise<void> {
  const { config } = await ensureConfig();
  const bridge = await ensureBridge(config, options.port);
  const server = await createMcpServer(config, bridge.port);
  await server.connect(new StdioServerTransport());
}
