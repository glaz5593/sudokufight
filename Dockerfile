# syntax=docker/dockerfile:1

# The game server's image (apps/server), for Fly.io (fly.toml) or any Docker host. From the repo root:
#   docker build -t sudoku-fight-server .
#   docker run --rm -p 2567:2567 -e DATABASE_URL=postgres://… -e ADMIN_PASSWORD=… sudoku-fight-server
#
# Stages:
#   manifests  the package.json files and the lockfile only: the npm layers stay cached until a dependency changes
#   build      the dependencies of the server and the admin site (dev ones too), then both builds:
#              apps/server/dist/index.cjs (esbuild; the engine and the protocol are inside) and apps/admin/dist (Vite;
#              the avatars are inside, the site draws them)
#   prod-deps  the server's production dependencies, nothing else
#   runtime    node:24-slim, as the `node` user: the bundle, the migrations, the admin site and the puzzle bank
#
# apps/mobile is left out of the build context (.dockerignore), its package.json too, on purpose. drizzle-orm
# has an optional peer dependency on expo-sqlite, and npm follows it to whatever the lockfile holds: with the
# app's manifest here, `npm ci --workspace @sudoku-fight/server --omit=dev` installs Expo and React Native
# (831 packages instead of 94). Without it npm still accepts the lockfile: it only checks that what it installs
# is in there. apps/server/test/deploy.test.ts checks the context and the runtime layout against the code.

ARG NODE_VERSION=24

# ---- manifests ------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS manifests
WORKDIR /app
ENV npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY packages/avatars/package.json packages/avatars/
COPY apps/server/package.json apps/server/
COPY apps/admin/package.json apps/admin/

# ---- build ----------------------------------------------------------------------------------------------
FROM manifests AS build
# --ignore-scripts: no install script runs. esbuild, Rolldown (Vite) and Lightning CSS take their binaries
# from their platform packages, which the lockfile pins for Linux (glibc and musl, x64 and arm64).
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @sudoku-fight/server --workspace @sudoku-fight/admin --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/protocol packages/protocol
COPY packages/avatars packages/avatars
COPY apps/server apps/server
COPY apps/admin apps/admin
RUN npm run build --workspace @sudoku-fight/server \
 && npm run build --workspace @sudoku-fight/admin

# ---- prod-deps ------------------------------------------------------------------------------------------
FROM manifests AS prod-deps
# The bundle keeps five packages outside (apps/server/package.json, "build"): @colyseus/core,
# @colyseus/ws-transport, express, @electric-sql/pglite and @sentry/node (loaded only with SENTRY_DSN; Sentry
# asks not to bundle its Node SDK). They come with their own dependencies; drizzle-orm, postgres and zod are
# inside the bundle but come too, being dependencies.
# --omit=optional leaves out msgpackr-extract, a native speed-up that msgpackr does without, and @pm2/io, an
# optional peer of @colyseus/core that the lockfile holds for @colyseus/tools (a dev tool).
# A dependency npm had to nest under apps/server/node_modules is found from apps/server/dist too; the folder is
# made either way, so the COPY below never fails.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @sudoku-fight/server --omit=dev --omit=optional --ignore-scripts \
 && mkdir -p apps/server/node_modules

# ---- runtime --------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production PORT=2567
WORKDIR /app
# The repo's layout, so the bundle finds what it looks for next to itself (from apps/server/dist):
#   ../drizzle         the migrations, applied at start (src/db)
#   ../../admin/dist   the admin site, served at /admin (src/admin/site.ts)
# and packages/engine/data/puzzles.json, the puzzle bank with the ranked pool, which stays on the server (spec
# §20): code that reads it from disk finds it through the workspace link npm made, node_modules/@sudoku-fight/engine.
# Everything belongs to root: the server, running as `node`, cannot change its own code.
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/engine/package.json packages/engine/
COPY --from=build /app/packages/engine/data packages/engine/data
COPY --from=build /app/packages/protocol/package.json packages/protocol/
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/admin/dist apps/admin/dist
USER node
EXPOSE 2567
# Fly.io runs its own check (fly.toml); this one is for `docker run` and other hosts. Slim has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# node itself, not npm: SIGTERM reaches the server, which closes its rooms and the database (Colyseus).
CMD ["node", "apps/server/dist/index.cjs"]
