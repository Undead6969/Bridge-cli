#!/usr/bin/env node
import { BridgeSdk } from "@bridge/sdk";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import localtunnel from "localtunnel";
import qrcode from "qrcode-terminal";
import { clearAuthToken, readAuthToken, writeAuthToken } from "./auth.js";

const baseUrl = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:8787";
const appUrl = process.env.BRIDGE_APP_URL ?? "https://bridge-cli.vercel.app";
const auth = readAuthToken();
const sdk = new BridgeSdk(baseUrl, auth?.token);
const program = new Command();
const currentFile = fileURLToPath(import.meta.url);
const bridgeRoot = resolve(dirname(currentFile), "..", "..", "..");
const telegramConfigPath = resolve(homedir(), ".bridge", "telegram.json");

program.name("bridge").description("Remote scripting and session-control CLI");

type ManagedService = {
  name: "server" | "daemon";
  healthUrl: string;
  child?: ChildProcess;
  started: boolean;
};

type PairingStatus = {
  code: string;
  label?: string;
  expiresAt: number;
  consumedAt?: number;
  tokenLabel?: string;
};

type TelegramConfig = {
  botToken: string;
  botUsername?: string;
  serverUrl: string;
  bridgeToken: string;
  appUrl: string;
  linkCode: string;
  allowedChatIds: number[];
  pollOffset?: number;
  defaultMachineId?: string;
  currentMachineByChat: Record<string, string>;
  currentWorkspaceByChat: Record<string, string>;
  currentSessionByChat: Record<string, string>;
  updatedAt: number;
};

function logServiceOutput(name: string, child: ChildProcess): void {
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk.toString()}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk.toString()}`);
  });
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(url: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  while (!(await isHealthy(url))) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function spawnWorkspaceCommand(name: "server" | "daemon" | "telegram"): ChildProcess {
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

async function ensureLocalServices(options?: {
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

async function createTunnel(serverUrl: string, subdomain?: string): Promise<{
  url: string;
  close: () => void;
}> {
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

async function createCloudflareTunnel(serverUrl: string): Promise<{
  url: string;
  close: () => void;
}> {
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

async function resolvePublicServerUrl(options?: { useTunnel?: boolean; serverUrl?: string; subdomain?: string }): Promise<{
  serverUrl: string;
  close?: () => void;
}> {
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

async function printPairing(label: string, options?: { useTunnel?: boolean; serverUrl?: string; subdomain?: string }): Promise<void> {
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
        // If polling fails briefly, the QR should not have a full emotional breakdown.
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
    console.log("Tunnel is active. Keep this process running while you use the web app.");
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

async function hostMode(options?: {
  label?: string;
  useTunnel?: boolean;
  serverUrl?: string;
  subdomain?: string;
  startServer?: boolean;
  startDaemon?: boolean;
}): Promise<void> {
  const services = await ensureLocalServices({
    startServer: options?.startServer,
    startDaemon: options?.startDaemon
  });

  const started = services.filter((service) => service.started).map((service) => service.name);
  if (started.length > 0) {
    console.log(`Started: ${started.join(", ")}`);
  } else {
    console.log("Local server and daemon were already running.");
  }

  await printPairing(options?.label ?? "bridge", {
    useTunnel: options?.useTunnel,
    serverUrl: options?.serverUrl,
    subdomain: options?.subdomain
  });
}

function createFreshLinkCode(): string {
  return String(randomInt(100000, 1_000_000));
}

async function mintFreshToken(label: string, serverUrl = baseUrl): Promise<{ token: string; label: string; createdAt: number; lastUsedAt: number }> {
  const publicSdk = new BridgeSdk(serverUrl);
  const pairing = await publicSdk.createPairing(label);
  return publicSdk.exchangePairing(pairing.code, label);
}

async function reauthenticateCli(label = "bridge-cli"): Promise<void> {
  await ensureLocalServices({ startServer: true, startDaemon: false });
  clearAuthToken();
  const token = await mintFreshToken(label, baseUrl);
  writeAuthToken(token);
  console.log(`Re-authenticated as ${token.label}. The CLI now has fresh credentials and fewer excuses.\n`);
  console.log(JSON.stringify(token, null, 2));
}

async function prompt(question: string, fallback = ""): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const suffix = fallback ? ` (${fallback})` : "";
    const answer = await rl.question(`${question}${suffix}: `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

async function fetchTelegramMe(botToken: string): Promise<{ username?: string; first_name?: string }> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
    method: "POST"
  });
  const payload = (await response.json()) as { ok: boolean; result?: { username?: string; first_name?: string }; description?: string };
  if (!payload.ok || !payload.result) {
    throw new Error(payload.description ?? "Telegram rejected the bot token");
  }
  return payload.result;
}

async function setupTelegramBot(options?: { startAfterSetup?: boolean }): Promise<void> {
  await ensureLocalServices({ startServer: true, startDaemon: true });
  const botToken = await prompt("Telegram bot token");
  if (!botToken) {
    throw new Error("Telegram bot token is required");
  }

  const me = await fetchTelegramMe(botToken);
  const serverUrl = await prompt("Bridge server URL for the bot", baseUrl);
  const appForBot = await prompt("Bridge web app URL", appUrl);
  const existingConfig = existsSync(telegramConfigPath);
  const bridgeToken = (await mintFreshToken("bridge-telegram-bot", serverUrl)).token;
  const linkCode = createFreshLinkCode();
  const config: TelegramConfig = {
    botToken,
    botUsername: me.username,
    serverUrl,
    bridgeToken,
    appUrl: appForBot,
    linkCode,
    allowedChatIds: [],
    pollOffset: undefined,
    defaultMachineId: undefined,
    currentMachineByChat: {},
    currentWorkspaceByChat: {},
    currentSessionByChat: {},
    updatedAt: Date.now()
  };

  mkdirSync(dirname(telegramConfigPath), { recursive: true });
  writeFileSync(telegramConfigPath, JSON.stringify(config, null, 2));

  console.log(`Telegram bot ${me.username ? `@${me.username}` : "(username not reported)"} is configured.`);
  if (me.username) {
    console.log(`Open: https://t.me/${me.username}?start=${linkCode}`);
  }
  console.log(`Or message the bot with: /start ${linkCode}`);
  console.log(existingConfig ? "Previous Telegram config was replaced. The old one died so the new one could be dramatic." : "Telegram setup saved.");

  if (options?.startAfterSetup) {
    await startTelegramBot();
  }
}

