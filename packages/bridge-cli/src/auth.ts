import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AuthToken } from "@bridge/protocol";

const authFile = join(homedir(), ".bridge", "auth.json");

export function readAuthToken(): AuthToken | null {
  try {
    return JSON.parse(readFileSync(authFile, "utf8")) as AuthToken;
  } catch {
    return null;
  }
}

export function writeAuthToken(token: AuthToken): void {
  mkdirSync(dirname(authFile), { recursive: true });
  writeFileSync(authFile, JSON.stringify(token, null, 2));
}

export function clearAuthToken(): void {
  rmSync(authFile, { force: true });
}
