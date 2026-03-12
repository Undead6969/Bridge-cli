"use client";

import type { MachineRecord, SessionRecord } from "@bridge/protocol";
import { useEffect, useState } from "react";
import { Dashboard } from "./dashboard";

const tokenKey = "bridge-auth-token";

async function fetchJson<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const base = process.env.NEXT_PUBLIC_BRIDGE_SERVER_URL ?? "http://127.0.0.1:8787";
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

  useEffect(() => {
    const stored = window.localStorage.getItem(tokenKey);
    if (stored) {
      setToken(stored);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    window.localStorage.setItem(tokenKey, token);
    const load = async () => {
      try {
        setMachines(await fetchJson<MachineRecord[]>("/machines", token));
        setSessions(await fetchJson<SessionRecord[]>("/sessions", token));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load data");
      }
    };
    void load();
  }, [token]);

  const requestPairing = async () => {
    const payload = await fetchJson<{ code: string; expiresAt: number }>("/auth/pairings/request", undefined, {
      method: "POST",
      body: JSON.stringify({ label: "web" })
    });
    setPairingCode(payload.code);
    setError("");
  };

  const exchangePairing = async () => {
    try {
      const payload = await fetchJson<{ token: string }>("/auth/pairings/exchange", undefined, {
        method: "POST",
        body: JSON.stringify({ code: exchangeCode, label: "web-client" })
      });
      setToken(payload.token);
      setError("");
    } catch (exchangeError) {
      setError(exchangeError instanceof Error ? exchangeError.message : "Failed to exchange code");
    }
  };

  return (
    <div className="shell">
      <section className="panel">
        <h2>Pair This Browser</h2>
        <p className="muted">
          Use a 6-digit code instead of relying only on QR. Generate a code anywhere,
          then exchange it here once and this browser stays paired.
        </p>
        <div className="launcher">
          <button className="chip" onClick={requestPairing} type="button">
            Generate Pairing Code
          </button>
          {pairingCode ? <span className="chip">Code: {pairingCode}</span> : null}
        </div>
        <div className="launcher">
          <input
            className="chip"
            value={exchangeCode}
            onChange={(event) => setExchangeCode(event.target.value)}
            placeholder="Enter 6-digit code"
          />
          <button className="chip" onClick={exchangePairing} type="button">
            Connect
          </button>
        </div>
        {token ? <p className="muted">Browser paired.</p> : null}
        {error ? <p className="muted">{error}</p> : null}
      </section>
      <Dashboard machines={machines} sessions={sessions} />
    </div>
  );
}
