import React from "react";
import type { MachineRecord, SessionRecord } from "@bridge/protocol";

type DashboardProps = {
  machines: MachineRecord[];
  sessions: SessionRecord[];
  serverBaseUrl: string;
};

export function Dashboard({ machines, sessions, serverBaseUrl }: DashboardProps) {
  const onlineMachines = machines.filter((machine) => machine.online).length;

  return (
    <>
      <section className="panel accent-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Launch Surface</span>
            <h2>Choose the runtime you want before your coffee cools.</h2>
          </div>
          <p className="muted">
            Codex stays center stage, but Claude Code, Gemini, and a raw terminal are all one tap away.
          </p>
        </div>
        <div className="launcher launch-grid">
          <span className="launch-chip launch-primary">Codex default</span>
          <span className="launch-chip">Claude Code</span>
          <span className="launch-chip">Gemini CLI</span>
          <span className="launch-chip">Terminal</span>
        </div>
      </section>

      <section className="summary-strip">
        <div className="summary-card">
          <span className="eyebrow">Online</span>
          <strong>{onlineMachines}</strong>
          <span className="muted">machines responding</span>
        </div>
        <div className="summary-card">
          <span className="eyebrow">Sessions</span>
          <strong>{sessions.length}</strong>
          <span className="muted">running or recently active</span>
        </div>
        <div className="summary-card">
          <span className="eyebrow">Bridge Server</span>
          <strong>{serverBaseUrl ? "linked" : "missing"}</strong>
          <span className="muted">{serverBaseUrl || "Add a public server URL to pair from the web."}</span>
        </div>
        <div className="summary-card">
          <span className="eyebrow">Wake Policy</span>
          <strong>{machines[0]?.powerPolicy.mode ?? "n/a"}</strong>
          <span className="muted">current default behavior</span>
        </div>
      </section>

      <div className="grid">
        <section className="panel">
          <div className="section-header">
            <div>
              <span className="eyebrow">Machines</span>
              <h2>Active machines</h2>
            </div>
          </div>
          <div className="list">
            {machines.map((machine) => (
              <div key={machine.machineId} className="row machine-row">
                <div className="row-header">
                  <strong>{machine.hostname}</strong>
                  <span className={`status-dot ${machine.online ? "status-online" : "status-offline"}`}>
                    {machine.online ? "online" : "offline"}
                  </span>
                </div>
                <div className="muted">{machine.capabilities.os.platform} / {machine.capabilities.os.arch}</div>
                <div className="muted">
                  Codex: {machine.capabilities.cli.codex.installed ? machine.capabilities.cli.codex.version ?? "installed" : "missing"}
                </div>
                <div className="capability-row">
                  <span className={`capability-pill ${machine.capabilities.cli.codex.launchable ? "capability-good" : ""}`}>Codex</span>
                  <span className={`capability-pill ${machine.capabilities.cli.claude.launchable ? "capability-good" : ""}`}>Claude</span>
                  <span className={`capability-pill ${machine.capabilities.cli.gemini.launchable ? "capability-good" : ""}`}>Gemini</span>
                  <span className={`capability-pill ${machine.capabilities.terminal.supportsInteractivePty ? "capability-good" : ""}`}>PTY</span>
                </div>
                <div className="muted">Power: {machine.powerPolicy.mode}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-header">
            <div>
              <span className="eyebrow">Sessions</span>
              <h2>Recent sessions</h2>
            </div>
          </div>
          <div className="list">
            {sessions.map((session) => (
              <div key={session.id} className="row session-row">
                <div className="row-header">
                  <strong>{session.title}</strong>
                  <span className="session-tag">{session.runtime === "agent-session" ? session.agent ?? "agent" : "terminal"}</span>
                </div>
                <div className="muted session-meta">
                  {session.runtime} / {session.status}
                </div>
                {session.runtime === "terminal-session" ? (
                  <div className="muted">PTY: {session.terminalBackend ?? "pending"}</div>
                ) : null}
                <div className="muted">{session.cwd}</div>
              </div>
            ))}
            {sessions.length === 0 ? (
              <div className="row empty-row">
                <strong>No sessions yet</strong>
                <div className="muted">Launch one from the CLI or the app and it will show up here.</div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel terminal-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Terminal</span>
            <h2>Browser-ready shell preview</h2>
          </div>
        </div>
        <div className="terminal">
          {`$ bridge terminal start --machine laptop --cwd ~/work
session connected
> mobile reconnect ready
> codex wrapper available
> wake lock: active while sessions run`}
        </div>
      </section>
    </>
  );
}
