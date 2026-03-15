import { daemonCommandSchema, daemonEventSchema, type MachineCapabilities, type PowerPolicy, type SessionSpec } from "@bridge/protocol";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";
import type { SessionManager } from "./sessions.js";

type RelayOptions = {
  serverUrl: string;
  machineId: string;
  capabilities: MachineCapabilities;
  getPowerPolicy: () => PowerPolicy;
  sessions: SessionManager;
};

function websocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("role", "daemon");
  return url.toString();
}

export class DaemonRelay {
  private socket: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: RelayOptions) {}

  start(): void {
    this.connect();
    this.options.sessions.on("session.started", (session) => {
      this.send({ type: "session.started", session });
    });
    this.options.sessions.on("session.updated", (session) => {
      this.send({ type: "session.updated", session });
    });
    this.options.sessions.on("session.stopped", (sessionId) => {
      this.send({ type: "session.stopped", sessionId });
    });
    this.options.sessions.on("session.event", (event) => {
      this.send({ type: "session.event", event });
    });
  }

  private connect(): void {
    this.socket = new WebSocket(websocketUrl(this.options.serverUrl));
    this.socket.on("open", () => {
      this.send({ type: "daemon.hello", machineId: this.options.machineId });
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 10_000);
    });
    this.socket.on("message", (buffer) => {
      const command = daemonCommandSchema.parse(JSON.parse(buffer.toString()));
      if (command.type === "session.start") {
        this.options.sessions.create(this.options.machineId, command.sessionId, command.spec as SessionSpec);
      } else if (command.type === "session.stop") {
        this.options.sessions.stop(command.sessionId);
      } else if (command.type === "session.input") {
        this.options.sessions.input(command.sessionId, command.data);
      } else if (command.type === "session.resize") {
        this.options.sessions.resize(command.sessionId, command.cols, command.rows);
      } else if (command.type === "approval.respond") {
        this.options.sessions.approve(command.sessionId, command.requestId, command.decision);
      }
    });
    this.socket.on("close", () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.scheduleReconnect();
    });
    this.socket.on("error", () => {
      this.socket?.close();
    });
  }

  private sendHeartbeat(): void {
    this.send(
      daemonEventSchema.parse({
        type: "machine.heartbeat",
        machineId: this.options.machineId,
        capabilities: this.options.capabilities,
        powerPolicy: this.options.getPowerPolicy()
      })
    );
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2_000);
  }
}

export function createMachineId(): string {
  if (process.env.BRIDGE_MACHINE_ID) {
    return process.env.BRIDGE_MACHINE_ID;
  }
  const globalMachineIdFile = resolve(homedir(), ".bridge", "machine-id");
  const legacyMachineIdFile = resolve(process.cwd(), ".bridge", "machine-id");

  if (existsSync(globalMachineIdFile)) {
    const value = readFileSync(globalMachineIdFile, "utf8").trim();
    if (value) {
      return value;
    }
  }

  if (existsSync(legacyMachineIdFile)) {
    const value = readFileSync(legacyMachineIdFile, "utf8").trim();
    if (value) {
      mkdirSync(dirname(globalMachineIdFile), { recursive: true });
      writeFileSync(globalMachineIdFile, `${value}\n`, "utf8");
      return value;
    }
  }

  const value = `machine-${randomUUID()}`;
  mkdirSync(dirname(globalMachineIdFile), { recursive: true });
  writeFileSync(globalMachineIdFile, `${value}\n`, "utf8");
  return value;
}
