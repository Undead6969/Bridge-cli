#!/usr/bin/env node
import { BridgeSdk } from "@bridge/sdk";
import type { GatewayType, RuntimeName } from "@bridge/protocol";
import { Command } from "commander";
import { clearAuthToken, readAuthToken, writeAuthToken } from "./auth.js";
import { buildDoctorReport, printDoctorReport } from "./doctor.js";
import {
  isSetupComplete,
  localStatePaths,
  readGatewaysState,
  readOwnerRecord,
  upsertGatewayRecord,
  writeGatewaysState
} from "./local-state.js";
import { prompt, selectOne } from "./prompts.js";
import { authenticateRuntime, resetOwnerAuth } from "./runtime-auth.js";
import { runSetup } from "./setup.js";
import {
  appUrl,
  baseUrl,
  ensureLocalServices,
  mintFreshToken,
  printPairing
} from "./services.js";
import {
  printTelegramLoginCode,
  revokeTelegramIdentity,
  setupTelegramGateway,
  startTelegramBot
} from "./telegram.js";
import { scaffoldWhatsAppGateway } from "./whatsapp.js";

const program = new Command();
program.name("bridge").description("Owner-first remote coding control plane");

function currentSdk(): BridgeSdk {
  const auth = readAuthToken();
  return new BridgeSdk(baseUrl, auth?.token);
}

async function runPrimaryFlow(): Promise<void> {
  const owner = readOwnerRecord();
  const gateways = readGatewaysState();
  if (!owner || !gateways) {
    await runSetup();
    return;
  }

  await ensureLocalServices({ startServer: true, startDaemon: true });

  if (gateways.primaryGateway === "telegram" && gateways.gateways.telegram.enabled) {
    console.log("Starting Bridge with Telegram as the primary gateway.");
    startTelegramBot();
    console.log("Telegram bot launched. Use `bridge gateway login-code telegram` to link a chat if needed.");
    await new Promise(() => undefined);
    return;
  }

  if (gateways.primaryGateway === "whatsapp") {
    console.log("WhatsApp is configured as the primary gateway, but the helper is still scaffold-level. Falling back to the web gateway for now.");
  }

  await printPairing("bridge", { useTunnel: true });
}

