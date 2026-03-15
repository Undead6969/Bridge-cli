"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const tokenKey = "bridge-auth-token";
const serverUrlKey = "bridge-server-url";
const notificationsKey = "bridge-notifications-enabled";
const themeKey = "bridge-theme";

export type ThemeMode = "dark" | "light";

type ServerContextValue = {
  serverBaseUrl: string;
  token: string | null;
  notificationsEnabled: boolean;
  theme: ThemeMode;
  showPairing: boolean;
  pairingCode: string;
  exchangeCode: string;
  pairingUrl: string;
  pairingMessage: string;
  error: string;
  isPairing: boolean;
  hostedAppOrigin: string;
  setServerBaseUrl: (value: string) => void;
  setNotificationsEnabled: (value: boolean | ((current: boolean) => boolean)) => void;
  setTheme: (value: ThemeMode) => void;
  setShowPairing: (value: boolean) => void;
  setExchangeCode: (value: string) => void;
  beginPairing: () => void;
  finishPairing: (token: string) => void;
  failPairing: (message: string) => void;
  setPairingPayload: (payload: { code: string; url: string; message: string }) => void;
  clearError: () => void;
  disconnect: () => void;
};

const ServerContext = createContext<ServerContextValue | null>(null);

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
}

export function requiresTunnelBypass(baseUrl: string): boolean {
  try {
    return /\.loca\.lt$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

export function friendlyError(message: string): string {
  const trimmed = message.trim();
  let normalized = trimmed;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: string };
      if (parsed.message) {
        normalized = parsed.message;
      }
    } catch {
      normalized = trimmed;
    }
  }
  if (/Invalid or expired pairing code/i.test(normalized)) {
    return "That code expired or was already used. Press r in Bridge for a fresh one.";
  }
  if (/Body cannot be empty/i.test(normalized)) {
    return "Bridge sent an empty request. Tiny tragedy, fully fixable.";
  }
  if (/Unauthorized|401/i.test(normalized)) {
    return "This browser lost its session. Pair again with the latest code.";
  }
  return normalized;
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

