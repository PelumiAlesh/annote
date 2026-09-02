import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 4747;
export const ANNOTE_HOME = join(homedir(), ".annote");
export const CONFIG_PATH = joinANNOTE_HOME("config.json");
export const PERMISSIONS_PATH = joinANNOTE_HOME("permissions.json");

export type AnnoteConfig = {
  machineSecret: string;
  createdAt: string;
};

function joinANNOTE_HOME(file: string): string {
  return join(ANNOTE_HOME, file);
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
}

export function createMachineSecret(): string {
  return randomBytes(32).toString("base64url");
}

export async function readConfig(path = CONFIG_PATH): Promise<AnnoteConfig | null> {
  path = process.env.ANNOTE_TEST_CONFIG_PATH || path;
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<AnnoteConfig>;
    if (typeof value.machineSecret !== "string" || value.machineSecret.length < 32) return null;
    return { machineSecret: value.machineSecret, createdAt: value.createdAt || new Date().toISOString() };
  } catch {
    return null;
  }
}

export async function ensureConfig(path = CONFIG_PATH): Promise<{ config: AnnoteConfig; created: boolean }> {
  path = process.env.ANNOTE_TEST_CONFIG_PATH || path;
  const existing = await readConfig(path);
  if (existing) return { config: existing, created: false };
  const config = { machineSecret: createMachineSecret(), createdAt: new Date().toISOString() };
  await ensureParent(path);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // Some platforms do not support chmod; doctor reports this when inspectable.
  }
  return { config, created: true };
}

export function bridgeBaseUrl(port = DEFAULT_BRIDGE_PORT): string {
  return `http://${DEFAULT_BRIDGE_HOST}:${port}`;
}
