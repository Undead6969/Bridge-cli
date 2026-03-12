import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "../components/dashboard";
import { defaultPowerPolicy, type MachineRecord } from "@bridge/protocol";

describe("Dashboard", () => {
  it("renders machine details", () => {
    const machines: MachineRecord[] = [
      {
        machineId: "m1",
        hostname: "laptop",
        capabilities: {
          machineId: "m1",
          hostname: "laptop",
          os: { platform: "darwin", release: "24", arch: "arm64" },
          cli: {
            codex: {
              installed: true,
              version: "5.4",
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
            supportsInteractivePty: true
          },
          daemonVersion: "0.1.0",
          reportedAt: 1
        },
        powerPolicy: defaultPowerPolicy,
        online: true,
        updatedAt: 1
      }
    ];

    const html = renderToStaticMarkup(<Dashboard machines={machines} sessions={[]} serverBaseUrl="https://bridge.example.com" />);
    expect(html).toContain("laptop");
    expect(html).toContain("Codex: 5.4");
  });
});
