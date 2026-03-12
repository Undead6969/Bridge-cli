import { describe, expect, it } from "vitest";
import { defaultPowerPolicy, machineCapabilitiesSchema, sessionSpecSchema } from "../src/index.js";

describe("protocol schemas", () => {
  it("validates a machine capability payload", () => {
    const parsed = machineCapabilitiesSchema.parse({
      machineId: "machine-1",
      hostname: "laptop",
      os: { platform: "darwin", release: "24.0.0", arch: "arm64" },
      cli: {
        codex: {
          installed: true,
          executablePath: "/usr/local/bin/codex",
          version: "0.5.4",
          launchable: true,
          supportsRemoteWrapper: true,
          supportsSessionControl: true
        },
        claude: {
          installed: false,
          launchable: false,
          supportsRemoteWrapper: false,
          supportsSessionControl: false
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
    });

    expect(parsed.cli.codex.version).toBe("0.5.4");
  });

  it("validates terminal session specs", () => {
    const parsed = sessionSpecSchema.parse({
      runtime: "terminal-session",
      cwd: "/tmp",
      startedBy: "web"
    });

    expect(parsed.runtime).toBe("terminal-session");
  });

  it("exports the default power policy", () => {
    expect(defaultPowerPolicy.mode).toBe("stay-awake-during-activity");
  });
});
