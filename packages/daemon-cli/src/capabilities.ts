import { type CliCapability, type MachineCapabilities, type PowerCapability } from "@bridge/protocol";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname, homedir } from "node:os";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const daemonVersion = "0.1.0";

async function resolveExecutable(name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("sh", ["-lc", `command -v ${name}`]);
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function resolveVersion(command: string): Promise<string | undefined> {
  const candidates = [["--version"], ["version"], ["-v"]];
  for (const args of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(command, args);
      const raw = `${stdout} ${stderr}`.trim();
      if (raw) {
        const line = raw.split("\n")[0]?.trim();
        if (line) {
          return line;
        }
      }
    } catch {
      // Keep trying candidates.
    }
  }
  return undefined;
}

function supportsRemoteWrapper(name: string, version: string | undefined): boolean {
  if (!version) {
    return false;
  }
  if (name !== "codex") {
    return true;
  }
  return /5\.4|0\.5\.4|0\.6|1\./.test(version);
}

async function detectCli(name: "codex" | "claude" | "gemini"): Promise<CliCapability> {
  const executablePath = await resolveExecutable(name);
  if (!executablePath) {
    return {
      installed: false,
      launchable: false,
      authState: "not-installed",
      supportsRemoteWrapper: false,
      supportsSessionControl: false
    };
  }
  const version = await resolveVersion(executablePath);
  const remote = supportsRemoteWrapper(name, version);
  const authState = await detectAuthState(name);
  return {
    installed: true,
    executablePath,
    version,
    launchable: true,
    authState,
    supportsRemoteWrapper: remote,
    supportsSessionControl: remote
  };
}

async function detectAuthState(name: "codex" | "claude" | "gemini"): Promise<CliCapability["authState"]> {
  if (name === "codex") {
    try {
      const { stdout, stderr } = await execFileAsync("codex", ["login", "status"]);
      const value = `${stdout}${stderr}`;
      return /logged in/i.test(value) ? "authenticated" : "unauthenticated";
    } catch {
      return existsSync(join(homedir(), ".codex", "auth.json")) ? "authenticated" : "unauthenticated";
    }
  }
  if (name === "gemini") {
    return existsSync(join(homedir(), ".gemini", "oauth_creds.json")) ? "authenticated" : "unauthenticated";
  }
  const claudeCandidates = [
    join(homedir(), ".claude", "auth.json"),
    join(homedir(), ".config", "claude", "auth.json"),
    join(homedir(), ".config", "claude-code", "auth.json")
  ];
  return claudeCandidates.some((pathname) => existsSync(pathname)) ? "authenticated" : "unknown";
}

export function detectPowerCapability(): PowerCapability {
  const platform = process.platform;
  if (platform === "darwin") {
    return { canPreventSleep: true, canSleep: true, canShutdown: true, platform: "macos" };
  }
  if (platform === "linux") {
    return { canPreventSleep: true, canSleep: true, canShutdown: true, platform: "linux" };
  }
  if (platform === "win32") {
    return { canPreventSleep: true, canSleep: true, canShutdown: true, platform: "windows" };
  }
  return { canPreventSleep: false, canSleep: false, canShutdown: false, platform: "unknown" };
}

export async function detectMachineCapabilities(machineId: string): Promise<MachineCapabilities> {
  const [codex, claude, gemini] = await Promise.all([
    detectCli("codex"),
    detectCli("claude"),
    detectCli("gemini")
  ]);

  return {
    machineId,
    hostname: hostname(),
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch()
    },
    cli: { codex, claude, gemini },
    power: detectPowerCapability(),
    terminal: {
      shellPath: process.env.SHELL,
      supportsInteractivePty: true
    },
    daemonVersion,
    reportedAt: Date.now()
  };
}
