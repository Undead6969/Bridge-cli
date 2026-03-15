import {
  gatewayRecordSchema,
  gatewaysStateSchema,
  gatewayTypeSchema,
  machineSetupRecordSchema,
  ownerRecordSchema,
  runtimeStatusRecordSchema,
  runtimesStateSchema,
  type GatewayRecord,
  type GatewayType,
  type GatewaysState,
  type MachineSetupRecord,
  type OwnerRecord,
  type RuntimeName,
  type RuntimeStatusRecord,
  type RuntimesState
} from "@bridge/protocol";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const bridgeHome = resolve(homedir(), ".bridge");

export const localStatePaths = {
  home: bridgeHome,
  owner: join(bridgeHome, "owner.json"),
  machine: join(bridgeHome, "machine.json"),
  runtimes: join(bridgeHome, "runtimes.json"),
  gateways: join(bridgeHome, "gateways.json"),
  auth: join(bridgeHome, "auth.json"),
  telegram: join(bridgeHome, "telegram.json"),
  whatsapp: join(bridgeHome, "whatsapp.json"),
  machineId: join(bridgeHome, "machine-id")
} as const;

function ensureDir(pathname: string): void {
  mkdirSync(dirname(pathname), { recursive: true });
}

function readJson<T>(pathname: string, parser: { parse: (value: unknown) => T }): T | null {
  try {
    return parser.parse(JSON.parse(readFileSync(pathname, "utf8")));
  } catch {
    return null;
  }
}

function writeJson<T>(pathname: string, value: T): T {
  ensureDir(pathname);
  writeFileSync(pathname, JSON.stringify(value, null, 2));
  return value;
}

export function readOwnerRecord(): OwnerRecord | null {
  return readJson(localStatePaths.owner, ownerRecordSchema);
}

export function writeOwnerRecord(owner: OwnerRecord): OwnerRecord {
  return writeJson(localStatePaths.owner, ownerRecordSchema.parse(owner));
}

export function readMachineSetupRecord(): MachineSetupRecord | null {
  return readJson(localStatePaths.machine, machineSetupRecordSchema);
}

export function writeMachineSetupRecord(machine: MachineSetupRecord): MachineSetupRecord {
  return writeJson(localStatePaths.machine, machineSetupRecordSchema.parse(machine));
}

export function readRuntimesState(): RuntimesState | null {
  return readJson(localStatePaths.runtimes, runtimesStateSchema);
}

export function writeRuntimesState(state: RuntimesState): RuntimesState {
  return writeJson(localStatePaths.runtimes, runtimesStateSchema.parse(state));
}

export function readGatewaysState(): GatewaysState | null {
  return readJson(localStatePaths.gateways, gatewaysStateSchema);
}

export function writeGatewaysState(state: GatewaysState): GatewaysState {
  return writeJson(localStatePaths.gateways, gatewaysStateSchema.parse(state));
}

export function createDefaultRuntimeRecord(runtime: RuntimeName, now = Date.now()): RuntimeStatusRecord {
  return runtimeStatusRecordSchema.parse({
    runtime,
    installed: runtime === "terminal",
    launchable: runtime === "terminal",
    authState: runtime === "terminal" ? "authenticated" : "unknown",
    selected: false,
    health: "unknown",
    lastValidatedAt: now,
    notes: []
  });
}

export function createDefaultGatewayRecord(type: GatewayType, now = Date.now()): GatewayRecord {
  return gatewayRecordSchema.parse({
    type,
    enabled: false,
    status: "disabled",
    isPrimary: false,
    linkedIdentities: [],
    lastValidatedAt: now,
    metadata: {}
  });
}

export function createEmptyGatewaysState(ownerId: string, primaryGateway: GatewayType, now = Date.now()): GatewaysState {
  return gatewaysStateSchema.parse({
    ownerId,
    primaryGateway,
    gateways: {
      web: createDefaultGatewayRecord("web", now),
      telegram: createDefaultGatewayRecord("telegram", now),
      whatsapp: createDefaultGatewayRecord("whatsapp", now)
    }
  });
}

export function isSetupComplete(): boolean {
  return existsSync(localStatePaths.owner) && existsSync(localStatePaths.machine) && existsSync(localStatePaths.runtimes) && existsSync(localStatePaths.gateways);
}

export function upsertGatewayRecord(state: GatewaysState, gateway: GatewayRecord, primaryGateway = state.primaryGateway): GatewaysState {
  const nextGateways = {
    ...state.gateways,
    [gateway.type]: gatewayRecordSchema.parse({
      ...gateway,
      isPrimary: gateway.type === primaryGateway
    })
  };
  for (const type of gatewayTypeSchema.options) {
    nextGateways[type] = gatewayRecordSchema.parse({
      ...nextGateways[type],
      isPrimary: type === primaryGateway
    });
  }
  return gatewaysStateSchema.parse({
    ...state,
    primaryGateway,
    gateways: nextGateways
  });
}

export function legacyRepoMachineIdPath(cwd = process.cwd()): string {
  return resolve(cwd, ".bridge", "machine-id");
}

export function legacyServerStatePath(cwd = process.cwd()): string {
  return resolve(cwd, ".bridge", "server-state.json");
}

export function ensureStableMachineId(cwd = process.cwd()): string {
  if (existsSync(localStatePaths.machineId)) {
    const value = readFileSync(localStatePaths.machineId, "utf8").trim();
    if (value) {
      return value;
    }
  }
  const legacyPath = legacyRepoMachineIdPath(cwd);
  if (existsSync(legacyPath)) {
    const legacyValue = readFileSync(legacyPath, "utf8").trim();
    if (legacyValue) {
      ensureDir(localStatePaths.machineId);
      writeFileSync(localStatePaths.machineId, `${legacyValue}\n`, "utf8");
      return legacyValue;
    }
  }
  const value = `machine-${randomUUID()}`;
  ensureDir(localStatePaths.machineId);
  writeFileSync(localStatePaths.machineId, `${value}\n`, "utf8");
  return value;
}
