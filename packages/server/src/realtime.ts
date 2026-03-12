import { randomUUID } from "node:crypto";
import { daemonCommandSchema, daemonEventSchema, subscriberCommandSchema, type SessionRecord, type SessionStreamEvent } from "@bridge/protocol";
import type { Server as HttpServer } from "node:http";
import { parse } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { originAllowed } from "./origin.js";
import type { BridgeStore } from "./store.js";

export type Connections = {
  daemons: Map<string, WebSocket>;
  subscribers: Map<string, Set<WebSocket>>;
};

function createInboxFromEvent(event: SessionStreamEvent, session: SessionRecord | undefined) {
  if (!session) {
    return undefined;
  }
  if (event.kind === "approval") {
    return {
      machineId: session.machineId,
      sessionId: session.id,
      title: `${session.title} needs approval`,
      body: event.data.slice(0, 280),
      level: "critical" as const,
      category: "approval-required" as const,
      link: { type: "session" as const, targetId: session.id }
    };
  }
  if (event.kind === "blocked") {
    return {
      machineId: session.machineId,
      sessionId: session.id,
      title: `${session.title} is blocked`,
      body: event.data.slice(0, 280),
      level: "warning" as const,
      category: "session-blocked" as const,
      link: { type: "session" as const, targetId: session.id }
    };
  }
  if (event.kind === "ready" || event.kind === "completed") {
    return {
      machineId: session.machineId,
      sessionId: session.id,
      title: `${session.title} is ready`,
      body: event.data.slice(0, 280),
      level: "success" as const,
      category: "session-ready" as const,
      link: { type: "session" as const, targetId: session.id }
    };
  }
  return undefined;
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function authTokenFromUrl(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined;
  const parsed = parse(requestUrl, true);
  const token = parsed.query.token;
  return typeof token === "string" ? token : undefined;
}

export function attachRealtime(server: HttpServer, store: BridgeStore): Connections {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const connections: Connections = {
    daemons: new Map(),
    subscribers: new Map()
  };

  wss.on("connection", (socket, request) => {
    const token = authTokenFromUrl(request.url);
    const parsed = parse(request.url ?? "", true);
    const role = parsed.query.role;
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;

    if (role === "daemon") {
      let machineId = "";
      socket.on("message", (buffer) => {
        const event = daemonEventSchema.parse(JSON.parse(buffer.toString()));
        if (event.type === "daemon.hello") {
          machineId = event.machineId;
          connections.daemons.set(machineId, socket);
          store.updateMachineOnline(machineId, true);
          return;
        }
        if (event.type === "machine.heartbeat") {
          machineId = event.machineId;
          connections.daemons.set(machineId, socket);
          store.upsertMachine({
            machineId: event.machineId,
            hostname: event.capabilities.hostname,
            capabilities: event.capabilities,
            powerPolicy: event.powerPolicy,
            online: true,
            daemonConnected: true
          });
          return;
        }
        if (event.type === "session.started") {
          store.upsertSession(event.session);
          store.addSessionEvent({
            id: randomUUID(),
            sessionId: event.session.id,
            kind: "status",
            data: "session started",
            at: Date.now(),
            meta: { status: event.session.status }
          });
          return;
        }
        if (event.type === "session.updated") {
          store.upsertSession(event.session);
          return;
        }
        if (event.type === "session.stopped") {
          store.stopSession(event.sessionId);
          const payload = {
            id: randomUUID(),
            sessionId: event.sessionId,
            kind: "status",
            data: "session stopped",
            at: Date.now()
          } satisfies SessionStreamEvent;
          store.addSessionEvent(payload);
          const subscribers = connections.subscribers.get(event.sessionId);
          subscribers?.forEach((client) => send(client, { type: "session.event", event: payload }));
          return;
        }
        if (event.type === "session.event") {
          store.addSessionEvent(event.event);
          const session = store.getSession(event.event.sessionId);
          const inboxItem = createInboxFromEvent(event.event, session);
          if (inboxItem) {
            store.addInboxItem(inboxItem);
          }
          const subscribers = connections.subscribers.get(event.event.sessionId);
          subscribers?.forEach((client) => send(client, { type: "session.event", event: event.event }));
        }
      });

      socket.on("close", () => {
        if (machineId) {
          connections.daemons.delete(machineId);
          const machine = store.updateMachineOnline(machineId, false);
          if (machine) {
            store.addInboxItem({
              machineId,
              title: `${machine.hostname} went offline`,
              body: "The daemon disconnected, so remote sessions may need a moment to recover.",
              level: "warning",
              category: "machine-offline",
              link: { type: "machine", targetId: machineId }
            });
          }
        }
      });

      return;
    }

    if (!originAllowed(origin)) {
      socket.close(1008, "origin not allowed");
      return;
    }

    if (!token || !store.getToken(token)) {
      socket.close(1008, "unauthorized");
      return;
    }

    socket.on("message", (buffer) => {
      const command = subscriberCommandSchema.parse(JSON.parse(buffer.toString()));
      if (command.type === "subscribe") {
        const subscribers = connections.subscribers.get(command.sessionId) ?? new Set<WebSocket>();
        subscribers.add(socket);
        connections.subscribers.set(command.sessionId, subscribers);
        store.markSessionViewed(command.sessionId);
        const session = store.getSession(command.sessionId);
        send(socket, {
          type: "session.snapshot",
          session,
          events: store.getSessionEvents(command.sessionId, command.lastEventId)
        });
        return;
      }

      if (command.type === "unsubscribe") {
        connections.subscribers.get(command.sessionId)?.delete(socket);
        return;
      }

      const session = store.getSession(command.sessionId);
      if (!session) {
        send(socket, { type: "error", message: `Unknown session ${command.sessionId}` });
        return;
      }
      const daemon = connections.daemons.get(session.machineId);
      if (!daemon) {
        send(socket, { type: "error", message: `Machine ${session.machineId} is offline` });
        return;
      }

      if (command.type === "input") {
        store.updateSessionOwner(command.sessionId, "remote");
        send(daemon, { type: "session.input", sessionId: command.sessionId, data: command.data });
        store.addSessionEvent({
          id: randomUUID(),
          sessionId: command.sessionId,
          kind: "input",
          data: command.data,
          at: Date.now()
        });
        return;
      }
      if (command.type === "resize") {
        store.updateSessionOwner(command.sessionId, "remote");
        send(daemon, {
          type: "session.resize",
          sessionId: command.sessionId,
          cols: command.cols,
          rows: command.rows
        });
        return;
      }
      if (command.type === "approval") {
        store.updateSessionOwner(command.sessionId, "remote");
        send(daemon, {
          type: "approval.respond",
          sessionId: command.sessionId,
          requestId: command.requestId,
          decision: command.decision
        });
      }
    });
  });

  return connections;
}

export function sendSessionStart(connections: Connections, session: SessionRecord, spec: import("@bridge/protocol").SessionSpec): void {
  const daemon = connections.daemons.get(session.machineId);
  if (!daemon) {
    return;
  }
  const payload = daemonCommandSchema.parse({
    type: "session.start",
    sessionId: session.id,
    spec
  });
  send(daemon, payload);
}

export function sendSessionStop(connections: Connections, session: SessionRecord): void {
  const daemon = connections.daemons.get(session.machineId);
  if (!daemon) {
    return;
  }
  send(daemon, daemonCommandSchema.parse({ type: "session.stop", sessionId: session.id }));
}
