import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PERMISSIONS_PATH } from "./config.js";

export type OriginPermission = {
  origin: string;
  approvedAt: string;
};

export type PermissionsFile = {
  allowedOrigins: string[];
  permissions?: OriginPermission[];
};

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function readPermissions(path = PERMISSIONS_PATH): Promise<PermissionsFile> {
  path = process.env.ANNOTE_TEST_PERMISSIONS_PATH || path;
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<PermissionsFile>;
    const origins = Array.isArray(value.allowedOrigins)
      ? value.allowedOrigins.map((origin) => (typeof origin === "string" ? normalizeOrigin(origin) : null)).filter((origin): origin is string => !!origin)
      : [];
    const permissionOrigins = Array.isArray(value.permissions)
      ? value.permissions
          .map((item) => (typeof item?.origin === "string" ? normalizeOrigin(item.origin) : null))
          .filter((origin): origin is string => !!origin)
      : [];
    return { allowedOrigins: Array.from(new Set([...origins, ...permissionOrigins])) };
  } catch {
    return { allowedOrigins: [] };
  }
}

export async function writePermissions(permissions: PermissionsFile, path = PERMISSIONS_PATH): Promise<void> {
  path = process.env.ANNOTE_TEST_PERMISSIONS_PATH || path;
  const allowedOrigins = Array.from(new Set(permissions.allowedOrigins.map(normalizeOrigin).filter((origin): origin is string => !!origin))).sort();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ allowedOrigins }, null, 2)}\n`, { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
  }
}

export async function isOriginAllowed(origin: string | null | undefined, path = PERMISSIONS_PATH): Promise<boolean> {
  path = process.env.ANNOTE_TEST_PERMISSIONS_PATH || path;
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const permissions = await readPermissions(path);
  return permissions.allowedOrigins.includes(normalized);
}

export async function approveOrigin(origin: string, path = PERMISSIONS_PATH): Promise<string> {
  path = process.env.ANNOTE_TEST_PERMISSIONS_PATH || path;
  const normalized = normalizeOrigin(origin);
  if (!normalized) throw new Error("Invalid origin");
  const permissions = await readPermissions(path);
  if (!permissions.allowedOrigins.includes(normalized)) permissions.allowedOrigins.push(normalized);
  await writePermissions(permissions, path);
  return normalized;
}

export async function revokeOrigin(origin: string, path = PERMISSIONS_PATH): Promise<string> {
  path = process.env.ANNOTE_TEST_PERMISSIONS_PATH || path;
  const normalized = normalizeOrigin(origin);
  if (!normalized) throw new Error("Invalid origin");
  const permissions = await readPermissions(path);
  permissions.allowedOrigins = permissions.allowedOrigins.filter((item) => item !== normalized);
  await writePermissions(permissions, path);
  return normalized;
}

export function originFromHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return null;
  return value ? normalizeOrigin(value) : null;
}
