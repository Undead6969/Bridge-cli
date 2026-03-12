import {
  authTokenSchema,
  inboxItemSchema,
  machineRecordSchema,
  pairingCodeSchema,
  pairingRequestSchema,
  powerPolicySchema,
  sessionRecordSchema,
  sessionSpecSchema,
  sessionStreamEventSchema,
  type AuthToken,
  type InboxItem,
  type MachineRecord,
  type PowerPolicy,
  type SessionRecord,
  type SessionSpec,
  type SessionStreamEvent
} from "@bridge/protocol";
import WebSocket from "ws";

async function json<T>(response: Response, parser: { parse: (value: unknown) => T }): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }
  return parser.parse(await response.json());
}

export class BridgeSdk {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string
  ) {}

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async createPairing(label?: string): Promise<{ code: string; expiresAt: number }> {
    const response = await fetch(`${this.baseUrl}/auth/pairings/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pairingRequestSchema.parse({ label }))
    });
    return json(response, {
      parse: (value) =>
        ({
          code: pairingCodeSchema.shape.code.parse((value as { code: string }).code),
          expiresAt: Number((value as { expiresAt: number }).expiresAt)
        })
    });
  }

  async exchangePairing(code: string, label?: string): Promise<AuthToken> {
    const response = await fetch(`${this.baseUrl}/auth/pairings/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pairingCodeSchema.parse({ code, label }))
    });
    return json(response, authTokenSchema);
  }

  async listMachines(): Promise<MachineRecord[]> {
    const response = await fetch(`${this.baseUrl}/machines`, { headers: this.headers() });
    return json(response, { parse: (value) => machineRecordSchema.array().parse(value) });
  }

  async getMachine(machineId: string): Promise<MachineRecord> {
    const response = await fetch(`${this.baseUrl}/machines/${machineId}`, { headers: this.headers() });
    return json(response, machineRecordSchema);
  }

  async updatePowerPolicy(machineId: string, policy: PowerPolicy): Promise<MachineRecord> {
    const response = await fetch(`${this.baseUrl}/machines/${machineId}/power-policy`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...this.headers() },
      body: JSON.stringify(powerPolicySchema.parse(policy))
    });
    return json(response, machineRecordSchema);
  }

  async listSessions(): Promise<SessionRecord[]> {
    const response = await fetch(`${this.baseUrl}/sessions`, { headers: this.headers() });
    return json(response, { parse: (value) => sessionRecordSchema.array().parse(value) });
  }

  async listInbox(): Promise<InboxItem[]> {
    const response = await fetch(`${this.baseUrl}/inbox`, { headers: this.headers() });
    return json(response, { parse: (value) => inboxItemSchema.array().parse(value) });
  }

  async createSession(machineId: string, spec: SessionSpec): Promise<SessionRecord> {
    const response = await fetch(`${this.baseUrl}/machines/${machineId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers() },
      body: JSON.stringify(sessionSpecSchema.parse(spec))
    });
    return json(response, sessionRecordSchema);
  }

  async stopSession(sessionId: string): Promise<SessionRecord> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/stop`, {
      method: "POST",
      headers: this.headers()
    });
    return json(response, sessionRecordSchema);
  }

  async listSessionEvents(sessionId: string): Promise<SessionStreamEvent[]> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/events`, { headers: this.headers() });
    return json(response, { parse: (value) => sessionStreamEventSchema.array().parse(value) });
  }

  async markSessionViewed(sessionId: string): Promise<SessionRecord> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/view`, {
      method: "POST",
      headers: this.headers()
    });
    return json(response, sessionRecordSchema);
  }

  subscribe(
    sessionId: string,
    handlers: {
      onSnapshot?: (payload: { session: SessionRecord | null; events: SessionStreamEvent[] }) => void;
      onEvent?: (event: SessionStreamEvent) => void;
      onError?: (message: string) => void;
    }
  ): WebSocket {
    if (!this.token) {
      throw new Error("A token is required for websocket subscriptions");
    }
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.searchParams.set("role", "subscriber");
    url.searchParams.set("token", this.token);
    const socket = new WebSocket(url);
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "subscribe", sessionId }));
    });
    socket.on("message", (buffer) => {
      const payload = JSON.parse(buffer.toString()) as
        | { type: "session.snapshot"; session: SessionRecord | null; events: SessionStreamEvent[] }
        | { type: "session.event"; event: SessionStreamEvent }
        | { type: "error"; message: string };
      if (payload.type === "session.snapshot") {
        handlers.onSnapshot?.({
          session: payload.session ? sessionRecordSchema.parse(payload.session) : null,
          events: payload.events.map((event) => sessionStreamEventSchema.parse(event))
        });
      } else if (payload.type === "session.event") {
        handlers.onEvent?.(sessionStreamEventSchema.parse(payload.event));
      } else {
        handlers.onError?.(payload.message);
      }
    });
    return socket;
  }
}
