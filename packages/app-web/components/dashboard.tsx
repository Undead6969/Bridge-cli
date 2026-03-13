import React from "react";
import type { InboxItem, MachineRecord, SessionRecord, SessionStreamEvent } from "@bridge/protocol";

type DashboardProps = {
  machines: MachineRecord[];
  sessions: SessionRecord[];
  inbox: InboxItem[];
  serverBaseUrl: string;
  activeTab: "home" | "sessions" | "inbox" | "settings";
  selectedMachineId: string | null;
  activeSessionId: string | null;
  sessionEvents: SessionStreamEvent[];
  composer: string;
  notificationsEnabled: boolean;
  onSelectTab: (tab: DashboardProps["activeTab"]) => void;
  onSelectMachine: (machineId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onComposerChange: (value: string) => void;
  onSendInput: () => void;
  onLaunchSession: (machineId: string, target: "codex" | "claude" | "gemini" | "terminal") => void;
  onPowerChange: (machineId: string, mode: MachineRecord["powerPolicy"]["mode"]) => void;
  onMarkInboxRead: (id: string) => void;
  onToggleNotifications: () => void;
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

function statusTone(status: SessionRecord["status"]): string {
  if (status === "approval-needed" || status === "blocked" || status === "errored" || status === "offline") {
    return "danger";
  }
  if (status === "completed" || status === "waiting") {
    return "good";
  }
  return "neutral";
}

function runtimeLabel(session: SessionRecord): string {
  return session.runtime === "agent-session" ? session.agent ?? "agent" : "terminal";
}

function statusCopy(session: SessionRecord): string {
  if (session.status === "running") {
    return session.runtime === "terminal-session" ? "Live terminal attached" : "Agent is working";
  }
  if (session.status === "approval-needed") {
    return "Needs your approval";
  }
  if (session.status === "blocked") {
    return "Hit something cranky";
  }
  if (session.status === "completed") {
    return "Finished and waiting for you";
  }
  if (session.status === "stopped") {
    return "Stopped on the machine";
  }
  return "Getting ready";
}

export function Dashboard(props: DashboardProps) {
  const {
    machines,
    sessions,
    inbox,
    serverBaseUrl,
    activeTab,
    selectedMachineId,
    activeSessionId,
    sessionEvents,
    composer,
    notificationsEnabled,
    onSelectTab,
    onSelectMachine,
    onSelectSession,
    onComposerChange,
    onSendInput,
    onLaunchSession,
    onPowerChange,
    onMarkInboxRead,
    onToggleNotifications
  } = props;

  const selectedMachine = machines.find((machine) => machine.machineId === selectedMachineId) ?? machines[0] ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const onlineMachines = machines.filter((machine) => machine.online).length;
  const attentionSessions = sessions.filter((session) => session.attention !== "idle").length;

  const homeView = (
    <div className="tab-body">
      <section className="panel hero-panel">
        <div className="section-header stack-on-mobile">
          <div>
            <span className="eyebrow">Bridge Home</span>
            <h2>Phone-first remote control for the machines doing the actual work.</h2>
          </div>
          <div className="mini-stat-grid">
            <div className="mini-stat">
              <strong>{onlineMachines}</strong>
              <span>online</span>
            </div>
            <div className="mini-stat">
              <strong>{sessions.length}</strong>
              <span>sessions</span>
            </div>
            <div className="mini-stat">
              <strong>{attentionSessions}</strong>
              <span>attention</span>
            </div>
          </div>
        </div>
        <p className="muted">
          Codex is the default pilot, but the launcher also offers Claude Code, Gemini CLI, and raw terminal when the machine can support them.
        </p>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Machines</span>
            <h2>Pick a machine, then launch like you mean it.</h2>
          </div>
        </div>
        <div className="stack-list">
          {machines.map((machine) => (
            <button key={machine.machineId} className={`machine-card ${selectedMachine?.machineId === machine.machineId ? "selected-card" : ""}`} onClick={() => onSelectMachine(machine.machineId)} type="button">
              <div className="row-header">
                <strong>{machine.hostname}</strong>
                <span className={`status-pill tone-${machine.online ? "good" : "danger"}`}>{machine.online ? "Online" : "Offline"}</span>
              </div>
              <div className="muted">{machine.capabilities.os.platform} / {machine.capabilities.os.arch}</div>
              <div className="capability-row">
                <span className={`capability-pill ${machine.capabilities.cli.codex.launchable ? "capability-good" : ""}`}>Codex {machine.capabilities.cli.codex.version ?? ""}</span>
                <span className={`capability-pill ${machine.capabilities.cli.claude.launchable ? "capability-good" : ""}`}>Claude</span>
                <span className={`capability-pill ${machine.capabilities.cli.gemini.launchable ? "capability-good" : ""}`}>Gemini</span>
                <span className={`capability-pill ${machine.capabilities.terminal.supportsInteractivePty ? "capability-good" : ""}`}>PTY</span>
              </div>
              <div className="muted">Daemon: {machine.daemonConnected ? "connected" : "missing"} • Power: {machine.powerPolicy.mode}</div>
            </button>
          ))}
        </div>
      </section>

      {selectedMachine ? (
        <section className="panel">
          <div className="section-header">
            <div>
              <span className="eyebrow">Machine</span>
              <h2>{selectedMachine.hostname}</h2>
            </div>
            <span className="status-pill">{selectedMachine.online ? "remote ready" : "awaiting daemon"}</span>
          </div>
          <div className="button-grid">
            <button className="launch-button primary" onClick={() => onLaunchSession(selectedMachine.machineId, "codex")} type="button">
              Launch Codex
            </button>
            <button className="launch-button" disabled={!selectedMachine.capabilities.cli.claude.launchable} onClick={() => onLaunchSession(selectedMachine.machineId, "claude")} type="button">
              Claude Code
            </button>
            <button className="launch-button" disabled={!selectedMachine.capabilities.cli.gemini.launchable} onClick={() => onLaunchSession(selectedMachine.machineId, "gemini")} type="button">
              Gemini CLI
            </button>
            <button className="launch-button" disabled={!selectedMachine.capabilities.terminal.supportsInteractivePty} onClick={() => onLaunchSession(selectedMachine.machineId, "terminal")} type="button">
              Terminal
            </button>
          </div>
          <div className="machine-health">
            <div className="health-chip">Server: {serverBaseUrl || "missing"}</div>
            <div className="health-chip">Wake policy: {selectedMachine.powerPolicy.mode}</div>
            <div className="health-chip">Ownership: remote active</div>
          </div>
          <div className="power-grid">
            {(["normal", "stay-awake-during-activity", "always-awake"] as const).map((mode) => (
              <button
                key={mode}
                className={`power-button ${selectedMachine.powerPolicy.mode === mode ? "power-active" : ""}`}
                onClick={() => onPowerChange(selectedMachine.machineId, mode)}
                type="button"
              >
                {mode}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );

  const sessionsView = (
    <div className="tab-body">
      <section className="panel">
        <div className="section-header stack-on-mobile">
          <div>
            <span className="eyebrow">Sessions</span>
            <h2>Live work, grouped by whatever is currently stealing your attention.</h2>
          </div>
          <span className="muted">Tap a session to open the mobile transcript or terminal view.</span>
        </div>
        <div className="stack-list">
          {sessions.map((session) => (
            <button key={session.id} className={`session-card ${activeSession?.id === session.id ? "selected-card" : ""}`} onClick={() => onSelectSession(session.id)} type="button">
              <div className="row-header">
                <strong>{session.title}</strong>
                <span className={`status-pill tone-${statusTone(session.status)}`}>{session.status}</span>
              </div>
              <div className="muted">{runtimeLabel(session)} • {session.cwd}</div>
              <div className="session-metadata">
                <span className="session-tag">{session.owner}</span>
                <span className="session-tag">{session.unreadCount} unread</span>
                <span className="session-tag">{formatTime(session.lastEventAt)}</span>
              </div>
              <div className="muted">{statusCopy(session)}</div>
            </button>
          ))}
        </div>
      </section>

      {activeSession ? (
        <section className="panel session-view">
          <div className="section-header">
            <div>
              <span className="eyebrow">Session View</span>
              <h2>{activeSession.title}</h2>
            </div>
            <span className={`status-pill tone-${statusTone(activeSession.status)}`}>{activeSession.status}</span>
          </div>
          <div className="session-banner">
            <span>Owner: {activeSession.owner}</span>
            <span>Attention: {activeSession.attention}</span>
            <span>{activeSession.runtime === "terminal-session" ? activeSession.terminalBackend ?? "pending" : runtimeLabel(activeSession)}</span>
          </div>
          <div className={`live-status live-status-${statusTone(activeSession.status)}`}>
            <strong>{statusCopy(activeSession)}</strong>
            <span>{activeSession.runtime === "terminal-session" ? "Phone terminal mode" : "Chat mode"} • {formatTime(activeSession.lastEventAt)}</span>
          </div>
          <div className={`transcript ${activeSession.runtime === "terminal-session" ? "terminal-transcript" : ""}`}>
            {sessionEvents.length === 0 ? (
              <div className="transcript-bubble muted">No events yet. The session is either shy or brand new.</div>
            ) : (
              sessionEvents.map((event) => (
                <div key={event.id} className={`transcript-bubble bubble-${event.kind}`}>
                  <span className="bubble-kind">{event.kind}</span>
                  <pre>{event.data}</pre>
                </div>
              ))
            )}
          </div>
          <div className="composer-bar">
            <input value={composer} onChange={(event) => onComposerChange(event.target.value)} placeholder={activeSession.runtime === "terminal-session" ? "Type shell input" : "Send a prompt"} />
            <button className="cta-button" onClick={onSendInput} type="button">Send</button>
          </div>
        </section>
      ) : null}
    </div>
  );

  const inboxView = (
    <div className="tab-body">
      <section className="panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Inbox</span>
            <h2>Everything that wants your attention without texting your soul at 2 AM.</h2>
          </div>
        </div>
        <div className="stack-list">
          {inbox.map((item) => (
            <button key={item.id} className={`inbox-card ${item.readAt ? "read-card" : "unread-card"}`} onClick={() => onMarkInboxRead(item.id)} type="button">
              <div className="row-header">
                <strong>{item.title}</strong>
                <span className={`status-pill tone-${item.level === "critical" || item.level === "warning" ? "danger" : item.level === "success" ? "good" : "neutral"}`}>
                  {item.level}
                </span>
              </div>
              <div>{item.body}</div>
              <div className="muted">{item.category} • {formatTime(item.createdAt)}</div>
            </button>
          ))}
          {inbox.length === 0 ? <div className="empty-state">No inbox items yet. Suspiciously peaceful.</div> : null}
        </div>
      </section>
    </div>
  );

  const settingsView = (
    <div className="tab-body">
      <section className="panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Settings</span>
            <h2>Phone-friendly controls for the parts that matter.</h2>
          </div>
        </div>
        <div className="settings-list">
          <div className="settings-row">
            <div>
              <strong>Bridge server</strong>
              <div className="muted">{serverBaseUrl || "Not configured yet"}</div>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <strong>Browser notifications</strong>
              <div className="muted">Ready/done, approval, and machine alerts while this tab is open.</div>
            </div>
            <button className={`power-button ${notificationsEnabled ? "power-active" : ""}`} onClick={onToggleNotifications} type="button">
              {notificationsEnabled ? "Enabled" : "Enable"}
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>Remote handoff</strong>
              <div className="muted">Bridge marks active phone sessions as remote-owned when you interact.</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <section className="product-shell">
      <nav className="tabbar">
        {([
          ["home", "Home"],
          ["sessions", "Sessions"],
          ["inbox", "Inbox"],
          ["settings", "Settings"]
        ] as const).map(([tab, label]) => (
          <button key={tab} className={`tabbar-button ${activeTab === tab ? "tabbar-active" : ""}`} onClick={() => onSelectTab(tab)} type="button">
            {label}
          </button>
        ))}
      </nav>
      {activeTab === "home" ? homeView : null}
      {activeTab === "sessions" ? sessionsView : null}
      {activeTab === "inbox" ? inboxView : null}
      {activeTab === "settings" ? settingsView : null}
    </section>
  );
}
