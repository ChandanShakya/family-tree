# syntax=docker/dockerfile:1
# Multi-stage build on node:22-bookworm-slim (amd64 and arm64, so a Raspberry Pi 4 builds the same file).
# Compilers are installed only if a native module (better-sqlite3, sharp) has no prebuilt binary for the
# target architecture, and they never reach the runtime image.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* && npm ci --no-audit --no-fund)
COPY . .
RUN npm run build

# Production dependencies (tsx included: operators run backup / rebuild-fts / sweep-orphans with `docker compose exec`).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* && npm ci --omit=dev --no-audit --no-fund)

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN useradd -m app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/src/lib/db/migrations ./migrations
COPY scripts ./scripts
# scripts import src/lib/db relatively; the workers run from WORKERS_PATH and import ../../shared (no bundle internals).
COPY --from=build /app/src/lib/db ./src/lib/db
COPY --from=build /app/src/lib/server/workers ./lib/server/workers
COPY --from=build /app/src/lib/shared ./lib/shared
ENV MIGRATIONS_PATH=/app/migrations \
    WORKERS_PATH=/app/lib/server/workers \
    DATABASE_PATH=/data/db/family.db \
    PHOTO_PATH=/data/photos \
    BODY_SIZE_LIMIT=12M \
    SHUTDOWN_TIMEOUT=12
# Named volumes mounted here inherit this ownership, so the non-root user can write to them.
RUN mkdir -p /data/db /data/photos && chown -R app:app /data /app
USER app
EXPOSE 3000
STOPSIGNAL SIGTERM
# The slim image has neither curl nor wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# --max-semi-space-size=2: a small young generation roughly halves resident memory (about 220 MB -> 110 MB at start).
CMD ["node", "--max-semi-space-size=2", "build"]
