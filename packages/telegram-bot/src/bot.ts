import { BridgeSdk } from "@bridge/sdk";
import { readTelegramConfig, updateTelegramConfig, writeTelegramConfig, type TelegramConfig } from "./config.js";

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: {
      id: number;
      type: string;
    };
  };
};

type MachineChoice = {
  machineId: string;
  hostname: string;
  online: boolean;
};

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function compactText(value: string): string {
  return stripAnsi(value).replace(/\s+/g, " ").trim();
}

function chunkText(value: string, max = 3500): string[] {
  if (value.length <= max) {
    return [value];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    chunks.push(value.slice(start, start + max));
    start += max;
  }
  return chunks;
}

async function telegramApi<T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok || json.result === undefined) {
    throw new Error(json.description ?? `Telegram ${method} failed`);
  }
  return json.result;
}

async function sendMessage(botToken: string, chatId: number, text: string): Promise<void> {
  for (const chunk of chunkText(text)) {
    await telegramApi(botToken, "sendMessage", {
      chat_id: chatId,
      text: chunk
    });
  }
}

async function setCommands(botToken: string): Promise<void> {
  await telegramApi(botToken, "setMyCommands", {
    commands: [
      { command: "start", description: "Link this chat to Bridge" },
      { command: "help", description: "Show command help" },
      { command: "machines", description: "List machines" },
      { command: "use_machine", description: "Select a machine by id or index" },
      { command: "workspaces", description: "List recent workspaces" },
      { command: "use_workspace", description: "Select a workspace path or index" },
      { command: "sessions", description: "List sessions for the current machine/workspace" },
      { command: "use_session", description: "Select a session by id or index" },
      { command: "new_codex", description: "Start a Codex session" },
      { command: "new_terminal", description: "Start a terminal session" },
      { command: "send", description: "Send text to the current session" },
      { command: "tail", description: "Show recent session output" },
      { command: "status", description: "Show current Bridge context" },
      { command: "stop", description: "Stop the current session" },
      { command: "open", description: "Open the web app" }
    ]
  });
}

function parseCommand(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) {
    return null;
  }
  const [rawName, ...rest] = text.trim().split(/\s+/);
  return {
    name: rawName.slice(1).split("@")[0] ?? "",
    args: rest.join(" ").trim()
  };
}

function currentChatKey(chatId: number): string {
  return String(chatId);
}

function isAuthorized(config: TelegramConfig, chatId: number): boolean {
  return config.allowedChatIds.includes(chatId);
}

function authorizeChat(config: TelegramConfig, chatId: number): TelegramConfig {
  if (config.allowedChatIds.includes(chatId)) {
    return config;
  }
  return {
    ...config,
    allowedChatIds: [...config.allowedChatIds, chatId]
  };
}

function getMachineChoices(sdk: BridgeSdk) {
  return sdk.listMachines().then((machines) =>
    machines.map(
      (machine): MachineChoice => ({
        machineId: machine.machineId,
        hostname: machine.hostname,
        online: machine.online
      })
    )
  );
}

async function resolveCurrentMachine(
  config: TelegramConfig,
  chatId: number,
  sdk: BridgeSdk
): Promise<MachineChoice | null> {
  const choices = await getMachineChoices(sdk);
  if (choices.length === 0) {
    return null;
  }
  const key = currentChatKey(chatId);
  const selected = config.currentMachineByChat[key] ?? config.defaultMachineId;
  const found = choices.find((choice) => choice.machineId === selected);
  if (found) {
    return found;
  }
  if (choices.length === 1) {
    return choices[0];
  }
  return null;
}

