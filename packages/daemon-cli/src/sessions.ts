import { type AgentKind, type SessionRecord, type SessionSpec, type SessionStreamEvent } from "@bridge/protocol";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { spawn as spawnPty, type IPty } from "node-pty";

type ManagedSession = SessionRecord & {
  child?: ChildProcess;
  pty?: IPty;
  terminalBackend?: "node-pty" | "python-pty";
  pendingApprovals: Map<string, "pending">;
};

type SessionManagerEvents = {
  "session.started": [SessionRecord];
  "session.updated": [SessionRecord];
  "session.stopped": [string];
  "session.event": [SessionStreamEvent];
};

function commandForAgent(agent: AgentKind): string {
  return agent;
}

function normalizeShellPath(shell: string): string {
  if (shell.trim().length === 0) {
    return process.env.SHELL ?? "/bin/sh";
  }
  return shell;
}

function interactiveProgramForAgent(agent: AgentKind): { command: string; args: string[] } {
  return { command: commandForAgent(agent), args: [] };
}

function createSpawnEnv(overrides?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return {
    ...env,
    ...(overrides ?? {})
  };
}

function createEvent(sessionId: string, kind: SessionStreamEvent["kind"], data: string, meta?: SessionStreamEvent["meta"]): SessionStreamEvent {
  return {
    id: randomUUID(),
    sessionId,
    kind,
    data,
    at: Date.now(),
    meta
  };
}

function summarizeOutput(data: string): Partial<Pick<SessionRecord, "status" | "attention">> & {
  eventKind?: SessionStreamEvent["kind"];
} {
  if (/(approve|approval|permission)/i.test(data)) {
    return {
      status: "approval-needed",
      attention: "urgent"
    };
  }
  if (/(blocked|failed|error:|fix required)/i.test(data)) {
    return {
      status: "blocked",
      attention: "urgent",
      eventKind: "blocked"
    };
  }
  if (/(done|completed|finished|ready for review|all set)/i.test(data)) {
    return {
      status: "completed",
      attention: "needs-review",
      eventKind: "completed"
    };
  }
  if (/(waiting|standing by|awaiting|ready)/i.test(data)) {
    return {
      status: "waiting",
      attention: "needs-review",
      eventKind: "ready"
    };
  }
  return {
    status: "running",
    attention: "activity"
  };
}

function looksLikeCodexTrustPrompt(data: string): boolean {
  const compact = data.replace(/\s+/g, "");
  return /Doyoutrustthecontentsofthisdirectory\?/i.test(compact) && /Pressentertocontinue/i.test(compact);
}

function normalizeTerminalInput(data: string): string {
  return data.replace(/\r?\n/g, "\r");
}

function createPythonPtyProgram(cols: number, rows: number): string {
  return [
    "import fcntl, json, os, pty, select, signal, struct, sys, termios",
    `cols=${cols}`,
    `rows=${rows}`,
    "argv = json.loads(os.environ['BRIDGE_ARGV'])",
    "pid, fd = pty.fork()",
    "if pid == 0:",
    "    os.execvpe(argv[0], argv, os.environ)",
    "else:",
    "    def _winch(signum, frame):",
    "        winsz = struct.pack('HHHH', rows, cols, 0, 0)",
    "        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsz)",
    "    _winch(None, None)",
    "    signal.signal(signal.SIGWINCH, _winch)",
    "    while True:",
    "        try:",
    "            readers, _, _ = select.select([fd, sys.stdin.fileno()], [], [])",
    "            if fd in readers:",
    "                data = os.read(fd, 1024)",
    "                if not data:",
    "                    break",
    "                os.write(sys.stdout.fileno(), data)",
    "            if sys.stdin.fileno() in readers:",
    "                data = os.read(sys.stdin.fileno(), 1024)",
    "                if not data:",
    "                    break",
    "                os.write(fd, data)",
    "        except OSError:",
    "            break"
  ].join("\n");
}

