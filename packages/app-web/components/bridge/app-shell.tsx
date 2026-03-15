"use client";

import { Bell, Menu, MoreHorizontal, MoonStar, PlugZap, RefreshCcw, Settings, SunMedium } from "lucide-react";
import { PromptBox } from "@/components/ui/chatgpt-prompt-input";
import { useBridgeServer } from "@/components/bridge/server-context";
import { useBridgeSync } from "@/components/bridge/sync-store";
import type { MachineRecord, SessionRecord, SessionStreamEvent } from "@bridge/protocol";
import React from "react";

function workspaceLabel(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? pathname ?? "Root";
}

function formatTime(timestamp?: number) {
  if (!timestamp) return "just now";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function sessionSummary(session: SessionRecord, events: SessionStreamEvent[]) {
  const latest = [...events].reverse().find((event) => event.sessionId === session.id && event.kind !== "input");
  if (!latest) return session.status === "waiting" ? "Ready for your next message." : "Start the conversation.";
  const text = latest.data.replace(/\s+/g, " ").trim();
  if (!text) return session.status;
  return text.slice(0, 120);
}

function sessionMachine(session: SessionRecord, machines: MachineRecord[]) {
  return machines.find((machine) => machine.machineId === session.machineId);
}

function eventBlocks(events: SessionStreamEvent[]) {
  return events.map((event) => {
    const compact = event.data.trim();
    const isUser = event.kind === "input";
    return {
      id: event.id,
      tone:
        event.kind === "approval" || event.kind === "blocked"
          ? "warning"
          : event.kind === "stderr"
            ? "muted"
            : isUser
              ? "user"
              : "agent",
      label:
        event.kind === "approval"
          ? "Approval needed"
          : event.kind === "blocked"
            ? "Blocked"
            : isUser
              ? "You"
              : event.kind === "ready"
                ? "Ready"
                : event.kind === "completed"
                  ? "Completed"
                  : "Codex",
      body: compact || event.kind,
      meta: formatTime(event.at)
    };
  });
}

export function BridgeAppShell() {
  const server = useBridgeServer();
  const sync = useBridgeSync();

  if (!sync.isConnected || server.showPairing) {
    return null;
  }

  const workspaceOptions = Array.from(
    new Map(sync.sessions.map((session) => [session.cwd, { id: session.cwd, label: workspaceLabel(session.cwd) }])).values()
  );

  const visibleSessions =
    sync.selectedWorkspace === "all" ? sync.sessions : sync.sessions.filter((session) => session.cwd === sync.selectedWorkspace);

  const eventCards = eventBlocks(sync.sessionEvents);
  const activeMachine = sync.activeSession ? sessionMachine(sync.activeSession, sync.machines) : sync.machines[0];

  return (
    <section className="codex-shell">
      <aside className={`codex-rail ${sync.mobileSidebarOpen ? "is-open" : ""}`}>
        <div className="codex-brand">
          <div className="codex-brand-mark">B</div>
          <div>
            <strong>Bridge</strong>
            <span>Codex over web, minus the emotional paperwork.</span>
          </div>
        </div>

        <div className="codex-sidebar-block">
          <div className="codex-sidebar-header">
            <span>Your chats</span>
            <button className="sidebar-button" onClick={() => activeMachine && void sync.launchSession(activeMachine.machineId, "codex")}>
              New
            </button>
          </div>

          <label className="workspace-picker">
            <span>Workspace</span>
            <select value={sync.selectedWorkspace} onChange={(event) => sync.setSelectedWorkspace(event.target.value)}>
              <option value="all">All workspaces</option>
              {workspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label}
                </option>
              ))}
            </select>
          </label>

          <div className="session-list">
            {visibleSessions.map((session) => {
              const machine = sessionMachine(session, sync.machines);
              const selected = session.id === sync.activeSessionId;
              return (
                <button
                  key={session.id}
                  className={`session-item ${selected ? "is-active" : ""}`}
                  onClick={() => {
                    sync.setActiveSessionId(session.id);
                    sync.setMobileSidebarOpen(false);
                  }}
                >
                  <div className="session-avatar">{(session.agent ?? "T").slice(0, 1).toUpperCase()}</div>
                  <div className="session-copy">
                    <div className="session-title-row">
                      <strong>{session.title}</strong>
                      <span>{formatTime(session.lastEventAt ?? session.updatedAt)}</span>
                    </div>
                    <span>{machine?.hostname ?? "Unknown machine"}</span>
                    <span>{sessionSummary(session, sync.sessionEvents)}</span>
                  </div>
                  {session.unreadCount ? <span className="session-unread">{session.unreadCount}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="codex-sidebar-footer">
          <button className="footer-item" onClick={() => sync.setSettingsOpen(true)}>
            <Settings size={16} />
            Settings
          </button>
          <button className="footer-item" onClick={() => server.setShowPairing(true)}>
            <PlugZap size={16} />
            Reconnect
          </button>
        </div>
      </aside>

      <main className="codex-main">
        <header className="codex-topbar">
          <button className="topbar-icon mobile-only" onClick={() => sync.setMobileSidebarOpen(true)}>
            <Menu size={16} />
          </button>
          <div className="topbar-title">
            <span>{sync.activeSession?.agent === "codex" ? "Codex" : sync.activeSession?.title ?? "Bridge"}</span>
            <strong>{sync.activeSession?.title ?? "No active session"}</strong>
          </div>
          <div className="topbar-actions">
            <button className="topbar-icon" onClick={() => server.setShowPairing(true)}>
              Pair
            </button>
            <button className="topbar-icon" onClick={() => sync.setSettingsOpen((current) => !current)}>
              <MoreHorizontal size={16} />
            </button>
          </div>
        </header>

        <section className="chat-stage">
          <div className="chat-scroll">
            {sync.activeSession ? (
              <>
                {activeMachine ? (
                  <div className="runtime-strip">
                    <div>
                      <strong>{activeMachine.hostname}</strong>
                      <span>Switch runtimes without leaving the conversation.</span>
                    </div>
                    <div className="runtime-actions">
                      <button className="runtime-chip active">Codex</button>
                      <button className="runtime-chip" onClick={() => void sync.launchSession(activeMachine.machineId, "claude")}>
                        Claude
                      </button>
                      <button className="runtime-chip" onClick={() => void sync.launchSession(activeMachine.machineId, "gemini")}>
                        Gemini
                      </button>
                      <button className="runtime-chip" onClick={() => void sync.launchSession(activeMachine.machineId, "terminal")}>
                        Terminal
                      </button>
                    </div>
                  </div>
                ) : null}

                {!sync.readyForComposer ? (
                  <div className="session-banner">
                    <strong>Waiting for Codex to actually become interactive.</strong>
                    <span>
                      Bridge now checks for a real ready state before letting the chat pretend everything is fine.
                    </span>
                  </div>
                ) : null}

                <div className="transcript-lane">
                  {eventCards.length === 0 ? (
                    <div className="empty-state">
                      <h2>Ready when you are.</h2>
                      <p>Once Codex speaks or you send a prompt, the transcript will show up here without making you scroll through the whole app like a scavenger hunt.</p>
                    </div>
                  ) : (
                    eventCards.map((card) => (
                      <article key={card.id} className={`message-card tone-${card.tone}`}>
                        <span className="message-label">{card.label}</span>
                        <p>{card.body}</p>
                        <span className="message-meta">{card.meta}</span>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h2>Pick a session or start a new one.</h2>
                <p>The goal is “chat app for Codex,” not “dashboard with abandonment issues.”</p>
              </div>
            )}
          </div>

          <div className="composer-dock">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sync.sendComposer();
              }}
              className="composer-wrap"
            >
              <PromptBox
                value={sync.composer}
                onValueChange={sync.setComposer}
                onSubmit={sync.sendComposer}
                placeholder={sync.readyForComposer ? "Ask Codex anything" : "Waiting for Codex to be ready..."}
                disabled={!sync.activeSession || !sync.readyForComposer}
              />
            </form>
          </div>
        </section>
      </main>

      <div className={`settings-drawer ${sync.settingsOpen ? "is-open" : ""}`}>
        <div className="settings-panel">
          <div className="settings-header">
            <strong>Settings</strong>
            <button className="topbar-icon" onClick={() => sync.setSettingsOpen(false)}>
              <MoreHorizontal size={16} />
            </button>
          </div>
          <div className="settings-stack">
            <label className="settings-field">
              <span>Server</span>
              <code>{server.serverBaseUrl || "Not set"}</code>
            </label>
            <div className="settings-row">
              <button className={`settings-pill ${server.theme === "dark" ? "active" : ""}`} onClick={() => server.setTheme("dark")}>
                <MoonStar size={14} />
                Dark
              </button>
              <button className={`settings-pill ${server.theme === "light" ? "active" : ""}`} onClick={() => server.setTheme("light")}>
                <SunMedium size={14} />
                Light
              </button>
            </div>
            <div className="settings-row">
              <button
                className={`settings-pill ${server.notificationsEnabled ? "active" : ""}`}
                onClick={() => server.setNotificationsEnabled((current) => !current)}
              >
                <Bell size={14} />
                Notifications
              </button>
            </div>
            <div className="settings-row">
              <button className="settings-action" onClick={() => server.setShowPairing(true)}>
                <PlugZap size={14} />
                Show pairing
              </button>
              <button className="settings-action danger" onClick={() => server.disconnect()}>
                <RefreshCcw size={14} />
                Restart connection
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
