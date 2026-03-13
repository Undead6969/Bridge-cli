import React from "react";
import type { InboxItem, MachineRecord, SessionRecord, SessionStreamEvent } from "@bridge/protocol";
import { PromptBox } from "@/components/ui/chatgpt-prompt-input";

type ThemeMode = "dark" | "light";

type DashboardProps = {
  machines: MachineRecord[];
  sessions: SessionRecord[];
  inbox: InboxItem[];
  serverBaseUrl: string;
  selectedWorkspace: string;
  activeSessionId: string | null;
  sessionEvents: SessionStreamEvent[];
  composer: string;
  notificationsEnabled: boolean;
  theme: ThemeMode;
  mobilePane: "list" | "chat";
  settingsOpen: boolean;
  onSelectWorkspace: (workspace: string) => void;
  onSelectSession: (sessionId: string) => void;
  onComposerChange: (value: string) => void;
  onSendInput: () => void;
  onLaunchSession: (machineId: string, target: "codex" | "claude" | "gemini" | "terminal") => void;
  onPowerChange: (machineId: string, mode: MachineRecord["powerPolicy"]["mode"]) => void;
  onMarkInboxRead: (id: string) => void;
  onToggleNotifications: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onDisconnect: () => void;
  onShowPairing: () => void;
  onBackToSessions: () => void;
  onToggleSettings: () => void;
};

type WorkspaceOption = {
  id: string;
  label: string;
  detail: string;
};

function formatTime(timestamp?: number): string {
  if (!timestamp) {
    return "just now";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
}

function formatRelative(timestamp?: number): string {
  if (!timestamp) {
    return "just now";
  }
  const delta = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function sessionTone(session: SessionRecord): "good" | "danger" | "muted" {
  if (session.status === "approval-needed" || session.status === "blocked" || session.status === "errored" || session.status === "offline") {
    return "danger";
  }
  if (session.status === "running" || session.status === "waiting" || session.status === "completed") {
    return "good";
  }
  return "muted";
}

function sessionStatusCopy(session: SessionRecord): string {
  if (session.status === "running") {
    return session.runtime === "terminal-session" ? "live terminal attached" : "working now";
  }
  if (session.status === "waiting") {
    return "ready for your next message";
  }
  if (session.status === "approval-needed") {
    return "needs approval";
  }
  if (session.status === "blocked") {
    return "blocked";
  }
  if (session.status === "completed") {
    return "finished";
  }
  if (session.status === "stopped") {
    return "stopped";
  }
  if (session.status === "starting") {
    return "starting";
  }
  return session.status;
}

function sessionPreview(session: SessionRecord, events: SessionStreamEvent[]): string {
  const relevant = events.filter((event) => event.sessionId === session.id);
  const last = relevant.at(-1);
  if (!last) {
    return session.runtime === "terminal-session" ? "Terminal session ready." : "Start the conversation.";
  }
  const cleaned = last.data.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return sessionStatusCopy(session);
  }
  return cleaned.slice(0, 110);
}

function displayRuntime(session: SessionRecord): string {
  return session.runtime === "terminal-session" ? "Terminal" : session.agent === "claude" ? "Claude Code" : session.agent === "gemini" ? "Gemini CLI" : "Codex";
}

function workspaceIdFromSession(session: SessionRecord): string {
  return session.cwd;
}

function workspaceLabel(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length === 0) {
    return "Root";
  }
  return parts[parts.length - 1] ?? cwd;
}

function workspaceDetail(cwd: string, machine?: MachineRecord): string {
  return `${cwd} ${machine ? `• ${machine.hostname}` : ""}`.trim();
}

function avatarSeed(input: string): string {
  const seeds = ["#37a9ff", "#76e3ac", "#ff9f68", "#ff6d92", "#b88cff", "#f4d35e"];
  let value = 0;
  for (const char of input) {
    value += char.charCodeAt(0);
  }
  return seeds[value % seeds.length] ?? seeds[0];
}

