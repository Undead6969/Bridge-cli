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

function normalizeTerminalInput(data: string): string {
  return data.replace(/\r?\n/g, "\r");
}

export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private sessions = new Map<string, ManagedSession>();

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
      lastEventAt: now,
      lastViewedAt: spec.startedBy === "web" || spec.startedBy === "pwa" ? now : undefined,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
      pendingApprovals: new Map()
    };

    if (spec.runtime === "agent-session") {
      this.createAgentRuntime(session, spec);
    } else {
      this.createTerminalRuntime(session, spec);
    }

    session.status = "running";
    this.sessions.set(session.id, session);
    this.emit("session.started", this.get(session.id)!);

    return this.get(session.id)!;
  }

  private createAgentRuntime(session: ManagedSession, spec: Extract<SessionSpec, { runtime: "agent-session" }>): void {
    const program = interactiveProgramForAgent(spec.agent);
    try {
      session.pty = spawnPty(program.command, program.args, {
        cwd: spec.cwd,
        env: createSpawnEnv({
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          ...spec.env
        }),
        cols: 120,
        rows: 32,
        name: "xterm-256color"
      });
      session.terminalBackend = "node-pty";
      session.pty.onData((data) => {
        this.handleChunk(session.id, "stdout", data);
      });
      session.pty.onExit(({ exitCode, signal }) => {
        const current = this.sessions.get(session.id);
        if (!current) {
          return;
        }
        current.status = "stopped";
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
        createEvent(session.id, "system", "agent pty launch failed; falling back to piped process", {
          backend: "node-pty",
          command: program.command,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }

    session.child = spawn(program.command, program.args, {
      cwd: spec.cwd,
      env: createSpawnEnv({
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...spec.env
      }),
      stdio: "pipe"
    });
    session.child.stdout?.on("data", (chunk) => {
      this.handleChunk(session.id, "stdout", chunk.toString());
    });
    session.child.stderr?.on("data", (chunk) => {
      this.handleChunk(session.id, "stderr", chunk.toString());
    });
    session.child.on("exit", (code, signal) => {
      const current = this.sessions.get(session.id);
      if (!current) {
        return;
      }
      current.status = "stopped";
      current.attention = "idle";
      current.updatedAt = Date.now();
      this.emit("session.event", createEvent(session.id, "status", "process exited", { code, signal }));
      this.emitSessionUpdated(session.id);
      this.emit("session.stopped", session.id);
    });
    this.emit("session.event", createEvent(session.id, "system", "agent backend: stdio", { backend: "stdio", command: program.command }));
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
        const current = this.sessions.get(session.id);
        if (!current) {
          return;
        }
        current.status = "stopped";
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

    session.child = spawn(
        "python3",
        [
          "-c",
          "import fcntl, os, pty, select, signal, struct, sys, termios; cols=int(os.environ.get('BRIDGE_COLS','120')); rows=int(os.environ.get('BRIDGE_ROWS','32')); shell=os.environ.get('BRIDGE_SHELL','/bin/sh'); argv=[shell, '-l'] if os.path.basename(shell) in {'bash','zsh'} else [shell]; pid, fd = pty.fork();\nif pid == 0:\n    os.execvpe(argv[0], argv, os.environ)\nelse:\n    def _winch(signum, frame):\n        winsz = struct.pack('HHHH', rows, cols, 0, 0)\n        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsz)\n    _winch(None, None)\n    signal.signal(signal.SIGWINCH, _winch)\n    while True:\n        try:\n            readers, _, _ = select.select([fd, sys.stdin.fileno()], [], [])\n            if fd in readers:\n                data = os.read(fd, 1024)\n                if not data:\n                    break\n                os.write(sys.stdout.fileno(), data)\n            if sys.stdin.fileno() in readers:\n                data = os.read(sys.stdin.fileno(), 1024)\n                if not data:\n                    break\n                os.write(fd, data)\n        except OSError:\n            break"
        ],
      {
        cwd: spec.cwd,
        env: createSpawnEnv({
          ...spec.env,
          BRIDGE_SHELL: shell,
          BRIDGE_COLS: "120",
          BRIDGE_ROWS: "32"
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
      const current = this.sessions.get(session.id);
      if (!current) {
        return;
      }
      current.status = "stopped";
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
    session.status = summary.status ?? session.status;
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
    session.pty?.kill();
    session.child?.kill("SIGTERM");
    session.status = "stopped";
    session.attention = "idle";
    session.updatedAt = Date.now();
    session.lastEventAt = session.updatedAt;
    this.emitSessionUpdated(sessionId);
    return this.get(sessionId)!;
  }
}
