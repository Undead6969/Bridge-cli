#!/usr/bin/env node
import { BridgeSdk } from "@bridge/sdk";
import { Command } from "commander";
import localtunnel from "localtunnel";
import qrcode from "qrcode-terminal";
import { clearAuthToken, readAuthToken, writeAuthToken } from "./auth.js";

const baseUrl = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:8787";
const appUrl = process.env.BRIDGE_APP_URL ?? "https://app-web-sand.vercel.app";
const auth = readAuthToken();
const sdk = new BridgeSdk(baseUrl, auth?.token);
const program = new Command();

program.name("bridge").description("Remote scripting and session-control CLI");

function isLoopbackUrl(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "0.0.0.0";
}

async function createTunnel(serverUrl: string, subdomain?: string): Promise<{
  url: string;
  close: () => void;
}> {
  const parsed = new URL(serverUrl);
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const tunnel = await localtunnel({
    port,
    subdomain
  });

  return {
    url: tunnel.url,
    close: () => tunnel.close()
  };
}

async function resolvePublicServerUrl(options?: { useTunnel?: boolean; serverUrl?: string; subdomain?: string }): Promise<{
  serverUrl: string;
  close?: () => void;
}> {
  if (options?.serverUrl) {
    return { serverUrl: options.serverUrl };
  }
  if (process.env.BRIDGE_PUBLIC_SERVER_URL) {
    return { serverUrl: process.env.BRIDGE_PUBLIC_SERVER_URL };
  }
  if (!isLoopbackUrl(baseUrl) || options?.useTunnel === false) {
    return { serverUrl: baseUrl };
  }

  const tunnel = await createTunnel(baseUrl, options?.subdomain ?? process.env.BRIDGE_TUNNEL_SUBDOMAIN);
  return {
    serverUrl: tunnel.url,
    close: tunnel.close
  };
}

async function printPairing(label: string, options?: { useTunnel?: boolean; serverUrl?: string; subdomain?: string }): Promise<void> {
  const exposure = await resolvePublicServerUrl(options);
  const publicSdk = new BridgeSdk(exposure.serverUrl);
  const pairing = await publicSdk.createPairing(label);
  const url = new URL(appUrl);
  url.searchParams.set("pairCode", pairing.code);
  url.searchParams.set("serverUrl", exposure.serverUrl);
  qrcode.generate(url.toString(), { small: true });
  console.log(`\nCode: ${pairing.code}`);
  console.log(`Server: ${exposure.serverUrl}`);
  console.log(`Open: ${url.toString()}\n`);

  if (exposure.close) {
    console.log("Tunnel is active. Keep this process running while you use the web app.");
    const cleanup = () => {
      exposure.close?.();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    await new Promise(() => undefined);
  }
}

const authCommand = program.command("auth").description("Pairing code auth");

authCommand
  .command("pair")
  .option("--label <label>", "Label for the requesting device", "bridge")
  .option("--no-tunnel", "Do not create a public tunnel for local servers")
  .option("--server-url <url>", "Explicit public server URL")
  .option("--subdomain <name>", "Preferred localtunnel subdomain")
  .action(async (options) => {
    await printPairing(options.label, {
      useTunnel: options.tunnel,
      serverUrl: options.serverUrl,
      subdomain: options.subdomain
    });
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
  .option("--no-tunnel", "Do not create a public tunnel for local servers")
  .option("--server-url <url>", "Explicit public server URL")
  .option("--subdomain <name>", "Preferred localtunnel subdomain")
  .action(async (options) => {
    await printPairing(options.label, {
      useTunnel: options.tunnel,
      serverUrl: options.serverUrl,
      subdomain: options.subdomain
    });
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
  .command("doctor")
  .description("Check server and daemon reachability")
  .action(async () => {
    const checks = await Promise.all([
      fetch(`${baseUrl}/health`).then((response) => ({ name: "server", ok: response.ok, url: baseUrl })).catch(() => ({ name: "server", ok: false, url: baseUrl })),
      fetch("http://127.0.0.1:8790/machine/capabilities").then((response) => ({ name: "daemon", ok: response.ok, url: "http://127.0.0.1:8790" })).catch(() => ({ name: "daemon", ok: false, url: "http://127.0.0.1:8790" }))
    ]);
    console.log(JSON.stringify(checks, null, 2));
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
  await printPairing("bridge", { useTunnel: true });
} else {
  await program.parseAsync(process.argv);
}
