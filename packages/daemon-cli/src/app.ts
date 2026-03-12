import { defaultPowerPolicy, powerPolicySchema, sessionSpecSchema, type MachineCapabilities } from "@bridge/protocol";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { detectMachineCapabilities } from "./capabilities.js";
import { WakeLockManager } from "./power.js";
import { DaemonRelay } from "./relay.js";
import { SessionManager } from "./sessions.js";

export async function createDaemonApp(machineId = "local-machine", serverUrl = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:8787") {
  const app = Fastify({ logger: false });
  let capabilities: MachineCapabilities = await detectMachineCapabilities(machineId);
  const sessions = new SessionManager();
  const wakeLock = new WakeLockManager();
  wakeLock.updatePolicy(defaultPowerPolicy);
  const relay = new DaemonRelay({
    serverUrl,
    machineId,
    capabilities,
    getPowerPolicy: () => wakeLock.getPolicy(),
    sessions
  });

  sessions.on("session.started", () => wakeLock.onSessionStarted());
  sessions.on("session.stopped", () => wakeLock.onSessionStopped());

  app.get("/machine/capabilities", async () => capabilities);
  app.post("/machine/capabilities/refresh", async () => {
    capabilities = await detectMachineCapabilities(machineId);
    return capabilities;
  });
  app.get("/sessions", async () => sessions.list());
  app.get("/power-policy", async () => wakeLock.getPolicy());

  app.post("/sessions/agent", async (request) => {
    const spec = sessionSpecSchema.parse(request.body);
    if (spec.runtime !== "agent-session") {
      throw new Error("Expected an agent session spec");
    }
    return sessions.create(machineId, randomUUID(), spec);
  });

  app.post("/sessions/terminal", async (request) => {
    const spec = sessionSpecSchema.parse(request.body);
    if (spec.runtime !== "terminal-session") {
      throw new Error("Expected a terminal session spec");
    }
    return sessions.create(machineId, randomUUID(), spec);
  });

  app.post("/sessions/:sessionId/input", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { data: string };
    sessions.input(sessionId, body.data);
    return { ok: true };
  });

  app.post("/sessions/:sessionId/resize", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { cols: number; rows: number };
    sessions.resize(sessionId, body.cols, body.rows);
    return { ok: true };
  });

  app.post("/sessions/:sessionId/approval", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { requestId: string; decision: "approve" | "deny" };
    sessions.approve(sessionId, body.requestId, body.decision);
    return { ok: true };
  });

  app.post("/sessions/:sessionId/stop", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return sessions.stop(sessionId);
  });

  app.put("/power-policy", async (request) => {
    return wakeLock.updatePolicy(powerPolicySchema.parse(request.body));
  });

  return { app, relay, wakeLock };
}
