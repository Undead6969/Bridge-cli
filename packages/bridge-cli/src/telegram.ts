import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { localStatePaths, readGatewaysState, upsertGatewayRecord, writeGatewaysState } from "./local-state.js";
import { prompt } from "./prompts.js";
import { mintFreshToken, spawnWorkspaceCommand } from "./services.js";

export type TelegramConfig = {
  botToken: string;
  botUsername?: string;
  serverUrl: string;
  bridgeToken: string;
  appUrl: string;
  allowedChatIds: number[];
  pollOffset?: number;
  defaultMachineId?: string;
  currentMachineByChat: Record<string, string>;
  currentWorkspaceByChat: Record<string, string>;
  currentSessionByChat: Record<string, string>;
  loginCodes: Array<{
    code: string;
    createdAt: number;
    expiresAt: number;
    label?: string;
    usedAt?: number;
  }>;
  updatedAt: number;
};

function readTelegramConfig(): TelegramConfig | null {
  try {
    return JSON.parse(readFileSync(localStatePaths.telegram, "utf8")) as TelegramConfig;
  } catch {
    return null;
  }
}

function writeTelegramConfig(config: TelegramConfig): TelegramConfig {
  mkdirSync(dirname(localStatePaths.telegram), { recursive: true });
  const next = {
    ...config,
    updatedAt: Date.now()
  };
  writeFileSync(localStatePaths.telegram, JSON.stringify(next, null, 2));
  return next;
}

function createLinkCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function fetchTelegramMe(botToken: string): Promise<{ username?: string; first_name?: string }> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
    method: "POST"
  });
  const payload = (await response.json()) as { ok: boolean; result?: { username?: string; first_name?: string }; description?: string };
  if (!payload.ok || !payload.result) {
    throw new Error(payload.description ?? "Telegram rejected the bot token");
  }
  return payload.result;
}

export function issueTelegramLoginCode(config: TelegramConfig, options?: { minutes?: number; label?: string }) {
  const code = createLinkCode();
  const createdAt = Date.now();
  const expiresAt = createdAt + (options?.minutes ?? 10) * 60_000;
  const next = writeTelegramConfig({
    ...config,
    loginCodes: [
      ...(config.loginCodes ?? []).filter((entry) => !entry.usedAt && entry.expiresAt > createdAt),
      {
        code,
        createdAt,
        expiresAt,
        label: options?.label
      }
    ]
  });
  return {
    config: next,
    code,
    expiresAt
  };
}

export async function setupTelegramGateway(options?: {
  botToken?: string;
  serverUrl?: string;
  appUrl?: string;
  autoConfirm?: boolean;
}): Promise<void> {
  const botToken = options?.botToken ?? (options?.autoConfirm ? "" : await prompt("Telegram bot token"));
  if (!botToken) {
    throw new Error("Telegram bot token is required");
  }

  const me = await fetchTelegramMe(botToken);
  const bridgeToken = (await mintFreshToken("bridge-telegram-bot", options?.serverUrl)).token;
  const config = writeTelegramConfig({
    botToken,
    botUsername: me.username,
    serverUrl: options?.serverUrl ?? "http://127.0.0.1:8787",
    bridgeToken,
    appUrl: options?.appUrl ?? "https://bridge-cli.vercel.app",
    allowedChatIds: [],
    pollOffset: undefined,
    defaultMachineId: undefined,
    currentMachineByChat: {},
    currentWorkspaceByChat: {},
    currentSessionByChat: {},
    loginCodes: [],
    updatedAt: Date.now()
  });
  const login = issueTelegramLoginCode(config, { minutes: 15, label: "owner access" });

  const gatewayState = readGatewaysState();
  if (gatewayState) {
    writeGatewaysState(
      upsertGatewayRecord(gatewayState, {
        ...gatewayState.gateways.telegram,
        type: "telegram",
        enabled: true,
        status: "configured",
        configPath: localStatePaths.telegram,
        helperCommand: "bridge telegram start",
        isPrimary: gatewayState.primaryGateway === "telegram",
        metadata: {
          botUsername: me.username
        },
        lastValidatedAt: Date.now()
      })
    );
  }

  console.log(`Telegram bot ${me.username ? `@${me.username}` : "(username not reported)"} is configured.`);
  if (me.username) {
    console.log(`Open: https://t.me/${me.username}?start=${login.code}`);
  }
  console.log(`Or message the bot with: /start ${login.code}`);
  console.log("That code expires in 15 minutes and works once. Security is more attractive when it isn’t optional.");
}

export function printTelegramLoginCode(minutes = 15, label?: string): void {
  const config = readTelegramConfig();
  if (!config) {
    throw new Error("Telegram is not configured yet. Run `bridge gateway add telegram` first.");
  }
  const issued = issueTelegramLoginCode(config, { minutes, label });
  const expiresAt = new Date(issued.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  console.log(`Telegram login code: ${issued.code}`);
  console.log(`Expires: ${expiresAt}`);
  if (issued.config.botUsername) {
    console.log(`Deep link: https://t.me/${issued.config.botUsername}?start=${issued.code}`);
  }
}

export function startTelegramBot(): void {
  const config = readTelegramConfig();
  if (!config) {
    throw new Error("Telegram is not configured yet. Run `bridge gateway add telegram` first.");
  }
  const child = spawnWorkspaceCommand("telegram");
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}

export function revokeTelegramIdentity(target?: string): boolean {
  const config = readTelegramConfig();
  if (!config) {
    return false;
  }
  if (!target) {
    writeTelegramConfig({
      ...config,
      allowedChatIds: []
    });
    return true;
  }
  const nextIds = config.allowedChatIds.filter((id) => String(id) !== target);
  writeTelegramConfig({
    ...config,
    allowedChatIds: nextIds
  });
  return nextIds.length !== config.allowedChatIds.length;
}