export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private sessions = new Map<string, ManagedSession>();
  private readinessTimers = new Map<string, NodeJS.Timeout>();
  private trustPromptBuffers = new Map<string, string>();
  private trustPromptAccepted = new Set<string>();

  private stripAnsi(data: string): string {
    return data
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b[@-_]/g, "");
  }

  private markAgentReady(sessionId: string, reason = "agent session is interactive"): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.runtime !== "agent-session") {
      return;
    }
    if (session.status === "waiting" || session.status === "completed" || session.status === "stopped") {
      return;
    }
    session.status = "waiting";
    session.interactive = true;
    session.attention = "needs-review";
    session.updatedAt = Date.now();
    session.lastEventAt = session.updatedAt;
    this.emit(
      "session.event",
      createEvent(sessionId, "ready", reason, {
        backend: session.terminalBackend
      })
    );
    this.emitSessionUpdated(sessionId);
  }

  private emitSessionUpdated(sessionId: string): void {
    const session = this.get(sessionId);
    if (session) {
      this.emit("session.updated", session);
    }
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()].map(({ child: _child, pty: _pty, pendingApprovals: _pendingApprovals, ...session }) => session);
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.list().find((session) => session.id === sessionId);
  }

  create(machineId: string, sessionId: string, spec: SessionSpec): SessionRecord {
    const now = Date.now();
    const session: ManagedSession = {
      id: sessionId,
      machineId,
      runtime: spec.runtime,
      title: spec.runtime === "agent-session" ? `${spec.agent} session` : spec.profile ?? "terminal",
      status: "starting",
      attention: "activity",
      owner: spec.startedBy === "cli" ? "local" : spec.startedBy === "web" || spec.startedBy === "pwa" ? "remote" : "shared",
      cwd: spec.cwd,
      agent: spec.runtime === "agent-session" ? spec.agent : undefined,
      shell: spec.runtime === "terminal-session" ? spec.shell ?? process.env.SHELL ?? "/bin/sh" : undefined,
      terminalBackend: undefined,
      startedBy: spec.startedBy,
      interactive: spec.runtime === "terminal-session",
      lastEventAt: now,
      lastViewedAt: spec.startedBy === "web" || spec.startedBy === "pwa" ? now : undefined,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
      pendingApprovals: new Map()
    };

    this.sessions.set(session.id, session);

    if (spec.runtime === "agent-session") {
      this.createAgentRuntime(session, spec);
    } else {
      this.createTerminalRuntime(session, spec);
    }

    session.status = "running";
    if (spec.runtime === "agent-session") {
      this.scheduleAgentReadyFallback(session.id);
    }
    this.emit("session.started", this.get(session.id)!);

    return this.get(session.id)!;
  }

  private clearReadinessTimer(sessionId: string): void {
    const timer = this.readinessTimers.get(sessionId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.readinessTimers.delete(sessionId);
  }

  private scheduleAgentReadyFallback(sessionId: string): void {
    this.clearReadinessTimer(sessionId);
    const timer = setTimeout(() => {
      this.readinessTimers.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (!session || session.runtime !== "agent-session") {
        return;
      }
      if (session.status !== "running" && session.status !== "starting") {
        return;
      }
      this.markAgentReady(sessionId);
    }, 900);
    this.readinessTimers.set(sessionId, timer);
  }

  private createAgentRuntime(session: ManagedSession, spec: Extract<SessionSpec, { runtime: "agent-session" }>): void {
    const program = interactiveProgramForAgent(spec.agent);
    const cols = 120;
    const rows = 32;
    try {
      session.pty = spawnPty(program.command, program.args, {
        cwd: spec.cwd,
        env: createSpawnEnv({
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          ...spec.env
        }),
        cols,
        rows,
        name: "xterm-256color"
      });
      session.terminalBackend = "node-pty";
      session.pty.onData((data) => {
        this.handleChunk(session.id, "stdout", data);
      });
      session.pty.onExit(({ exitCode, signal }) => {
        this.clearReadinessTimer(session.id);
        const current = this.sessions.get(session.id);
        if (!current) {
          return;
        }
        current.status = "stopped";
        current.interactive = false;
        current.attention = "idle";
        current.updatedAt = Date.now();
        this.emit("session.event", createEvent(session.id, "status", "process exited", { code: exitCode, signal, backend: "node-pty" }));
        this.emitSessionUpdated(session.id);
        this.emit("session.stopped", session.id);
      });
      this.emit("session.event", createEvent(session.id, "system", "agent backend: node-pty", { backend: "node-pty", command: program.command }));
      return;
    } catch (error) {
      this.emit(
        "session.event",
        createEvent(session.id, "system", "agent pty launch failed; falling back to python pty", {
          backend: "node-pty",
          command: program.command,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }

    session.child = spawn("python3", ["-c", createPythonPtyProgram(cols, rows)], {
      cwd: spec.cwd,
      env: createSpawnEnv({
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...spec.env,
        BRIDGE_ARGV: JSON.stringify([program.command, ...program.args])
      }),
      stdio: "pipe"
    });
    session.terminalBackend = "python-pty";
    session.child.stdout?.on("data", (chunk) => {
      this.handleChunk(session.id, "stdout", chunk.toString());
    });
    session.child.stderr?.on("data", (chunk) => {
      this.handleChunk(session.id, "stderr", chunk.toString());
    });
    session.child.on("exit", (code, signal) => {
      this.clearReadinessTimer(session.id);
      const current = this.sessions.get(session.id);
      if (!current) {
        return;
      }
      current.status = "stopped";
      current.interactive = false;
      current.attention = "idle";
      current.updatedAt = Date.now();
      this.emit("session.event", createEvent(session.id, "status", "process exited", { code, signal, backend: "python-pty" }));
      this.emitSessionUpdated(session.id);
      this.emit("session.stopped", session.id);
    });
    this.emit("session.event", createEvent(session.id, "system", "agent backend: python-pty", { backend: "python-pty", command: program.command }));
  }

  private createTerminalRuntime(session: ManagedSession, spec: Extract<SessionSpec, { runtime: "terminal-session" }>): void {
    const shell = normalizeShellPath(spec.shell ?? process.env.SHELL ?? "/bin/sh");
    try {
      session.pty = spawnPty(shell, [], {
        cwd: spec.cwd,
        env: createSpawnEnv(spec.env),
        cols: 120,
        rows: 32,
        name: "xterm-color"
      });
      session.terminalBackend = "node-pty";
      session.pty.onData((data) => {
        this.handleChunk(session.id, "stdout", data);
      });
      session.pty.onExit(({ exitCode, signal }) => {
        this.clearReadinessTimer(session.id);
        const current = this.sessions.get(session.id);
        if (!current) {
          return;
        }
        current.status = "stopped";
        current.interactive = false;
        current.attention = "idle";
        current.updatedAt = Date.now();
        this.emit("session.event", createEvent(session.id, "status", `pty exited`, { code: exitCode, signal, backend: "node-pty" }));
        this.emitSessionUpdated(session.id);
        this.emit("session.stopped", session.id);
      });
      session.shell = shell;
      this.emit("session.event", createEvent(session.id, "system", "terminal backend: node-pty", { backend: "node-pty", shell }));
      return;
    } catch (error) {
      this.emit(
        "session.event",
        createEvent(
          session.id,
          "system",
          "node-pty launch failed; falling back to python pty",
          { backend: "node-pty", shell, error: error instanceof Error ? error.message : String(error) }
        )
      );
    }

    const loginArgs = /(?:^|\/)(?:bash|zsh)$/.test(shell) ? ["-l"] : [];
    session.child = spawn(
        "python3",
        [
          "-c",
          createPythonPtyProgram(120, 32)
        ],
      {
        cwd: spec.cwd,
        env: createSpawnEnv({
          ...spec.env,
          BRIDGE_ARGV: JSON.stringify([shell, ...loginArgs])
        }),
        stdio: "pipe"
      }
    );
    session.terminalBackend = "python-pty";
    session.shell = shell;
    session.child.stdout?.on("data", (chunk) => {
      this.handleChunk(session.id, "stdout", chunk.toString());
    });
    session.child.stderr?.on("data", (chunk) => {
      this.handleChunk(session.id, "stderr", chunk.toString());
    });
    session.child.on("exit", (code, signal) => {
      this.clearReadinessTimer(session.id);
      const current = this.sessions.get(session.id);
      if (!current) {
        return;
      }
      current.status = "stopped";
      current.interactive = false;
      current.attention = "idle";
      current.updatedAt = Date.now();
      this.emit("session.event", createEvent(session.id, "status", `pty exited`, { code, signal, backend: "python-pty" }));
      this.emitSessionUpdated(session.id);
      this.emit("session.stopped", session.id);
    });
    this.emit("session.event", createEvent(session.id, "system", "terminal backend: python-pty", { backend: "python-pty", shell }));
  }

  private updateTerminalMetadata(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.updatedAt = Date.now();
    session.lastEventAt = session.updatedAt;
    this.emitSessionUpdated(sessionId);
  }

  private handleChunk(sessionId: string, kind: "stdout" | "stderr", data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    const plainText = this.stripAnsi(data);
    if (session.runtime === "agent-session" && kind === "stdout") {
      const previous = this.trustPromptBuffers.get(sessionId) ?? "";
      const combined = `${previous}${plainText}`.slice(-1200);
      this.trustPromptBuffers.set(sessionId, combined);
      if (!this.trustPromptAccepted.has(sessionId) && looksLikeCodexTrustPrompt(combined)) {
        this.trustPromptAccepted.add(sessionId);
        this.emit(
          "session.event",
          createEvent(
            sessionId,
            "system",
            "Codex asked whether to trust this workspace. Bridge accepted the default continue option so the session can actually start."
          )
        );
        if (session.pty) {
          session.pty.write("\r");
        } else if (session.child?.stdin) {
          session.child.stdin.write("\r");
        }
      }
    }
    if (session.runtime === "agent-session" && kind === "stdout" && looksLikeCodexTrustPrompt(plainText)) {
      this.emit(
        "session.event",
        createEvent(
          sessionId,
          "system",
          "Codex asked whether to trust this workspace. Bridge accepted the default continue option so the session can actually start."
        )
      );
      if (session.pty) {
        session.pty.write("\r");
      } else if (session.child?.stdin) {
        session.child.stdin.write("\r");
      }
    }
    if (session.runtime === "agent-session" && kind === "stdout" && data.trim().length > 0) {
      this.clearReadinessTimer(sessionId);
      if (!looksLikeCodexTrustPrompt(this.trustPromptBuffers.get(sessionId) ?? plainText)) {
        this.markAgentReady(sessionId, "agent output detected");
      }
    }
    session.updatedAt = Date.now();
    session.lastEventAt = session.updatedAt;
    this.emit("session.event", createEvent(sessionId, kind, data));
    if (session.runtime === "agent-session" && /(approve|approval|permission)/i.test(data)) {
      const requestId = randomUUID();
      session.pendingApprovals.set(requestId, "pending");
      session.status = "approval-needed";
      session.attention = "urgent";
      this.emit(
        "session.event",
        createEvent(sessionId, "approval", data, {
          requestId,
          state: "pending"
        })
      );
      this.emitSessionUpdated(sessionId);
      return;
    }
    const summary = summarizeOutput(data);
    if (!(session.status === "waiting" && summary.status === "running")) {
      session.status = summary.status ?? session.status;
    }
    if (session.runtime === "agent-session") {
      if (session.status === "running" || session.status === "starting") {
        session.interactive = false;
      }
      if (session.status === "waiting" || summary.eventKind === "ready") {
        session.interactive = true;
      }
      if (session.status === "blocked" || session.status === "completed" || session.status === "stopped") {
        session.interactive = false;
      }
    }
    session.attention = summary.attention ?? session.attention;
    if (summary.eventKind) {
      this.emit("session.event", createEvent(sessionId, summary.eventKind, data));
    }
    this.emitSessionUpdated(sessionId);
  }

  input(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    if (session.pty) {
      session.pty.write(session.runtime === "terminal-session" ? normalizeTerminalInput(data) : data);
    } else if (session.child?.stdin) {
      session.child.stdin.write(session.runtime === "terminal-session" ? normalizeTerminalInput(data) : data);
    } else {
      throw new Error(`Session ${sessionId} is not writable`);
    }
    this.updateTerminalMetadata(sessionId);
    session.owner = "remote";
    this.emit("session.event", createEvent(sessionId, "input", data));
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    if (session.pty) {
      session.pty.resize(cols, rows);
    } else if (session.child?.stdin && session.runtime === "terminal-session") {
      session.child.stdin.write(`stty cols ${cols} rows ${rows}\n`);
    }
    this.updateTerminalMetadata(sessionId);
    session.owner = "remote";
    this.emit(
      "session.event",
      createEvent(sessionId, "system", `resized to ${cols}x${rows}`, {
        cols,
        rows,
        backend: session.terminalBackend
      })
    );
  }

  approve(sessionId: string, requestId: string, decision: "approve" | "deny"): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    if (!session.pendingApprovals.has(requestId)) {
      throw new Error(`Unknown approval request ${requestId}`);
    }
    session.pendingApprovals.delete(requestId);
    this.input(sessionId, decision === "approve" ? "y\n" : "n\n");
    session.status = decision === "approve" ? "running" : "blocked";
    session.interactive = false;
    session.attention = decision === "approve" ? "activity" : "urgent";
    this.emit(
      "session.event",
      createEvent(sessionId, "approval", `approval ${decision}`, {
        requestId,
        state: decision
      })
    );
    this.emitSessionUpdated(sessionId);
  }

  stop(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    this.clearReadinessTimer(sessionId);
    this.trustPromptBuffers.delete(sessionId);
    this.trustPromptAccepted.delete(sessionId);
    session.pty?.kill();
    session.child?.kill("SIGTERM");
    session.status = "stopped";
    session.interactive = false;
    session.attention = "idle";
    session.updatedAt = Date.now();
    session.lastEventAt = session.updatedAt;
    this.emitSessionUpdated(sessionId);
    return this.get(sessionId)!;
  }
}
