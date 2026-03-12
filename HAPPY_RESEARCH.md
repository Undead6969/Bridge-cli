# Happy Research Notes

Reference repo: `https://github.com/slopus/happy`
Local copy inspected at `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main`

## What Happy already is

Happy is not just a wrapper around Claude anymore. It is already a remote-control system for:

- Claude Code
- Codex
- Gemini
- mobile app clients
- a web client
- a background daemon on the machine running the agent
- an encrypted sync backend

Their core user pitch is basically the same problem we want to solve: "run the coding agent on your laptop/server, then monitor and control it from your phone or web."

That means this repo is a very strong reference, but we should treat it as a product/architecture benchmark, not as something to clone blindly.

## Monorepo shape

Top-level workspaces:

- `packages/happy-cli`: wrapper CLI users run instead of `claude` or `codex`
- `packages/happy-agent`: control-only CLI for remote session management
- `packages/happy-app`: mobile/web/desktop client
- `packages/happy-server`: backend for auth, sync, presence, storage
- `packages/happy-wire`: shared protocol/message schemas

High-value docs:

- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/docs/cli-architecture.md`
- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/docs/protocol.md`
- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/docs/encryption.md`
- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/docs/plans/happy-agent.md`

## How the system works

### 1. CLI wrapper on the machine

Entry point:

- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-cli/src/index.ts`

Behavior:

- `happy` wraps Claude
- `happy codex` wraps Codex
- it authenticates the machine
- it creates or resumes a remote session
- it starts a daemon when needed
- it forwards agent output into Happy's encrypted session protocol
- it listens for phone/web-originated messages and pushes them back into the local agent

For Codex specifically:

- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-cli/src/codex/runCodex.ts`

This file is the real "Codex remote bridge" heart. It:

- registers the machine
- creates session metadata
- opens an encrypted session
- receives user prompts from remote clients
- starts Codex through an MCP-based client
- maps Codex events into a normalized session protocol
- sends push notifications when the agent is ready or blocked
- supports offline reconnection logic

### 2. Local daemon

Key file:

- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-cli/src/daemon/controlServer.ts`

The daemon runs in the background and exposes localhost IPC endpoints like:

- `/list`
- `/stop-session`
- `/spawn-session`
- `/session-started`
- `/stop`

This is important for our product direction. Happy does not rely on the phone app directly shelling into the laptop. Instead:

- phone/web talks to server
- server talks to daemon/session sockets
- daemon can spawn and track local agent processes

That design is safer and more structured than "open SSH in a trench coat and hope nobody notices."

### 3. Session transport

Key file:

- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-cli/src/api/apiSession.ts`

Transport model:

- HTTP for create/read actions
- Socket.IO for live updates
- encrypted payloads for session metadata, state, and messages

Socket client types:

- `user-scoped`
- `session-scoped`
- `machine-scoped`

The session client:

- decrypts incoming messages
- emits outgoing encrypted user messages
- syncs metadata and agent state
- registers RPC handlers
- exposes a controlled tool/RPC surface to remote clients

### 4. Remote control CLI

Key files:

- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-agent/src/index.ts`
- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-agent/src/session.ts`
- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-agent/src/api.ts`

This package matters a lot for us because it proves Happy already split runtime from control.

`happy-agent` can:

- authenticate
- list sessions
- inspect status
- create sessions
- send prompts
- wait for idle
- read history
- stop sessions

This is close to the product shape we want for "Codex on laptop, control from somewhere else."

### 5. Shared protocol

Key package:

- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-wire/src`

This contains:

- message schemas
- session protocol schemas
- shared types for app/server/CLI

This is a good pattern to copy. If we build our own stack, a shared protocol package will save us from multi-client drift and future self-hatred.

### 6. Backend

Key package:

- `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-server`

The server provides:

- auth
- session creation and listing
- machine registration
- real-time Socket.IO updates
- artifacts/KV/access keys
- persistence and sequencing

Important product detail:

- most interesting user/session content is encrypted client-side before it reaches the server

## Security model

From `docs/encryption.md` and protocol docs:

- session metadata, messages, machine state, artifacts, and KV values are encrypted client-side
- server mostly stores opaque encrypted blobs
- Happy supports legacy NaCl secretbox and newer per-session AES-GCM data keys
- per-session keys are wrapped using public-key crypto and delivered to authorized clients

For our project, this is one of the biggest design choices:

1. Happy-style synced control plane with end-to-end encryption
2. simpler self-hosted tunnel/SSH/WebSocket model
3. purely local LAN/VPN control model

Happy chose option 1. It is powerful, but it also means more backend and crypto complexity.

