import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

export type DetectedClient = {
  id: string;
  name: string;
  path: string;
  detected: boolean;
  safeMutation: boolean;
  entry: string;
  reason?: string;
  adapterId?: string;
};

export function canonicalServerCommand(): { command: string; args: string[] } {
  return { command: "npx", args: ["-y", "annote", "server"] };
}

export function canonicalServerCommandArray(): string[] {
  return ["npx", "-y", "annote", "server"];
}

// Kept for dev/test only — not used for user config
export function localServerCommand(): { command: string; args: string[] } {
  return canonicalServerCommand();
}

export function futureServerCommand(): { command: string; args: string[] } {
  return canonicalServerCommand();
}

function jsonEntry(command = canonicalServerCommand()): Record<string, unknown> {
  return { command: command.command, args: command.args };
}

function tomlEntry(command = canonicalServerCommand()): string {
  return `[mcp_servers.annote]
command = "${command.command}"
args = [${command.args.map((arg) => JSON.stringify(arg)).join(", ")}]
enabled = true
`;
}

function vsCodeEntry(command = canonicalServerCommand()): Record<string, unknown> {
  return { type: "stdio", command: command.command, args: command.args };
}

function kiloEntry(): Record<string, unknown> {
  return { type: "local", command: canonicalServerCommandArray(), enabled: true };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function hasExecutable(cmd: string): Promise<boolean> {
  const isWin = process.platform === "win32";
  const whichCmd = isWin ? "where" : "which";
  try {
    await execFileAsync(whichCmd, [cmd]);
    return true;
  } catch {
    // Fallback: check PATH manually
    const pathEnv = process.env.PATH || "";
    const parts = pathEnv.split(isWin ? ";" : ":");
    for (const dir of parts) {
      const full = join(dir, cmd + (isWin ? ".exe" : ""));
      if (await exists(full)) return true;
      if (await exists(join(dir, cmd))) return true;
    }
    return false;
  }
}

function homedirSafe(): string {
  try {
    return homedir();
  } catch {
    return process.env.HOME || process.env.USERPROFILE || "";
  }
}

export type McpClientAdapter = {
  id: string;
  name: string;
  detect: () => Promise<DetectedClient | null>;
  getConfigPreview: () => string;
  configure: (client: DetectedClient) => Promise<"added" | "exists" | "manual" | "unsupported">;
  verify?: (client: DetectedClient) => Promise<boolean>;
  manualInstructions?: string;
};

function codexAdapter(): McpClientAdapter {
  const codexPath = join(homedirSafe(), ".codex", "config.toml");
  return {
    id: "codex",
    name: "Codex",
    detect: async () => {
      const detected = (await exists(dirname(codexPath))) || (await hasExecutable("codex"));
      if (!detected) return null;
      return {
        id: "codex",
        name: "Codex",
        path: codexPath,
        detected: true,
        safeMutation: true,
        entry: tomlEntry(),
      };
    },
    getConfigPreview: () => tomlEntry().trim(),
    configure: async (client) => configureCodex(client.path),
  };
}

function cursorAdapter(): McpClientAdapter {
  const cursorPath = join(homedirSafe(), ".cursor", "mcp.json");
  return {
    id: "cursor",
    name: "Cursor",
    detect: async () => {
      const detected = (await exists(dirname(cursorPath))) || (await hasExecutable("cursor"));
      if (!detected) return null;
      return {
        id: "cursor",
        name: "Cursor",
        path: cursorPath,
        detected: true,
        safeMutation: true,
        entry: JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
      };
    },
    getConfigPreview: () => JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
    configure: async (client) => configureJsonMcp(client.path, "mcpServers"),
  };
}

function claudeAdapter(): McpClientAdapter {
  const claudePath = join(homedirSafe(), ".claude.json");
  const cmd = canonicalServerCommand();
  return {
    id: "claude",
    name: "Claude Code",
    detect: async () => {
      const detected = (await exists(claudePath)) || (await hasExecutable("claude"));
      if (!detected) return null;
      return {
        id: "claude",
        name: "Claude Code",
        path: claudePath,
        detected: true,
        safeMutation: false,
        entry: `claude mcp add annote -- ${cmd.command} ${cmd.args.join(" ")}`,
        reason: "Use Claude's MCP CLI so its user config format is not rewritten by Annote.",
      };
    },
    getConfigPreview: () => `claude mcp add annote -- ${cmd.command} ${cmd.args.join(" ")}`,
    configure: async () => "manual",
    verify: async () => {
      try {
        const { stdout } = await execFileAsync("claude", ["mcp", "list"]);
        return stdout.includes("annote");
      } catch {
        return false;
      }
    },
  };
}

function hermesAdapter(): McpClientAdapter {
  const hermesPath = join(homedirSafe(), ".hermes", "config.yaml");
  const cmd = canonicalServerCommand();
  return {
    id: "hermes",
    name: "Hermes Agent",
    detect: async () => {
      const detected = (await exists(hermesPath)) || (await exists(join(homedirSafe(), ".hermes"))) || (await hasExecutable("hermes"));
      if (!detected) return null;
      return {
        id: "hermes",
        name: "Hermes Agent",
        path: hermesPath,
        detected: true,
        safeMutation: true,
        entry: `mcp_servers:\n  annote:\n    command: "${cmd.command}"\n    args: [${cmd.args.map((a) => `"${a}"`).join(", ")}]`,
      };
    },
    getConfigPreview: () => `mcp_servers:\n  annote:\n    command: "${cmd.command}"\n    args: ["-y", "annote", "server"]`,
    configure: async (client) => {
      // Prefer CLI if available
      if (await hasExecutable("hermes")) {
        try {
          const { stdout } = await execFileAsync("hermes", ["mcp", "list"]);
          if (stdout.includes("annote")) return "exists";
        } catch {}
        try {
          await execFileAsync("hermes", ["mcp", "add", "annote", "--", cmd.command, ...cmd.args]);
          return "added";
        } catch {
          // Fall back to YAML mutation
        }
      }
      return configureHermesYaml(client.path);
    },
  };
}

function openCodeAdapter(): McpClientAdapter {
  const home = homedirSafe();
  const configPath = join(home, ".config", "opencode", "opencode.json");
  const jsoncPath = join(home, ".config", "opencode", "opencode.jsonc");
  return {
    id: "opencode",
    name: "OpenCode",
    detect: async () => {
      const detected =
        (await exists(configPath)) ||
        (await exists(jsoncPath)) ||
        (await exists(join(home, ".config", "opencode"))) ||
        (await hasExecutable("opencode"));
      if (!detected) return null;
      const path = (await exists(configPath)) ? configPath : (await exists(jsoncPath)) ? jsoncPath : configPath;
      return {
        id: "opencode",
        name: "OpenCode",
        path,
        detected: true,
        safeMutation: true,
        entry: JSON.stringify({ mcp: { annote: { command: "npx", args: ["-y", "annote", "server"] } } }, null, 2),
      };
    },
    getConfigPreview: () => JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
    configure: async (client) => {
      if (await hasExecutable("opencode")) {
        // Try CLI first if available - check if opencode mcp add exists
        try {
          await execFileAsync("opencode", ["mcp", "list"]);
          // If list succeeds, try add via CLI
          try {
            await execFileAsync("opencode", ["mcp", "add", "annote", "--", "npx", "-y", "annote", "server"]);
            return "added";
          } catch {}
        } catch {}
      }
      // Fall back to JSON mutation
      const isJsonc = client.path.endsWith(".jsonc");
      if (isJsonc) {
        const content = await readFileSafe(client.path);
        if (content && (content.includes("//") || content.includes("/*"))) {
          // Preserve comments - use manual if complex
          return "manual";
        }
      }
      return configureOpenCodeJson(client.path);
    },
  };
}

function geminiAdapter(): McpClientAdapter {
  const geminiPath = join(homedirSafe(), ".gemini", "settings.json");
  return {
    id: "gemini",
    name: "Gemini CLI",
    detect: async () => {
      const detected = (await exists(geminiPath)) || (await hasExecutable("gemini"));
      if (!detected) return null;
      return {
        id: "gemini",
        name: "Gemini CLI",
        path: geminiPath,
        detected: true,
        safeMutation: true,
        entry: JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
      };
    },
    getConfigPreview: () => JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
    configure: async (client) => {
      if (await hasExecutable("gemini")) {
        try {
          const { stdout } = await execFileAsync("gemini", ["mcp", "list"]);
          if (stdout.includes("annote")) return "exists";
        } catch {}
        try {
          await execFileAsync("gemini", ["mcp", "add", "annote", "npx", "-y", "annote", "server"]);
          return "added";
        } catch {}
      }
      return configureJsonMcp(client.path, "mcpServers");
    },
  };
}

function vscodeAdapter(): McpClientAdapter {
  const home = homedirSafe();
  const vscodeUserPath = join(home, ".config", "Code", "User", "settings.json");
  const mcpPath = join(home, ".vscode", "mcp.json");
  const workspacePath = join(process.cwd(), ".vscode", "mcp.json");
  return {
    id: "vscode",
    name: "VS Code",
    detect: async () => {
      const detected =
        (await exists(vscodeUserPath)) ||
        (await exists(mcpPath)) ||
        (await exists(workspacePath)) ||
        (await hasExecutable("code"));
      if (!detected) return null;
      const path = (await exists(mcpPath)) ? mcpPath : workspacePath;
      return {
        id: "vscode",
        name: "VS Code",
        path,
        detected: true,
        safeMutation: true,
        entry: JSON.stringify({ servers: { annote: vsCodeEntry() } }, null, 2),
      };
    },
    getConfigPreview: () => JSON.stringify({ servers: { annote: vsCodeEntry() } }, null, 2),
    configure: async (client) => configureVsCodeJson(client.path),
  };
}

function kiloAdapter(): McpClientAdapter {
  const home = homedirSafe();
  const kiloPath = join(home, ".config", "kilo", "kilo.json");
  const kiloJsoncPath = join(home, ".config", "kilo", "kilo.jsonc");
  return {
    id: "kilo",
    name: "Kilo Code",
    detect: async () => {
      const detected =
        (await exists(kiloPath)) ||
        (await exists(kiloJsoncPath)) ||
        (await exists(join(home, ".config", "kilo"))) ||
        (await hasExecutable("kilo"));
      if (!detected) return null;
      const path = (await exists(kiloPath)) ? kiloPath : kiloJsoncPath;
      return {
        id: "kilo",
        name: "Kilo Code",
        path,
        detected: true,
        safeMutation: true,
        entry: JSON.stringify({ mcp: { annote: kiloEntry() } }, null, 2),
      };
    },
    getConfigPreview: () => JSON.stringify({ mcp: { annote: kiloEntry() } }, null, 2),
    configure: async (client) => {
      const content = await readFileSafe(client.path);
      if (content && (content.includes("//") || content.includes("/*"))) return "manual";
      return configureKiloJson(client.path);
    },
  };
}

function windsurfAdapter(): McpClientAdapter {
  const windsurfPath = join(homedirSafe(), ".codeium", "windsurf", "mcp_config.json");
  return {
    id: "windsurf",
    name: "Windsurf",
    detect: async () => {
      const detected = (await exists(windsurfPath)) || (await hasExecutable("windsurf"));
      if (!detected) return null;
      return {
        id: "windsurf",
        name: "Windsurf",
        path: windsurfPath,
        detected: true,
        safeMutation: false,
        entry: JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
        reason: "Windsurf manages MCP via UI. Add manually via settings.",
      };
    },
    getConfigPreview: () => JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
    configure: async () => "manual",
  };
}

function zedAdapter(): McpClientAdapter {
  const zedPath = join(homedirSafe(), ".config", "zed", "settings.json");
  return {
    id: "zed",
    name: "Zed",
    detect: async () => {
      const detected = (await exists(zedPath)) || (await hasExecutable("zed"));
      if (!detected) return null;
      return {
        id: "zed",
        name: "Zed",
        path: zedPath,
        detected: true,
        safeMutation: false,
        entry: JSON.stringify({ context_servers: { annote: { command: "npx", args: ["-y", "annote", "server"] } } }, null, 2),
        reason: "Zed MCP is configured via settings.json context_servers. Add manually.",
      };
    },
    getConfigPreview: () => JSON.stringify({ context_servers: { annote: { command: "npx", args: ["-y", "annote", "server"] } } }, null, 2),
    configure: async () => "manual",
  };
}

function clineAdapter(): McpClientAdapter {
  const clinePath = join(homedirSafe(), ".config", "cline", "settings.json");
  return {
    id: "cline",
    name: "Cline",
    detect: async () => {
      const detected = (await exists(clinePath)) || (await exists(join(homedirSafe(), ".vscode", "extensions", "saoudrizwan.claude-dev")));
      if (!detected) return null;
      return {
        id: "cline",
        name: "Cline",
        path: clinePath,
        detected: true,
        safeMutation: false,
        entry: JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
        reason: "Cline manages MCP via VS Code extension UI. Add manually.",
      };
    },
    getConfigPreview: () => JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
    configure: async () => "manual",
  };
}

function rooAdapter(): McpClientAdapter {
  const rooPath = join(homedirSafe(), ".roo", "mcp.json");
  return {
    id: "roo",
    name: "Roo Code",
    detect: async () => {
      const detected = (await exists(rooPath)) || (await hasExecutable("roo"));
      if (!detected) return null;
      return {
        id: "roo",
        name: "Roo Code",
        path: rooPath,
        detected: true,
        safeMutation: true,
        entry: JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
      };
    },
    getConfigPreview: () => JSON.stringify({ mcpServers: { annote: jsonEntry() } }, null, 2),
    configure: async (client) => configureJsonMcp(client.path, "mcpServers"),
  };
}

function gooseAdapter(): McpClientAdapter {
  const goosePath = join(homedirSafe(), ".config", "goose", "config.yaml");
  return {
    id: "goose",
    name: "Goose",
    detect: async () => {
      const detected = (await exists(goosePath)) || (await hasExecutable("goose"));
      if (!detected) return null;
      return {
        id: "goose",
        name: "Goose",
        path: goosePath,
        detected: true,
        safeMutation: false,
        entry: `extensions:\n  annote:\n    cmd: npx\n    args: ["-y", "annote", "server"]`,
        reason: "Goose MCP is YAML-based. Add manually to config.yaml.",
      };
    },
    getConfigPreview: () => `extensions:\n  annote:\n    cmd: npx\n    args: ["-y", "annote", "server"]`,
    configure: async () => "manual",
  };
}

export function getAdapters(): McpClientAdapter[] {
  return [
    codexAdapter(),
    claudeAdapter(),
    cursorAdapter(),
    hermesAdapter(),
    openCodeAdapter(),
    geminiAdapter(),
    vscodeAdapter(),
    kiloAdapter(),
    windsurfAdapter(),
    zedAdapter(),
    clineAdapter(),
    rooAdapter(),
    gooseAdapter(),
  ];
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function detectClients(): Promise<DetectedClient[]> {
  const adapters = getAdapters();
  const results: DetectedClient[] = [];
  for (const adapter of adapters) {
    const detected = await adapter.detect();
    if (detected) results.push(detected);
  }
  // Filter to unique ids
  const seen = new Set<string>();
  return results.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

export async function configureClient(client: DetectedClient): Promise<"added" | "exists" | "manual"> {
  const adapter = getAdapters().find((a) => a.id === client.id);
  if (!adapter) return "manual";
  const result = await adapter.configure(client);
  if (result === "unsupported") return "manual";
  return result as "added" | "exists" | "manual";
}

async function configureCodex(path: string): Promise<"added" | "exists"> {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch {}
  if (/\[mcp_servers\.annote\]/.test(current)) return "exists";
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const next = `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${tomlEntry()}`;
  await writeFile(path, `${next.trimEnd()}\n`);
  return "added";
}

async function configureJsonMcp(path: string, key = "mcpServers"): Promise<"added" | "exists" | "manual"> {
  let root: Record<string, unknown> = {};
  try {
    const info = await stat(path);
    if (info.size > 0) {
      const content = await readFile(path, "utf8");
      // Check for JSONC comments
      if (content.includes("//") || content.includes("/*")) {
        // Try to parse after stripping comments for validation, but don't overwrite if comments present
        // For now, treat as manual to preserve comments
        // Check if it's actually JSONC with comments outside strings
        if (/\/\/[^\n]*\n/.test(content) || /\/\*[\s\S]*?\*\//.test(content)) {
          // Preserve comments - return manual unless we can safely handle
          // For Cursor/Gemini we can try simple merge if annote not present
          if (content.includes('"annote"') || content.includes("'annote'")) {
            // Check if annote already exists
            try {
              const stripped = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
              const parsed = JSON.parse(stripped) as Record<string, unknown>;
              const servers = parsed[key] as Record<string, unknown> | undefined;
              if (servers && typeof servers === "object" && "annote" in servers) return "exists";
            } catch {}
          }
          return "manual";
        }
      }
      root = JSON.parse(content) as Record<string, unknown>;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "manual";
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) return "manual";
  const servers = root[key];
  if (servers && (typeof servers !== "object" || Array.isArray(servers))) return "manual";
  const nextServers = { ...((servers as Record<string, unknown>) || {}) };
  if (nextServers.annote) return "exists";
  nextServers.annote = jsonEntry();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ ...root, [key]: nextServers }, null, 2)}\n`);
  return "added";
}

async function configureHermesYaml(path: string): Promise<"added" | "exists" | "manual"> {
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "manual";
  }
  if (content.includes("annote:")) {
    // Simple check for existing annote entry under mcp_servers
    if (/mcp_servers:\s*\n[\s\S]*?annote:/.test(content)) return "exists";
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const entry = `mcp_servers:\n  annote:\n    command: "npx"\n    args: ["-y", "annote", "server"]\n`;
  let next: string;
  if (!content.trim()) {
    next = entry;
  } else if (content.includes("mcp_servers:")) {
    // Append annote under mcp_servers
    next = content.replace(/mcp_servers:\s*\n/, `mcp_servers:\n  annote:\n    command: "npx"\n    args: ["-y", "annote", "server"]\n`);
    // If replacement didn't add, fallback to append
    if (next === content) {
      next = `${content.trimEnd()}\n\n${entry}`;
    }
  } else {
    next = `${content.trimEnd()}\n\n${entry}`;
  }
  await writeFile(path, next);
  return "added";
}

async function configureOpenCodeJson(path: string): Promise<"added" | "exists" | "manual"> {
  let root: Record<string, unknown> = {};
  let content = "";
  try {
    const info = await stat(path);
    if (info.size > 0) {
      content = await readFile(path, "utf8");
      // Detect mcp vs mcp.servers shape
      const hasServers = content.includes('"servers"') || content.includes("'servers'");
      root = JSON.parse(content) as Record<string, unknown>;
      // Check for existing annote in either shape
      const mcp = root.mcp as Record<string, unknown> | undefined;
      if (mcp) {
        if ("servers" in mcp) {
          const servers = (mcp as Record<string, unknown>).servers as Record<string, unknown> | undefined;
          if (servers && "annote" in servers) return "exists";
        } else if ("annote" in mcp) {
          return "exists";
        }
      }
      if (root.mcpServers && typeof root.mcpServers === "object" && "annote" in (root.mcpServers as Record<string, unknown>)) return "exists";
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "manual";
    root = {};
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) return "manual";
  // Preserve existing format: if mcp.servers exists, use that, else use mcp
  let nextRoot: Record<string, unknown>;
  if (root.mcp && typeof root.mcp === "object" && !Array.isArray(root.mcp) && "servers" in (root.mcp as Record<string, unknown>)) {
    const mcp = root.mcp as Record<string, unknown>;
    const servers = { ...((mcp.servers as Record<string, unknown>) || {}) };
    servers.annote = { command: "npx", args: ["-y", "annote", "server"] };
    nextRoot = { ...root, mcp: { ...mcp, servers } };
  } else {
    const mcp = { ...((root.mcp as Record<string, unknown>) || {}) };
    mcp.annote = { command: "npx", args: ["-y", "annote", "server"] };
    nextRoot = { ...root, mcp };
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(nextRoot, null, 2)}\n`);
  return "added";
}

