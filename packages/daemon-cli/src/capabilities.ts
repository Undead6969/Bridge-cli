import { type CliCapability, type MachineCapabilities, type PowerCapability } from "@bridge/protocol";
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import os from "node:os";
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
      supportsRemoteWrapper: false,
      supportsSessionControl: false
    };
  }
  const version = await resolveVersion(executablePath);
  const remote = supportsRemoteWrapper(name, version);
  return {
    installed: true,
    executablePath,
    version,
    launchable: true,
    supportsRemoteWrapper: remote,
    supportsSessionControl: remote
  };
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
