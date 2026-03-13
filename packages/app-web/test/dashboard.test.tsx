import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "../components/dashboard";
import { defaultPowerPolicy, type InboxItem, type MachineRecord, type SessionRecord } from "@bridge/protocol";

describe("Dashboard", () => {
  it("renders messenger-style workspace and session details", () => {
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
        daemonConnected: true,
        updatedAt: 1
      }
    ];

    const sessions: SessionRecord[] = [
      {
        id: "s1",
        machineId: "m1",
        runtime: "agent-session",
        title: "codex session",
        status: "waiting",
        attention: "needs-review",
        owner: "remote",
        cwd: "/tmp",
        agent: "codex",
        startedBy: "web",
        unreadCount: 2,
        createdAt: 1,
        updatedAt: 1
      }
    ];

    const inbox: InboxItem[] = [
      {
        id: "i1",
        sessionId: "s1",
        machineId: "m1",
        title: "codex session is ready",
        body: "All set",
        level: "success",
        category: "session-ready",
        createdAt: 1
      }
    ];

    const html = renderToStaticMarkup(
      <Dashboard
        machines={machines}
        sessions={sessions}
        inbox={inbox}
        serverBaseUrl="https://bridge.example.com"
        selectedWorkspace="all"
        activeSessionId="s1"
        sessionEvents={[]}
        composer=""
        notificationsEnabled={false}
        theme="dark"
        onSelectWorkspace={() => undefined}
        onSelectSession={() => undefined}
        onComposerChange={() => undefined}
        onSendInput={() => undefined}
        onLaunchSession={() => undefined}
        onPowerChange={() => undefined}
        onMarkInboxRead={() => undefined}
        onToggleNotifications={() => undefined}
        onThemeChange={() => undefined}
        onDisconnect={() => undefined}
        onShowPairing={() => undefined}
      />
    );

    expect(html).toContain("laptop");
    expect(html).toContain("Bridge");
    expect(html).toContain("Sessions");
    expect(html).toContain("Codex");
  });
});