async function launcherMenu(): Promise<void> {
  const owner = readOwnerRecord();
  console.log("\nBridge\n");
  console.log(owner ? `Owner: ${owner.displayLabel}` : "Owner: not configured");
  console.log("1. Run primary flow");
  console.log("2. Setup / migrate this laptop");
  console.log("3. Authenticate a runtime");
  console.log("4. Gateway actions");
  console.log("5. Doctor");
  console.log("6. Quit\n");

  const choice = await prompt("Pick an option", "1");
  if (choice === "1") {
    await runPrimaryFlow();
    return;
  }
  if (choice === "2") {
    await runSetup();
    return;
  }
  if (choice === "3") {
    const runtime = await selectOne<RuntimeName>(
      "Select a runtime to authenticate",
      [
        { value: "codex", label: "Codex" },
        { value: "claude", label: "Claude Code" },
        { value: "gemini", label: "Gemini CLI" },
        { value: "terminal", label: "Terminal" }
      ],
      "codex"
    );
    await authenticateRuntime(runtime);
    return;
  }
  if (choice === "4") {
    const gatewayAction = await selectOne<"web" | "telegram" | "whatsapp" | "list">(
      "Gateway actions",
      [
        { value: "web", label: "Enable/run web gateway" },
        { value: "telegram", label: "Configure Telegram" },
        { value: "whatsapp", label: "Scaffold WhatsApp" },
        { value: "list", label: "List gateway state" }
      ],
      "list"
    );
    if (gatewayAction === "list") {
      const gateways = readGatewaysState();
      console.log(JSON.stringify(gateways, null, 2));
      return;
    }
    if (gatewayAction === "web") {
      await printPairing("bridge", { useTunnel: true });
      return;
    }
    if (gatewayAction === "telegram") {
      await setupTelegramGateway({ serverUrl: baseUrl, appUrl });
      return;
    }
    scaffoldWhatsAppGateway();
    return;
  }
  if (choice === "5") {
    const report = await buildDoctorReport(false);
    printDoctorReport(report, false);
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  console.log("Bridge launcher closed. Very mature. Very composed.");
}

async function reauthenticateCli(label = "bridge-cli"): Promise<void> {
  await ensureLocalServices({ startServer: true, startDaemon: false });
  clearAuthToken();
  const token = await mintFreshToken(label, baseUrl);
  writeAuthToken(token);
  console.log(`Re-authenticated as ${token.label}. The CLI now has fresh credentials and fewer excuses.`);
}

async function addGateway(type: GatewayType, options?: { botToken?: string; yes?: boolean }): Promise<void> {
  const owner = readOwnerRecord();
  const gateways = readGatewaysState();
  if (!owner || !gateways) {
    console.log("Bridge is not set up yet. Running `bridge setup` first.");
    await runSetup();
  }

  const refreshedGateways = readGatewaysState();
  if (!refreshedGateways) {
    throw new Error("Gateway state is still missing after setup.");
  }

  if (type === "web") {
    const webGateway = refreshedGateways.gateways.web;
    writeGatewaysState(
      upsertGatewayRecord(refreshedGateways, {
        ...webGateway,
        type: "web",
        enabled: true,
        status: webGateway.linkedIdentities.length > 0 ? "linked" : "configured",
        isPrimary: refreshedGateways.primaryGateway === "web",
        configPath: localStatePaths.home,
        metadata: webGateway.metadata ?? {},
        lastValidatedAt: Date.now()
      })
    );
    console.log("Web gateway is enabled.");
    return;
  }

  if (type === "telegram") {
    await ensureLocalServices({ startServer: true, startDaemon: true });
    await setupTelegramGateway({
      serverUrl: baseUrl,
      appUrl,
      botToken: options?.botToken,
      autoConfirm: options?.yes
    });
    return;
  }

  scaffoldWhatsAppGateway();
}

function listGateways(): void {
  const state = readGatewaysState();
  if (!state) {
    console.log("No gateway state found yet. Run `bridge setup`.");
    return;
  }
  for (const gateway of Object.values(state.gateways)) {
    console.log(`${gateway.type}: ${gateway.status}${gateway.isPrimary ? " (primary)" : ""}${gateway.linkedIdentities.length ? ` - ${gateway.linkedIdentities.length} linked` : ""}`);
  }
}

function revokeGateway(target: string): void {
  const gateways = readGatewaysState();
  if (!gateways) {
    throw new Error("Gateway state not found. Run `bridge setup` first.");
  }

  if (target === "telegram") {
    const telegramGateway = gateways.gateways.telegram;
    revokeTelegramIdentity();
    writeGatewaysState(
      upsertGatewayRecord(gateways, {
        ...telegramGateway,
        type: "telegram",
        enabled: false,
        status: "disabled",
        isPrimary: gateways.primaryGateway === "telegram",
        linkedIdentities: [],
        metadata: telegramGateway.metadata ?? {},
        lastValidatedAt: Date.now()
      })
    );
    console.log("Telegram gateway disabled.");
    return;
  }

  if (target === "web" || target === "whatsapp") {
    const currentGateway = gateways.gateways[target];
    writeGatewaysState(
      upsertGatewayRecord(gateways, {
        ...currentGateway,
        type: target,
        enabled: false,
        status: "disabled",
        isPrimary: gateways.primaryGateway === target,
        linkedIdentities: [],
        metadata: currentGateway.metadata ?? {},
        lastValidatedAt: Date.now()
      })
    );
    console.log(`${target} gateway disabled.`);
    return;
  }

  if (revokeTelegramIdentity(target)) {
    const updated = readGatewaysState();
    if (updated) {
      const telegramGateway = updated.gateways.telegram;
      writeGatewaysState(
        upsertGatewayRecord(updated, {
          ...telegramGateway,
          type: "telegram",
          linkedIdentities: telegramGateway.linkedIdentities.filter((identity) => identity.id !== target),
          status: telegramGateway.linkedIdentities.length > 1 ? "linked" : "configured",
          isPrimary: updated.primaryGateway === "telegram",
          metadata: telegramGateway.metadata ?? {},
          lastValidatedAt: Date.now()
        })
      );
    }
    console.log(`Revoked Telegram identity ${target}.`);
    return;
  }

  throw new Error(`No gateway or linked identity matched "${target}"`);
}

async function handleGatewayLoginCode(type: GatewayType, minutes: number, label?: string): Promise<void> {
  if (type === "telegram") {
    printTelegramLoginCode(minutes, label);
    return;
  }
  if (type === "web") {
    await printPairing(label ?? "bridge", { useTunnel: true });
    return;
  }
  throw new Error("WhatsApp login codes are not implemented yet. The scaffold exists; the magic does not.");
}

function requireSetup(): void {
  if (!isSetupComplete()) {
    throw new Error("Bridge is not set up yet. Run `bridge setup` first.");
  }
}

async function runSessionInput(sessionId: string, text: string): Promise<void> {
  const sdk = currentSdk();
  const socket = sdk.subscribe(sessionId, {});
  await new Promise<void>((resolve) => {
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "input", sessionId, data: `${text}\n` }));
      setTimeout(() => socket.close(), 80);
    });
    socket.on("close", () => resolve());
  });
}

