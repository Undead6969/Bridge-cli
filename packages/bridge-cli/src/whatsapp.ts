import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { localStatePaths, readGatewaysState, upsertGatewayRecord, writeGatewaysState } from "./local-state.js";

export function scaffoldWhatsAppGateway(): void {
  const helperSecret = randomUUID();
  mkdirSync(dirname(localStatePaths.whatsapp), { recursive: true });
  writeFileSync(
    localStatePaths.whatsapp,
    JSON.stringify(
      {
        mode: "scaffolded",
        localhostBind: "127.0.0.1",
        helperSecret,
        linkedPhoneNumbers: [],
        createdAt: Date.now()
      },
      null,
      2
    )
  );

  const gateways = readGatewaysState();
  if (gateways) {
    writeGatewaysState(
      upsertGatewayRecord(gateways, {
        ...gateways.gateways.whatsapp,
        type: "whatsapp",
        enabled: true,
        status: "configured",
        configPath: localStatePaths.whatsapp,
        helperCommand: "bridge gateway add whatsapp",
        isPrimary: gateways.primaryGateway === "whatsapp",
        metadata: {
          localhostBind: "127.0.0.1"
        },
        lastValidatedAt: Date.now()
      })
    );
  }

  console.log(`WhatsApp gateway scaffolded at ${localStatePaths.whatsapp}`);
  console.log("This is helper-only scaffolding for now: localhost-bound, shared-secret ready, and gloriously not public by accident.");
}
