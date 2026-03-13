import {
  inboxItemSchema,
  machineCapabilitiesSchema,
  machineRecordSchema,
  pairingCodeSchema,
  pairingRequestSchema,
  powerPolicySchema,
  sessionRecordSchema,
  sessionSpecSchema
} from "@bridge/protocol";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { originAllowed } from "./origin.js";
import { attachRealtime, sendSessionStart, sendSessionStop, type Connections } from "./realtime.js";
import { BridgeStore } from "./store.js";

function bearerToken(headers: Record<string, unknown>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
    return undefined;
  }
  return auth.slice("Bearer ".length);
}

export function createApp(store = new BridgeStore()) {
  const app = Fastify({ logger: false });
  let realtime: Connections | null = null;

  void app.register(cors, {
    origin(origin, callback) {
      callback(originAllowed(origin) ? null : new Error("Origin not allowed"), true);
    },
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "bypass-tunnel-reminder"]
  });

  app.addHook("onReady", async () => {
    realtime = attachRealtime(app.server, store);
  });

  app.decorateRequest("authToken", null);
  app.addHook("preHandler", async (request, reply) => {
    const publicRoutes = new Set([
      "/health",
      "/auth/pairings/request",
      "/auth/pairings/exchange",
      "/machines/register"
    ]);
    if (publicRoutes.has(request.url)) {
      return;
    }
    const token = bearerToken(request.headers as Record<string, unknown>);
    if (!token || !store.getToken(token)) {
      reply.code(401).send({ message: "Unauthorized" });
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/pairings/request", async (request) => {
    const body = pairingRequestSchema.parse(request.body ?? {});
    const pairing = store.createPairing(body.label);
    return {
      code: pairing.code,
      expiresAt: pairing.expiresAt
    };
  });

  app.post("/auth/pairings/exchange", async (request) => {
    const body = pairingCodeSchema.parse(request.body);
    return store.exchangePairing(body.code, body.label);
  });

  app.get("/machines", async () => store.listMachines());

  app.get("/machines/:machineId", async (request, reply) => {
    const { machineId } = request.params as { machineId: string };
    const machine = store.getMachine(machineId);
    if (!machine) {
      reply.code(404);
      return { message: "Machine not found" };
    }
    return machine;
  });

  app.post("/machines/register", async (request) => {
    const body = request.body as {
      machineId: string;
      hostname: string;
      capabilities: unknown;
      powerPolicy?: unknown;
    };
    const capabilities = machineCapabilitiesSchema.parse(body.capabilities);
    const powerPolicy = body.powerPolicy ? powerPolicySchema.parse(body.powerPolicy) : undefined;
    return store.upsertMachine({
      machineId: body.machineId,
      hostname: body.hostname,
      capabilities,
      powerPolicy,
      online: true
    });
  });

  app.put("/machines/:machineId/power-policy", async (request) => {
    const { machineId } = request.params as { machineId: string };
    const policy = powerPolicySchema.parse(request.body);
    return store.updatePowerPolicy(machineId, policy);
  });

  app.get("/sessions", async () => store.listSessions());

  app.get("/inbox", async () => store.listInbox());

  app.post("/inbox/:inboxItemId/read", async (request) => {
    const { inboxItemId } = request.params as { inboxItemId: string };
    return store.markInboxItemRead(inboxItemId);
  });

  app.get("/sessions/:sessionId/events", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = store.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { message: "Session not found" };
    }
    const after = (request.query as { after?: string }).after;
    return store.getSessionEvents(sessionId, after);
  });

  app.post("/sessions/:sessionId/view", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = store.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { message: "Session not found" };
    }
    return store.markSessionViewed(sessionId);
  });

  app.post("/sessions/:sessionId/owner", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = store.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { message: "Session not found" };
    }
    const body = request.body as { owner?: "local" | "remote" | "shared" | "unknown" };
    if (!body.owner) {
      reply.code(400);
      return { message: "owner is required" };
    }
    return store.updateSessionOwner(sessionId, body.owner);
  });

  app.post("/machines/:machineId/sessions", async (request, reply) => {
    const { machineId } = request.params as { machineId: string };
    const machine = store.getMachine(machineId);
    if (!machine) {
      reply.code(404);
      return { message: "Machine not found" };
    }
    const spec = sessionSpecSchema.parse(request.body);
    const session = store.createSession(machineId, spec);
    sendSessionStart(realtime!, session, spec);
    return session;
  });

  app.post("/sessions/:sessionId/stop", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = store.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { message: "Session not found" };
    }
    sendSessionStop(realtime!, session);
    return store.stopSession(sessionId);
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    reply.code(400).send({ message });
  });

  return { app, store };
}

export const schemas = {
  machine: machineRecordSchema,
  session: sessionRecordSchema,
  inbox: inboxItemSchema
};
