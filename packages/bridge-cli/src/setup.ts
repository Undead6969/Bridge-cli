import type { GatewaysState, GatewayType, MachineCapabilities, RuntimeName } from "@bridge/protocol";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  createDefaultGatewayRecord,
  ensureStableMachineId,
  isSetupComplete,
  localStatePaths,
  readGatewaysState,
  readMachineSetupRecord,
  readOwnerRecord,
  readRuntimesState,
  writeGatewaysState,
  writeMachineSetupRecord,
  writeOwnerRecord,
  writeRuntimesState
} from "./local-state.js";
import { selectOne, prompt } from "./prompts.js";
import { buildRuntimeStatus } from "./runtime-status.js";
import { ensureLocalServices, fetchDaemonCapabilities } from "./services.js";

type TelegramConfigSnapshot = {
  botUsername?: string;
  allowedChatIds: number[];
  defaultMachineId?: string;
  updatedAt: number;
};

function readTelegramConfig(): TelegramConfigSnapshot | null {
  try {
    return JSON.parse(readFileSync(localStatePaths.telegram, "utf8")) as TelegramConfigSnapshot;
  } catch {
    return null;
  }
}

const migrationVersion = 1;

function inferDefaultRuntime(capabilities: MachineCapabilities | null): RuntimeName {
  if (capabilities?.cli.codex.installed && capabilities.cli.codex.launchable) {
    return "codex";
  }
  if (capabilities?.cli.claude.installed && capabilities.cli.claude.launchable) {
    return "claude";
  }
  if (capabilities?.cli.gemini.installed && capabilities.cli.gemini.launchable) {
    return "gemini";
  }
  return "terminal";
}

export async function buildRuntimeInventory(ownerId: string, capabilities: MachineCapabilities | null, defaultRuntime?: RuntimeName) {
  const runtimes = {
    codex: await buildRuntimeStatus("codex", capabilities ?? undefined),
    claude: await buildRuntimeStatus("claude", capabilities ?? undefined),
    gemini: await buildRuntimeStatus("gemini", capabilities ?? undefined),
    terminal: await buildRuntimeStatus("terminal", capabilities ?? undefined)
  };

  const selectedRuntime = defaultRuntime ?? inferDefaultRuntime(capabilities);
  runtimes[selectedRuntime].selected = true;

  return {
    ownerId,
    defaultRuntime: selectedRuntime,
    runtimes
  };
}

function syncGatewayState(ownerId: string, primaryGateway: GatewayType) {
  const existing = readGatewaysState();
  const now = Date.now();
  const next: GatewaysState = existing && existing.ownerId === ownerId
    ? {
        ...existing,
        primaryGateway,
        gateways: {
          ...existing.gateways,
          web: {
            ...existing.gateways.web,
            type: "web",
            enabled: true,
            status: existing.gateways.web.linkedIdentities.length > 0 ? "linked" : "configured",
            isPrimary: primaryGateway === "web",
            metadata: existing.gateways.web.metadata ?? {},
            lastValidatedAt: now
          },
          telegram: {
            ...existing.gateways.telegram,
            type: "telegram",
            isPrimary: primaryGateway === "telegram",
            metadata: existing.gateways.telegram.metadata ?? {},
            lastValidatedAt: now
          },
          whatsapp: {
            ...existing.gateways.whatsapp,
            type: "whatsapp",
            isPrimary: primaryGateway === "whatsapp",
            metadata: existing.gateways.whatsapp.metadata ?? {},
            lastValidatedAt: now
          }
        }
      }
    : {
        ownerId,
        primaryGateway,
        gateways: {
          web: {
            ...createDefaultGatewayRecord("web", now),
            enabled: true,
            status: "configured",
            isPrimary: primaryGateway === "web",
            configPath: localStatePaths.home
          },
          telegram: createDefaultGatewayRecord("telegram", now),
          whatsapp: createDefaultGatewayRecord("whatsapp", now)
        }
      };

  const telegramConfig = readTelegramConfig();
  if (telegramConfig) {
    next.gateways.telegram = {
      ...next.gateways.telegram,
      type: "telegram",
      enabled: true,
      status: telegramConfig.allowedChatIds.length > 0 ? "linked" : "configured",
      linkedIdentities: telegramConfig.allowedChatIds.map((chatId) => ({
        id: String(chatId),
        label: `chat:${chatId}`,
        linkedAt: telegramConfig.updatedAt,
        metadata: {
          gateway: "telegram"
        }
      })),
      configPath: localStatePaths.telegram,
      helperCommand: "bridge telegram start",
      metadata: {
        botUsername: telegramConfig.botUsername,
        defaultMachineId: telegramConfig.defaultMachineId
      },
      isPrimary: primaryGateway === "telegram",
      lastValidatedAt: now
    };
  }

  if (existsSync(localStatePaths.whatsapp)) {
    next.gateways.whatsapp = {
      ...next.gateways.whatsapp,
      type: "whatsapp",
      enabled: true,
      status: "configured",
      configPath: localStatePaths.whatsapp,
      helperCommand: "bridge gateway add whatsapp",
      isPrimary: primaryGateway === "whatsapp",
      lastValidatedAt: now
    };
  }

  return writeGatewaysState(next);
}

