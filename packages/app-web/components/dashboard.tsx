import React from "react";
import type { InboxItem, MachineRecord, SessionRecord, SessionStreamEvent } from "@bridge/protocol";

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
    onShowPairing
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

  return (
    <section className="messenger-shell">
      <header className="app-header">
        <div className="app-header-main">
          <div className="brand-mark">B</div>
          <div>
            <div className="app-title">Bridge</div>
            <div className="app-subtitle">Remote coding, now with less emotional ambiguity.</div>
          </div>
        </div>
        <div className="header-actions">
          <select className="workspace-select" value={selectedWorkspace} onChange={(event) => onSelectWorkspace(event.target.value)}>
            {workspaceOptions.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.label}
              </option>
            ))}
          </select>
          <button className="header-icon-button" onClick={onShowPairing} type="button" aria-label="Show pairing controls">
            Pair
          </button>
        </div>
      </header>

      <div className="messenger-layout">
        <aside className="chat-sidebar">
          <div className="sidebar-top">
            <div>
              <div className="sidebar-title">Sessions</div>
              <div className="sidebar-subtitle">{workspaceOptions.find((item) => item.id === selectedWorkspace)?.detail ?? "All workspaces"}</div>
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
              <header className="chat-header">
                <div className="chat-header-left">
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
                {sessionEvents.length === 0 ? (
                  <div className="message-system">No messages yet. This session is either brand new or plotting.</div>
                ) : (
                  sessionEvents.map((event) => {
                    const isUser = event.kind === "input";
                    const tone =
                      event.kind === "approval"
                        ? "warning"
                        : event.kind === "blocked"
                          ? "danger"
                          : event.kind === "completed" || event.kind === "ready"
                            ? "success"
                            : event.kind === "stderr"
                              ? "neutral"
                              : isUser
                                ? "user"
                                : "default";
                    return (
                      <article key={event.id} className={`message-bubble message-${tone}`}>
                        <div className="message-kind">{event.kind}</div>
                        <pre>{event.data}</pre>
                        <div className="message-meta">{formatTime(event.at)}</div>
                      </article>
                    );
                  })
                )}
              </section>

              <footer className="chat-composer">
                <div className="composer-frame">
                  <input
                    value={composer}
                    onChange={(event) => onComposerChange(event.target.value)}
                    placeholder={activeSession.runtime === "terminal-session" ? "Type terminal input..." : "Message this session..."}
                  />
                  <button className="composer-send" onClick={onSendInput} type="button">
                    Send
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="empty-chat-stage">
              <strong>No active chat yet</strong>
              <span>Pick a session on the left, or launch one from a connected machine.</span>
            </div>
          )}
        </main>

        <aside className="settings-rail">
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
