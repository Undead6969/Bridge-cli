import type { MachineCapabilities, RuntimeName, RuntimeStatusRecord } from "@bridge/protocol";
import { runtimeStatusRecordSchema } from "@bridge/protocol";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function tryExec(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args);
    const value = `${stdout ?? ""}${stderr ?? ""}`.trim();
    return value || "";
  } catch {
    return null;
  }
}

async function detectCodexAuth(): Promise<RuntimeStatusRecord["authState"]> {
  const status = await tryExec("codex", ["login", "status"]);
  if (status === null) {
    return existsSync(join(homedir(), ".codex", "auth.json")) ? "authenticated" : "unauthenticated";
  }
  return /logged in/i.test(status) ? "authenticated" : "unauthenticated";
}

async function detectGeminiAuth(): Promise<RuntimeStatusRecord["authState"]> {
  return existsSync(join(homedir(), ".gemini", "oauth_creds.json")) ? "authenticated" : "unauthenticated";
}

async function detectClaudeAuth(): Promise<RuntimeStatusRecord["authState"]> {
  const candidates = [
    join(homedir(), ".claude", "auth.json"),
    join(homedir(), ".config", "claude", "auth.json"),
    join(homedir(), ".config", "claude-code", "auth.json")
  ];
  return candidates.some((pathname) => existsSync(pathname)) ? "authenticated" : "unknown";
}

function detectTerminalAuth(): RuntimeStatusRecord["authState"] {
  return "authenticated";
}

export async function detectRuntimeAuthState(runtime: RuntimeName, installed: boolean): Promise<RuntimeStatusRecord["authState"]> {
  if (!installed) {
    return "not-installed";
  }
  if (runtime === "codex") {
    return detectCodexAuth();
  }
  if (runtime === "gemini") {
    return detectGeminiAuth();
  }
  if (runtime === "claude") {
    return detectClaudeAuth();
  }
  return detectTerminalAuth();
}

export async function buildRuntimeStatus(runtime: RuntimeName, capabilities?: MachineCapabilities): Promise<RuntimeStatusRecord> {
  const now = Date.now();
  if (runtime === "terminal") {
    return runtimeStatusRecordSchema.parse({
      runtime,
      installed: true,
      launchable: true,
      authState: "authenticated",
      selected: false,
      health: "healthy",
      executablePath: capabilities?.terminal.shellPath,
      version: undefined,
      supportsRemoteWrapper: true,
      supportsSessionControl: true,
      lastValidatedAt: now,
      notes: []
    });
  }

  const cli = capabilities?.cli[runtime];
  const installed = cli?.installed ?? false;
  const authState = await detectRuntimeAuthState(runtime, installed);
  const health = !installed ? "broken" : cli?.launchable ? authState === "authenticated" ? "healthy" : "degraded" : "broken";
  const notes: string[] = [];
  if (!installed) {
    notes.push(`${runtime} CLI is not installed`);
  } else if (!cli?.launchable) {
    notes.push(`${runtime} is installed but not launchable`);
  } else if (authState === "unauthenticated") {
    notes.push(`${runtime} is installed but not authenticated`);
  } else if (authState === "unknown") {
    notes.push(`Bridge could not verify ${runtime} auth automatically`);
  }

  return runtimeStatusRecordSchema.parse({
    runtime,
    installed,
    launchable: cli?.launchable ?? false,
    authState,
    selected: false,
    health,
    executablePath: cli?.executablePath,
    version: cli?.version,
    supportsRemoteWrapper: cli?.supportsRemoteWrapper,
    supportsSessionControl: cli?.supportsSessionControl,
    lastValidatedAt: now,
    notes
  });
}

export function renderRuntimeFix(runtime: RuntimeStatusRecord): string | undefined {
  if (!runtime.installed) {
    return `Install ${runtime.runtime} and run \`bridge auth runtime ${runtime.runtime}\` if it needs login.`;
  }
  if (!runtime.launchable) {
    return `Check ${runtime.runtime} executable and PATH, then rerun \`bridge doctor --verbose\`.`;
  }
  if (runtime.authState === "unauthenticated") {
    return `Run \`bridge auth runtime ${runtime.runtime}\` to link it.`;
  }
  return undefined;
}

export function parseCapabilitiesResponse(raw: string): MachineCapabilities | null {
  try {
    return JSON.parse(raw) as MachineCapabilities;
  } catch {
    return null;
  }
}

export function readCodexAuthLabel(): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), ".codex", "auth.json"), "utf8")) as { account?: { email?: string } };
    return raw.account?.email ?? null;
  } catch {
    return null;
  }
}