async function sendSessionInput(config: TelegramConfig, sessionId: string, text: string): Promise<void> {
  const sdk = new BridgeSdk(config.serverUrl, config.bridgeToken);
  const socket = sdk.subscribe(sessionId, {});
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out while sending session input"));
    }, 10_000);
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "input", sessionId, data: `${text}\n` }));
      setTimeout(() => {
        clearTimeout(timeout);
        socket.close();
        resolve();
      }, 120);
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function formatSessionTail(config: TelegramConfig, sessionId: string): Promise<string> {
  const sdk = new BridgeSdk(config.serverUrl, config.bridgeToken);
  const events = await sdk.listSessionEvents(sessionId);
  const interesting = events
    .slice(-12)
    .map((event) => {
      const cleaned = compactText(event.data);
      if (!cleaned) {
        return null;
      }
      const label = event.kind.toUpperCase();
      return `${label}: ${cleaned}`;
    })
    .filter((value): value is string => Boolean(value));

  return interesting.length > 0 ? interesting.join("\n") : "The session is quiet. Very meditative. Almost suspiciously so.";
}

function helpText(config: TelegramConfig): string {
  return [
    "Bridge Telegram controls:",
    "/machines - list machines",
    "/use_machine <index|machineId> - select a machine",
    "/workspaces - list recent workspaces",
    "/use_workspace <index|path> - select a workspace",
    "/sessions - list sessions in the current context",
    "/use_session <index|sessionId> - select a session",
    "/new_codex [path] - start Codex in the current or given workspace",
    "/new_terminal [path] - start a terminal session",
    "/send <message> - send input to the selected session",
    "/tail - show recent session output",
    "/status - show the current machine/workspace/session",
    "/stop - stop the selected session",
    `/open - open ${config.appUrl}`
  ].join("\n");
}

