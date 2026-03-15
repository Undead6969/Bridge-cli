import {
  doctorReportSchema,
  type DoctorCheck,
  type DoctorReport,
  type GatewayRecord,
  type RuntimeName,
  type RuntimeStatusRecord
} from "@bridge/protocol";
import { existsSync, readFileSync } from "node:fs";
import {
  localStatePaths,
  readGatewaysState,
  readMachineSetupRecord,
  readOwnerRecord,
  readRuntimesState
} from "./local-state.js";
import { buildRuntimeStatus, renderRuntimeFix } from "./runtime-status.js";
import { baseUrl, fetchDaemonCapabilities, isHealthy } from "./services.js";

function addCheck(checks: DoctorCheck[], check: DoctorCheck): void {
  checks.push(check);
}

function runtimeLabel(runtime: RuntimeName): string {
  return runtime === "claude" ? "Claude Code" : runtime === "gemini" ? "Gemini CLI" : runtime === "codex" ? "Codex" : "Terminal";
}

function summarizeGateway(gateway: GatewayRecord): string {
  if (!gateway.enabled) {
    return "disabled";
  }
  if (gateway.linkedIdentities.length > 0) {
    return `${gateway.status} (${gateway.linkedIdentities.length} linked)`;
  }
  return gateway.status;
}

function selectedRuntimeRecord(reportRuntimes: NonNullable<DoctorReport["runtimes"]>): RuntimeStatusRecord {
  if (reportRuntimes.defaultRuntime === "codex") return reportRuntimes.runtimes.codex;
  if (reportRuntimes.defaultRuntime === "claude") return reportRuntimes.runtimes.claude;
  if (reportRuntimes.defaultRuntime === "gemini") return reportRuntimes.runtimes.gemini;
  return reportRuntimes.runtimes.terminal;
}

function readTelegramBotState(): { configured: boolean; linked: number } {
  if (!existsSync(localStatePaths.telegram)) {
    return { configured: false, linked: 0 };
  }
  try {
    const raw = JSON.parse(readFileSync(localStatePaths.telegram, "utf8")) as { allowedChatIds?: number[] };
    return {
      configured: true,
      linked: raw.allowedChatIds?.length ?? 0
    };
  } catch {
    return { configured: true, linked: 0 };
  }
}

