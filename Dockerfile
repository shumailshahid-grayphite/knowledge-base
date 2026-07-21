# syntax=docker/dockerfile:1
# Multi-stage build for the KB monorepo (pnpm workspace).
# Targets: api | worker | web | migrate. A single `deps`+`build` base is shared
# so the workspace is installed and compiled once.

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---- deps: install ALL workspace deps, cached on the manifests only ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/providers/package.json ./packages/providers/
COPY packages/connectors/package.json ./packages/connectors/
RUN pnpm install --frozen-lockfile

# ---- build: compile shared packages first, then apps ----
FROM deps AS build
COPY . .
RUN pnpm --filter @kb/shared build \
 && pnpm --filter @kb/db build \
 && pnpm --filter @kb/providers build \
 && pnpm --filter @kb/connectors build \
 && pnpm --filter @kb/api build \
 && pnpm --filter @kb/worker build \
 && pnpm --filter @kb/web build

# ---- migrate: one-shot SQL migration runner (plain node + pg) ----
FROM build AS migrate
CMD ["pnpm", "db:migrate"]

# ---- api ----
FROM build AS api
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# ---- worker ----
FROM build AS worker
CMD ["node", "apps/worker/dist/main.js"]

# ---- web (Next.js) ----
FROM build AS web
EXPOSE 3000
CMD ["pnpm", "--filter", "@kb/web", "start"]
