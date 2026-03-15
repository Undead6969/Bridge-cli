# Nano Bot Research for Bridge

## What Nano Bot Is Built On

Nano Bot is not a web app first. It is a lightweight local agent platform built around:

- Python 3.11+ core runtime
- `typer` CLI for onboarding and commands
- `pydantic` / `pydantic-settings` for config
- `litellm` plus direct/custom providers for model access
- async message-bus pattern for channel <-> agent communication
- per-channel gateway adapters for Telegram, Discord, Slack, WhatsApp, Matrix, Email, and others
- local session persistence in JSONL files
- a tiny Node.js bridge only where a channel needs it
  - specifically WhatsApp, via a localhost-only WebSocket bridge with optional token auth

Key source files in Nano Bot:

- `README.md`
- `pyproject.toml`
- `nanobot/config/schema.py`
- `nanobot/channels/base.py`
- `nanobot/channels/manager.py`
- `nanobot/session/manager.py`
- `nanobot/bus/events.py`
- `nanobot/bus/queue.py`
- `nanobot/providers/openai_codex_provider.py`
- `bridge/src/server.ts`

## The Useful Pattern Nano Bot Gets Right

Nano Bot separates five concerns cleanly:

1. Local owner setup
2. Provider authentication
3. Channel authentication
4. Session/message routing
5. Agent runtime execution

That sounds obvious, but obvious architecture is where half the industry trips over its shoelaces.

### Their shape

- `nanobot onboard`
  - creates config and workspace
- `nanobot provider login openai-codex`
  - authenticates the model provider
- `nanobot channels login`
  - authenticates channel-specific bridges like WhatsApp
- `nanobot gateway`
  - runs the always-on gateway that accepts messages from channels
- `nanobot agent`
  - runs a direct local agent session

### Security model

- channel access is allowlist-based
- empty allowlists deny all by default
- local WhatsApp bridge binds only to `127.0.0.1`
- optional bridge token protects Python <-> Node communication
- each instance can use its own config + workspace

### Session model

- channel messages become `InboundMessage`
- agent replies become `OutboundMessage`
- both flow through a small async message bus
- sessions are stored per channel/chat context

## What Bridge Should Copy

Bridge should copy the functionality, not the Python stack.

### 1. Split setup into distinct layers

Bridge currently mixes together:

- pairing
- local service startup
- runtime launch
- gateway exposure
- remote UI

It should instead be:

1. `bridge setup`
   - create local config
   - create owner identity
   - create machine identity
   - choose default runtime: Codex, Claude Code, Gemini, Terminal
2. `bridge auth`
   - authenticate runtime/provider locally
   - for example Codex/Claude-specific checks
3. `bridge gateway add`
   - add web / telegram / whatsapp / future channels
4. `bridge doctor`
   - verify daemon, server, runtime, gateway auth, workspace access
5. `bridge run`
   - run the owner's local control plane

### 2. Introduce a real gateway layer

Bridge already has the beginning of this:

- `server`
- `daemon`
- `telegram-bot`
- `app-web`

But it still thinks in terms of one app plus one bot, instead of a gateway system.

Bridge should explicitly define:

- `gateway-web`
- `gateway-telegram`
- `gateway-whatsapp`
- future gateways

Each gateway should:

- authenticate the human
- map that human to exactly one Bridge owner
- forward commands/messages into the same Bridge event model
- never talk directly to the runtime process

### 3. Add owner-scoped auth, not just device pairing

The user's requested model is:

- each user installs Bridge CLI on their own laptop
- they complete setup once
- after that, only their own gateways can access that laptop

Bridge is missing a first-class owner identity.

Bridge should add:

- `owner.json` or equivalent in `~/.bridge`
- owner ID
- owner auth secret / keypair
- allowed gateway identities
- allowed Telegram chat IDs
- allowed WhatsApp numbers
- allowed web sessions

Pairing alone is not enough. Pairing is just the doorbell. Ownership is who actually lives in the house.

### 4. Separate provider auth from gateway auth

Nano Bot does this correctly.

Bridge should separately track:

- runtime/provider auth
  - Codex login / Claude auth / Gemini auth
- gateway auth
  - Telegram bot linked chats
  - WhatsApp linked phone numbers
  - web paired devices

This lets Bridge say useful things like:

- Codex installed but not authenticated
- Telegram gateway configured but no approved chats
- WhatsApp gateway installed but not linked

That is much better than "something somewhere is vibes-broken."

### 5. Introduce a minimal event bus abstraction

Nano Bot's tiny message bus is one of the best parts of the system.

Bridge should formalize a shared internal command/event layer like:

- `InboundCommand`
  - from web / telegram / whatsapp / CLI
- `SessionEvent`
  - ready / blocked / completed / output / approval requested
- `OutboundNotification`
  - send back to specific gateway/user/channel

That would let every gateway reuse the same orchestration logic.

### 6. Use allowlists by default

Nano Bot's recent security hardening is a big hint.

Bridge should default to:

- no Telegram chat IDs allowed until explicitly linked
- no WhatsApp numbers allowed until explicitly linked
- no web clients allowed until explicitly paired
- all gateway access deny-by-default

## What Bridge Is Currently Missing

### Identity and setup

- first-class owner identity
- separate provider auth state
- separate gateway auth state
- gateway-specific allowlists
- setup wizard that asks "how do you want to use Bridge?"

### Gateway architecture