## Codex-specific implementation details worth stealing

Happy's Codex support is not fake brochureware. It already has real implementation depth:

- `runCodex.ts` manages remote/local handoff and keepalive
- Codex output is converted into a unified session protocol
- permission requests are modeled explicitly
- there is a Happy MCP bridge for Codex:
  - `/Users/zex/Others/Prod/cli wrapper/happy-src/happy-main/packages/happy-cli/src/codex/happyMcpStdioBridge.ts`
- there is sandbox handling for Codex launches
- there is offline reconnection handling

This tells us the hard part is not just "send commands to Codex." The hard part is:

- preserving interactive session state
- modeling tool calls and approvals cleanly
- maintaining control when network is flaky
- deciding who owns the active terminal at any given moment

## Product lessons for our "better than Happy" direction

### What Happy gets right

- solid separation between runtime, control client, app, server, and protocol
- daemon-based local process management
- end-to-end encryption mindset
- Codex support is already first-class
- explicit session/message schema package
- mobile/web control is not an afterthought

### What we should not copy blindly

- huge product surface area from day one
- multi-agent ambition if our real wedge is Codex-first excellence
- backend complexity before proving the interaction model
- too much agent-specific code inside the runtime path

### Where we can be better

- make the product unapologetically Codex-first
- treat remote control as "continue the exact same Codex session" rather than "a generic AI session"
- design around Codex desktop/app constraints and thread model
- simplify setup
- make approval flows smoother on phone
- make session ownership and handoff extremely obvious
- support personal self-hosted mode early
- build a better terminal-native control story, not only mobile-app-first

## What I think our architecture should look like

Recommended mental model:

1. Local machine agent runtime
2. Small local supervisor/daemon
3. Shared session protocol package
4. Control client(s): phone web CLI
5. Optional relay server

This suggests two possible product tracks.

### Track A: Happy-style cloud relay

Pros:

- works from anywhere
- easier phone/web access
- multi-device sync is straightforward

Cons:

- backend + auth + crypto + ops complexity
- more trust and privacy questions
- more moving parts

### Track B: Self-hosted direct bridge first

Pros:

- much simpler first product
- strong privacy story
- easier to explain

Cons:

- NAT/tunnel story can be annoying
- mobile access setup is harder
- multi-device sync is less elegant

### My recommendation

Start with a Codex-first local supervisor plus a simple remote control plane, then add relay/self-hosted options deliberately.

Concretely:

- build a local daemon first
- define our own session protocol early
- make remote clients control sessions through the daemon, not by poking the Codex process directly
- keep transport pluggable so we can support:
  - local-only
  - self-hosted relay
  - hosted relay later

## Concrete reuse ideas from Happy

We should copy the pattern, not the branding:

- wrapper command that becomes the normal entry point
- daemon that owns process lifecycle
- session-scoped and machine-scoped real-time channels
- shared wire-schema package
- explicit session protocol for text/tool calls/turn lifecycle
- separate control-only CLI for automation and scripting

## Concrete things to improve versus Happy

- sharper Codex-only UX
- less product sprawl at the beginning
- smaller architecture for local-first installs
- clearer naming around machine/session/control ownership
- first-class browser UI, not just "mobile app also exists"
- cleaner story for laptop takeover from phone and giving control back

## Proposed MVP for us

MVP should probably be:

- local daemon installed with our CLI
- wrapper around Codex sessions
- web UI optimized for phone and desktop browsers
- remote prompt send / view output / approve / abort / resume
- session list and machine status
- session handoff between laptop and phone
- optional relay or tunnel

Not MVP:

- multi-agent support
- artifacts/KV/feed/social features
- broad mobile native app complexity
- full generic protocol for every future agent under the sun

## Immediate takeaways

- Happy is already solving almost the same category of problem
- its strongest reference pieces for us are `happy-cli`, `happy-agent`, `happy-wire`, and the architecture docs
- the fastest path is not "copy Happy"
- the smartest path is "extract the right patterns, then build a smaller, more focused Codex-first system"

## Questions we should answer before implementation

1. Is our first release hosted relay, self-hosted relay, or direct/local-first?
2. Is the main client a browser web app, a phone PWA, or a native mobile app?
3. Do we want to wrap the existing `codex` binary, or drive Codex through a lower-level protocol boundary?
4. How much of Codex state can we safely mirror without breaking the user experience?
5. Do we want strict E2EE from day one, or a simpler secure relay first?

## Suggested next step

Create our own design doc with:

- product scope
- session lifecycle
- daemon responsibilities
- transport options
- security model
- Codex integration strategy
- MVP vs later roadmap
