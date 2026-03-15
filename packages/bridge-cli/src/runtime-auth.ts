import type { RuntimeName } from "@bridge/protocol";
import { spawn } from "node:child_process";
import { readOwnerRecord, readRuntimesState, writeOwnerRecord, writeRuntimesState } from "./local-state.js";
import { buildRuntimeInventory } from "./setup.js";
import { fetchDaemonCapabilities } from "./services.js";

function runInteractive(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env
    });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", reject);
  });
}

export async function authenticateRuntime(runtime: RuntimeName): Promise<void> {
  if (runtime === "terminal") {
    console.log("Terminal does not need provider auth. It just wants a shell and a chance.");
    return;
  }

  if (runtime === "codex") {
    await runInteractive("codex", ["login"]);
  } else if (runtime === "gemini") {
    console.log("Gemini auth is CLI-managed. Launching Gemini so it can complete login if needed.");
    await runInteractive("gemini", []);
  } else if (runtime === "claude") {
    console.log("Claude Code auth is usually handled by the Claude CLI. If `claude` is installed, complete its login flow now.");
    await runInteractive("claude", []);
  }

  const owner = readOwnerRecord();
  const current = readRuntimesState();
  if (owner) {
    const capabilities = await fetchDaemonCapabilities();
    const refreshed = await buildRuntimeInventory(owner.ownerId, capabilities, current?.defaultRuntime ?? owner.defaultRuntime);
    writeRuntimesState(refreshed);
  }
}

export function resetOwnerAuth(): void {
  const owner = readOwnerRecord();
  if (!owner) {
    console.log("No owner setup exists yet.");
    return;
  }
  writeOwnerRecord({
    ...owner,
    updatedAt: Date.now(),
    migrationNotes: [...owner.migrationNotes, "owner auth reset requested"]
  });
  console.log("Owner auth marker reset. Less dramatic than deleting everything, which is why we chose it.");
}
