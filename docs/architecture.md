# Architecture

The authoritative design is the specification in [`project/SPECS.md`](project/SPECS.md). Deviations and additions are recorded in [`project/DECISIONS.md`](project/DECISIONS.md). This page is the short tour.

## Overview

```
Browser ──HTTPS──> Cloudflare ──tunnel──> cloudflared ──HTTP──> familytree (Node 22, SvelteKit adapter-node)
                                                                   │
                                          worker threads ──────────┤ (fuzzy search, import, export, maintenance)
                                                                   │
                                                         SQLite (WAL) + photos on disk
```

- **One process, one database.** SvelteKit on Node 22 serves pages and the JSON API. SQLite through `better-sqlite3` in WAL mode; Drizzle ORM for schema and migrations.
- **Heavy work runs in worker threads** with their own read-only or writing connections: GEDCOM import, exports, fuzzy search and the maintenance pass. This keeps the event loop responsive.
- **Photos** are stored on disk, re-encoded by `sharp` (EXIF stripped, size and pixel caps), and served by `/photos/...` only after an access check, with `Cache-Control: private`.

## Code layout

```
src/
  hooks.server.ts         startup (migrations, secret check, maintenance), sessions, origin check,
                          rate limit, write-lock wait, security headers, graceful shutdown
  routes/                 pages (+page.svelte / +page.server.ts) and /api/* endpoints (+server.ts)
  lib/
    server/               services: auth, accounts, trees, persons, relations, graph, claims, codes,
                          history, notifications, search, media, storage, permissions, route-policies
    server/workers/       plain ESM worker entry points
    shared/               plain ESM shared by the app, workers and tests (dates, privacy, gedcom, fuzzy)
    db/                   schema, migrations, pragmas, full-text index rebuild
    components/           feature components (tree, person, claim, join, media, history, shared)
    components/ui/        generated shadcn-svelte components
    schemas/              Zod request schemas
    utils/                client-safe helpers (dates, formatting, contrast)
scripts/                  migrate, backup, restore, sweep-orphans, bench, traceability
tests/                    Vitest (unit, service and live-server) and tests/e2e (Playwright)
```

## Key rules

- **Reads** go through `+page.server.ts` loads; **writes** go through `fetch('/api/…')` and then `invalidateAll()`.
- **Authorisation** is declared per route in `route-policies.ts` (public, session, tree role or code). An access test probes every route with every role.
- **Writes** run in `BEGIN IMMEDIATE` transactions. A write that cannot get the lock in time returns `503 BUSY` with `Retry-After`, never a 500.
- **History:** every change writes a history row with a batch id. Revert and undo replay through the same service and refuse stale reverts.
- **Privacy filter** (`shared/privacy.mjs`) is applied to public reads and filtered exports alike.
- **Full-text search:** an FTS5 table kept in sync by triggers (name parts, birth year, places), checked and rebuilt at startup when it drifts.
- **Large trees** open in focus mode: bounded traversals from one person, with whole-tree scans memoised per tree until it changes.

## Front end

Svelte 5 runes, Tailwind CSS 4 and shadcn-svelte components on design tokens from the specification (contrast-checked by `npm run contrast`). The tree chart is a custom layout rendered as SVG with d3-zoom; layouts of more than 200 people run in a Web Worker. The PWA service worker precaches only the app shell, and never caches pages, API responses or photos.

## Testing

- Vitest covers services, routes and live servers, including concurrency with four processes on one database file.
- Playwright covers the main flows, accessibility (axe, light and dark, with dialogs open) and the Content Security Policy.
- `npm run check:traceability` requires a test named after every acceptance test in the specification.