async function startTelegramBot(): Promise<void> {
  if (!existsSync(telegramConfigPath)) {
    throw new Error(`Telegram is not configured yet. Run \`bridge telegram setup\` first.`);
  }
  const child = spawnWorkspaceCommand("telegram");
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
  await new Promise(() => undefined);
}

async function launcherMenu(): Promise<void> {
  console.log("\nBridge launcher\n");
  console.log("1. Pair phone/web and host locally");
  console.log("2. Set up Telegram bot");
  console.log("3. Start Telegram bot");
  console.log("4. Re-authenticate this CLI");
  console.log("5. Doctor / diagnostics");
  console.log("6. Quit\n");

  const choice = await prompt("Pick an option", "1");
  switch (choice) {
    case "1":
      await hostMode({ label: "bridge", useTunnel: true });
      return;
    case "2":
      await setupTelegramBot();
      return;
    case "3":
      await startTelegramBot();
      return;
    case "4":
      await reauthenticateCli();
      return;
    case "5":
      console.log(
        JSON.stringify(
          {
            checks: await Promise.all([
              fetch(`${baseUrl}/health`)
                .then((response) => ({ name: "server", ok: response.ok, url: baseUrl }))
                .catch(() => ({ name: "server", ok: false, url: baseUrl })),
              fetch("http://127.0.0.1:8790/machine/capabilities")
                .then((response) => ({ name: "daemon", ok: response.ok, url: "http://127.0.0.1:8790" }))
                .catch(() => ({ name: "daemon", ok: false, url: "http://127.0.0.1:8790" }))
            ]),
            hostedApp: appUrl,
            telegramConfigured: existsSync(telegramConfigPath)
          },
          null,
          2
        )
      );
      return;
    default:
      console.log("Bridge launcher closed. No QRs were harmed in the making of this decision.");
  }
}