async function handleAuthorizedCommand(
  config: TelegramConfig,
  chatId: number,
  name: string,
  args: string
): Promise<void> {
  const sdk = new BridgeSdk(config.serverUrl, config.bridgeToken);
  const chatKey = currentChatKey(chatId);

  if (name === "help") {
    await sendMessage(config.botToken, chatId, helpText(config));
    return;
  }

  if (name === "machines") {
    const machines = await getMachineChoices(sdk);
    if (machines.length === 0) {
      await sendMessage(config.botToken, chatId, "No machines found yet. Start `bridge` on the host first.");
      return;
    }
    const lines = machines.map((machine, index) => `${index + 1}. ${machine.hostname} (${machine.online ? "online" : "offline"})\n   ${machine.machineId}`);
    await sendMessage(config.botToken, chatId, lines.join("\n\n"));
    return;
  }

  if (name === "use_machine") {
    const machines = await getMachineChoices(sdk);
    if (!args) {
      await sendMessage(config.botToken, chatId, "Use `/use_machine 1` or `/use_machine machine-id`.");
      return;
    }
    const byIndex = Number(args);
    const selected =
      Number.isInteger(byIndex) && byIndex > 0
        ? machines[byIndex - 1]
        : machines.find((machine) => machine.machineId === args);
    if (!selected) {
      await sendMessage(config.botToken, chatId, "Could not find that machine. Telegram is many things, but psychic is still in beta.");
      return;
    }
    writeTelegramConfig({
      ...config,
      currentMachineByChat: {
        ...config.currentMachineByChat,
        [chatKey]: selected.machineId
      },
      currentSessionByChat: {
        ...config.currentSessionByChat,
        [chatKey]: ""
      }
    });
    await sendMessage(config.botToken, chatId, `Using machine: ${selected.hostname}`);
    return;
  }

  const machine = await resolveCurrentMachine(config, chatId, sdk);
  if (!machine) {
    await sendMessage(config.botToken, chatId, "Pick a machine first with `/machines` and `/use_machine`. The bot believes in consent and context.");
    return;
  }

  if (name === "workspaces") {
    const sessions = await sdk.listSessions();
    const workspaces = [...new Set(sessions.filter((session) => session.machineId === machine.machineId).map((session) => session.cwd))];
    if (workspaces.length === 0) {
      await sendMessage(config.botToken, chatId, "No workspaces seen yet on that machine. Start a session once and I’ll stop pretending to be surprised.");
      return;
    }
    const lines = workspaces.map((workspace, index) => `${index + 1}. ${workspace}`);
    await sendMessage(config.botToken, chatId, lines.join("\n"));
    return;
  }

  if (name === "use_workspace") {
    const sessions = await sdk.listSessions();
    const workspaces = [...new Set(sessions.filter((session) => session.machineId === machine.machineId).map((session) => session.cwd))];
    if (!args) {
      await sendMessage(config.botToken, chatId, "Use `/use_workspace 1` or `/use_workspace /absolute/path`.");
      return;
    }
    const byIndex = Number(args);
    const workspace =
      Number.isInteger(byIndex) && byIndex > 0
        ? workspaces[byIndex - 1]
        : args;
    if (!workspace) {
      await sendMessage(config.botToken, chatId, "That workspace did not resolve to a real path.");
      return;
    }
    writeTelegramConfig({
      ...config,
      currentWorkspaceByChat: {
        ...config.currentWorkspaceByChat,
        [chatKey]: workspace
      }
    });
    await sendMessage(config.botToken, chatId, `Using workspace: ${workspace}`);
    return;
  }

  if (name === "sessions") {
    const sessions = await sdk.listSessions();
    const workspace = config.currentWorkspaceByChat[chatKey];
    const filtered = sessions.filter((session) => session.machineId === machine.machineId && (!workspace || session.cwd === workspace));
    if (filtered.length === 0) {
      await sendMessage(config.botToken, chatId, "No sessions in the current context. `/new_codex` is waiting patiently.");
      return;
    }
    const lines = filtered.slice(0, 12).map((session, index) => `${index + 1}. ${session.title} (${session.status})\n   ${session.id}\n   ${session.cwd}`);
    await sendMessage(config.botToken, chatId, lines.join("\n\n"));
    return;
  }

  if (name === "use_session") {
    const sessions = await sdk.listSessions();
    const workspace = config.currentWorkspaceByChat[chatKey];
    const filtered = sessions.filter((session) => session.machineId === machine.machineId && (!workspace || session.cwd === workspace));
    if (!args) {
      await sendMessage(config.botToken, chatId, "Use `/use_session 1` or `/use_session session-id`.");
      return;
    }
    const byIndex = Number(args);
    const session =
      Number.isInteger(byIndex) && byIndex > 0
        ? filtered[byIndex - 1]
        : filtered.find((item) => item.id === args);
    if (!session) {
      await sendMessage(config.botToken, chatId, "That session was not found. The universe remains hostile to vague identifiers.");
      return;
    }
    writeTelegramConfig({
      ...config,
      currentSessionByChat: {
        ...config.currentSessionByChat,
        [chatKey]: session.id
      },
      currentWorkspaceByChat: {
        ...config.currentWorkspaceByChat,
        [chatKey]: session.cwd
      }
    });
    await sendMessage(config.botToken, chatId, `Using session: ${session.title}`);
    return;
  }

  if (name === "new_codex" || name === "new_terminal") {
    const cwd = args || config.currentWorkspaceByChat[chatKey] || "/";
    const created =
      name === "new_codex"
        ? await sdk.createSession(machine.machineId, {
            runtime: "agent-session",
            agent: "codex",
            cwd,
            startedBy: "bridge"
          })
        : await sdk.createSession(machine.machineId, {
            runtime: "terminal-session",
            cwd,
            startedBy: "bridge"
          });

    writeTelegramConfig({
      ...config,
      currentMachineByChat: {
        ...config.currentMachineByChat,
        [chatKey]: machine.machineId
      },
      currentWorkspaceByChat: {
        ...config.currentWorkspaceByChat,
        [chatKey]: created.cwd
      },
      currentSessionByChat: {
        ...config.currentSessionByChat,
        [chatKey]: created.id
      }
    });
    await sendMessage(
      config.botToken,
      chatId,
      `Started ${created.title} on ${machine.hostname}\nSession: ${created.id}\nWorkspace: ${created.cwd}`
    );
    return;
  }

  const currentSessionId = config.currentSessionByChat[chatKey];
  if (name === "status") {
    const workspace = config.currentWorkspaceByChat[chatKey] ?? "not set";
    const sessionLine = currentSessionId ? currentSessionId : "not selected";
    await sendMessage(
      config.botToken,
      chatId,
      `Machine: ${machine.hostname}\nWorkspace: ${workspace}\nSession: ${sessionLine}\nWeb app: ${config.appUrl}`
    );
    return;
  }

  if (name === "open") {
    await sendMessage(config.botToken, chatId, `Open Bridge here: ${config.appUrl}`);
    return;
  }

  if (!currentSessionId) {
    await sendMessage(config.botToken, chatId, "Pick or create a session first. `/new_codex` is the popular kid for a reason.");
    return;
  }

  if (name === "send") {
    if (!args) {
      await sendMessage(config.botToken, chatId, "Use `/send your message here`.");
      return;
    }
    await sendSessionInput(config, currentSessionId, args);
    await sendMessage(config.botToken, chatId, "Sent. The robot has received your tiny scroll.");
    return;
  }

  if (name === "tail") {
    await sendMessage(config.botToken, chatId, await formatSessionTail(config, currentSessionId));
    return;
  }

  if (name === "stop") {
    const session = await sdk.stopSession(currentSessionId);
    await sendMessage(config.botToken, chatId, `Stopped ${session.title}. Everyone may now exhale.`);
    return;
  }

  await sendMessage(config.botToken, chatId, "Unknown command. `/help` knows things.");
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const config = readTelegramConfig();
  if (!config || !update.message?.text) {
    return;
  }

  const chatId = update.message.chat.id;
  const parsed = parseCommand(update.message.text);
  if (!parsed) {
    if (isAuthorized(config, chatId)) {
      await sendMessage(config.botToken, chatId, "Use slash commands here. Telegram freeform chat is charming, but Bridge likes verbs.");
    }
    return;
  }

  if (parsed.name === "start" || parsed.name === "link") {
    if (parsed.args === config.linkCode) {
      writeTelegramConfig(authorizeChat(config, chatId));
      await sendMessage(
        config.botToken,
        chatId,
        "Linked. You can now use `/machines`, `/new_codex`, and friends without ceremonial suffering."
      );
      return;
    }
    if (!isAuthorized(config, chatId)) {
      await sendMessage(config.botToken, chatId, "This chat is not linked yet. Use the link code from `bridge telegram setup`.");
      return;
    }
  }

  if (!isAuthorized(config, chatId)) {
    await sendMessage(config.botToken, chatId, "Unauthorized chat. Use `/start <link-code>` first.");
    return;
  }

  await handleAuthorizedCommand(config, chatId, parsed.name, parsed.args);
}

export async function runTelegramBot(): Promise<void> {
  const config = readTelegramConfig();
  if (!config) {
    throw new Error("Telegram is not configured yet. Run `bridge telegram setup` first.");
  }

  await setCommands(config.botToken);

  while (true) {
    const latest = readTelegramConfig();
    if (!latest) {
      throw new Error("Telegram config disappeared mid-flight. Dramatic, but unhelpful.");
    }
    try {
      const updates = await telegramApi<TelegramUpdate[]>(latest.botToken, "getUpdates", {
        offset: latest.pollOffset ? latest.pollOffset + 1 : undefined,
        timeout: 25,
        allowed_updates: ["message"]
      });
      let lastOffset = latest.pollOffset;
      for (const update of updates) {
        await handleUpdate(update);
        lastOffset = update.update_id;
      }
      if (lastOffset !== latest.pollOffset && lastOffset !== undefined) {
        updateTelegramConfig((config) => ({
          ...config,
          pollOffset: lastOffset
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[telegram] ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}