export async function runSetup(options?: {
  ownerLabel?: string;
  defaultRuntime?: RuntimeName;
  primaryGateway?: GatewayType;
  nonInteractive?: boolean;
}): Promise<void> {
  const now = Date.now();
  const machineId = ensureStableMachineId();
  const existingOwner = readOwnerRecord();
  const existingMachine = readMachineSetupRecord();

  await ensureLocalServices({ startServer: true, startDaemon: true });
  const capabilities = await fetchDaemonCapabilities();
  const suggestedRuntime = options?.defaultRuntime ?? existingOwner?.defaultRuntime ?? inferDefaultRuntime(capabilities);
  const suggestedGateway = options?.primaryGateway ?? existingOwner?.primaryGateway ?? "web";

  const ownerLabel =
    options?.ownerLabel ??
    existingOwner?.displayLabel ??
    (options?.nonInteractive
      ? hostname()
      : await prompt("Owner label for this laptop", hostname()));

  const defaultRuntime =
    options?.defaultRuntime ??
    (options?.nonInteractive
      ? suggestedRuntime
      : await selectOne<RuntimeName>(
          "Choose the default runtime",
          [
            { value: "codex", label: "Codex", description: "Best default if installed/authenticated" },
            { value: "claude", label: "Claude Code", description: "Anthropic CLI runtime" },
            { value: "gemini", label: "Gemini CLI", description: "Google CLI runtime" },
            { value: "terminal", label: "Terminal", description: "Raw shell session" }
          ],
          suggestedRuntime
        ));

  const primaryGateway =
    options?.primaryGateway ??
    (options?.nonInteractive
      ? suggestedGateway
      : await selectOne<GatewayType>(
          "Choose the primary gateway",
          [
            { value: "web", label: "Web", description: "Hosted app + QR pairing" },
            { value: "telegram", label: "Telegram", description: "Slash commands and notifications" },
            { value: "whatsapp", label: "WhatsApp", description: "Planned gateway helper" }
          ],
          suggestedGateway
        ));

  const ownerId = existingOwner?.ownerId ?? `owner-${randomUUID()}`;

  writeOwnerRecord({
    ownerId,
    displayLabel: ownerLabel,
    defaultRuntime,
    primaryGateway,
    createdAt: existingOwner?.createdAt ?? now,
    updatedAt: now,
    migrationVersion,
    migrationNotes: isSetupComplete() ? ["updated existing owner-first setup"] : ["initialized owner-first setup"]
  });

  writeMachineSetupRecord({
    machineId,
    hostname: capabilities?.hostname ?? existingMachine?.hostname ?? hostname(),
    ownerId,
    createdAt: existingMachine?.createdAt ?? now,
    updatedAt: now,
    migrationSource: existingMachine?.migrationSource ?? "bridge-owner-first"
  });

  const runtimeState = await buildRuntimeInventory(ownerId, capabilities, defaultRuntime);
  writeRuntimesState(runtimeState);
  const gatewayState = syncGatewayState(ownerId, primaryGateway);

  console.log("\nBridge setup complete.\n");
  console.log(`Owner: ${ownerLabel}`);
  console.log(`Machine: ${capabilities?.hostname ?? hostname()} (${machineId})`);
  console.log(`Default runtime: ${defaultRuntime}`);
  console.log(`Primary gateway: ${primaryGateway}`);

  const runtimeNotes = Object.values(runtimeState.runtimes)
    .filter((runtime) => runtime.notes.length > 0)
    .map((runtime) => `- ${runtime.runtime}: ${runtime.notes.join("; ")}`);
  if (runtimeNotes.length > 0) {
    console.log("\nRuntime notes:");
    console.log(runtimeNotes.join("\n"));
  }

  const gatewayNotes = Object.values(gatewayState.gateways)
    .filter((gateway) => gateway.enabled || gateway.isPrimary)
    .map((gateway) => `- ${gateway.type}: ${gateway.status}`);
  if (gatewayNotes.length > 0) {
    console.log("\nGateway status:");
    console.log(gatewayNotes.join("\n"));
  }

  if (primaryGateway === "telegram" && !gatewayState.gateways.telegram.configPath) {
    console.log("\nNext: run `bridge gateway add telegram` to configure the bot.");
  } else if (primaryGateway === "whatsapp" && !existsSync(localStatePaths.whatsapp)) {
    console.log("\nNext: run `bridge gateway add whatsapp` to scaffold the helper config.");
  } else {
    console.log("\nNext: run `bridge doctor`, then `bridge run`.");
  }
}
