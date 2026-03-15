import { z } from "zod";

export const installedCliSchema = z.enum(["codex", "claude", "gemini"]);
export type InstalledCli = z.infer<typeof installedCliSchema>;

export const runtimeNameSchema = z.enum(["codex", "claude", "gemini", "terminal"]);
export type RuntimeName = z.infer<typeof runtimeNameSchema>;

export const runtimeAuthStateSchema = z.enum(["unknown", "authenticated", "unauthenticated", "not-installed"]);
export type RuntimeAuthState = z.infer<typeof runtimeAuthStateSchema>;

export const gatewayTypeSchema = z.enum(["web", "telegram", "whatsapp"]);
export type GatewayType = z.infer<typeof gatewayTypeSchema>;

export const gatewayStatusSchema = z.enum(["disabled", "configured", "linked", "active", "errored"]);
export type GatewayStatus = z.infer<typeof gatewayStatusSchema>;

export const cliCapabilitySchema = z.object({
  installed: z.boolean(),
  executablePath: z.string().optional(),
  version: z.string().optional(),
  launchable: z.boolean(),
  supportsRemoteWrapper: z.boolean(),
  supportsSessionControl: z.boolean(),
  authState: runtimeAuthStateSchema.default("unknown"),
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
  status: z.enum(["starting", "running", "waiting", "blocked", "approval-needed", "completed", "stopped", "errored", "offline"]),
  attention: z.enum(["idle", "activity", "needs-review", "urgent"]).default("idle"),
  owner: z.enum(["local", "remote", "shared", "unknown"]).default("unknown"),
  cwd: z.string(),
  agent: agentKindSchema.optional(),
  shell: z.string().optional(),
  terminalBackend: z.enum(["node-pty", "python-pty"]).optional(),
  interactive: z.boolean().default(false),
  startedBy: startedBySchema,
  lastEventAt: z.number().optional(),
  lastViewedAt: z.number().optional(),
  unreadCount: z.number().int().nonnegative().default(0),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const sessionStreamEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: z.enum(["stdout", "stderr", "status", "approval", "input", "system", "ready", "blocked", "completed"]),
  data: z.string(),
  at: z.number(),
  meta: z.record(z.string(), z.unknown()).optional()
});
export type SessionStreamEvent = z.infer<typeof sessionStreamEventSchema>;