export async function buildDoctorReport(verbose = false): Promise<DoctorReport> {
  const owner = readOwnerRecord();
  const machine = readMachineSetupRecord();
  const storedRuntimes = readRuntimesState();
  const gateways = readGatewaysState();
  const daemonHealthy = await isHealthy("http://127.0.0.1:8790/machine/capabilities");
  const serverHealthy = await isHealthy(`${baseUrl}/health`);
  const capabilities = daemonHealthy ? await fetchDaemonCapabilities() : null;

  const runtimes =
    owner
      ? {
          ownerId: owner.ownerId,
          defaultRuntime: owner.defaultRuntime,
          runtimes: {
            codex: await buildRuntimeStatus("codex", capabilities ?? undefined),
            claude: await buildRuntimeStatus("claude", capabilities ?? undefined),
            gemini: await buildRuntimeStatus("gemini", capabilities ?? undefined),
            terminal: await buildRuntimeStatus("terminal", capabilities ?? undefined)
          }
        }
      : storedRuntimes;

  if (runtimes) {
    const selected = selectedRuntimeRecord(runtimes);
    selected.selected = true;
  }

  const checks: DoctorCheck[] = [];

  addCheck(checks, {
    id: "owner",
    label: "Owner setup",
    status: owner ? "pass" : "fail",
    summary: owner ? `${owner.displayLabel} owns this Bridge install.` : "Bridge is not set up yet for an owner.",
    fix: owner ? undefined : "Run `bridge setup` to create the owner + machine configuration."
  });

  addCheck(checks, {
    id: "machine",
    label: "Machine identity",
    status: machine && owner && machine.ownerId === owner.ownerId ? "pass" : "fail",
    summary: machine ? `${machine.hostname} is linked to ${machine.ownerId}.` : "No machine identity found.",
    fix: machine ? undefined : "Run `bridge setup` to create and persist a machine identity."
  });

  addCheck(checks, {
    id: "server",
    label: "Local server",
    status: serverHealthy ? "pass" : "fail",
    summary: serverHealthy ? "bridge-server is healthy." : "bridge-server is not responding.",
    fix: serverHealthy ? undefined : "Run `bridge run` or `bridge doctor --verbose` after starting the local server.",
    details: verbose ? { url: baseUrl } : undefined
  });

  addCheck(checks, {
    id: "daemon",
    label: "Local daemon",
    status: daemonHealthy ? "pass" : "fail",
    summary: daemonHealthy ? "bridge-daemon is healthy." : "bridge-daemon is not responding.",
    fix: daemonHealthy ? undefined : "Run `bridge run` to start the daemon and runtime executor.",
    details: verbose ? { url: "http://127.0.0.1:8790/machine/capabilities" } : undefined
  });

  if (runtimes) {
    for (const runtime of Object.values(runtimes.runtimes)) {
      const isDefault = runtime.runtime === runtimes.defaultRuntime;
      addCheck(checks, {
        id: `runtime:${runtime.runtime}`,
        label: `${runtimeLabel(runtime.runtime)} runtime`,
        status:
          !runtime.installed || !runtime.launchable
            ? isDefault
              ? "fail"
              : "warn"
            : runtime.authState === "authenticated"
              ? "pass"
              : "warn",
        summary: !runtime.installed
          ? `${runtimeLabel(runtime.runtime)} is not installed.`
          : !runtime.launchable
            ? `${runtimeLabel(runtime.runtime)} is installed but not launchable.`
            : runtime.authState === "authenticated"
              ? `${runtimeLabel(runtime.runtime)} is ready.`
              : runtime.authState === "unknown"
                ? `${runtimeLabel(runtime.runtime)} is installed, but auth could not be verified.`
                : `${runtimeLabel(runtime.runtime)} needs authentication.`,
        fix: renderRuntimeFix(runtime),
        details: verbose
          ? {
              executablePath: runtime.executablePath,
              version: runtime.version,
              notes: runtime.notes
            }
          : undefined
      });
    }

    const selected = selectedRuntimeRecord(runtimes);
    addCheck(checks, {
      id: "runtime:default",
      label: "Default runtime",
      status: selected.installed && selected.launchable ? selected.authState === "authenticated" || selected.runtime === "terminal" ? "pass" : "warn" : "fail",
      summary: `${runtimeLabel(selected.runtime)} is the default runtime for this laptop.`,
      fix: renderRuntimeFix(selected)
    });
  } else {
    addCheck(checks, {
      id: "runtime:all",
      label: "Runtime registry",
      status: "fail",
      summary: "Runtime state has not been created yet.",
      fix: "Run `bridge setup` to detect runtimes and choose a default."
    });
  }

  if (gateways) {
    const telegramState = readTelegramBotState();
    for (const gateway of Object.values(gateways.gateways)) {
      const isTelegram = gateway.type === "telegram";
      const configured = gateway.enabled || gateway.status !== "disabled";
      const linked = gateway.linkedIdentities.length > 0 || (isTelegram && telegramState.linked > 0);
      addCheck(checks, {
        id: `gateway:${gateway.type}`,
        label: `${gateway.type} gateway`,
        status: !configured ? "warn" : linked ? "pass" : "warn",
        summary: `${gateway.type} is ${summarizeGateway(gateway)}.`,
        fix:
          gateway.type === "telegram" && !configured
            ? "Run `bridge gateway add telegram` to configure the bot."
            : gateway.type === "telegram" && !linked
              ? "Run `bridge gateway login-code telegram` and link a chat."
              : gateway.type === "whatsapp" && !configured
                ? "Run `bridge gateway add whatsapp` to scaffold the helper."
                : gateway.type === "web" && !linked
                  ? "Run `bridge run` and pair the web app."
                  : undefined,
        details: verbose
          ? {
              configPath: gateway.configPath,
              helperCommand: gateway.helperCommand,
              linkedIdentities: gateway.linkedIdentities
            }
          : undefined
      });
    }
  } else {
    addCheck(checks, {
      id: "gateway:all",
      label: "Gateway registry",
      status: "fail",
      summary: "Gateway state has not been created yet.",
      fix: "Run `bridge setup` to choose and configure a gateway."
    });
  }

  const publicAccessSummary =
    gateways?.primaryGateway === "web"
      ? "Web gateway is primary; QR/tunnel pairing is available on demand."
      : gateways?.primaryGateway === "telegram"
        ? "Telegram gateway is primary; bot access depends on linked chat IDs."
        : gateways?.primaryGateway === "whatsapp"
          ? "WhatsApp gateway is primary; helper scaffolding is expected."
          : "Public access mode is not configured yet.";

  addCheck(checks, {
    id: "gateway:primary",
    label: "Primary gateway",
    status: gateways ? "info" : "fail",
    summary: publicAccessSummary,
    fix: gateways ? undefined : "Run `bridge setup` to choose a primary gateway."
  });

  const ok = checks.every((check) => check.status !== "fail");
  return doctorReportSchema.parse({
    ok,
    owner,
    machine,
    runtimes: runtimes ?? null,
    gateways,
    checks,
    generatedAt: Date.now()
  });
}

export function printDoctorReport(report: DoctorReport, verbose = false): void {
  const groups = report.checks.map((check) => {
    const icon = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : check.status === "fail" ? "FAIL" : "INFO";
    return `${icon} ${check.label}: ${check.summary}${check.fix ? `\n   fix: ${check.fix}` : ""}${
      verbose && check.details ? `\n   details: ${JSON.stringify(check.details)}` : ""
    }`;
  });
  console.log(groups.join("\n\n"));
}