const authCommand = program.command("auth").description("Pairing code auth");

authCommand
  .command("pair")
  .option("--label <label>", "Label for the requesting device", "bridge")
  .option("--no-tunnel", "Do not create a public tunnel for local servers")
  .option("--server-url <url>", "Explicit public server URL")
  .option("--subdomain <name>", "Preferred localtunnel subdomain")
  .action(async (options) => {
    await printPairing(options.label, {
      useTunnel: options.tunnel,
      serverUrl: options.serverUrl,
      subdomain: options.subdomain
    });
  });

authCommand
  .command("login")
  .requiredOption("--code <code>", "6 digit pairing code")
  .option("--label <label>", "Label for this device", "bridge-cli")
  .action(async (options) => {
    const publicSdk = new BridgeSdk(baseUrl);
    const token = await publicSdk.exchangePairing(options.code, options.label);
    writeAuthToken(token);
    console.log(JSON.stringify(token, null, 2));
  });

authCommand.command("logout").action(() => {
  clearAuthToken();
  console.log(JSON.stringify({ ok: true }, null, 2));
});

program
  .command("connect")
  .description("Generate a QR and 6-digit code for pairing a browser or phone")
  .option("--label <label>", "Label for the requesting device", "bridge")
  .option("--no-tunnel", "Do not create a public tunnel for local servers")
  .option("--server-url <url>", "Explicit public server URL")
  .option("--subdomain <name>", "Preferred localtunnel subdomain")
  .action(async (options) => {
    await printPairing(options.label, {
      useTunnel: options.tunnel,
      serverUrl: options.serverUrl,
      subdomain: options.subdomain
    });
  });

program
  .command("host")
  .description("Start the local Bridge server and daemon, then print a pairing QR")
  .option("--label <label>", "Label for the requesting device", "bridge")
  .option("--no-tunnel", "Do not create a public tunnel for local servers")
  .option("--server-url <url>", "Explicit public server URL")
  .option("--subdomain <name>", "Preferred localtunnel subdomain")
  .option("--no-server", "Do not auto-start the local Bridge server")
  .option("--no-daemon", "Do not auto-start the local Bridge daemon")
  .action(async (options) => {
    await hostMode({
      label: options.label,
      useTunnel: options.tunnel,
      serverUrl: options.serverUrl,
      subdomain: options.subdomain,
      startServer: options.server,
      startDaemon: options.daemon
    });
  });

program
  .command("login")
  .description("Log in with a 6-digit pairing code")
  .requiredOption("--code <code>", "6 digit pairing code")
  .option("--label <label>", "Label for this device", "bridge-cli")
  .action(async (options) => {
    const publicSdk = new BridgeSdk(baseUrl);
    const token = await publicSdk.exchangePairing(options.code, options.label);
    writeAuthToken(token);
    console.log(JSON.stringify(token, null, 2));
  });

program
  .command("reauth")
  .description("Rotate the saved CLI auth token")
  .option("--label <label>", "Label for the refreshed CLI token", "bridge-cli")
  .action(async (options) => {
    await reauthenticateCli(options.label);
  });

program
  .command("doctor")
  .description("Check server and daemon reachability")
  .action(async () => {
    const checks = await Promise.all([
      fetch(`${baseUrl}/health`)
        .then((response) => ({ name: "server", ok: response.ok, url: baseUrl }))
        .catch(() => ({ name: "server", ok: false, url: baseUrl })),
      fetch("http://127.0.0.1:8790/machine/capabilities")
        .then((response) => ({ name: "daemon", ok: response.ok, url: "http://127.0.0.1:8790" }))
        .catch(() => ({ name: "daemon", ok: false, url: "http://127.0.0.1:8790" }))
    ]);
    console.log(
      JSON.stringify(
        {
          checks,
          hostedApp: appUrl,
          publicServerUrl: process.env.BRIDGE_PUBLIC_SERVER_URL ?? null,
          tunnelMode: process.env.BRIDGE_PUBLIC_SERVER_URL ? "disabled (explicit public server)" : isLoopbackUrl(baseUrl) ? "available on demand" : "not needed",
          authLabel: auth?.label ?? null,
          telegramConfigured: existsSync(telegramConfigPath)
        },
        null,
        2
      )
    );
  });

