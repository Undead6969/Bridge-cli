import { describe, expect, it, vi } from "vitest";
import { BridgeSdk } from "../src/index.js";

describe("BridgeSdk", () => {
  it("exchanges pairing codes for tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: "token-1",
        label: "termux",
        createdAt: 1,
        lastUsedAt: 1
      })
    });
    vi.stubGlobal(
      "fetch",
      fetchMock
    );

    const sdk = new BridgeSdk("http://localhost:8787");
    const token = await sdk.exchangePairing("123456", "termux");
    expect(token.token).toBe("token-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/auth/pairings/exchange",
      expect.objectContaining({
        headers: expect.objectContaining({
          "bypass-tunnel-reminder": "bridge"
        })
      })
    );
  });

  it("creates sessions with validated payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "session-1",
          machineId: "machine-1",
          runtime: "agent-session",
          title: "Codex",
          status: "starting",
          cwd: "/tmp",
          agent: "codex",
          startedBy: "bridge",
          createdAt: 1,
          updatedAt: 1
        })
      })
    );

    const sdk = new BridgeSdk("http://localhost:8787");
    const session = await sdk.createSession("machine-1", {
      runtime: "agent-session",
      agent: "codex",
      cwd: "/tmp",
      startedBy: "bridge"
    });

    expect(session.agent).toBe("codex");
  });
});
