"use client";

import { QRCodeSVG } from "qrcode.react";
import { exchangePairingCode, requestPairingCode, useBridgeServer } from "@/components/bridge/server-context";
import { useBridgeSync } from "@/components/bridge/sync-store";

export function PairingView() {
  const {
    serverBaseUrl,
    showPairing,
    pairingCode,
    exchangeCode,
    pairingUrl,
    pairingMessage,
    error,
    isPairing,
    hostedAppOrigin,
    setServerBaseUrl,
    setShowPairing,
    setExchangeCode,
    beginPairing,
    finishPairing,
    failPairing,
    setPairingPayload,
    clearError
  } = useBridgeServer();
  const { isConnected } = useBridgeSync();

  if (!showPairing && isConnected) {
    return null;
  }

  return (
    <section className="pairing-shell">
      <div className="pairing-card">
        <div className="pairing-copy">
          <span className="pairing-kicker">Bridge Remote</span>
          <h1>Pair once. Then the web app behaves like an actual app.</h1>
          <p>
            This screen should be a lobby, not a forever home. Once paired, Bridge drops you into the Codex-style shell
            instead of making you live inside setup paperwork.
          </p>
        </div>

        <div className="pairing-form">
          <label className="pairing-label">
            Bridge server
            <input
              value={serverBaseUrl}
              onChange={(event) => {
                clearError();
                setServerBaseUrl(event.target.value);
              }}
              placeholder="https://your-bridge-server.example.com"
            />
          </label>

          <div className="pairing-button-row">
            <button
              className="primary-button"
              onClick={() => {
                if (!serverBaseUrl) {
                  failPairing("Enter a Bridge server URL first.");
                  return;
                }
                void requestPairingCode(serverBaseUrl, hostedAppOrigin)
                  .then(setPairingPayload)
                  .catch((cause) => failPairing(cause instanceof Error ? cause.message : "Failed to request pairing"));
              }}
            >
              Generate pairing code
            </button>
            {isConnected ? (
              <button className="secondary-button" onClick={() => setShowPairing(false)}>
                Back to chats
              </button>
            ) : null}
          </div>

          {pairingUrl ? (
            <div className="pairing-qr-wrap">
              <div className="pairing-qr">
                <QRCodeSVG value={pairingUrl} size={176} includeMargin />
              </div>
              <div className="pairing-code-block">
                <span className="pairing-kicker">Code</span>
                <strong>{pairingCode || "------"}</strong>
                <span>{pairingMessage}</span>
              </div>
            </div>
          ) : null}

          <label className="pairing-label">
            Pair with code
            <input
              value={exchangeCode}
              onChange={(event) => {
                clearError();
                setExchangeCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              placeholder="123456"
              inputMode="numeric"
            />
          </label>

          <button
            className="secondary-button"
            disabled={isPairing || exchangeCode.length !== 6}
            onClick={() => {
              if (!serverBaseUrl) {
                failPairing("Enter a Bridge server URL first.");
                return;
              }
              beginPairing();
              void exchangePairingCode(serverBaseUrl, exchangeCode)
                .then((payload) => finishPairing(payload.token))
                .catch((cause) => failPairing(cause instanceof Error ? cause.message : "Failed to exchange code"));
            }}
          >
            {isPairing ? "Pairing..." : "Connect"}
          </button>

          <div className="pairing-status">
            <span>{pairingMessage}</span>
            {error ? <strong>{error}</strong> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