const telegram = program.command("telegram").description("Telegram bot setup and runtime");

telegram
  .command("setup")
  .description("Configure the Telegram bot and create a Bridge auth token for it")
  .option("--start", "Start the bot immediately after setup")
  .action(async (options) => {
    await setupTelegramBot({ startAfterSetup: options.start });
  });

telegram
  .command("start")
  .description("Start the configured Telegram bot")
  .action(async () => {
    await startTelegramBot();
  });

program
  .command("machines")
  .description("List machines")
  .action(async () => {
    console.log(JSON.stringify(await sdk.listMachines(), null, 2));
  });

const machine = program.command("machine").description("Machine operations");

machine
  .command("capabilities")
  .argument("<machineId>")
  .action(async (machineId) => {
    console.log(JSON.stringify((await sdk.getMachine(machineId)).capabilities, null, 2));
  });

machine
  .command("power")
  .argument("<machineId>")
  .argument("<mode>")
  .action(async (machineId, mode) => {
    const machineRecord = await sdk.getMachine(machineId);
    const updated = await sdk.updatePowerPolicy(machineId, {
      ...machineRecord.powerPolicy,
      mode
    });
    console.log(JSON.stringify(updated.powerPolicy, null, 2));
  });

const session = program.command("session").description("Agent session operations");

session
  .command("start")
  .requiredOption("--machine <machineId>")
  .requiredOption("--agent <agent>")
  .requiredOption("--cwd <cwd>")
  .action(async (options) => {
    const created = await sdk.createSession(options.machine, {
      runtime: "agent-session",
      agent: options.agent,
      cwd: options.cwd,
      startedBy: "bridge"
    });
    console.log(JSON.stringify(created, null, 2));
  });

session
  .command("attach")
  .argument("<sessionId>")
  .action(async (sessionId) => {
    const socket = sdk.subscribe(sessionId, {
      onSnapshot: (payload) => {
        payload.events.forEach((event) => process.stdout.write(event.data));
      },
      onEvent: (event) => {
        process.stdout.write(event.data);
      },
      onError: (message) => {
        process.stderr.write(`${message}\n`);
      }
    });
    process.on("SIGINT", () => socket.close());
    await new Promise(() => undefined);
  });

session
  .command("send")
  .argument("<sessionId>")
  .argument("<text>")
  .action(async (sessionId, text) => {
    const socket = sdk.subscribe(sessionId, {});
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "input", sessionId, data: `${text}\n` }));
      setTimeout(() => socket.close(), 50);
    });
    await new Promise((resolve) => socket.on("close", resolve));
  });

session
  .command("stop")
  .argument("<sessionId>")
  .action(async (sessionId) => {
    console.log(JSON.stringify(await sdk.stopSession(sessionId), null, 2));
  });

program
  .command("terminal")
  .description("Start terminal session")
  .requiredOption("--machine <machineId>")
  .requiredOption("--cwd <cwd>")
  .action(async (options) => {
    const created = await sdk.createSession(options.machine, {
      runtime: "terminal-session",
      cwd: options.cwd,
      startedBy: "bridge"
    });
    console.log(JSON.stringify(created, null, 2));
  });

program
  .command("terminal-attach")
  .argument("<sessionId>")
  .description("Attach to a terminal session stream")
  .action(async (sessionId) => {
    const socket = sdk.subscribe(sessionId, {
      onSnapshot: (payload) => {
        payload.events.forEach((event) => process.stdout.write(event.data));
      },
      onEvent: (event) => {
        process.stdout.write(event.data);
      },
      onError: (message) => {
        process.stderr.write(`${message}\n`);
      }
    });
    process.on("SIGINT", () => socket.close());
    await new Promise(() => undefined);
  });

if (process.argv.length <= 2) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    await launcherMenu();
  } else {
    await hostMode({ label: "bridge", useTunnel: true });
  }
} else {
  await program.parseAsync(process.argv);
}
