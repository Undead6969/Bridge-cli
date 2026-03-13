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

  return (
    <section className={`messenger-shell ${mobilePane === "chat" ? "messenger-mobile-chat" : ""} ${settingsOpen ? "messenger-settings-open" : ""}`}>
      <header className="app-header">
        <div className="app-header-main">
          <div className="brand-mark">B</div>
          <div>
            <div className="app-title">Bridge</div>
            <div className="app-subtitle">Remote coding, now with less emotional ambiguity.</div>
          </div>
        </div>
        <div className="header-actions">
          <div className="workspace-header-chip">
            <span className="workspace-header-label">Workspace</span>
            <select className="workspace-select" value={selectedWorkspace} onChange={(event) => onSelectWorkspace(event.target.value)}>
              {workspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label}
                </option>
              ))}
            </select>
          </div>
          <button className="header-icon-button" onClick={onShowPairing} type="button" aria-label="Show pairing controls">
            Pair
          </button>
          <button className="header-icon-button" onClick={onToggleSettings} type="button" aria-label="Toggle settings">
            Settings
          </button>
        </div>
      </header>

      <div className="messenger-layout">
        <aside className="chat-sidebar">
          <div className="sidebar-top">
            <div>
              <div className="sidebar-title">Sessions</div>
              <div className="sidebar-subtitle">{activeWorkspace?.detail ?? "All workspaces"}</div>
            </div>
            <button className="header-icon-button compact-button" onClick={onShowPairing} type="button">
              +
            </button>
          </div>

          <div className="sidebar-summary">
            <div className="sidebar-summary-card">
              <strong>{machines.filter((machine) => machine.online).length}</strong>
              <span>machines online</span>
            </div>
            <div className="sidebar-summary-card">
              <strong>{unreadCount}</strong>
              <span>unread</span>
            </div>
            <div className="sidebar-summary-card">
              <strong>{hasActiveApprovals ? "1+" : "0"}</strong>
              <span>approvals</span>
            </div>
          </div>

          <div className="chat-groups">
            {groupedSessions.length === 0 ? (
              <div className="empty-chats">
                <strong>No sessions yet</strong>
                <span>Launch Codex, Claude, Gemini, or a terminal from the active machine.</span>
              </div>
            ) : (
              groupedSessions.map(([group, items]) => (
                <div key={group} className="chat-group">
                  <div className="chat-group-label">{group}</div>
                  {items.map((session) => {
                    const machine = machines.find((item) => item.machineId === session.machineId);
                    return (
                      <button
                        key={session.id}
                        className={`chat-list-item ${activeSession?.id === session.id ? "chat-list-item-active" : ""}`}
                        onClick={() => onSelectSession(session.id)}
                        type="button"
                      >
                        <div className="chat-avatar" style={{ backgroundColor: avatarSeed(session.title) }}>
                          {displayRuntime(session).slice(0, 1)}
                        </div>
                        <div className="chat-copy">
                          <div className="chat-copy-top">
                            <strong>{session.title}</strong>
                            <span>{formatTime(session.lastEventAt)}</span>
                          </div>
                          <div className="chat-copy-middle">
                            <span>{machine?.hostname ?? "machine"}</span>
                            <span className={`session-dot dot-${sessionTone(session)}`}>{sessionStatusCopy(session)}</span>
                          </div>
                          <div className="chat-copy-bottom">{sessionPreview(session, sessionEvents)}</div>
                        </div>
                        {session.unreadCount > 0 ? <div className="unread-badge">{session.unreadCount}</div> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="chat-main">
          {activeSession ? (
            <>
              <div className="chat-connection-banner">
                <div>
                  <strong>{activeMachine?.online ? "Connected" : "Waiting on machine"}</strong>
                  <span>
                    {activeMachine?.hostname ?? "machine"} • {activeWorkspace?.label ?? "workspace"} • {activeSession.runtime === "terminal-session" ? "terminal session" : "agent chat"}
                  </span>
                </div>
                <div className="chat-connection-state">
                  <span className={`session-dot dot-${sessionTone(activeSession)}`}>{sessionStatusCopy(activeSession)}</span>
                  <span className="header-meta-pill">{activeSession.owner}</span>
                </div>
              </div>

              <header className="chat-header">
                <div className="chat-header-left">
                  <button className="mobile-back-button" onClick={onBackToSessions} type="button" aria-label="Back to sessions">
                    ←
                  </button>
                  <div className="chat-avatar large-avatar" style={{ backgroundColor: avatarSeed(activeSession.title) }}>
                    {displayRuntime(activeSession).slice(0, 1)}
                  </div>
                  <div>
                    <div className="chat-header-title">{activeSession.title}</div>
                    <div className="chat-header-subtitle">
                      {activeMachine?.hostname ?? "machine"} • {activeSession.cwd} • {displayRuntime(activeSession)}
                    </div>
                  </div>
                </div>
                <div className="chat-header-right">
                  <span className={`session-badge badge-${sessionTone(activeSession)}`}>{sessionStatusCopy(activeSession)}</span>
                  <span className="header-meta-pill">{activeSession.owner}</span>
                  <button className="header-icon-button compact-button" onClick={onToggleSettings} type="button">⋯</button>
                </div>
              </header>

              <section className="chat-launch-strip">
                {activeMachine ? (
                  <>
                    <div className="chat-launch-copy">
                      <strong>{activeMachine.hostname}</strong>
                      <span>Switch agents or open a terminal without leaving the thread list.</span>
                    </div>
                    <div className="launch-chip-row">
                      <button className="launch-chip launch-chip-primary" onClick={() => onLaunchSession(activeMachine.machineId, "codex")} type="button">Codex</button>
                      <button className="launch-chip" disabled={!activeMachine.capabilities.cli.claude.launchable} onClick={() => onLaunchSession(activeMachine.machineId, "claude")} type="button">Claude</button>
                      <button className="launch-chip" disabled={!activeMachine.capabilities.cli.gemini.launchable} onClick={() => onLaunchSession(activeMachine.machineId, "gemini")} type="button">Gemini</button>
                      <button className="launch-chip" disabled={!activeMachine.capabilities.terminal.supportsInteractivePty} onClick={() => onLaunchSession(activeMachine.machineId, "terminal")} type="button">Terminal</button>
                    </div>
                  </>
                ) : null}
              </section>

              <section className={`chat-transcript ${activeSession.runtime === "terminal-session" ? "chat-transcript-terminal" : ""}`}>
                {activeSession.runtime === "terminal-session" ? (
                  <div className="terminal-shell">
                    <div className="terminal-shell-header">
                      <span className="terminal-dot terminal-red" />
                      <span className="terminal-dot terminal-yellow" />
                      <span className="terminal-dot terminal-green" />
                      <strong>{activeSession.shell ?? "shell"}</strong>
                    </div>
                    <pre className="terminal-screen">{terminalText || "Waiting for terminal output..."}</pre>
                  </div>
                ) : sessionEvents.length === 0 ? (
                  <div className="message-system">No messages yet. This session is either brand new or plotting.</div>
                ) : (
                  transcriptCards.map(({ event, card }) => {
                    const isUser = event.kind === "input";
                    if (card.type === "approval") {
                      return (
                        <article key={event.id} className="message-card message-card-approval">
                          <div className="message-card-top">
                            <span className="message-card-icon">!</span>
                            <div>
                              <strong>{card.title}</strong>
                              <div className="message-card-meta">{card.meta}</div>
                            </div>
                          </div>
                          <p>{card.body}</p>
                          <div className="message-card-actions">
                            <button className="mini-action">Approve in terminal</button>
                            <button className="mini-action ghost-button">Review first</button>
                          </div>
                        </article>
                      );
                    }
                    if (card.type === "tool" || card.type === "command" || card.type === "file" || card.type === "status") {
                      return (
                        <article key={event.id} className={`message-card message-card-${card.type}`}>
                          <div className="message-card-top">
                            <span className="message-card-icon">
                              {card.type === "tool" ? "◉" : card.type === "command" ? ">" : card.type === "file" ? "#" : "•"}
                            </span>
                            <div>
                              <strong>{card.title}</strong>
                              <div className="message-card-meta">{card.meta ?? formatTime(event.at)}</div>
                            </div>
                          </div>
                          <p>{card.body}</p>
                        </article>
                      );
                    }
                    return (
                      <article key={event.id} className={`message-bubble ${isUser ? "message-user" : "message-default"}`}>
                        <div className="message-kind">{isUser ? "You" : displayRuntime(activeSession)}</div>
                        <pre>{event.data}</pre>
                        <div className="message-meta">{formatTime(event.at)}</div>
                      </article>
                    );
                  })
                )}
                {thinking && activeSession.runtime !== "terminal-session" ? (
                  <div className="thinking-block">
                    <div className="thinking-avatar">{displayRuntime(activeSession).slice(0, 1)}</div>
                    <div className="thinking-card">
                      <div className="thinking-label">{displayRuntime(activeSession)} is thinking</div>
                      <div className="thinking-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                      <div className="thinking-lines">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>

              <footer className="chat-composer">
                <PromptBox
                  className="chat-promptbox"
                  mode={activeSession.runtime === "terminal-session" ? "terminal" : "chat"}
                  value={composer}
                  onValueChange={onComposerChange}
                  onSubmit={onSendInput}
                  placeholder={activeSession.runtime === "terminal-session" ? "Type terminal input..." : "Message this session..."}
                />
              </footer>
            </>
          ) : (
            <div className="empty-chat-stage">
              <strong>No active chat yet</strong>
              <span>Pick a session on the left, or launch one from a connected machine.</span>
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
    </section>
  );
}
