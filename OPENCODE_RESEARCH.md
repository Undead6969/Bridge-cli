# OpenCode Notes

OpenCode is a much better reference for Bridge's app shell than Happy.

## What it is built on

- Monorepo with Bun workspaces
- Main app: `packages/app`
- Shared UI system: `packages/ui`
- Desktop wrapper: `packages/desktop` and `packages/desktop-electron`
- Frontend stack is Solid + Vite, not React + Next

Key files:

- `opencode-ref/packages/app/src/pages/layout.tsx`
- `opencode-ref/packages/app/src/pages/home.tsx`
- `opencode-ref/packages/app/src/pages/session.tsx`
- `opencode-ref/packages/app/src/components/prompt-input.tsx`
- `opencode-ref/packages/app/src/index.css`
- `opencode-ref/packages/ui/package.json`

## Why it feels better

OpenCode does not treat the main screen like a dashboard.

It separates the product into:

- app frame / layout shell
- session page
- prompt input
- terminal panel
- side panels
- shared UI primitives

That means the conversation area is allowed to be just a conversation area.

## Patterns worth copying into Bridge

1. Shell-first layout
   - left rail for global nav
   - chat/session sidebar
   - main session canvas
   - side tools/settings panels layered separately

2. Page separation
   - home page
   - session page
   - layout page
   - prompt input component

3. Composer as a real component
   - prompt input is its own system
   - attachments, tools, history, and mode switching are all isolated there

4. Context separation
   - layout state
   - sync state
   - prompt state
   - terminal state
   - permissions and notifications

5. Shared UI primitives
   - app package does not hand-roll every surface inline
   - reusable primitives live in `packages/ui`

## What this means for Bridge

We should stop trying to evolve the current single dashboard component into the final product.

Instead we should split Bridge web into:

- `app shell`
- `chat sidebar`
- `session canvas`
- `composer`
- `settings drawer`
- `machine/runtime panel`

And only the session canvas should own the chat transcript.

## Important difference

OpenCode is Solid, not React.

So we should copy:

- information architecture
- page decomposition
- shell hierarchy
- density and spacing strategy

Not:

- component code
- framework-specific patterns

