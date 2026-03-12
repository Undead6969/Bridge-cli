FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json

RUN pnpm install --frozen-lockfile

COPY packages/protocol packages/protocol
COPY packages/server packages/server

RUN pnpm --filter @bridge/protocol build && pnpm --filter @bridge/server build

ENV PORT=8787
EXPOSE 8787

CMD ["pnpm", "--filter", "@bridge/server", "start"]
