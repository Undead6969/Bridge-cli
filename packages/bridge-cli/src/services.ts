import { BridgeSdk } from "@bridge/sdk";
import type { MachineCapabilities } from "@bridge/protocol";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import localtunnel from "localtunnel";
import qrcode from "qrcode-terminal";

export const baseUrl = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:8787";
export const appUrl = process.env.BRIDGE_APP_URL ?? "https://bridge-cli.vercel.app";
const currentFile = fileURLToPath(import.meta.url);
export const bridgeRoot = resolve(dirname(currentFile), "..", "..", "..");

export type ManagedService = {
  name: "server" | "daemon";
  healthUrl: string;
  child?: ChildProcess;
  started: boolean;
};

export type PairingStatus = {
  code: string;
  label?: string;
  expiresAt: number;
  consumedAt?: number;
  tokenLabel?: string;
};

function logServiceOutput(name: "server" | "daemon" | "telegram", child: ChildProcess): void {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk.toString()}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk.toString()}`));
}

export async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForHealthy(url: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  while (!(await isHealthy(url))) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function spawnWorkspaceCommand(name: "server" | "daemon" | "telegram"): ChildProcess {
  const scriptPath =
    name === "server"
      ? resolve(bridgeRoot, "packages", "server", "dist", "server", "src", "index.js")
      : name === "daemon"
        ? resolve(bridgeRoot, "packages", "daemon-cli", "dist", "daemon-cli", "src", "index.js")
        : resolve(bridgeRoot, "packages", "telegram-bot", "dist", "telegram-bot", "src", "index.js");

  if (existsSync(scriptPath)) {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: bridgeRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    logServiceOutput(name, child);
    return child;
  }

  const filter = name === "server" ? "@bridge/server" : name === "daemon" ? "@bridge/daemon" : "@bridge/telegram-bot";
  const child = spawn("corepack", ["pnpm", "--filter", filter, "dev"], {
    cwd: bridgeRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  logServiceOutput(name, child);
  return child;
}

export async function ensureLocalServices(options?: {
  startServer?: boolean;
  startDaemon?: boolean;
}): Promise<ManagedService[]> {
  const services: ManagedService[] = [
    {
      name: "server",
      healthUrl: `${baseUrl}/health`,
      started: false
    },
    {
      name: "daemon",
      healthUrl: "http://127.0.0.1:8790/machine/capabilities",
      started: false
    }
  ];

  for (const service of services) {
    const shouldStart = service.name === "server" ? options?.startServer !== false : options?.startDaemon !== false;
    if (await isHealthy(service.healthUrl)) {
      continue;
    }
    if (!shouldStart) {
      continue;
    }
    service.child = spawnWorkspaceCommand(service.name);
    service.started = true;
    await waitForHealthy(service.healthUrl);
  }

  return services;
}

function isLoopbackUrl(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "0.0.0.0";
}

async function createCloudflareTunnel(serverUrl: string): Promise<{ url: string; close: () => void }> {
  const executable = existsSync("/opt/homebrew/bin/cloudflared") ? "/opt/homebrew/bin/cloudflared" : "cloudflared";
  const child = spawn(executable, ["tunnel", "--url", serverUrl, "--no-autoupdate"], {
    cwd: bridgeRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out waiting for cloudflared tunnel URL"));
    }, 15_000);

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`cloudflared exited before a tunnel URL was ready (code ${code ?? "unknown"})`));
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  return {
    url,
    close: () => child.kill("SIGTERM")
  };
}

async function createTunnel(serverUrl: string, subdomain?: string): Promise<{ url: string; close: () => void }> {
  if (existsSync("/opt/homebrew/bin/cloudflared") || existsSync("/usr/local/bin/cloudflared")) {
    return createCloudflareTunnel(serverUrl);
  }

  const parsed = new URL(serverUrl);
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const tunnel = await localtunnel({
    port,
    subdomain
  });

  return {
    url: tunnel.url,
    close: () => tunnel.close()
  };
}

export async function resolvePublicServerUrl(options?: {
  useTunnel?: boolean;
  serverUrl?: string;
  subdomain?: string;
}): Promise<{ serverUrl: string; close?: () => void }> {
  if (options?.serverUrl) {
    return { serverUrl: options.serverUrl };
  }
  if (process.env.BRIDGE_PUBLIC_SERVER_URL) {
    return { serverUrl: process.env.BRIDGE_PUBLIC_SERVER_URL };
  }
  if (!isLoopbackUrl(baseUrl) || options?.useTunnel === false) {
    return { serverUrl: baseUrl };
  }

  const tunnel = await createTunnel(baseUrl, options?.subdomain ?? process.env.BRIDGE_TUNNEL_SUBDOMAIN);
  return {
    serverUrl: tunnel.url,
    close: tunnel.close
  };
}

export async function mintFreshToken(label: string, serverUrl = baseUrl): Promise<{ token: string; label: string; createdAt: number; lastUsedAt: number }> {
  const publicSdk = new BridgeSdk(serverUrl);
  const pairing = await publicSdk.createPairing(label);
  return publicSdk.exchangePairing(pairing.code, label);
}

export async function fetchDaemonCapabilities(): Promise<MachineCapabilities | null> {
  try {
    const response = await fetch("http://127.0.0.1:8790/machine/capabilities");
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as MachineCapabilities;
  } catch {
    return null;
  }
}

export async function printPairing(label: string, options?: { useTunnel?: boolean; serverUrl?: string; subdomain?: string }): Promise<void> {
  const exposure = await resolvePublicServerUrl(options);
  const pairingServerUrl =
    options?.serverUrl || process.env.BRIDGE_PUBLIC_SERVER_URL || !isLoopbackUrl(baseUrl) ? exposure.serverUrl : baseUrl;
  const sdk = new BridgeSdk(pairingServerUrl);
  let lastConnectedCode: string | null = null;
  let pollTimer: NodeJS.Timeout | null = null;

  const startPairingPoll = (code: string) => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    pollTimer = setInterval(async () => {
      try {
        const response = await fetch(`${baseUrl}/auth/pairings/${code}`);
        if (!response.ok) {
          return;
        }
        const status = (await response.json()) as PairingStatus;
        if (status.consumedAt && lastConnectedCode !== code) {
          lastConnectedCode = code;
          console.log(`Connected: ${status.tokenLabel ?? "a browser"} paired successfully. The app is alive, not just decorative.\n`);
        }
      } catch {
        // brief poll failures are allowed to be dramatic only internally
      }
    }, 1200);
  };

  const renderPairing = async () => {
    const pairing = await sdk.createPairing(label);
    const url = new URL(appUrl);
    url.searchParams.set("pairCode", pairing.code);
    url.searchParams.set("serverUrl", exposure.serverUrl);
    lastConnectedCode = null;
    console.clear();
    qrcode.generate(url.toString(), { small: true });
    console.log(`\nCode: ${pairing.code}`);
    console.log(`Server: ${exposure.serverUrl}`);
    console.log(`Open: ${url.toString()}\n`);
    if (process.stdin.isTTY) {
      console.log("Press r to refresh the QR/code, or Ctrl+C to quit.\n");
    }
    startPairingPoll(pairing.code);
  };

  await renderPairing();

  if (exposure.close) {
    console.log("Tunnel is active. Keep this process running while you use the gateway.");
    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      exposure.close?.();
      process.exit(0);
    };
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", async (chunk) => {
        const key = chunk.toString().toLowerCase();
        if (key === "r") {
          await renderPairing();
          return;
        }
        if (key === "\u0003" || key === "q") {
          cleanup();
        }
      });
    }
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    await new Promise(() => undefined);
  }
}