type ParsedCard =
  | { type: "tool"; title: string; body: string; meta?: string }
  | { type: "approval"; title: string; body: string; meta?: string }
  | { type: "file"; title: string; body: string; meta?: string }
  | { type: "command"; title: string; body: string; meta?: string }
  | { type: "status"; title: string; body: string; meta?: string }
  | { type: "message"; title: string; body: string; meta?: string };

function trimMessage(input: string, limit = 280): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit - 1)}…`;
}

function findPath(input: string): string | null {
  const match = input.match(/([~/.][\w./-]+(?:\.[\w-]+)?)/);
  return match?.[1] ?? null;
}

function parseEventCard(event: SessionStreamEvent): ParsedCard {
  const text = event.data.trim();
  if (event.kind === "approval") {
    return {
      type: "approval",
      title: "Approval needed",
      body: trimMessage(text || "Bridge is waiting for a yes/no."),
      meta: event.meta?.requestId ? `request ${String(event.meta.requestId)}` : "respond from phone"
    };
  }
  if (event.kind === "blocked") {
    return {
      type: "status",
      title: "Blocked",
      body: trimMessage(text || "The agent hit something prickly."),
      meta: "needs intervention"
    };
  }
  if (event.kind === "completed" || event.kind === "ready") {
    return {
      type: "status",
      title: event.kind === "completed" ? "Finished" : "Ready",
      body: trimMessage(text || "The agent wrapped up this step."),
      meta: "review suggested"
    };
  }
  if (event.kind === "system") {
    const path = findPath(text);
    const toolMatch = text.match(/([a-z][\w-]+)\((.*)\)/i);
    if (toolMatch) {
      return {
        type: "tool",
        title: toolMatch[1] ?? "Tool call",
        body: trimMessage(toolMatch[2] || text),
        meta: "tool activity"
      };
    }
    if (path) {
      return {
        type: "file",
        title: path.split("/").pop() ?? path,
        body: trimMessage(text),
        meta: path
      };
    }
    return {
      type: "status",
      title: "System",
      body: trimMessage(text),
      meta: "session event"
    };
  }
  if (event.kind === "stderr") {
    const path = findPath(text);
    return {
      type: path ? "file" : "message",
      title: path ? "Workspace activity" : "Agent note",
      body: trimMessage(text || "stderr"),
      meta: path ?? "stderr"
    };
  }
  if (event.kind === "stdout") {
    const command = text.match(/^\$\s+(.+)/m)?.[1];
    const path = findPath(text);
    if (command) {
      return {
        type: "command",
        title: command.split(" ")[0] ?? "Command",
        body: trimMessage(command),
        meta: "shell activity"
      };
    }
    if (path) {
      return {
        type: "file",
        title: path.split("/").pop() ?? path,
        body: trimMessage(text),
        meta: path
      };
    }
  }
  if (event.kind === "input") {
    return {
      type: "message",
      title: "You",
      body: trimMessage(text),
      meta: "remote input"
    };
  }
  return {
    type: "message",
    title: "Agent",
    body: trimMessage(text),
    meta: undefined
  };
}

function terminalBuffer(events: SessionStreamEvent[]): string {
  return events
    .filter((event) => ["stdout", "stderr", "input", "system", "status", "blocked", "completed", "ready"].includes(event.kind))
    .map((event) => {
      if (event.kind === "input") {
        return `$ ${event.data.replace(/\n$/, "")}`;
      }
      return event.data;
    })
    .join("")
    .trim();
}

function workspaceHeadline(selectedWorkspace: string, options: WorkspaceOption[]): WorkspaceOption | undefined {
  return options.find((item) => item.id === selectedWorkspace) ?? options[0];
}

export function Dashboard(props: DashboardProps) {
  const {
    machines,
    sessions,
    inbox,
    serverBaseUrl,
    selectedWorkspace,
    activeSessionId,
    sessionEvents,
    composer,
    notificationsEnabled,
    theme,
    mobilePane,
    settingsOpen,
    onSelectWorkspace,
    onSelectSession,
    onComposerChange,
    onSendInput,
    onLaunchSession,
    onPowerChange,
    onMarkInboxRead,
    onToggleNotifications,
    onThemeChange,
    onDisconnect,
    onShowPairing,
    onBackToSessions,
    onToggleSettings
  } = props;

  const sessionsByWorkspace = React.useMemo(() => {
    const map = new Map<string, SessionRecord[]>();
    for (const session of sessions) {
      const key = workspaceIdFromSession(session);
      const current = map.get(key) ?? [];
      current.push(session);
      map.set(key, current);
    }
    return map;
  }, [sessions]);

  const workspaceOptions = React.useMemo<WorkspaceOption[]>(() => {
    const options = new Map<string, WorkspaceOption>();
    for (const session of sessions) {
      const machine = machines.find((item) => item.machineId === session.machineId);
      options.set(workspaceIdFromSession(session), {
        id: workspaceIdFromSession(session),
        label: workspaceLabel(session.cwd),
        detail: workspaceDetail(session.cwd, machine)
      });
    }
    if (options.size === 0) {
      options.set("all", {
        id: "all",
        label: "All workspaces",
        detail: "No sessions yet"
      });
    }
    return [{ id: "all", label: "All workspaces", detail: `${sessions.length} session${sessions.length === 1 ? "" : "s"}` }, ...[...options.values()].filter((item) => item.id !== "all")];
  }, [machines, sessions]);

  const filteredSessions = React.useMemo(() => {
    if (selectedWorkspace === "all") {
      return sessions;
    }
    return sessions.filter((session) => workspaceIdFromSession(session) === selectedWorkspace);
  }, [selectedWorkspace, sessions]);

  const activeSession = React.useMemo(
    () => filteredSessions.find((session) => session.id === activeSessionId) ?? sessions.find((session) => session.id === activeSessionId) ?? filteredSessions[0] ?? sessions[0] ?? null,
    [activeSessionId, filteredSessions, sessions]
  );

  const activeMachine = activeSession ? machines.find((machine) => machine.machineId === activeSession.machineId) ?? null : null;
  const groupedSessions = React.useMemo(() => {
    const groups = new Map<string, SessionRecord[]>();
    for (const session of filteredSessions) {
      const key = workspaceLabel(session.cwd);
      const current = groups.get(key) ?? [];
      current.push(session);
      groups.set(key, current);
    }
    return [...groups.entries()];
  }, [filteredSessions]);

  const activePreview = activeSession ? sessionPreview(activeSession, sessionEvents) : "Pick a session to start.";
  const hasActiveApprovals = filteredSessions.some((session) => session.status === "approval-needed");
  const unreadCount = filteredSessions.reduce((count, session) => count + session.unreadCount, 0);
  const thinking = Boolean(activeSession && (activeSession.status === "running" || activeSession.status === "starting") && composer.trim().length === 0);
  const transcriptCards = activeSession ? sessionEvents.map((event) => ({ event, card: parseEventCard(event) })) : [];
  const terminalText = activeSession?.runtime === "terminal-session" ? terminalBuffer(sessionEvents) : "";
  const activeWorkspace = workspaceHeadline(selectedWorkspace, workspaceOptions);
  const codexHandshakeReady = Boolean(
    activeSession?.agent === "codex" &&
      sessionEvents.some((event) => event.kind === "system" && /agent backend:/i.test(event.data))
  );
  const blockedByRuntime = Boolean(
    activeSession &&
      (["blocked", "errored", "stopped", "offline"].includes(activeSession.status) ||
        sessionEvents.some((event) => /TERM is set to "dumb"|Refusing to start the interactive TUI/i.test(event.data)))
  );
  const chatReady = Boolean(
    activeSession &&
      !blockedByRuntime &&
      (activeSession.runtime === "terminal-session"
        ? ["running", "waiting"].includes(activeSession.status)
        : activeSession.agent === "codex"
          ? codexHandshakeReady && ["running", "waiting", "completed"].includes(activeSession.status)
          : ["running", "waiting", "completed"].includes(activeSession.status))
  );
  const connectionLabel = !activeSession
    ? "Pick a chat to begin."
    : blockedByRuntime
      ? "Codex hit a runtime problem. Start a fresh session."
      : !chatReady
        ? activeSession.agent === "codex"
          ? "Waiting for Codex to finish handshaking..."
          : "Waiting for session to become interactive..."
        : activeSession.runtime === "terminal-session"
          ? "Terminal is live."
          : `${displayRuntime(activeSession)} is connected.`;

  return (
    <section className={`codex-shell ${mobilePane === "chat" ? "codex-shell-mobile-chat" : ""}`}>
      <div className="codex-layout">
        <aside className="codex-sidebar">
          <div className="codex-sidebar-top">
            <div className="codex-brand">
              <div className="brand-mark">B</div>
              <div>
                <strong>Bridge</strong>
                <span>Remote coding</span>
              </div>
            </div>
            <button className="codex-sidebar-icon" onClick={onShowPairing} type="button" aria-label="Pair browser">
              +
            </button>
          </div>

          <div className="codex-sidebar-actions">
            <button className="codex-sidebar-action" onClick={() => activeMachine && onLaunchSession(activeMachine.machineId, "codex")} type="button" disabled={!activeMachine}>
              New chat
            </button>
            <button className="codex-sidebar-action codex-sidebar-action-secondary" onClick={onToggleSettings} type="button">
              Settings
            </button>
          </div>

          <div className="codex-sidebar-section">
            <div className="codex-sidebar-heading">Your chats</div>
            <label className="codex-sidebar-label" htmlFor="workspace-select">
              Workspace
            </label>
            <select id="workspace-select" className="codex-workspace-select" value={selectedWorkspace} onChange={(event) => onSelectWorkspace(event.target.value)}>
              {workspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label}
                </option>
              ))}
            </select>
          </div>

          <div className="codex-sidebar-section codex-sidebar-stats">
            <span>{machines.filter((machine) => machine.online).length} online</span>
            <span>{unreadCount} unread</span>
            <span>{hasActiveApprovals ? "approval needed" : "quiet for now"}</span>
          </div>

          <div className="codex-thread-list">
            {groupedSessions.length === 0 ? (
              <div className="codex-empty-sidebar">
                <strong>No chats yet</strong>
                <span>Launch Codex from the sidebar and the thread list will wake up.</span>
              </div>
            ) : (
              groupedSessions.map(([group, items]) => (
                <div key={group} className="codex-thread-group">
                  <div className="codex-thread-group-title">{group}</div>
                  {items.map((session) => {
                    const machine = machines.find((item) => item.machineId === session.machineId);
                    return (
                      <button
                        key={session.id}
                        className={`codex-thread-item ${activeSession?.id === session.id ? "codex-thread-item-active" : ""}`}
                        onClick={() => onSelectSession(session.id)}
                        type="button"
                      >
                        <div className="codex-thread-avatar" style={{ backgroundColor: avatarSeed(session.title) }}>
                          {displayRuntime(session).slice(0, 1)}
                        </div>
                        <div className="codex-thread-copy">
                          <div className="codex-thread-title-row">
                            <strong>{session.title}</strong>
                            <span>{formatTime(session.lastEventAt)}</span>
                          </div>
                          <div className="codex-thread-subtitle">{machine?.hostname ?? "machine"} • {sessionStatusCopy(session)}</div>
                          <div className="codex-thread-preview">{sessionPreview(session, sessionEvents)}</div>
                        </div>
                        {session.unreadCount > 0 ? <span className="codex-thread-badge">{session.unreadCount}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="codex-sidebar-footer">
            <div className="codex-sidebar-footer-title">Quick launch</div>
            <div className="codex-runtime-list">
              <button className="codex-runtime-button" disabled={!activeMachine} onClick={() => activeMachine && onLaunchSession(activeMachine.machineId, "codex")} type="button">Codex</button>
              <button className="codex-runtime-button" disabled={!activeMachine?.capabilities.cli.claude.launchable} onClick={() => activeMachine && onLaunchSession(activeMachine.machineId, "claude")} type="button">Claude</button>
              <button className="codex-runtime-button" disabled={!activeMachine?.capabilities.cli.gemini.launchable} onClick={() => activeMachine && onLaunchSession(activeMachine.machineId, "gemini")} type="button">Gemini</button>
              <button className="codex-runtime-button" disabled={!activeMachine?.capabilities.terminal.supportsInteractivePty} onClick={() => activeMachine && onLaunchSession(activeMachine.machineId, "terminal")} type="button">Terminal</button>
            </div>
          </div>
        </aside>

        <main className="codex-main">
          {activeSession ? (
            <>
              <header className="codex-main-header">
                <button className="mobile-back-button" onClick={onBackToSessions} type="button" aria-label="Back to sessions">
                  ←
                </button>
                <div className="codex-main-header-copy">
                  <div className="codex-main-kicker">{displayRuntime(activeSession)}</div>
                  <div className="codex-main-title">{activeSession.title}</div>
                  <div className="codex-main-subtitle">
                    {activeMachine?.hostname ?? "machine"} • {activeWorkspace?.label ?? "workspace"} • {sessionStatusCopy(activeSession)}
                  </div>
                </div>
                <div className={`codex-connection-pill ${chatReady ? "codex-connection-pill-live" : ""}`}>{connectionLabel}</div>
              </header>

              <section className={`codex-transcript ${activeSession.runtime === "terminal-session" ? "codex-transcript-terminal" : ""}`}>
                {activeSession.runtime === "terminal-session" ? (
                  <div className="codex-terminal transcript-lane">
                    <div className="codex-terminal-bar">{activeSession.shell ?? "shell"}</div>
                    <pre className="codex-terminal-screen">{terminalText || "Waiting for terminal output..."}</pre>
                  </div>
                ) : sessionEvents.length === 0 ? (
                  <div className="codex-empty-state">
                    <h2>Ready when you are.</h2>
                    <p>{chatReady ? "Send a message and Bridge will forward it to the live Codex session." : connectionLabel}</p>
                  </div>
                ) : (
                  transcriptCards.map(({ event, card }) => {
                    const isUser = event.kind === "input";
                    if (card.type === "approval") {
                      return (
                        <article key={event.id} className="codex-event-card codex-event-card-approval transcript-lane">
                          <div className="codex-event-card-top">
                            <span className="codex-event-dot">!</span>
                            <div>
                              <strong>{card.title}</strong>
                              <div className="codex-event-meta">{card.meta}</div>
                            </div>
                          </div>
                          <p>{card.body}</p>
                        </article>
                      );
                    }
                    if (card.type === "tool" || card.type === "command" || card.type === "file" || card.type === "status") {
                      return (
                        <article key={event.id} className={`codex-event-card codex-event-card-${card.type} transcript-lane`}>
                          <div className="codex-event-card-top">
                            <span className="codex-event-dot">
                              {card.type === "tool" ? "◉" : card.type === "command" ? ">" : card.type === "file" ? "#" : "•"}
                            </span>
                            <div>
                              <strong>{card.title}</strong>
                              <div className="codex-event-meta">{card.meta ?? formatTime(event.at)}</div>
                            </div>
                          </div>
                          <p>{card.body}</p>
                        </article>
                      );
                    }
                    return (
                      <article key={event.id} className={`codex-bubble ${isUser ? "codex-bubble-user" : "codex-bubble-agent"} transcript-lane`}>
                        <div className="codex-bubble-role">{isUser ? "You" : displayRuntime(activeSession)}</div>
                        <pre>{event.data}</pre>
                        <div className="codex-bubble-time">{formatTime(event.at)}</div>
                      </article>
                    );
                  })
                )}
                {thinking && activeSession.runtime !== "terminal-session" ? (
                  <div className="codex-thinking transcript-lane">
                    <div className="codex-thinking-label">{displayRuntime(activeSession)} is thinking</div>
                    <div className="codex-thinking-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ) : null}
              </section>

              <footer className="codex-composer-wrap">
                <PromptBox
                  className="codex-promptbox"
                  mode={activeSession.runtime === "terminal-session" ? "terminal" : "chat"}
                  value={composer}
                  onValueChange={onComposerChange}
                  onSubmit={onSendInput}
                  disabled={!chatReady}
                  placeholder={
                    activeSession.runtime === "terminal-session"
                      ? "Type terminal input..."
                      : chatReady
                        ? "Ask Codex anything"
                        : connectionLabel
                  }
                />
              </footer>
            </>
          ) : (
            <div className="codex-empty-state codex-empty-state-full">
              <h2>Ready when you are.</h2>
              <p>Pick a chat on the left or start a fresh Codex session.</p>
            </div>
          )}
        </main>

        <aside className={`settings-rail ${settingsOpen ? "settings-rail-open" : ""}`}>
          <div className="settings-card">
            <div className="settings-card-title">Connection</div>
            <div className="settings-card-body">
              <div className="settings-line">
                <span>Server</span>
                <strong>{serverBaseUrl}</strong>
              </div>
              <div className="settings-line">
                <span>Theme</span>
                <div className="theme-switcher">
                  <button className={theme === "dark" ? "theme-pill theme-pill-active" : "theme-pill"} onClick={() => onThemeChange("dark")} type="button">Dark</button>
                  <button className={theme === "light" ? "theme-pill theme-pill-active" : "theme-pill"} onClick={() => onThemeChange("light")} type="button">Light</button>
                </div>
              </div>
              <div className="settings-line">
                <span>Notifications</span>
                <button className={notificationsEnabled ? "theme-pill theme-pill-active" : "theme-pill"} onClick={onToggleNotifications} type="button">
                  {notificationsEnabled ? "On" : "Off"}
                </button>
              </div>
            </div>
            <div className="settings-actions">
              <button className="settings-button" onClick={onShowPairing} type="button">Show pairing</button>
              <button className="settings-button settings-button-danger" onClick={onDisconnect} type="button">Restart connection</button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-title">Machines</div>
            <div className="machine-list">
              {machines.map((machine) => (
                <div key={machine.machineId} className="machine-mini-card">
                  <div>
                    <strong>{machine.hostname}</strong>
                    <div className="machine-mini-copy">{machine.capabilities.os.platform} • {machine.online ? "online" : "offline"}</div>
                  </div>
                  <select value={machine.powerPolicy.mode} onChange={(event) => onPowerChange(machine.machineId, event.target.value as MachineRecord["powerPolicy"]["mode"])}>
                    <option value="normal">normal</option>
                    <option value="stay-awake-during-activity">stay awake</option>
                    <option value="always-awake">always awake</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-title">Inbox</div>
            <div className="inbox-stack">
              {inbox.slice(0, 6).map((item) => (
                <button key={item.id} className={`inbox-mini ${item.readAt ? "" : "inbox-mini-unread"}`} onClick={() => onMarkInboxRead(item.id)} type="button">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </button>
              ))}
              {inbox.length === 0 ? <div className="inbox-empty">No alerts. Suspiciously peaceful.</div> : null}
            </div>
          </div>
        </aside>
      </div>

      {settingsOpen ? <button className="settings-backdrop" onClick={onToggleSettings} type="button" aria-label="Close settings" /> : null}
    </section>
  );
}
