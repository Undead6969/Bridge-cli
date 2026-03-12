import { z } from "zod";

export const installedCliSchema = z.enum(["codex", "claude", "gemini"]);
export type InstalledCli = z.infer<typeof installedCliSchema>;

export const cliCapabilitySchema = z.object({
  installed: z.boolean(),
  executablePath: z.string().optional(),
  version: z.string().optional(),
  launchable: z.boolean(),
  supportsRemoteWrapper: z.boolean(),
  supportsSessionControl: z.boolean(),
  detectionError: z.string().optional()
});
export type CliCapability = z.infer<typeof cliCapabilitySchema>;

export const powerCapabilitySchema = z.object({
  canPreventSleep: z.boolean(),
  canSleep: z.boolean(),
  canShutdown: z.boolean(),
  platform: z.enum(["macos", "linux", "windows", "android", "unknown"])
});
export type PowerCapability = z.infer<typeof powerCapabilitySchema>;

export const terminalCapabilitySchema = z.object({
  shellPath: z.string().optional(),
  supportsInteractivePty: z.boolean()
});
export type TerminalCapability = z.infer<typeof terminalCapabilitySchema>;

export const machineCapabilitiesSchema = z.object({
  machineId: z.string(),
  hostname: z.string(),
  os: z.object({
    platform: z.string(),
    release: z.string(),
    arch: z.string()
  }),
  cli: z.object({
    codex: cliCapabilitySchema,
    claude: cliCapabilitySchema,
    gemini: cliCapabilitySchema
  }),
  power: powerCapabilitySchema,
  terminal: terminalCapabilitySchema,
  daemonVersion: z.string(),
  reportedAt: z.number()
});
export type MachineCapabilities = z.infer<typeof machineCapabilitiesSchema>;

export const powerPolicySchema = z.object({
  mode: z.enum(["normal", "stay-awake-during-activity", "always-awake"]),
  idleSleepAfterSeconds: z.number().int().positive().optional(),
  idleShutdownAfterSeconds: z.number().int().positive().optional(),
  wakeLockScope: z.enum(["any-session", "agent-only", "terminal-only"])
});
export type PowerPolicy = z.infer<typeof powerPolicySchema>;

export const runtimeKindSchema = z.enum(["agent-session", "terminal-session"]);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export const agentKindSchema = z.enum(["codex", "claude", "gemini"]);
export type AgentKind = z.infer<typeof agentKindSchema>;

export const startedBySchema = z.enum(["web", "pwa", "cli", "bridge"]);
export type StartedBy = z.infer<typeof startedBySchema>;

export const agentSessionSpecSchema = z.object({
  runtime: z.literal("agent-session"),
  agent: agentKindSchema,
  cwd: z.string(),
  env: z.record(z.string()).optional(),
  startedBy: startedBySchema
});
export type AgentSessionSpec = z.infer<typeof agentSessionSpecSchema>;

export const terminalSessionSpecSchema = z.object({
  runtime: z.literal("terminal-session"),
  shell: z.string().optional(),
  cwd: z.string(),
  env: z.record(z.string()).optional(),
  profile: z.string().optional(),
  startedBy: startedBySchema
});
export type TerminalSessionSpec = z.infer<typeof terminalSessionSpecSchema>;

export const sessionSpecSchema = z.discriminatedUnion("runtime", [
  agentSessionSpecSchema,
  terminalSessionSpecSchema
]);
export type SessionSpec = z.infer<typeof sessionSpecSchema>;

export const sessionRecordSchema = z.object({
  id: z.string(),
  machineId: z.string(),
  runtime: runtimeKindSchema,
  title: z.string(),
  status: z.enum(["starting", "running", "stopped", "errored"]),
  cwd: z.string(),
  agent: agentKindSchema.optional(),
  shell: z.string().optional(),
  terminalBackend: z.enum(["node-pty", "python-pty"]).optional(),
  startedBy: startedBySchema,
  createdAt: z.number(),
  updatedAt: z.number()
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const sessionStreamEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: z.enum(["stdout", "stderr", "status", "approval", "input", "system"]),
  data: z.string(),
  at: z.number(),
  meta: z.record(z.string(), z.unknown()).optional()
});
export type SessionStreamEvent = z.infer<typeof sessionStreamEventSchema>;

export const machineRecordSchema = z.object({
  machineId: z.string(),
  hostname: z.string(),
  capabilities: machineCapabilitiesSchema,
  powerPolicy: powerPolicySchema,
  online: z.boolean(),
  updatedAt: z.number()
});
export type MachineRecord = z.infer<typeof machineRecordSchema>;

export const terminalChunkSchema = z.object({
  sessionId: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  data: z.string(),
  at: z.number()
});
export type TerminalChunk = z.infer<typeof terminalChunkSchema>;

export const agentEventSchema = z.object({
  sessionId: z.string(),
  type: z.enum(["message", "status", "approval", "error"]),
  payload: z.unknown(),
  at: z.number()
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const pairingRequestSchema = z.object({
  label: z.string().min(1).max(80).optional()
});
export type PairingRequest = z.infer<typeof pairingRequestSchema>;

export const pairingCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  label: z.string().min(1).max(80).optional()
});
export type PairingCode = z.infer<typeof pairingCodeSchema>;

export const authTokenSchema = z.object({
  token: z.string(),
  label: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number()
});
export type AuthToken = z.infer<typeof authTokenSchema>;

export const daemonCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.start"),
    sessionId: z.string(),
    spec: sessionSpecSchema
  }),
  z.object({
    type: z.literal("session.stop"),
    sessionId: z.string()
  }),
  z.object({
    type: z.literal("session.input"),
    sessionId: z.string(),
    data: z.string()
  }),
  z.object({
    type: z.literal("session.resize"),
    sessionId: z.string(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
  }),
  z.object({
    type: z.literal("approval.respond"),
    sessionId: z.string(),
    requestId: z.string(),
    decision: z.enum(["approve", "deny"])
  })
]);
export type DaemonCommand = z.infer<typeof daemonCommandSchema>;

export const daemonEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("daemon.hello"),
    machineId: z.string()
  }),
  z.object({
    type: z.literal("machine.heartbeat"),
    machineId: z.string(),
    capabilities: machineCapabilitiesSchema,
    powerPolicy: powerPolicySchema.optional()
  }),
  z.object({
    type: z.literal("session.started"),
    session: sessionRecordSchema
  }),
  z.object({
    type: z.literal("session.stopped"),
    sessionId: z.string()
  }),
  z.object({
    type: z.literal("session.event"),
    event: sessionStreamEventSchema
  })
]);
export type DaemonEvent = z.infer<typeof daemonEventSchema>;

export const subscriberCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    sessionId: z.string(),
    lastEventId: z.string().optional()
  }),
  z.object({
    type: z.literal("unsubscribe"),
    sessionId: z.string()
  }),
  z.object({
    type: z.literal("input"),
    sessionId: z.string(),
    data: z.string()
  }),
  z.object({
    type: z.literal("resize"),
    sessionId: z.string(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
  }),
  z.object({
    type: z.literal("approval"),
    sessionId: z.string(),
    requestId: z.string(),
    decision: z.enum(["approve", "deny"])
  })
]);
export type SubscriberCommand = z.infer<typeof subscriberCommandSchema>;

export const defaultPowerPolicy: PowerPolicy = {
  mode: "stay-awake-during-activity",
  wakeLockScope: "any-session"
};