program
  .command("setup")
  .description("Create or migrate owner + machine + runtime + gateway state")
  .option("--owner <label>", "Owner label")
  .option("--runtime <runtime>", "Default runtime")
  .option("--gateway <gateway>", "Primary gateway")
  .action(async (options) => {
    await runSetup({
      ownerLabel: options.owner,
      defaultRuntime: options.runtime,
      primaryGateway: options.gateway
    });
  });

const auth = program.command("auth").description("Owner and runtime authentication");
const authRuntime = auth.command("runtime").description("Authenticate runtime CLIs");
authRuntime
  .argument("[runtime]", "codex | claude | gemini | terminal")
  .action(async (runtime: RuntimeName | undefined) => {
    const selected =
      runtime ??
      (await selectOne<RuntimeName>(
        "Authenticate which runtime?",
        [
          { value: "codex", label: "Codex" },
          { value: "claude", label: "Claude Code" },
          { value: "gemini", label: "Gemini CLI" },
          { value: "terminal", label: "Terminal" }
        ],
        "codex"
      ));
    await authenticateRuntime(selected);
  });

auth
  .command("owner")
  .description("Owner auth utilities")
  .argument("<action>", "reset")
  .action((action: string) => {
    if (action !== "reset") {
      throw new Error("Only `bridge auth owner reset` is supported for now.");
    }
    resetOwnerAuth();
  });

const gateway = program.command("gateway").description("Manage owner-scoped gateways");
gateway
  .command("add")
  .argument("<type>", "web | telegram | whatsapp")
  .option("--bot-token <token>", "Telegram bot token")
  .option("--yes", "Skip setup prompts where possible")
  .action(async (type: GatewayType, options) => {
    await addGateway(type, options);
  });

gateway
  .command("list")
  .action(() => {
    listGateways();
  });

gateway
  .command("revoke")
  .argument("<target>", "gateway name or linked identity")
  .action((target) => {
    revokeGateway(target);
  });

gateway
  .command("login-code")
  .argument("<type>", "web | telegram | whatsapp")
  .option("--minutes <minutes>", "How long the code should stay valid", "15")
  .option("--label <label>", "Optional note for the login code")
  .action(async (type: GatewayType, options) => {
    await handleGatewayLoginCode(type, Number(options.minutes), options.label);
  });

program
  .command("doctor")
  .description("Validate owner, machine, runtimes, gateways, and local services")
  .option("--verbose", "Show more diagnostics")
  .action(async (options) => {
    const report = await buildDoctorReport(Boolean(options.verbose));
    printDoctorReport(report, Boolean(options.verbose));
    process.exitCode = report.ok ? 0 : 1;
  });

program
  .command("run")
  .description("Start local services and launch the primary gateway flow")
  .action(async () => {
    requireSetup();
    await runPrimaryFlow();
  });

program
  .command("reauth")
  .description("Rotate the saved CLI auth token")
  .option("--label <label>", "Label for the refreshed CLI token", "bridge-cli")
  .action(async (options) => {
    await reauthenticateCli(options.label);
  });