async function configureVsCodeJson(path: string): Promise<"added" | "exists" | "manual"> {
  let root: Record<string, unknown> = {};
  try {
    const info = await stat(path);
    if (info.size > 0) {
      const content = await readFile(path, "utf8");
      root = JSON.parse(content) as Record<string, unknown>;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "manual";
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) return "manual";
  const servers = root.servers;
  if (servers && (typeof servers !== "object" || Array.isArray(servers))) return "manual";
  const nextServers = { ...((servers as Record<string, unknown>) || {}) };
  if (nextServers.annote) return "exists";
  nextServers.annote = vsCodeEntry();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ ...root, servers: nextServers }, null, 2)}\n`);
  return "added";
}

async function configureKiloJson(path: string): Promise<"added" | "exists" | "manual"> {
  let root: Record<string, unknown> = {};
  try {
    const info = await stat(path);
    if (info.size > 0) {
      const content = await readFile(path, "utf8");
      root = JSON.parse(content) as Record<string, unknown>;
      const mcp = root.mcp as Record<string, unknown> | undefined;
      if (mcp && "annote" in mcp) return "exists";
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "manual";
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) return "manual";
  const mcp = { ...((root.mcp as Record<string, unknown>) || {}) };
  mcp.annote = kiloEntry();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ ...root, mcp }, null, 2)}\n`);
  return "added";
}
