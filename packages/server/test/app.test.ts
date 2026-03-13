import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { sendSessionStart } from "../src/realtime.js";
import { BridgeStore } from "../src/store.js";

function tempStore() {
  return new BridgeStore(join(mkdtempSync(join(tmpdir(), "bridge-server-")), "state.json"));
}

describe("server app", () => {
  it("creates pairing codes, exchanges them, and authorizes session creation", async () => {
    const store = tempStore();
    const { app } = createApp(store);

    const pairing = await app.inject({
      method: "POST",
      url: "/auth/pairings/request",
      payload: { label: "desktop" }
    });
    expect(pairing.statusCode).toBe(200);
    const code = pairing.json<{ code: string }>().code;

    const exchange = await app.inject({
      method: "POST",
      url: "/auth/pairings/exchange",
      payload: { code, label: "desktop" }
    });
    expect(exchange.statusCode).toBe(200);
    const token = exchange.json<{ token: string }>().token;

    const register = await app.inject({
      method: "POST",
      url: "/machines/register",
      payload: {
        machineId: "machine-1",
        hostname: "laptop",
        capabilities: {
          machineId: "machine-1",
          hostname: "laptop",
          os: { platform: "darwin", release: "24", arch: "arm64" },
          cli: {
            codex: {
              installed: true,
              launchable: true,
              version: "5.4",
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
          reportedAt: Date.now()
        }
      }
    });
    expect(register.statusCode).toBe(200);

    const session = await app.inject({
      method: "POST",
      url: "/machines/machine-1/sessions",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        runtime: "agent-session",
        agent: "codex",
        cwd: "/tmp",
        startedBy: "web"
      }
    });

    expect(session.statusCode).toBe(200);
    expect(session.json().agent).toBe("codex");
  });

  it("allows a pairing exchange to be retried without invalidating the code immediately", async () => {
    const store = tempStore();
    const { app } = createApp(store);

    const pairing = await app.inject({
      method: "POST",
      url: "/auth/pairings/request",
      payload: { label: "desktop" }
    });
    const code = pairing.json<{ code: string }>().code;

    const firstExchange = await app.inject({
      method: "POST",
      url: "/auth/pairings/exchange",
      payload: { code, label: "desktop" }
    });
    const secondExchange = await app.inject({
      method: "POST",
      url: "/auth/pairings/exchange",
      payload: { code, label: "desktop" }
    });

    expect(firstExchange.statusCode).toBe(200);
    expect(secondExchange.statusCode).toBe(200);
    expect(secondExchange.json<{ token: string }>().token).toBe(firstExchange.json<{ token: string }>().token);
  });

  it("persists session events and replays them by session", () => {
    const store = tempStore();
    store.addSessionEvent({
      id: "event-1",
      sessionId: "session-1",
      kind: "stdout",
      data: "hello",
      at: 1
    });
    store.addSessionEvent({
      id: "event-2",
      sessionId: "session-1",
      kind: "stderr",
      data: "oops",
      at: 2
    });

    expect(store.getSessionEvents("session-1").map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(store.getSessionEvents("session-1", "event-1").map((event) => event.id)).toEqual(["event-2"]);
  });

  it("dispatches daemon start commands to connected machines", () => {
    const send = vi.fn();
    sendSessionStart(
      {
        daemons: new Map([
          [
            "machine-1",
            {
              OPEN: 1,
              readyState: 1,
              send
            }
          ]
        ]),
        subscribers: new Map()
      } as never,
      {
        id: "session-1",
        machineId: "machine-1",
        runtime: "terminal-session",
        title: "terminal",
        status: "starting",
        attention: "activity",
        owner: "remote",
        cwd: "/tmp",
        startedBy: "web",
        unreadCount: 0,
        createdAt: 1,
        updatedAt: 1
      },
      {
        runtime: "terminal-session",
        cwd: "/tmp",
        startedBy: "web"
      }
    );

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toContain("session.start");
  });

  it("responds with cors headers for hosted app origins", async () => {
    const store = tempStore();
    const { app } = createApp(store);

    const response = await app.inject({
      method: "OPTIONS",
      url: "/auth/pairings/request",
      headers: {
        origin: "https://app-web-sand.vercel.app",
        "access-control-request-method": "POST"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app-web-sand.vercel.app");
    expect(String(response.headers["access-control-allow-headers"])).toContain("bypass-tunnel-reminder");
  });
});
