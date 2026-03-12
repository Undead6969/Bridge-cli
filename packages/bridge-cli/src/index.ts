#!/usr/bin/env node
import { BridgeSdk } from "@bridge/sdk";
import { Command } from "commander";
import qrcode from "qrcode-terminal";
import { clearAuthToken, readAuthToken, writeAuthToken } from "./auth.js";

const baseUrl = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:8787";
const appUrl = process.env.BRIDGE_APP_URL ?? "https://app-web-sand.vercel.app";
const auth = readAuthToken();
const sdk = new BridgeSdk(baseUrl, auth?.token);
const program = new Command();

program.name("bridge").description("Remote scripting and session-control CLI");

async function printPairing(label: string): Promise<void> {
  const publicSdk = new BridgeSdk(baseUrl);
  const pairing = await publicSdk.createPairing(label);
  const url = new URL(appUrl);
  url.searchParams.set("pairCode", pairing.code);
  qrcode.generate(url.toString(), { small: true });
  console.log(`\nCode: ${pairing.code}`);
  console.log(`Open: ${url.toString()}\n`);
}

const authCommand = program.command("auth").description("Pairing code auth");

authCommand
  .command("pair")
  .option("--label <label>", "Label for the requesting device", "bridge")
  .action(async (options) => {
    await printPairing(options.label);
  });

authCommand
  .command("login")
  .requiredOption("--code <code>", "6 digit pairing code")
  .option("--label <label>", "Label for this device", "bridge-cli")
  .action(async (options) => {
    const publicSdk = new BridgeSdk(baseUrl);
    const token = await publicSdk.exchangePairing(options.code, options.label);
    writeAuthToken(token);
    console.log(JSON.stringify(token, null, 2));
  });

authCommand.command("logout").action(() => {
  clearAuthToken();
  console.log(JSON.stringify({ ok: true }, null, 2));
});

program
  .command("connect")
  .description("Generate a QR and 6-digit code for pairing a browser or phone")
  .option("--label <label>", "Label for the requesting device", "bridge")
  .action(async (options) => {
    await printPairing(options.label);
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

program
  .command("machines")
  .description("List machines")
  .action(async () => {
    console.log(JSON.stringify(await sdk.listMachines(), null, 2));
  });

const machine = program.command("machine").description("Machine operations");

machine
  .command("capabilities")
  .argument("<machineId>")
  .action(async (machineId) => {
    console.log(JSON.stringify((await sdk.getMachine(machineId)).capabilities, null, 2));
  });

machine
  .command("power")
  .argument("<machineId>")
  .argument("<mode>")
  .action(async (machineId, mode) => {
    const machineRecord = await sdk.getMachine(machineId);
    const updated = await sdk.updatePowerPolicy(machineId, {
      ...machineRecord.powerPolicy,
      mode
    });
    console.log(JSON.stringify(updated.powerPolicy, null, 2));
  });

const session = program.command("session").description("Agent session operations");

session
  .command("start")
  .requiredOption("--machine <machineId>")
  .requiredOption("--agent <agent>")
  .requiredOption("--cwd <cwd>")
  .action(async (options) => {
    const created = await sdk.createSession(options.machine, {
      runtime: "agent-session",
      agent: options.agent,
      cwd: options.cwd,
      startedBy: "bridge"
    });
    console.log(JSON.stringify(created, null, 2));
  });

session
  .command("attach")
  .argument("<sessionId>")
  .action(async (sessionId) => {
    const socket = sdk.subscribe(sessionId, {
      onSnapshot: (payload) => {
        payload.events.forEach((event) => process.stdout.write(event.data));
      },
      onEvent: (event) => {
        process.stdout.write(event.data);
      },
      onError: (message) => {
        process.stderr.write(`${message}\n`);
      }
    });
    process.on("SIGINT", () => socket.close());
    await new Promise(() => undefined);
  });

session
  .command("send")
  .argument("<sessionId>")
  .argument("<text>")
  .action(async (sessionId, text) => {
    const socket = sdk.subscribe(sessionId, {});
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "input", sessionId, data: `${text}\n` }));
      setTimeout(() => socket.close(), 50);
    });
    await new Promise((resolve) => socket.on("close", resolve));
  });

session
  .command("stop")
  .argument("<sessionId>")
  .action(async (sessionId) => {
    console.log(JSON.stringify(await sdk.stopSession(sessionId), null, 2));
  });

program
  .command("terminal")
  .description("Start terminal session")
  .requiredOption("--machine <machineId>")
  .requiredOption("--cwd <cwd>")
  .action(async (options) => {
    const created = await sdk.createSession(options.machine, {
      runtime: "terminal-session",
      cwd: options.cwd,
      startedBy: "bridge"
    });
    console.log(JSON.stringify(created, null, 2));
  });

program
  .command("terminal-attach")
  .argument("<sessionId>")
  .description("Attach to a terminal session stream")
  .action(async (sessionId) => {
    const socket = sdk.subscribe(sessionId, {
      onSnapshot: (payload) => {
        payload.events.forEach((event) => process.stdout.write(event.data));
      },
      onEvent: (event) => {
        process.stdout.write(event.data);
      },
      onError: (message) => {
        process.stderr.write(`${message}\n`);
      }
    });
    process.on("SIGINT", () => socket.close());
    await new Promise(() => undefined);
  });

if (process.argv.length <= 2) {
  await printPairing("bridge");
} else {
  await program.parseAsync(process.argv);
}
