"use client";

import type { MachineRecord, SessionRecord } from "@bridge/protocol";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Dashboard } from "./dashboard";

const tokenKey = "bridge-auth-token";
const serverUrlKey = "bridge-server-url";

async function fetchJson<T>(base: string, path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
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
  const [pairingCode, setPairingCode] = useState("");
  const [exchangeCode, setExchangeCode] = useState("");
  const [error, setError] = useState("");
  const [pairingUrl, setPairingUrl] = useState("");
  const [isPairing, setIsPairing] = useState(false);
  const [pairingMessage, setPairingMessage] = useState("Scan the QR or type the 6-digit code.");
  const [serverBaseUrl, setServerBaseUrl] = useState(process.env.NEXT_PUBLIC_BRIDGE_SERVER_URL ?? "");

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
    const storedServerUrl = window.localStorage.getItem(serverUrlKey);
    const stored = window.localStorage.getItem(tokenKey);
    if (stored) {
      setToken(stored);
    }
    if (storedServerUrl) {
      setServerBaseUrl(storedServerUrl);
    }

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
        setPairingMessage("Browser paired. You can toss the QR confetti now.");
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
    setPairingMessage("Browser paired and ready.");
    const load = async () => {
      try {
        setMachines(await fetchJson<MachineRecord[]>(serverBaseUrl, "/machines", token));
        setSessions(await fetchJson<SessionRecord[]>(serverBaseUrl, "/sessions", token));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load data");
      }
    };
    void load();
  }, [serverBaseUrl, token]);

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

  return (
    <div className="shell">
      <section className="hero hero-grid">
        <div className="hero-copy">
          <span className="badge">Remote CLI / Web-first / Phone-ready</span>
          <h1>Bridge opens your machine from the command line to the browser in one scan.</h1>
          <p className="muted hero-text">
            Run <code>bridge</code>, scan the QR, and jump straight into your machine dashboard.
            The numeric code sits below the QR for moments when cameras decide to become performance artists.
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
              <strong>{token ? "paired" : "awaiting link"}</strong>
              <span className="muted">browser state</span>
            </div>
          </div>
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
      <Dashboard machines={machines} sessions={sessions} serverBaseUrl={serverBaseUrl} />
    </div>
  );
}
