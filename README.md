# Bridge Platform

Self-hosted, web-first remote CLI platform for Codex, Claude Code, Gemini, and raw terminal access.

## Installation

```bash
npm install -g bridge-cli
```

For local development of the full stack:

```bash
pnpm install
pnpm build
pnpm --filter @bridge/server dev
pnpm --filter bridge-daemon dev
pnpm --filter @bridge/app-web dev
```

## Usage

Generate a QR and 6-digit pairing code:

```bash
bridge connect
```

Log in with a code manually:

```bash
bridge login --code 123456
```

List machines:

```bash
bridge machines
```

Open a terminal session:

```bash
bridge terminal --machine <machine-id> --cwd "$PWD"
```

## Packages

- `@bridge/protocol`: shared schemas and contracts
- `@bridge/sdk`: typed API client
- `@bridge/server`: self-hosted API and realtime relay
- `bridge-daemon`: local daemon and machine supervisor
- `bridge-cli`: remote scripting and session-control CLI
- `@bridge/app-web`: web and PWA client
