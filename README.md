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

If you host the web app on Vercel, point the CLI at it so the QR lands on your real app:

```bash
export BRIDGE_APP_URL="https://your-bridge-app.vercel.app"
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

## Vercel

Install the Vercel CLI:

```bash
pnpm add -g vercel@latest
```

Deploy the web app:

```bash
cd packages/app-web
vercel
```

Recommended environment variables:

```bash
NEXT_PUBLIC_BRIDGE_SERVER_URL=https://your-bridge-server.example.com
NEXT_PUBLIC_BRIDGE_APP_URL=https://your-bridge-app.vercel.app
BRIDGE_APP_URL=https://your-bridge-app.vercel.app
```

## Packages

- `@bridge/protocol`: shared schemas and contracts
- `@bridge/sdk`: typed API client
- `@bridge/server`: self-hosted API and realtime relay
- `bridge-daemon`: local daemon and machine supervisor
- `bridge-cli`: remote scripting and session-control CLI
- `@bridge/app-web`: web and PWA client
