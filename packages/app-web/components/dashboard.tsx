import React from "react";
import type { MachineRecord, SessionRecord } from "@bridge/protocol";

type DashboardProps = {
  machines: MachineRecord[];
  sessions: SessionRecord[];
};

export function Dashboard({ machines, sessions }: DashboardProps) {
  return (
    <div className="shell">
      <section className="hero">
        <span className="badge">Self-hosted / Web-first / PWA-ready</span>
        <h1>Bridge turns your laptop into a remote CLI station.</h1>
        <p className="muted">
          Start Codex, Claude Code, Gemini, or a raw shell from the browser and switch
          between them without pretending `command -v` is a product strategy.
        </p>
        <div className="launcher">
          <span className="chip">Launch Codex</span>
          <span className="chip">Launch Claude Code</span>
          <span className="chip">Launch Gemini</span>
          <span className="chip">Open Terminal</span>
        </div>
      </section>

      <div className="grid">
        <section className="panel">
          <h2>Machines</h2>
          <div className="list">
            {machines.map((machine) => (
              <div key={machine.machineId} className="row">
                <strong>{machine.hostname}</strong>
                <div className="muted">{machine.capabilities.os.platform}</div>
                <div className="muted">
                  Codex: {machine.capabilities.cli.codex.installed ? machine.capabilities.cli.codex.version ?? "installed" : "missing"}
                </div>
                <div className="muted">Power: {machine.powerPolicy.mode}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Sessions</h2>
          <div className="list">
            {sessions.map((session) => (
              <div key={session.id} className="row">
                <strong>{session.title}</strong>
                <div className="muted">
                  {session.runtime} / {session.status}
                </div>
                {session.runtime === "terminal-session" ? (
                  <div className="muted">PTY: {session.terminalBackend ?? "pending"}</div>
                ) : null}
                <div className="muted">{session.cwd}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>Terminal Preview</h2>
        <div className="terminal">
          {`$ bridge terminal start --machine laptop --cwd ~/work
session connected
> mobile reconnect ready
> codex wrapper available
> wake lock: active while sessions run`}
        </div>
      </section>
    </div>
  );
}
