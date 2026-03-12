import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@bridge/protocol";
import { detectPowerCapability } from "../src/capabilities.js";
import { SessionManager } from "../src/sessions.js";

describe("capabilities", () => {
  it("detects a supported power capability shape", () => {
    const capability = detectPowerCapability();
    expect(capability.platform).toBeTypeOf("string");
    expect(typeof capability.canPreventSleep).toBe("boolean");
  });

  it("streams shell output through managed terminal sessions", async () => {
    const manager = new SessionManager();
    const events: string[] = [];
    const systemEvents: string[] = [];
    manager.on("session.event", (event) => {
      if (event.kind === "stdout") {
        events.push(event.data);
      }
      if (event.kind === "system") {
        systemEvents.push(event.data);
      }
    });

    manager.create("machine-1", "session-1", {
      runtime: "terminal-session",
      shell: "/bin/sh",
      cwd: process.cwd(),
      startedBy: "bridge"
    });
    const session = manager.get("session-1") as SessionRecord;
    manager.resize("session-1", 100, 40);
    manager.input("session-1", "printf 'hello from shell\\n'\n");
    manager.input("session-1", "exit\n");

    await waitFor(() => events.join("").includes("hello from shell"));
    expect(["node-pty", "python-pty"]).toContain(session.terminalBackend);
    expect(events.join("")).toContain("hello from shell");
    expect(systemEvents.join("")).toContain("100x40");
  });
});

async function waitFor(assertion: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!assertion()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for terminal output");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
