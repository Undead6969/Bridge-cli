"use client";

import type { InboxItem, MachineRecord, SessionRecord, SessionStreamEvent } from "@bridge/protocol";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { friendlyError, requestNotificationPermission, requiresTunnelBypass, useBridgeServer } from "@/components/bridge/server-context";

type SyncContextValue = {
  machines: MachineRecord[];
  sessions: SessionRecord[];
  inbox: InboxItem[];
  activeSessionId: string | null;
  activeSession: SessionRecord | null;
  selectedWorkspace: string;
  sessionEvents: SessionStreamEvent[];
  composer: string;
  reconnectHint: string;
  settingsOpen: boolean;
  mobileSidebarOpen: boolean;
  hasLoadedRemoteData: boolean;
  isConnected: boolean;
  readyForComposer: boolean;
  setSelectedWorkspace: (workspace: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setComposer: (value: string) => void;
  setSettingsOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  setMobileSidebarOpen: (value: boolean) => void;
  launchSession: (machineId: string, target: "codex" | "claude" | "gemini" | "terminal") => Promise<void>;
  sendComposer: () => void;
  updatePower: (machineId: string, mode: MachineRecord["powerPolicy"]["mode"]) => Promise<void>;
  markInboxRead: (id: string) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
  refreshNow: () => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

function websocketUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("role", "subscriber");
  url.searchParams.set("token", token);
  return url.toString();
}

async function fetchJson<T>(base: string, path: string, token?: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined;
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(requiresTunnelBypass(base) ? { "bypass-tunnel-reminder": "bridge" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

function workspaceFromSession(session?: SessionRecord | null): string {
  return session?.cwd ?? "all";
}

function stripAnsi(data: string): string {
  return data
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "");
}

function looksLikeCodexTrustPrompt(data: string): boolean {
  const compact = data.replace(/\s+/g, "");
  return /Doyoutrustthecontentsofthisdirectory\?/i.test(compact) && /Pressentertocontinue/i.test(compact);
}

function sessionReady(session: SessionRecord | null, events: SessionStreamEvent[]): boolean {
  if (!session) {
    return false;
  }
  if (session.runtime === "terminal-session") {
    return session.status !== "stopped" && session.status !== "errored" && session.status !== "offline";
  }
  if (session.status === "waiting" || session.status === "completed") {
    return true;
  }
  const relevant = events.filter((event) => event.sessionId === session.id);
  const combinedText = relevant.map((event) => stripAnsi(event.data)).join(" ");
  if (looksLikeCodexTrustPrompt(combinedText)) {
    return false;
  }
  if (session.status === "running") {
    const hasInteractiveSignal = relevant.some(
      (event) =>
        event.kind === "ready" ||
        event.kind === "stdout" ||
        (event.kind === "system" && /agent backend|trust this workspace/i.test(event.data))
    );
    const hasBlockingSignal = [...relevant].reverse().find(
      (event) => event.kind === "blocked" || event.kind === "approval" || event.kind === "completed"
    );
    if (hasInteractiveSignal && !hasBlockingSignal) {
      return true;
    }
  }
  const lastReady = [...relevant].reverse().find((event) => event.kind === "ready");
  const lastFatal = [...relevant].reverse().find((event) => event.kind === "blocked" || event.kind === "completed");
  if (!lastReady) {
    return false;
  }
  if (!lastFatal) {
    return true;
  }
  return lastReady.at > lastFatal.at;
}

export function BridgeSyncProvider({
  fallbackMachines,
  fallbackSessions,
  children
}: {
  fallbackMachines: MachineRecord[];
  fallbackSessions: SessionRecord[];
  children: ReactNode;
}) {
  const { token, serverBaseUrl, showPairing, notificationsEnabled } = useBridgeServer();
  const [machines, setMachines] = useState(fallbackMachines);
  const [sessions, setSessions] = useState(fallbackSessions);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(fallbackSessions[0]?.id ?? null);
  const [selectedWorkspace, setSelectedWorkspace] = useState("all");
  const [sessionEvents, setSessionEvents] = useState<SessionStreamEvent[]>([]);
  const [composer, setComposer] = useState("");
  const [reconnectHint, setReconnectHint] = useState("");
  const [settingsOpen, setSettingsOpenState] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);
  const [hasLoadedRemoteData, setHasLoadedRemoteData] = useState(false);
  const seenInboxIds = useRef<Set<string>>(new Set());
  const socketRef = useRef<WebSocket | null>(null);
  const autostartedMachineIds = useRef<Set<string>>(new Set());

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  const refreshNow = async () => {
    if (!token || !serverBaseUrl) {
      return;
    }
    const [machineData, sessionData, inboxData] = await Promise.all([
      fetchJson<MachineRecord[]>(serverBaseUrl, "/machines", token),
      fetchJson<SessionRecord[]>(serverBaseUrl, "/sessions", token),
      fetchJson<InboxItem[]>(serverBaseUrl, "/inbox", token)
    ]);
    setMachines(machineData);
    setSessions(sessionData);
    setInbox(inboxData);
    setHasLoadedRemoteData(true);
    setActiveSessionId((current) => {
      if (current && sessionData.some((item) => item.id === current)) {
        return current;
      }
      return sessionData[0]?.id ?? null;
    });
  };

  useEffect(() => {
    if (!token || !serverBaseUrl || showPairing) {
      setHasLoadedRemoteData(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        await refreshNow();
        if (!cancelled) {
          setReconnectHint("");
        }
      } catch (cause) {
        if (!cancelled) {
          setReconnectHint(friendlyError(cause instanceof Error ? cause.message : "Failed to load data"));
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
  }, [token, serverBaseUrl, showPairing]);

  useEffect(() => {
    if (!notificationsEnabled) {
      return;
    }
    void requestNotificationPermission().then((granted) => {
      if (!granted) {
        return;
      }
      for (const item of inbox) {
        if (item.readAt || seenInboxIds.current.has(item.id)) {
          continue;
        }
        seenInboxIds.current.add(item.id);
        new Notification(item.title, { body: item.body });
      }
    });
  }, [inbox, notificationsEnabled]);

  useEffect(() => {
    if (!token || !serverBaseUrl || !activeSessionId || showPairing) {
      socketRef.current?.close();
      socketRef.current = null;
      setSessionEvents([]);
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
            current.map((session) =>
              session.id === activeSessionId
                ? { ...session, unreadCount: 0, lastViewedAt: Date.now(), attention: "idle" }
                : session
            )
          );
        }
      } catch (cause) {
        if (!cancelled) {
          setReconnectHint(friendlyError(cause instanceof Error ? cause.message : "Reconnect failed"));
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
          setSessions((current) => current.map((session) => (session.id === payload.session?.id ? payload.session : session)));
        }
        return;
      }
      if (payload.type === "session.event") {
        setSessionEvents((current) => [...current, payload.event].slice(-400));
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
        setReconnectHint("Realtime feed disconnected. We are polling so the app does not pass out dramatically.");
      }
    });

    return () => {
      cancelled = true;
      socket.close();
      socketRef.current = null;
    };
  }, [activeSessionId, serverBaseUrl, showPairing, token]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    setSelectedWorkspace((current) => (current === "all" ? current : workspaceFromSession(activeSession)));
  }, [activeSession]);

  useEffect(() => {
    if (!token || !serverBaseUrl || showPairing || !hasLoadedRemoteData) {
      return;
    }
    const hasUsableActiveSession = sessions.some(
      (session) =>
        session.runtime === "agent-session" &&
        session.agent === "codex" &&
        session.status !== "stopped" &&
        session.status !== "errored" &&
        session.status !== "offline"
    );
    if (hasUsableActiveSession) {
      return;
    }
    const launchableMachine = machines.find(
      (machine) => machine.online && machine.capabilities.cli.codex.installed && machine.capabilities.cli.codex.launchable
    );
    if (!launchableMachine) {
      return;
    }
    if (autostartedMachineIds.current.has(launchableMachine.machineId)) {
      return;
    }
    autostartedMachineIds.current.add(launchableMachine.machineId);
    void launchSession(launchableMachine.machineId, "codex").catch(() => {
      autostartedMachineIds.current.delete(launchableMachine.machineId);
    });
  }, [token, serverBaseUrl, showPairing, hasLoadedRemoteData, sessions, machines]);

  const launchSession = async (machineId: string, target: "codex" | "claude" | "gemini" | "terminal") => {
    if (!token || !serverBaseUrl) {
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
    setSelectedWorkspace(created.cwd);
    setMobileSidebarOpen(false);
  };

  const sendComposer = () => {
    if (!composer.trim() || !activeSessionId || !socketRef.current || socketRef.current.readyState !== window.WebSocket.OPEN) {
      return;
    }
    socketRef.current.send(JSON.stringify({ type: "input", sessionId: activeSessionId, data: `${composer}\n` }));
    setComposer("");
  };

  const updatePower = async (machineId: string, mode: MachineRecord["powerPolicy"]["mode"]) => {
    if (!token || !serverBaseUrl) {
      return;
    }
    const machine = machines.find((item) => item.machineId === machineId);
    if (!machine) {
      return;
    }
    const updated = await fetchJson<MachineRecord>(serverBaseUrl, `/machines/${machineId}/power-policy`, token, {
      method: "PUT",
      body: JSON.stringify({ ...machine.powerPolicy, mode })
    });
    setMachines((current) => current.map((item) => (item.machineId === machineId ? updated : item)));
  };

  const markInboxRead = async (id: string) => {
    if (!token || !serverBaseUrl) {
      return;
    }
    await fetchJson<InboxItem>(serverBaseUrl, `/inbox/${id}/read`, token, { method: "POST" });
    setInbox((current) => current.map((item) => (item.id === id ? { ...item, readAt: Date.now() } : item)));
  };

  const stopSession = async (sessionId: string) => {
    if (!token || !serverBaseUrl) {
      return;
    }
    const updated = await fetchJson<SessionRecord>(serverBaseUrl, `/sessions/${sessionId}/stop`, token, { method: "POST" });
    setSessions((current) => current.map((item) => (item.id === sessionId ? updated : item)));
  };

  const readyForComposer = useMemo(() => sessionReady(activeSession, sessionEvents), [activeSession, sessionEvents]);
  const isConnected = Boolean(token) && hasLoadedRemoteData;

  const setSettingsOpen = (value: boolean | ((current: boolean) => boolean)) => {
    setSettingsOpenState((current) => (typeof value === "function" ? value(current) : value));
  };

  const value = useMemo<SyncContextValue>(
    () => ({
      machines,
      sessions,
      inbox,
      activeSessionId,
      activeSession,
      selectedWorkspace,
      sessionEvents,
      composer,
      reconnectHint,
      settingsOpen,
      mobileSidebarOpen,
      hasLoadedRemoteData,
      isConnected,
      readyForComposer,
      setSelectedWorkspace,
      setActiveSessionId,
      setComposer,
      setSettingsOpen,
      setMobileSidebarOpen,
      launchSession,
      sendComposer,
      updatePower,
      markInboxRead,
      stopSession,
      refreshNow
    }),
    [
      machines,
      sessions,
      inbox,
      activeSessionId,
      activeSession,
      selectedWorkspace,
      sessionEvents,
      composer,
      reconnectHint,
      settingsOpen,
      mobileSidebarOpen,
      hasLoadedRemoteData,
      isConnected,
      readyForComposer
    ]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useBridgeSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useBridgeSync must be used inside BridgeSyncProvider");
  }
  return context;
}