const telegram = program.command("telegram").description("Compatibility wrapper for Telegram gateway commands");
telegram
  .command("setup")
  .option("--bot-token <token>", "Telegram bot token")
  .option("--yes", "Skip setup prompts where possible")
  .action(async (options) => {
    await addGateway("telegram", { botToken: options.botToken, yes: options.yes });
  });
telegram
  .command("start")
  .action(() => {
    startTelegramBot();
  });
telegram
  .command("login-code")
  .option("--minutes <minutes>", "How long the code should stay valid", "15")
  .option("--label <label>", "Optional note for the login code")
  .action(async (options) => {
    await handleGatewayLoginCode("telegram", Number(options.minutes), options.label);
  });

program
  .command("connect")
  .description("Compatibility shim for web pairing")
  .action(async () => {
    console.log("`bridge connect` is deprecated. Using the owner-first web gateway flow instead.\n");
    await handleGatewayLoginCode("web", 15, "bridge");
  });

program
  .command("host")
  .description("Compatibility shim for the new run flow")
  .action(async () => {
    console.log("`bridge host` is deprecated. Running `bridge run`.\n");
    await runPrimaryFlow();
  });

program
  .command("login")
  .description("Log in with a 6-digit pairing code")
  .requiredOption("--code <code>", "6 digit pairing code")
  .option("--label <label>", "Label for this device", "bridge-cli")
  .action(async (options) => {
    const publicSdk = new BridgeSdk(baseUrl);
    const token = await publicSdk.exchangePairing(options.code, options.label);
    writeAuthToken(token);
    console.log(JSON.stringify(token, null, 2));
  });

program.command("machines").description("List machines").action(async () => {
  console.log(JSON.stringify(await currentSdk().listMachines(), null, 2));
});

const machine = program.command("machine").description("Machine operations");
machine.command("capabilities").argument("<machineId>").action(async (machineId) => {
  console.log(JSON.stringify((await currentSdk().getMachine(machineId)).capabilities, null, 2));
});
machine.command("power").argument("<machineId>").argument("<mode>").action(async (machineId, mode) => {
  const sdk = currentSdk();
  const machineRecord = await sdk.getMachine(machineId);
  const updated = await sdk.updatePowerPolicy(machineId, {
    ...machineRecord.powerPolicy,
    mode
  });
  console.log(JSON.stringify(updated.powerPolicy, null, 2));
});

const session = program.command("session").description("Session operations");
session
  .command("start")
  .requiredOption("--machine <machineId>")
  .requiredOption("--agent <agent>")
  .requiredOption("--cwd <cwd>")
  .action(async (options) => {
    const created = await currentSdk().createSession(options.machine, {
      runtime: "agent-session",
      agent: options.agent,
      cwd: options.cwd,
      startedBy: "bridge"
    });
    console.log(JSON.stringify(created, null, 2));
  });
session.command("attach").argument("<sessionId>").action(async (sessionId) => {
  const socket = currentSdk().subscribe(sessionId, {
    onSnapshot: (payload) => payload.events.forEach((event) => process.stdout.write(event.data)),
    onEvent: (event) => process.stdout.write(event.data),
    onError: (message) => process.stderr.write(`${message}\n`)
  });
  process.on("SIGINT", () => socket.close());
  await new Promise(() => undefined);
});
session.command("send").argument("<sessionId>").argument("<text>").action(async (sessionId, text) => {
  await runSessionInput(sessionId, text);
});
session.command("stop").argument("<sessionId>").action(async (sessionId) => {
  console.log(JSON.stringify(await currentSdk().stopSession(sessionId), null, 2));
});

program
  .command("terminal")
  .description("Start terminal session")
  .requiredOption("--machine <machineId>")
  .requiredOption("--cwd <cwd>")
  .action(async (options) => {
    const created = await currentSdk().createSession(options.machine, {
      runtime: "terminal-session",
      cwd: options.cwd,
      startedBy: "bridge"
    });
    console.log(JSON.stringify(created, null, 2));
  });

if (process.argv.length <= 2) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    if (!isSetupComplete()) {
      await runSetup();
    } else {
      await launcherMenu();
    }
  } else {
    if (!isSetupComplete()) {
      await runSetup({ nonInteractive: true });
    }
    await runPrimaryFlow();
  }
} else {
  await program.parseAsync(process.argv);
}