- unified gateway abstraction
- WhatsApp gateway
- shared inbound/outbound command routing layer
- gateway capability metadata
- per-gateway session context

### Runtime orchestration

- explicit runtime registry
  - Codex
  - Claude Code
  - Gemini CLI
  - Terminal
- runtime health checks
- runtime auth checks
- runtime-specific readiness detection
- "select default runtime" during setup

### Security and ops

- owner-scoped access control
- session expiry / token expiry policy
- better audit logging
- gateway revocation
- rate limiting for bot gateways
- explicit "this machine belongs to X owner" config

### Product setup

- one canonical `bridge setup`
- one canonical `bridge doctor`
- one canonical `bridge auth`
- one canonical `bridge gateway` family of commands

Right now Bridge has pieces of this. It does not yet feel like a product that knows who it is. It feels like a promising machine that has not yet chosen a haircut.

## What Bridge Can Reuse Immediately

From Nano Bot's design, Bridge can reuse these ideas right now:

### Keep

- local-first install
- config in the user's home directory
- per-gateway auth/linking
- allowlists for gateway identities
- channel/gateway manager pattern
- local-only bridge where required
- multiple instance support via config/workspace separation

### Adapt into Bridge's TypeScript stack

- message bus pattern
- gateway registry
- provider login commands
- channel login commands
- workspace isolation per owner/setup

### Do not copy directly

- Python implementation
- LiteLLM-centric provider model
- generic "one agent handles everything" framing

Bridge is a remote coding control plane, not a general personal AI butler with opinions about your weather and calendar.

## Recommended Smaller Bridge Setup

This is the smallest setup that still supports your direction well.

### Local pieces on the laptop

- `bridge`
  - main setup + launcher CLI
- `bridge-daemon`
  - runs sessions locally
- `bridge-server`
  - local control plane API + websocket server

Optional local gateway helpers:

- `bridge-whatsapp-bridge`
  - only if WhatsApp needs a special local transport

### Remote/client gateways

- web app
- Telegram bot
- WhatsApp bot

### Data model

- one owner
- one or more machines
- one or more workspaces
- one or more runtimes
- one or more gateways

### Proposed CLI

```text
bridge
  setup
  doctor
  auth
  gateway
  run
  reauth
```

Subcommands:

```text
bridge setup
  - create owner identity
  - detect runtimes
  - choose default runtime
  - choose gateway(s)

bridge auth
  runtime login codex
  runtime login claude
  runtime status
  owner reset

bridge gateway add web
bridge gateway add telegram
bridge gateway add whatsapp
bridge gateway list
bridge gateway revoke <id>
bridge gateway login-code

bridge doctor
  - daemon health
  - server health
  - runtime availability
  - runtime auth
  - gateway status
  - owner status

bridge run
  - starts server + daemon + selected gateways
```

## Recommended Bridge User Flow

### First-time setup

1. User installs `bridge`
2. Runs `bridge`
3. Bridge asks:
   - who owns this machine?
   - which runtime should be default?
   - which gateways do you want?
4. Bridge performs:
   - local config init
   - runtime detection
   - provider auth if needed
   - gateway setup
5. Bridge ends with:
   - owner created
   - machine linked
   - doctor summary

### Daily usage

- user runs `bridge run`
- or Bridge launches local services automatically
- web/telegram/whatsapp connect only if that owner has authorized them

## New Features Bridge Should Add

### High priority

- owner identity and gateway allowlists
- `bridge setup` wizard
- runtime auth registry
- gateway registry
- WhatsApp gateway
- unified command/event bus
- gateway-specific login flows

### Medium priority

- per-owner multiple workspace presets
- gateway notification preferences
- better audit log / recent actions
- runtime fallback order
  - Codex first
  - Claude second
  - Gemini third
  - Terminal fallback

### Lower priority

- multiple owners on one machine
- multiple Bridge instances with separate config roots
- plug-in gateway API

## Bridge-Specific Opinionated Recommendation

Bridge should not become Nano Bot with TypeScript and a gym membership.

Bridge should become:

- a local coding control plane
- with multiple remote gateways
- built around owned machines and coding runtimes
- optimized for Codex and Claude Code first

### The clean Bridge architecture should be

- `bridge-cli`
  - setup, auth, doctor, launch
- `bridge-server`
  - local API, websocket sync, owner/gateway auth
- `bridge-daemon`
  - runtime execution and session management
- `bridge-gateways/*`
  - web, telegram, whatsapp
- `bridge-protocol`
  - shared events and commands

## Concrete Next Steps

1. Add owner identity to `~/.bridge`
2. Add runtime auth/config registry
3. Refactor Telegram bot to be a formal gateway with allowlisted owner mapping
4. Add gateway abstraction in the server
5. Add `bridge setup`
6. Add `bridge gateway add telegram|web|whatsapp`
7. Add WhatsApp gateway only if we still want it after Telegram/web feel solid

## Bottom Line

Nano Bot is useful to Bridge because it proves a clean pattern:

- local owner
- provider login
- gateway login
- allowlists
- small gateway manager
- session persistence
- tiny channel bridges only where necessary

Bridge should copy that functionality, but keep its own product identity:

- local coding machine
- Codex / Claude Code / Gemini / Terminal
- web + Telegram + WhatsApp as gateways
- one owner per laptop by default

That gives Bridge a smaller setup, a clearer auth story, and a much more sane architecture than "pairings, tunnels, bots, sessions, and vibes all meet in one hallway and hope for the best."