export const inboxItemSchema = z.object({
  id: z.string(),
  machineId: z.string().optional(),
  sessionId: z.string().optional(),
  title: z.string(),
  body: z.string(),
  level: z.enum(["info", "success", "warning", "critical"]),
  category: z.enum(["session-ready", "approval-required", "session-blocked", "machine-offline", "machine-online", "server"]),
  readAt: z.number().optional(),
  createdAt: z.number(),
  link: z
    .object({
      type: z.enum(["session", "machine", "settings"]),
      targetId: z.string().optional()
    })
    .optional()
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

export const machineRecordSchema = z.object({
  machineId: z.string(),
  hostname: z.string(),
  capabilities: machineCapabilitiesSchema,
  powerPolicy: powerPolicySchema,
  online: z.boolean(),
  daemonConnected: z.boolean().optional(),
  updatedAt: z.number()
});
export type MachineRecord = z.infer<typeof machineRecordSchema>;

export const ownerRecordSchema = z.object({
  ownerId: z.string(),
  displayLabel: z.string(),
  defaultRuntime: runtimeNameSchema,
  primaryGateway: gatewayTypeSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  migrationVersion: z.number().int().nonnegative().default(1),
  migrationNotes: z.array(z.string()).default([])
});
export type OwnerRecord = z.infer<typeof ownerRecordSchema>;

export const machineSetupRecordSchema = z.object({
  machineId: z.string(),
  hostname: z.string(),
  ownerId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  migrationSource: z.string().optional()
});
export type MachineSetupRecord = z.infer<typeof machineSetupRecordSchema>;

export const runtimeStatusRecordSchema = z.object({
  runtime: runtimeNameSchema,
  installed: z.boolean(),
  launchable: z.boolean(),
  authState: runtimeAuthStateSchema,
  selected: z.boolean().default(false),
  health: z.enum(["unknown", "healthy", "degraded", "broken"]).default("unknown"),
  executablePath: z.string().optional(),
  version: z.string().optional(),
  supportsRemoteWrapper: z.boolean().optional(),
  supportsSessionControl: z.boolean().optional(),
  lastValidatedAt: z.number(),
  notes: z.array(z.string()).default([])
});
export type RuntimeStatusRecord = z.infer<typeof runtimeStatusRecordSchema>;

export const runtimesStateSchema = z.object({
  ownerId: z.string(),
  defaultRuntime: runtimeNameSchema,
  runtimes: z.object({
    codex: runtimeStatusRecordSchema,
    claude: runtimeStatusRecordSchema,
    gemini: runtimeStatusRecordSchema,
    terminal: runtimeStatusRecordSchema
  })
});
export type RuntimesState = z.infer<typeof runtimesStateSchema>;

export const gatewayIdentityRecordSchema = z.object({
  id: z.string(),
  label: z.string(),
  linkedAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({})
});
export type GatewayIdentityRecord = z.infer<typeof gatewayIdentityRecordSchema>;

export const gatewayRecordSchema = z.object({
  type: gatewayTypeSchema,
  enabled: z.boolean(),
  status: gatewayStatusSchema,
  isPrimary: z.boolean().default(false),
  linkedIdentities: z.array(gatewayIdentityRecordSchema).default([]),
  configPath: z.string().optional(),
  helperCommand: z.string().optional(),
  lastError: z.string().optional(),
  lastValidatedAt: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});
export type GatewayRecord = z.infer<typeof gatewayRecordSchema>;

export const gatewaysStateSchema = z.object({
  ownerId: z.string(),
  primaryGateway: gatewayTypeSchema,
  gateways: z.object({
    web: gatewayRecordSchema,
    telegram: gatewayRecordSchema,
    whatsapp: gatewayRecordSchema
  })
});
export type GatewaysState = z.infer<typeof gatewaysStateSchema>;

export const doctorCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail", "info"]),
  summary: z.string(),
  fix: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional()
});
export type DoctorCheck = z.infer<typeof doctorCheckSchema>;

export const doctorReportSchema = z.object({
  ok: z.boolean(),
  owner: ownerRecordSchema.nullable(),
  machine: machineSetupRecordSchema.nullable(),
  runtimes: runtimesStateSchema.nullable(),
  gateways: gatewaysStateSchema.nullable(),
  checks: z.array(doctorCheckSchema),
  generatedAt: z.number()
});
export type DoctorReport = z.infer<typeof doctorReportSchema>;

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
    type: z.literal("session.updated"),
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

export const inboundGatewayCommandSchema = z.object({
  id: z.string(),
  gateway: gatewayTypeSchema,
  ownerId: z.string(),
  machineId: z.string(),
  workspace: z.string().optional(),
  sessionId: z.string().optional(),
  runtime: runtimeNameSchema.optional(),
  command: z.enum(["launch-session", "send-input", "stop-session", "select-workspace", "approve", "deny", "pair-web"]),
  input: z.string().optional(),
  createdAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({})
});
export type InboundGatewayCommand = z.infer<typeof inboundGatewayCommandSchema>;

export const outboundGatewayEventSchema = z.object({
  id: z.string(),
  gateway: gatewayTypeSchema,
  targetIdentityId: z.string(),
  ownerId: z.string(),
  machineId: z.string().optional(),
  sessionId: z.string().optional(),
  kind: z.enum(["session-ready", "session-blocked", "session-output", "approval-needed", "machine-offline", "gateway-link"]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.number()
});
export type OutboundGatewayEvent = z.infer<typeof outboundGatewayEventSchema>;

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
