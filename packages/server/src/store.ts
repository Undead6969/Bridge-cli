import {
  authTokenSchema,
  defaultPowerPolicy,
  type AuthToken,
  type MachineRecord,
  type PairingCode,
  powerPolicySchema,
  type PowerPolicy,
  type SessionRecord,
  type SessionSpec,
  sessionStreamEventSchema,
  type SessionStreamEvent
} from "@bridge/protocol";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type PairingRecord = PairingCode & {
  expiresAt: number;
  consumedAt?: number;
};

type PersistedState = {
  machines: MachineRecord[];
  sessions: SessionRecord[];
  sessionEvents: SessionStreamEvent[];
  authTokens: AuthToken[];
  pairings: PairingRecord[];
};

const defaultState: PersistedState = {
  machines: [],
  sessions: [],
  sessionEvents: [],
  authTokens: [],
  pairings: []
};

export class BridgeStore {
  private readonly stateFile: string;
  private state: PersistedState;

  constructor(stateFile = resolve(process.cwd(), ".bridge", "server-state.json")) {
    this.stateFile = stateFile;
    this.state = this.readState();
  }

  private readState(): PersistedState {
    if (!existsSync(this.stateFile)) {
      return structuredClone(defaultState);
    }
    const raw = JSON.parse(readFileSync(this.stateFile, "utf8")) as PersistedState;
    return {
      machines: raw.machines ?? [],
      sessions: raw.sessions ?? [],
      sessionEvents: (raw.sessionEvents ?? []).map((event) => sessionStreamEventSchema.parse(event)),
      authTokens: (raw.authTokens ?? []).map((token) => authTokenSchema.parse(token)),
      pairings: raw.pairings ?? []
    };
  }

  private persist(): void {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  private prunePairings(): void {
    const now = Date.now();
    this.state.pairings = this.state.pairings.filter((pairing) => pairing.expiresAt > now && !pairing.consumedAt);
  }

  listMachines(): MachineRecord[] {
    return [...this.state.machines].sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  getMachine(machineId: string): MachineRecord | undefined {
    return this.state.machines.find((machine) => machine.machineId === machineId);
  }

  upsertMachine(machine: Omit<MachineRecord, "updatedAt" | "powerPolicy" | "online"> & Partial<Pick<MachineRecord, "powerPolicy" | "online">>): MachineRecord {
    const existing = this.getMachine(machine.machineId);
    const next: MachineRecord = {
      ...machine,
      powerPolicy: powerPolicySchema.parse(machine.powerPolicy ?? existing?.powerPolicy ?? defaultPowerPolicy),
      online: machine.online ?? existing?.online ?? true,
      updatedAt: Date.now()
    };
    this.state.machines = this.state.machines.filter((item) => item.machineId !== next.machineId);
    this.state.machines.push(next);
    this.persist();
    return next;
  }

  updateMachineOnline(machineId: string, online: boolean): MachineRecord | undefined {
    const machine = this.getMachine(machineId);
    if (!machine) {
      return undefined;
    }
    const next = { ...machine, online, updatedAt: Date.now() };
    this.state.machines = this.state.machines.filter((item) => item.machineId !== machineId);
    this.state.machines.push(next);
    this.persist();
    return next;
  }

  updatePowerPolicy(machineId: string, policy: PowerPolicy): MachineRecord {
    const machine = this.getMachine(machineId);
    if (!machine) {
      throw new Error(`Unknown machine ${machineId}`);
    }
    const next = { ...machine, powerPolicy: powerPolicySchema.parse(policy), updatedAt: Date.now() };
    this.state.machines = this.state.machines.filter((item) => item.machineId !== machineId);
    this.state.machines.push(next);
    this.persist();
    return next;
  }

  listSessions(): SessionRecord[] {
    return [...this.state.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.state.sessions.find((session) => session.id === sessionId);
  }

  createSession(machineId: string, spec: SessionSpec): SessionRecord {
    const session: SessionRecord = {
      id: randomUUID(),
      machineId,
      runtime: spec.runtime,
      title: spec.runtime === "agent-session" ? `${spec.agent} session` : spec.profile ?? "terminal",
      status: "starting",
      cwd: spec.cwd,
      agent: spec.runtime === "agent-session" ? spec.agent : undefined,
      shell: spec.runtime === "terminal-session" ? spec.shell : undefined,
      terminalBackend: undefined,
      startedBy: spec.startedBy,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.state.sessions.push(session);
    this.persist();
    return session;
  }

  upsertSession(session: SessionRecord): SessionRecord {
    this.state.sessions = this.state.sessions.filter((item) => item.id !== session.id);
    this.state.sessions.push({ ...session, updatedAt: Date.now() });
    this.persist();
    return this.getSession(session.id)!;
  }

  updateSessionStatus(sessionId: string, status: SessionRecord["status"]): SessionRecord {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    return this.upsertSession({ ...session, status });
  }

  stopSession(sessionId: string): SessionRecord {
    return this.updateSessionStatus(sessionId, "stopped");
  }

  addSessionEvent(event: SessionStreamEvent): SessionStreamEvent {
    this.state.sessionEvents.push(sessionStreamEventSchema.parse(event));
    const bySession = new Map<string, SessionStreamEvent[]>();
    for (const item of this.state.sessionEvents) {
      const events = bySession.get(item.sessionId) ?? [];
      events.push(item);
      bySession.set(item.sessionId, events.slice(-200));
    }
    this.state.sessionEvents = [...bySession.values()].flat();
    this.persist();
    return event;
  }

  getSessionEvents(sessionId: string, afterEventId?: string): SessionStreamEvent[] {
    const events = this.state.sessionEvents.filter((event) => event.sessionId === sessionId);
    if (!afterEventId) {
      return events.slice(-200);
    }
    const index = events.findIndex((event) => event.id === afterEventId);
    return index === -1 ? events.slice(-200) : events.slice(index + 1);
  }

  createPairing(label = "bridge"): PairingRecord {
    this.prunePairings();
    const code = `${randomInt(0, 1_000_000)}`.padStart(6, "0");
    const pairing: PairingRecord = {
      code,
      label,
      expiresAt: Date.now() + 1000 * 60 * 10
    };
    this.state.pairings.push(pairing);
    this.persist();
    return pairing;
  }

  exchangePairing(code: string, label = "paired-device"): AuthToken {
    this.prunePairings();
    const pairing = this.state.pairings.find((item) => item.code === code);
    if (!pairing) {
      throw new Error("Invalid or expired pairing code");
    }
    pairing.consumedAt = Date.now();
    const token: AuthToken = {
      token: randomUUID(),
      label,
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };
    this.state.authTokens.push(token);
    this.persist();
    return token;
  }

  getToken(token: string): AuthToken | undefined {
    const auth = this.state.authTokens.find((item) => item.token === token);
    if (auth) {
      auth.lastUsedAt = Date.now();
      this.persist();
    }
    return auth;
  }
}
