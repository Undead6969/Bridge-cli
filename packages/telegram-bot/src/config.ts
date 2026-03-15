import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { randomInt } from "node:crypto";
import { z } from "zod";

const telegramConfigSchema = z.object({
  botToken: z.string().min(1),
  botUsername: z.string().optional(),
  serverUrl: z.string().url(),
  bridgeToken: z.string().min(1),
  appUrl: z.string().url(),
  allowedChatIds: z.array(z.number().int()).default([]),
  pollOffset: z.number().int().optional(),
  defaultMachineId: z.string().optional(),
  currentMachineByChat: z.record(z.string(), z.string()).default({}),
  currentWorkspaceByChat: z.record(z.string(), z.string()).default({}),
  currentSessionByChat: z.record(z.string(), z.string()).default({}),
  loginCodes: z
    .array(
      z.object({
        code: z.string().regex(/^\d{6}$/),
        createdAt: z.number(),
        expiresAt: z.number(),
        label: z.string().optional(),
        usedAt: z.number().optional()
      })
    )
    .default([]),
  updatedAt: z.number()
});

export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

export const telegramConfigPath = resolve(homedir(), ".bridge", "telegram.json");

export function createLinkCode(): string {
  return String(randomInt(100000, 1_000_000));
}

export function readTelegramConfig(): TelegramConfig | null {
  try {
    return telegramConfigSchema.parse(JSON.parse(readFileSync(telegramConfigPath, "utf8")));
  } catch {
    return null;
  }
}

export function writeTelegramConfig(config: TelegramConfig): TelegramConfig {
  mkdirSync(dirname(telegramConfigPath), { recursive: true });
  const parsed = telegramConfigSchema.parse({
    ...config,
    updatedAt: Date.now()
  });
  writeFileSync(telegramConfigPath, JSON.stringify(parsed, null, 2));
  return parsed;
}

export function updateTelegramConfig(
  updater: (config: TelegramConfig) => TelegramConfig
): TelegramConfig {
  const config = readTelegramConfig();
  if (!config) {
    throw new Error(`Telegram config not found at ${telegramConfigPath}`);
  }
  return writeTelegramConfig(updater(config));
}
