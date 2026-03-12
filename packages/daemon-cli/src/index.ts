#!/usr/bin/env node
import { createDaemonApp } from "./app.js";
import { createMachineId } from "./relay.js";

const port = Number(process.env.BRIDGE_DAEMON_PORT ?? 8790);
const host = process.env.BRIDGE_DAEMON_HOST ?? "127.0.0.1";
const machineId = createMachineId();

const { app, relay } = await createDaemonApp(machineId);
relay.start();
await app.listen({ port, host });
console.log(`bridge daemon listening on http://${host}:${port}`);
