import {
  authTokenSchema,
  defaultPowerPolicy,
  inboxItemSchema,
  type AuthToken,
  type InboxItem,
  type MachineRecord,
  type PairingCode,
  powerPolicySchema,
  type PowerPolicy,
  sessionRecordSchema,
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
  inbox: InboxItem[];
  authTokens: AuthToken[];
  pairings: PairingRecord[];
};

const defaultState: PersistedState = {
  machines: [],
  sessions: [],
  sessionEvents: [],
  inbox: [],
  authTokens: [],
  pairings: []
};

const MACHINE_STALE_MS = 35_000;

function deriveOwner(startedBy: SessionSpec["startedBy"]): SessionRecord["owner"] {
  if (startedBy === "cli") {
    return "local";
  }
  if (startedBy === "web" || startedBy === "pwa") {
    return "remote";
  }
  return "shared";
}

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
      sessions: (raw.sessions ?? []).map((session) => sessionRecordSchema.parse(session)),
      sessionEvents: (raw.sessionEvents ?? []).map((event) => sessionStreamEventSchema.parse(event)),
      inbox: (raw.inbox ?? []).map((item) => inboxItemSchema.parse(item)),
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

  private refreshMachineLiveness(): void {
    const now = Date.now();
    let changed = false;
    this.state.machines = this.state.machines.map((machine) => {
      const online = now - machine.updatedAt <= MACHINE_STALE_MS && Boolean(machine.daemonConnected ?? machine.online);
      if (online === machine.online) {
        return machine;
      }
      changed = true;
      return { ...machine, online, updatedAt: now };
    });
    if (changed) {
      this.persist();
    }
  }

  listMachines(): MachineRecord[] {
    this.refreshMachineLiveness();
    return [...this.state.machines].sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  getMachine(machineId: string): MachineRecord | undefined {
    this.refreshMachineLiveness();
    return this.state.machines.find((machine) => machine.machineId === machineId);
  }

  upsertMachine(machine: Omit<MachineRecord, "updatedAt" | "powerPolicy" | "online"> & Partial<Pick<MachineRecord, "powerPolicy" | "online" | "daemonConnected">>): MachineRecord {
    const existing = this.getMachine(machine.machineId);
    const now = Date.now();
    const next: MachineRecord = {
      ...machine,
      powerPolicy: powerPolicySchema.parse(machine.powerPolicy ?? existing?.powerPolicy ?? defaultPowerPolicy),
      daemonConnected: machine.daemonConnected ?? existing?.daemonConnected ?? true,
      online: machine.online ?? existing?.online ?? true,
      updatedAt: now
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
    const next = { ...machine, online, daemonConnected: online, updatedAt: Date.now() };
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
    return [...this.state.sessions].sort((a, b) => (b.lastEventAt ?? b.updatedAt) - (a.lastEventAt ?? a.updatedAt));
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.state.sessions.find((session) => session.id === sessionId);
  }

  createSession(machineId: string, spec: SessionSpec): SessionRecord {
    const now = Date.now();
    const session: SessionRecord = {
      id: randomUUID(),
      machineId,
      runtime: spec.runtime,
      title: spec.runtime === "agent-session" ? `${spec.agent} session` : spec.profile ?? "terminal",
      status: "starting",
      attention: "activity",
      owner: deriveOwner(spec.startedBy),
      cwd: spec.cwd,
      agent: spec.runtime === "agent-session" ? spec.agent : undefined,
      shell: spec.runtime === "terminal-session" ? spec.shell : undefined,
      terminalBackend: undefined,
      startedBy: spec.startedBy,
      lastEventAt: now,
      lastViewedAt: spec.startedBy === "web" || spec.startedBy === "pwa" ? now : undefined,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now
    };
    this.state.sessions.push(session);
    this.persist();
    return session;
  }

  upsertSession(session: SessionRecord): SessionRecord {
    const parsed = sessionRecordSchema.parse({
      ...session,
      updatedAt: Date.now()
    });
    this.state.sessions = this.state.sessions.filter((item) => item.id !== parsed.id);
    this.state.sessions.push(parsed);
    this.persist();
    return this.getSession(parsed.id)!;
  }

  patchSession(sessionId: string, patch: Partial<SessionRecord>): SessionRecord {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    return this.upsertSession({
      ...session,
      ...patch,
      id: session.id,
      machineId: session.machineId,
      runtime: session.runtime,
      cwd: session.cwd,
      startedBy: session.startedBy,
      createdAt: session.createdAt
    });
  }

  updateSessionStatus(sessionId: string, status: SessionRecord["status"], attention?: SessionRecord["attention"]): SessionRecord {
    return this.patchSession(sessionId, {
      status,
      attention: attention ?? this.getSession(sessionId)?.attention,
      lastEventAt: Date.now()
    });
  }

  markSessionViewed(sessionId: string, at = Date.now()): SessionRecord {
    return this.patchSession(sessionId, {
      lastViewedAt: at,
      unreadCount: 0,
      attention: "idle"
    });
  }

  updateSessionOwner(sessionId: string, owner: SessionRecord["owner"]): SessionRecord {
    return this.patchSession(sessionId, { owner });
  }

  stopSession(sessionId: string): SessionRecord {
    return this.updateSessionStatus(sessionId, "stopped", "idle");
  }

  addSessionEvent(event: SessionStreamEvent): SessionStreamEvent {
    const parsed = sessionStreamEventSchema.parse(event);
    this.state.sessionEvents.push(parsed);
    const bySession = new Map<string, SessionStreamEvent[]>();
    for (const item of this.state.sessionEvents) {
      const events = bySession.get(item.sessionId) ?? [];
      events.push(item);
      bySession.set(item.sessionId, events.slice(-300));
    }
    this.state.sessionEvents = [...bySession.values()].flat();

    const session = this.getSession(parsed.sessionId);
    if (session) {
      const attention =
        parsed.kind === "approval" || parsed.kind === "blocked"
          ? "urgent"
          : parsed.kind === "ready" || parsed.kind === "completed"
            ? "needs-review"
            : "activity";
      const nextStatus =
        parsed.kind === "approval"
          ? "approval-needed"
          : parsed.kind === "blocked"
            ? "blocked"
            : parsed.kind === "ready"
              ? "waiting"
              : parsed.kind === "completed"
                ? "completed"
                : session.status;
      const lastViewedAt = session.lastViewedAt ?? 0;
      this.upsertSession({
        ...session,
        status: nextStatus,
        attention,
        unreadCount: parsed.at > lastViewedAt ? session.unreadCount + 1 : session.unreadCount,
        lastEventAt: parsed.at
      });
    } else {
      this.persist();
    }
    return parsed;
  }

  getSessionEvents(sessionId: string, afterEventId?: string): SessionStreamEvent[] {
    const events = this.state.sessionEvents.filter((event) => event.sessionId === sessionId);
    if (!afterEventId) {
      return events.slice(-300);
    }
    const index = events.findIndex((event) => event.id === afterEventId);
    return index === -1 ? events.slice(-300) : events.slice(index + 1);
  }

  listInbox(): InboxItem[] {
    return [...this.state.inbox].sort((a, b) => b.createdAt - a.createdAt);
  }

  addInboxItem(item: Omit<InboxItem, "id" | "createdAt"> & Partial<Pick<InboxItem, "id" | "createdAt">>): InboxItem {
    const next = inboxItemSchema.parse({
      id: item.id ?? randomUUID(),
      createdAt: item.createdAt ?? Date.now(),
      ...item
    });
    this.state.inbox = [next, ...this.state.inbox].slice(0, 400);
    this.persist();
    return next;
  }

  markInboxItemRead(id: string): InboxItem {
    const item = this.state.inbox.find((entry) => entry.id === id);
    if (!item) {
      throw new Error(`Unknown inbox item ${id}`);
    }
    item.readAt = Date.now();
    this.persist();
    return item;
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
