"use client";

import type { MachineRecord, SessionRecord } from "@bridge/protocol";
import { BridgeServerProvider } from "@/components/bridge/server-context";
import { BridgeSyncProvider } from "@/components/bridge/sync-store";
import { PairingView } from "@/components/bridge/pairing-view";
import { BridgeAppShell } from "@/components/bridge/app-shell";

export function ClientApp({
  fallbackMachines,
  fallbackSessions
}: {
  fallbackMachines: MachineRecord[];
  fallbackSessions: SessionRecord[];
}) {
  return (
    <BridgeServerProvider>
      <BridgeSyncProvider fallbackMachines={fallbackMachines} fallbackSessions={fallbackSessions}>
        <BridgeContent />
      </BridgeSyncProvider>
    </BridgeServerProvider>
  );
}

function BridgeContent() {
  return (
    <div className="bridge-root">
      <PairingView />
      <BridgeAppShell />
    </div>
  );
}
