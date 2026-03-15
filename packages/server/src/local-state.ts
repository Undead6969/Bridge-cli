import {
  gatewaysStateSchema,
  machineSetupRecordSchema,
  ownerRecordSchema,
  runtimesStateSchema,
  type GatewaysState,
  type MachineSetupRecord,
  type OwnerRecord,
  type RuntimesState
} from "@bridge/protocol";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const bridgeHome = resolve(homedir(), ".bridge");

export const localStatePaths = {
  home: bridgeHome,
  owner: resolve(bridgeHome, "owner.json"),
  machine: resolve(bridgeHome, "machine.json"),
  runtimes: resolve(bridgeHome, "runtimes.json"),
  gateways: resolve(bridgeHome, "gateways.json"),
  serverState: resolve(bridgeHome, "server-state.json")
} as const;

function readJson<T>(pathname: string, parser: { parse: (value: unknown) => T }): T | null {
  try {
    return parser.parse(JSON.parse(readFileSync(pathname, "utf8")));
  } catch {
    return null;
  }
}

export function readOwnerRecord(): OwnerRecord | null {
  return readJson(localStatePaths.owner, ownerRecordSchema);
}

export function readMachineSetupRecord(): MachineSetupRecord | null {
  return readJson(localStatePaths.machine, machineSetupRecordSchema);
}

export function readRuntimesState(): RuntimesState | null {
  return readJson(localStatePaths.runtimes, runtimesStateSchema);
}

export function readGatewaysState(): GatewaysState | null {
  return readJson(localStatePaths.gateways, gatewaysStateSchema);
}

export function legacyServerStatePath(cwd = process.cwd()): string {
  return resolve(cwd, ".bridge", "server-state.json");
}

export function hasOwnerFirstSetup(): boolean {
  return existsSync(localStatePaths.owner) && existsSync(localStatePaths.machine) && existsSync(localStatePaths.runtimes) && existsSync(localStatePaths.gateways);
}
