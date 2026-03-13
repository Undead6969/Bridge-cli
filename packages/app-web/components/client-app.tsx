"use client";

import type { InboxItem, MachineRecord, SessionRecord, SessionStreamEvent } from "@bridge/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Dashboard } from "./dashboard";

const tokenKey = "bridge-auth-token";
const serverUrlKey = "bridge-server-url";
const notificationsKey = "bridge-notifications-enabled";

async function fetchJson<T>(base: string, path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "bypass-tunnel-reminder": "bridge",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

function websocketUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("role", "subscriber");
  url.searchParams.set("token", token);
  return url.toString();
}

export function ClientApp({
  fallbackMachines,
  fallbackSessions
}: {
  fallbackMachines: MachineRecord[];
  fallbackSessions: SessionRecord[];
}) {
  const [token, setToken] = useState<string | null>(null);
  const [machines, setMachines] = useState<MachineRecord[]>(fallbackMachines);
  const [sessions, setSessions] = useState<SessionRecord[]>(fallbackSessions);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [pairingCode, setPairingCode] = useState("");
  const [exchangeCode, setExchangeCode] = useState("");
  const [error, setError] = useState("");
  const [pairingUrl, setPairingUrl] = useState("");
  const [isPairing, setIsPairing] = useState(false);
  const [pairingMessage, setPairingMessage] = useState("Scan the QR or type the 6-digit code.");
  const [serverBaseUrl, setServerBaseUrl] = useState(process.env.NEXT_PUBLIC_BRIDGE_SERVER_URL ?? "");
  const [activeTab, setActiveTab] = useState<"home" | "sessions" | "inbox" | "settings">("home");
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(fallbackMachines[0]?.machineId ?? null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(fallbackSessions[0]?.id ?? null);
  const [sessionEvents, setSessionEvents] = useState<SessionStreamEvent[]>([]);
  const [composer, setComposer] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [reconnectHint, setReconnectHint] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const seenInboxIds = useRef<Set<string>>(new Set());

  const hostedAppOrigin = useMemo(() => {
    const publicUrl = process.env.NEXT_PUBLIC_BRIDGE_APP_URL;
    if (publicUrl) {
      return publicUrl.replace(/\/$/, "");
    }
    if (typeof window === "undefined") {
      return "http://127.0.0.1:3000";
    }
    return window.location.origin;
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  useEffect(() => {
    const storedServerUrl = window.localStorage.getItem(serverUrlKey);
    const storedToken = window.localStorage.getItem(tokenKey);
    const storedNotifications = window.localStorage.getItem(notificationsKey);
    if (storedToken) {
      setToken(storedToken);
    }
    if (storedServerUrl) {
      setServerBaseUrl(storedServerUrl);
    }
    setNotificationsEnabled(storedNotifications === "true");

    const params = new URLSearchParams(window.location.search);
    const pairCode = params.get("pairCode");
    const serverUrl = params.get("serverUrl");
    if (pairCode) {
      setExchangeCode(pairCode);
    }
    if (serverUrl) {
      setServerBaseUrl(serverUrl);
      window.localStorage.setItem(serverUrlKey, serverUrl);
    }
  }, []);

  useEffect(() => {
    if (!exchangeCode || token || isPairing || !serverBaseUrl) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (!params.get("pairCode")) {
      return;
    }

    const pairFromLink = async () => {
      setIsPairing(true);
      setPairingMessage("Pairing browser from the link...");
      try {
        const payload = await fetchJson<{ token: string }>(serverBaseUrl, "/auth/pairings/exchange", undefined, {
          method: "POST",
          body: JSON.stringify({ code: exchangeCode, label: "web-client" })
        });
        setToken(payload.token);
        setError("");
        setPairingMessage("Browser paired. You are now legally allowed to feel powerful.");
        params.delete("pairCode");
        params.delete("serverUrl");
        const nextUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
        window.history.replaceState({}, "", nextUrl);
      } catch (exchangeError) {
        setError(exchangeError instanceof Error ? exchangeError.message : "Failed to exchange code");
        setPairingMessage("That pairing link expired or got used already.");
      } finally {
        setIsPairing(false);
      }
    };

    void pairFromLink();
  }, [exchangeCode, isPairing, serverBaseUrl, token]);

  useEffect(() => {
    if (!token || !serverBaseUrl) {
      return;
    }
    window.localStorage.setItem(tokenKey, token);
    window.localStorage.setItem(serverUrlKey, serverBaseUrl);

    let cancelled = false;
    const load = async () => {
      try {
        const [machineData, sessionData, inboxData] = await Promise.all([
          fetchJson<MachineRecord[]>(serverBaseUrl, "/machines", token),
          fetchJson<SessionRecord[]>(serverBaseUrl, "/sessions", token),
          fetchJson<InboxItem[]>(serverBaseUrl, "/inbox", token)
        ]);
        if (cancelled) {
          return;
        }
        setMachines(machineData);
        setSessions(sessionData);
        setInbox(inboxData);
        setSelectedMachineId((current) => current ?? machineData[0]?.machineId ?? null);
        setActiveSessionId((current) => current ?? sessionData[0]?.id ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load data");
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [serverBaseUrl, token]);

  useEffect(() => {
    window.localStorage.setItem(notificationsKey, notificationsEnabled ? "true" : "false");
  }, [notificationsEnabled]);

  useEffect(() => {
    if (!notificationsEnabled || typeof window === "undefined" || Notification.permission !== "granted") {
      return;
    }
    for (const item of inbox) {
      if (item.readAt || seenInboxIds.current.has(item.id)) {
        continue;
      }
      seenInboxIds.current.add(item.id);
      new Notification(item.title, { body: item.body });
    }
  }, [inbox, notificationsEnabled]);

  useEffect(() => {
    if (!token || !serverBaseUrl || !activeSessionId) {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    let cancelled = false;
    const loadEvents = async () => {
      try {
        const events = await fetchJson<SessionStreamEvent[]>(serverBaseUrl, `/sessions/${activeSessionId}/events`, token);
        if (!cancelled) {
          setSessionEvents(events);
          await fetchJson<SessionRecord>(serverBaseUrl, `/sessions/${activeSessionId}/view`, token, { method: "POST" });
          setSessions((current) =>
            current.map((session) => (session.id === activeSessionId ? { ...session, unreadCount: 0, lastViewedAt: Date.now(), attention: "idle" } : session))
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setReconnectHint(loadError instanceof Error ? loadError.message : "Reconnect failed");
        }
      }
    };

    void loadEvents();

    const socket = new window.WebSocket(websocketUrl(serverBaseUrl, token));
    socketRef.current = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "subscribe", sessionId: activeSessionId }));
      setReconnectHint("");
      void fetchJson<SessionRecord>(serverBaseUrl, `/sessions/${activeSessionId}/owner`, token, {
        method: "POST",
        body: JSON.stringify({ owner: "remote" })
      }).catch(() => undefined);
    });
    socket.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data as string) as
        | { type: "session.snapshot"; session: SessionRecord | null; events: SessionStreamEvent[] }
        | { type: "session.event"; event: SessionStreamEvent }
        | { type: "error"; message: string };
      if (payload.type === "session.snapshot") {
        setSessionEvents(payload.events);
        if (payload.session) {
          const nextSession = payload.session;
          setSessions((current) => current.map((session) => (session.id === nextSession.id ? nextSession : session)));
        }
        return;
      }
      if (payload.type === "session.event") {
        setSessionEvents((current) => [...current, payload.event].slice(-300));
        setSessions((current) =>
          current.map((session) =>
            session.id === payload.event.sessionId
              ? {
                  ...session,
                  lastEventAt: payload.event.at,
                  unreadCount: session.id === activeSessionId ? 0 : session.unreadCount + 1,
                  attention:
                    payload.event.kind === "approval" || payload.event.kind === "blocked"
                      ? "urgent"
                      : payload.event.kind === "ready" || payload.event.kind === "completed"
                        ? "needs-review"
                        : "activity"
                }
              : session
          )
        );
        return;
      }
      setReconnectHint(payload.message);
    });
    socket.addEventListener("close", () => {
      if (!cancelled) {
        setReconnectHint("Realtime feed disconnected. Polling still has your back.");
      }
    });

    return () => {
      cancelled = true;
      socket.close();
      socketRef.current = null;
    };
  }, [activeSessionId, serverBaseUrl, token]);

  const requestPairing = async () => {
    if (!serverBaseUrl) {
      setError("Enter a Bridge server URL first.");
      return;
    }
    const payload = await fetchJson<{ code: string; expiresAt: number }>(serverBaseUrl, "/auth/pairings/request", undefined, {
      method: "POST",
      body: JSON.stringify({ label: "web" })
    });
    setPairingCode(payload.code);
    setPairingUrl(`${hostedAppOrigin}/?pairCode=${payload.code}&serverUrl=${serverBaseUrl}`);
    setError("");
    setPairingMessage("Scan the QR or type the code below.");
  };

  const exchangePairing = async () => {
    try {
      if (!serverBaseUrl) {
        throw new Error("Enter a Bridge server URL first.");
      }
      setIsPairing(true);
      const payload = await fetchJson<{ token: string }>(serverBaseUrl, "/auth/pairings/exchange", undefined, {
        method: "POST",
        body: JSON.stringify({ code: exchangeCode, label: "web-client" })
      });
      setToken(payload.token);
      setError("");
      setPairingMessage("Browser paired and ready.");
    } catch (exchangeError) {
      setError(exchangeError instanceof Error ? exchangeError.message : "Failed to exchange code");
      setPairingMessage("That code did not work. Tiny betrayal, but fixable.");
    } finally {
      setIsPairing(false);
    }
  };

  const launchSession = async (machineId: string, target: "codex" | "claude" | "gemini" | "terminal") => {
    if (!token) {
      setError("Pair this browser first.");
      return;
    }
    const machine = machines.find((item) => item.machineId === machineId);
    if (!machine) {
      return;
    }
    const payload =
      target === "terminal"
        ? { runtime: "terminal-session", cwd: process.env.NEXT_PUBLIC_BRIDGE_DEFAULT_CWD ?? "/", startedBy: "web", shell: machine.capabilities.terminal.shellPath }
        : { runtime: "agent-session", agent: target, cwd: process.env.NEXT_PUBLIC_BRIDGE_DEFAULT_CWD ?? "/", startedBy: "web" };
    const created = await fetchJson<SessionRecord>(serverBaseUrl, `/machines/${machineId}/sessions`, token, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setSessions((current) => [created, ...current.filter((session) => session.id !== created.id)]);
    setActiveSessionId(created.id);
    setActiveTab("sessions");
  };

  const sendInput = () => {
    if (!composer.trim() || !activeSessionId || !socketRef.current || socketRef.current.readyState !== window.WebSocket.OPEN) {
      return;
    }
    socketRef.current.send(JSON.stringify({ type: "input", sessionId: activeSessionId, data: `${composer}\n` }));
    setComposer("");
  };

  const updatePower = async (machineId: string, mode: MachineRecord["powerPolicy"]["mode"]) => {
    if (!token) {
      return;
    }
    const machine = machines.find((item) => item.machineId === machineId);
    if (!machine) {
      return;
    }
    const updated = await fetchJson<MachineRecord>(serverBaseUrl, `/machines/${machineId}/power-policy`, token, {
      method: "PUT",
      body: JSON.stringify({
        ...machine.powerPolicy,
        mode
      })
    });
    setMachines((current) => current.map((item) => (item.machineId === machineId ? updated : item)));
  };

  const markInboxRead = async (id: string) => {
    if (!token) {
      return;
    }
    await fetchJson<InboxItem>(serverBaseUrl, `/inbox/${id}/read`, token, { method: "POST" });
    setInbox((current) => current.map((item) => (item.id === id ? { ...item, readAt: Date.now() } : item)));
  };

  const toggleNotifications = async () => {
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return;
      }
    }
    setNotificationsEnabled((current) => !current);
  };

  return (
    <div className="shell">
      <section className="hero hero-grid">
        <div className="hero-copy">
          <span className="badge">Phone-first / QR + code pairing / runtime switching</span>
          <h1>Bridge turns your laptop into a remote command deck you can actually drive from your phone.</h1>
          <p className="muted hero-text">
            Pair once, then launch Codex, Claude Code, Gemini CLI, or a raw terminal from the same mobile-shaped app.
            If the network hiccups, Bridge reconnects instead of entering interpretive dance.
          </p>
          <div className="stats">
            <div className="stat-card">
              <strong>{machines.length}</strong>
              <span className="muted">machines visible</span>
            </div>
            <div className="stat-card">
              <strong>{sessions.length}</strong>
              <span className="muted">sessions live</span>
            </div>
            <div className="stat-card">
              <strong>{inbox.filter((item) => !item.readAt).length}</strong>
              <span className="muted">inbox items</span>
            </div>
          </div>
          {reconnectHint ? <p className="muted warning-text">{reconnectHint}</p> : null}
        </div>

        <div className="pair-card">
          <div className="pair-card-header">
            <h2>Pair This Browser</h2>
            <span className="status-pill">{token ? "Connected" : "Ready to pair"}</span>
          </div>
          <p className="muted">{pairingMessage}</p>
          <div className="launcher">
            <button className="cta-button" onClick={requestPairing} type="button">
              Generate Pairing Code
            </button>
          </div>
          <div className="launcher pair-controls">
            <input
              className="chip code-input"
              value={serverBaseUrl}
              onChange={(event) => setServerBaseUrl(event.target.value)}
              placeholder="https://your-bridge-server.example.com"
            />
          </div>
          {pairingCode ? (
            <div className="qr-shell">
              <div className="qr-card">
                <QRCodeSVG value={pairingUrl || pairingCode} size={192} />
              </div>
              <div className="code-strip">
                <span className="code-label">Code</span>
                <strong>{pairingCode}</strong>
              </div>
            </div>
          ) : (
            <div className="qr-shell qr-empty">
              <div className="qr-placeholder">QR appears here after you ask nicely.</div>
            </div>
          )}
          <div className="launcher pair-controls">
            <input
              className="chip code-input"
              value={exchangeCode}
              onChange={(event) => setExchangeCode(event.target.value)}
              placeholder="Enter 6-digit code"
            />
            <button className="chip action-button" onClick={exchangePairing} type="button" disabled={isPairing}>
              {isPairing ? "Connecting..." : "Connect"}
            </button>
          </div>
          {error ? <p className="muted danger-text">{error}</p> : null}
        </div>
      </section>

      <Dashboard
        machines={machines}
        sessions={sessions}
        inbox={inbox}
        serverBaseUrl={serverBaseUrl}
        activeTab={activeTab}
        selectedMachineId={selectedMachineId}
        activeSessionId={activeSessionId}
        sessionEvents={sessionEvents}
        composer={composer}
        notificationsEnabled={notificationsEnabled}
        onSelectTab={setActiveTab}
        onSelectMachine={setSelectedMachineId}
        onSelectSession={(sessionId) => {
          setActiveSessionId(sessionId);
          setActiveTab("sessions");
        }}
        onComposerChange={setComposer}
        onSendInput={sendInput}
        onLaunchSession={launchSession}
        onPowerChange={updatePower}
        onMarkInboxRead={markInboxRead}
        onToggleNotifications={toggleNotifications}
      />
    </div>
  );
}
