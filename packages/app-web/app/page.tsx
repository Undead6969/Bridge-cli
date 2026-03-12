import { defaultPowerPolicy, type MachineRecord, type SessionRecord } from "@bridge/protocol";
import { ClientApp } from "../components/client-app";

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  const base = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:8787";
  try {
    const response = await fetch(`${base}${path}`, { cache: "no-store" });
    if (!response.ok) {
      return fallback;
    }
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export default async function Page() {
  const machines = await fetchJson<MachineRecord[]>("/machines", [
    {
      machineId: "local-machine",
      hostname: "offline-demo",
      capabilities: {
        machineId: "local-machine",
        hostname: "offline-demo",
        os: { platform: "darwin", release: "24", arch: "arm64" },
        cli: {
          codex: {
            installed: true,
            version: "5.4-compatible",
            launchable: true,
            supportsRemoteWrapper: true,
            supportsSessionControl: true
          },
          claude: {
            installed: true,
            version: "detected",
            launchable: true,
            supportsRemoteWrapper: true,
            supportsSessionControl: true
          },
          gemini: {
            installed: false,
            launchable: false,
            supportsRemoteWrapper: false,
            supportsSessionControl: false
          }
        },
        power: {
          canPreventSleep: true,
          canSleep: true,
          canShutdown: true,
          platform: "macos"
        },
        terminal: {
          shellPath: "/bin/zsh",
          supportsInteractivePty: true
        },
        daemonVersion: "0.1.0",
        reportedAt: Date.now()
      },
      powerPolicy: defaultPowerPolicy,
      online: false,
      updatedAt: Date.now()
    }
  ]);

  const sessions = await fetchJson<SessionRecord[]>("/sessions", []);

  return <ClientApp fallbackMachines={machines} fallbackSessions={sessions} />;
}