export function BridgeServerProvider({ children }: { children: ReactNode }) {
  const [serverBaseUrl, setServerBaseUrlState] = useState(process.env.NEXT_PUBLIC_BRIDGE_SERVER_URL ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [showPairing, setShowPairing] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [exchangeCode, setExchangeCode] = useState("");
  const [pairingUrl, setPairingUrl] = useState("");
  const [pairingMessage, setPairingMessage] = useState("Scan the QR or type the 6-digit code.");
  const [error, setError] = useState("");
  const [isPairing, setIsPairing] = useState(false);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedServerUrl = window.localStorage.getItem(serverUrlKey);
    const storedToken = window.localStorage.getItem(tokenKey);
    const storedNotifications = window.localStorage.getItem(notificationsKey);
    const storedTheme = window.localStorage.getItem(themeKey) as ThemeMode | null;
    if (storedServerUrl) {
      setServerBaseUrlState(storedServerUrl);
    }
    if (storedToken) {
      setToken(storedToken);
    }
    if (storedNotifications === "true") {
      setNotificationsEnabledState(true);
    }
    if (storedTheme === "light" || storedTheme === "dark") {
      setThemeState(storedTheme);
      applyTheme(storedTheme);
    } else {
      applyTheme("dark");
    }

    const params = new URLSearchParams(window.location.search);
    const pairCode = params.get("pairCode");
    const serverUrl = params.get("serverUrl");
    if (serverUrl) {
      setServerBaseUrlState(serverUrl);
      window.localStorage.setItem(serverUrlKey, serverUrl);
      if (storedServerUrl && storedServerUrl !== serverUrl) {
        window.localStorage.removeItem(tokenKey);
        setToken(null);
      }
    }
    if (pairCode) {
      setExchangeCode(pairCode);
      setShowPairing(true);
    } else if (!storedToken) {
      setShowPairing(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(notificationsKey, notificationsEnabled ? "true" : "false");
  }, [notificationsEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(themeKey, theme);
    applyTheme(theme);
  }, [theme]);

  const setServerBaseUrl = (value: string) => {
    setServerBaseUrlState(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(serverUrlKey, value);
    }
  };

  const setNotificationsEnabled = (value: boolean | ((current: boolean) => boolean)) => {
    setNotificationsEnabledState((current) => (typeof value === "function" ? value(current) : value));
  };

  const setTheme = (value: ThemeMode) => {
    setThemeState(value);
  };

  const beginPairing = () => {
    setIsPairing(true);
    setError("");
  };

  const finishPairing = (nextToken: string) => {
    setToken(nextToken);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(tokenKey, nextToken);
    }
    setPairingMessage("Connected. Opening your remote workspace.");
    setError("");
    setIsPairing(false);
    setShowPairing(false);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.delete("pairCode");
      params.delete("serverUrl");
      const nextUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
      window.history.replaceState({}, "", nextUrl);
    }
  };

  const failPairing = (message: string) => {
    setError(friendlyError(message));
    setPairingMessage("That pairing attempt flopped. Fresh code, same ambition.");
    setIsPairing(false);
  };

  const setPairingPayload = (payload: { code: string; url: string; message: string }) => {
    setPairingCode(payload.code);
    setPairingUrl(payload.url);
    setPairingMessage(payload.message);
    setError("");
  };

  const clearError = () => setError("");

  const disconnect = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(tokenKey);
    }
    setToken(null);
    setShowPairing(true);
    setPairingMessage("Connection reset. Pair again with the latest code.");
    setError("");
  };

  useEffect(() => {
    if (!exchangeCode || isPairing || !serverBaseUrl) {
      return;
    }
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    if (!params?.get("pairCode")) {
      return;
    }
    beginPairing();
    void fetchJson<{ token: string }>(serverBaseUrl, "/auth/pairings/exchange", undefined, {
      method: "POST",
      body: JSON.stringify({ code: exchangeCode, label: "web-client" })
    })
      .then((payload) => finishPairing(payload.token))
      .catch((cause) => failPairing(cause instanceof Error ? cause.message : "Failed to exchange code"));
  }, [exchangeCode, isPairing, serverBaseUrl]);

  const value = useMemo<ServerContextValue>(
    () => ({
      serverBaseUrl,
      token,
      notificationsEnabled,
      theme,
      showPairing,
      pairingCode,
      exchangeCode,
      pairingUrl,
      pairingMessage,
      error,
      isPairing,
      hostedAppOrigin,
      setServerBaseUrl,
      setNotificationsEnabled,
      setTheme,
      setShowPairing,
      setExchangeCode,
      beginPairing,
      finishPairing,
      failPairing,
      setPairingPayload,
      clearError,
      disconnect
    }),
    [
      serverBaseUrl,
      token,
      notificationsEnabled,
      theme,
      showPairing,
      pairingCode,
      exchangeCode,
      pairingUrl,
      pairingMessage,
      error,
      isPairing,
      hostedAppOrigin
    ]
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useBridgeServer() {
  const context = useContext(ServerContext);
  if (!context) {
    throw new Error("useBridgeServer must be used inside BridgeServerProvider");
  }
  return context;
}

export async function requestPairingCode(serverBaseUrl: string, hostedAppOrigin: string) {
  const payload = await fetchJson<{ code: string; expiresAt: number }>(serverBaseUrl, "/auth/pairings/request", undefined, {
    method: "POST",
    body: JSON.stringify({ label: "web" })
  });
  return {
    code: payload.code,
    url: `${hostedAppOrigin}/?pairCode=${payload.code}&serverUrl=${encodeURIComponent(serverBaseUrl)}`,
    message: "Use this QR or code on your phone or another browser."
  };
}

export async function exchangePairingCode(serverBaseUrl: string, code: string) {
  return fetchJson<{ token: string }>(serverBaseUrl, "/auth/pairings/exchange", undefined, {
    method: "POST",
    body: JSON.stringify({ code, label: "web-client" })
  });
}

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission === "denied") {
    return false;
  }
  return (await Notification.requestPermission()) === "granted";
}
