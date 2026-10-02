# IMPLEMENTATION_PLAN.md — Collaborative Family Tree (SPECS.md v4.0)

## Header

### Goal
Build self-hosted Collaborative Family Tree app per SPECS.md v4.0: multi-tree genealogy with accounts, bounded graph traversals, custom tree layout, FTS5 + fuzzy search, join-code collaboration + claiming, GEDCOM import/export, privacy-filtered public trees, PWA shell, Docker + Cloudflare Tunnel deployment. Phased delivery 1a → 1b → 2 → 3 → 4 → 5 → 6 (7 optional), each phase checkpoint green before next.

### Architecture summary
- **Frontend:** SvelteKit 2 + Svelte 5 runes, Tailwind 4, d3-zoom/selection/shape for render/zoom only, custom layout engine in `src/lib/tree/layout.ts` (pure functions, Web Worker above 200 nodes), lazy-loaded tree chunk. Reads via `+page.server.ts load` calling `lib/server/*` services directly; mutations via client `fetch()` to `/api/*` JSON routes; no Form Actions. Components in `src/lib/components/*`, PWA service worker precaches shell only.
- **Backend:** SvelteKit API routes as thin wrappers (Zod parse → `requireTreeAccess` → service → JSON). Services in `src/lib/server/*`. SQLite via Drizzle + better-sqlite3, WAL mode, single main-thread RW connection + on-demand `node:worker_threads` workers (GEDCOM, backup, export, fuzzy fallback) each with own connection + same pragmas. Migrations via `drizzle-orm/better-sqlite3/migrator` from `MIGRATIONS_PATH`, FTS via `--custom` SQL migration, `visible_persons` view via `--custom` migration.
- **AuthZ model:** `permissions.ts` matrix + `route-policies.ts` registry `{route, method, access, action?, allowPublic?, probe?}`; every route calls `requireTreeAccess`; entity-keyed routes resolve tree via `resolveTreeId`. 404 for non-member tree, 403 for insufficient role, 401 for anonymous on non-public.
- **Data:** UUIDv4 text IDs, ISO-8601 UTC text timestamps, 0/1 booleans. Tables per §5.1. `persons_fts` (FTS5) keyed via `person_fts_map.fts_id` as stable rowid. `visible_persons` view filters soft-deleted + pending/rejected-linked persons. Audit in `changeHistory` (batchId per action, snapshot on delete, stale-revert rule).
- **Ops:** Multi-stage Dockerfile (`node:22-bookworm-slim`, non-root, HEALTHCHECK via `node -e fetch`), `docker-compose.yml` (expose only, cloudflared sidecar) + `docker-compose.dev.yml` override, named volumes `family-db`/`family-photos` at `/data/db`, `/data/photos`. Scripts in `scripts/` run via `tsx` (production dep).

### Tech Stack (pinned, §2 — exact, `--save-exact`, no substitution)
| Package | Version | Notes |
|---|---|---|
| node | 22.x (≥22.12) | Docker base `node:22-bookworm-slim` |
| `@sveltejs/kit` | 2.70.3 | |
| `svelte` | 5.57.1 | runes only |
| `@sveltejs/adapter-node` | 5.5.7 | |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | requires Vite 8 |
| `vite` | 8.3.1 | |
| `typescript` | 6.0.3 | Not 7.x (Kit/svelte-check peers stop at 6) |
| `svelte-check` | 4.7.6 | |
| `tailwindcss` + `@tailwindcss/vite` | 4.3.3 | `@import "tailwindcss"` in app.css, no config file |
| `@lucide/svelte` | 1.49.0 | Not `lucide-svelte` |
| `drizzle-orm` | 0.45.3 | |
| `drizzle-kit` | 0.31.11 | dev |
| `better-sqlite3` | 13.0.3 | + `@types/better-sqlite3` 9.6.0 dev |
| `zod` | 4.6.5 | Zod 4 API (`z.email()`, `z.uuid()`, `error:` param) |
| `bcryptjs` | 3.0.3 | pure JS, async only, cost 12 |
| `d3-zoom` | 3.0.0 | render/zoom only |
| `d3-selection` | 3.0.0 | render/zoom only |
| `d3-shape` | 3.2.0 | render/zoom only (no d3-hierarchy, no d3-dag) |
| `nodemailer` | 10.0.13 | optional SMTP |
| `sharp` | 0.35.5 | prebuilt linux-arm64 exists; fail build if missing; `limitInputPixels`, `concurrency(1)`, `cache(false)` |
| `tar-stream` | 3.2.1 | backup export |
| `nepali-date-converter` | 3.4.0 | BS↔AD; verify supported range in 1a |
| `vitest` | 5.0.3 | + matching `@vitest/*` |
| `@playwright/test` | 1.63.0 | Phase 5 |
| `@axe-core/playwright` | 4.13.0 | Phase 5 |
| `@types/node` | 22.20.4 | |
| `tsx` | 4.23.15 | production dep (migrate/rebuild/sweep/backup in container) |
| `eslint` | 10.11.0 | |
| `typescript-eslint` | 8.71.0 | accepts TS <6.1 |
| `eslint-plugin-svelte` | 3.23.0 | + `@eslint/js` (same major as eslint) + `globals`, pin + record |
| Google OAuth | hand-written | auth-code + PKCE via `fetch`, no auth lib |

Syntax rules (§2.1): Zod 4 forms only; Svelte 5 runes (`$props/$state/$derived/$effect`, `{@render children()}`, `onclick=`); no `export let`/`$:`/`<slot>`/`on:click`/`createEventDispatcher`/`writable` for local state (shared in `.svelte.ts`); data flow: `load` → `data` → `$derived`, `$state` only for edit drafts, resync after `invalidateAll()`.

### Spec reference
- Source: `/home/chandan/Projects/chandanshakya/family-tree/SPECS.md`, 701 lines, v4.0, dated 2026-10-01.
- Reading guide (§0.3): full read at 1a start; later phases re-read §0, §2, §14, phase §12 rows + table below.
- Conflict rule (§0.1.12): §4, §5, §8 win over §6, §7; record in DECISIONS.md.

---

## Global Constraints

### Operating rules (§0.1)
1. Implement only named phase; no later scaffolding.
2. Complete working code; no stubs/fake APIs/`TODO`/`FIXME`; unfinished → Deferred list, never placeholder code.
3. Use §2 pins exactly; read installed types/docs if API differs; no guessing.
4. Ambiguity → simplest satisfying option + dated DECISIONS.md entry (decision/alternatives/reason).
5. Never claim pass without running in-session; quote real summary (e.g. `Tests 42 passed`); explicitly note unrunnable (ARM/CF/SMTP).
6. Every phase reply ends: **Files changed, Commands to verify, Results, Not verified, Deferred**; starts with `Scope:` line (§sections read + AT IDs).
7. Do not weaken requirement to pass test; stop + report if requirement seems wrong.
8. AT IDs + R-PERF IDs are only ID'd items; test titles carry AT id: `test('AT-07: …')`.
9. Non-interactive terminating commands only. Required scripts:
   `check` (`svelte-check --tsconfig ./tsconfig.json` + `tsc --noEmit` in CI), `test` (`vitest run`, never bare), `test:e2e` (`playwright test --reporter=line`, webServer `reuseExistingServer:false`, global timeout 120s), `lint` (`eslint .`), `db:generate` (`drizzle-kit generate`, + `--custom --name=<name>` for hand SQL), `build` (`vite build`), `test:e2e:setup` (`playwright install --with-deps chromium`), `check:traceability` (`node scripts/check-traceability.mjs --phase <id>`), `db:migrate` (`tsx scripts/migrate.ts`), `contrast` (`tsx scripts/contrast.ts`), `bench` (`tsx scripts/bench.ts`), `seed` (`tsx scripts/seed.ts`), `rebuild-fts` (`tsx scripts/rebuild-fts.ts`), `sweep-orphans` (`tsx scripts/sweep-orphans.ts`). Set `CI=1`; background server with log redirect + poll `/api/health` + kill; prefix blocking with `timeout 300`.
10. Dependency failure: no `--force`/`--legacy-peer-deps`; newest version satisfying peers (`npm view`), else previous major; record in DECISIONS.md; rerun phase tests.
11. Re-read listed sections per phase; do not rely on memory.
12. `CI=1` etc. per above.

### Tunable defaults (§0.2 — all in `src/lib/config.ts`, one const each; `RATE_LIMITS` + `LOCKOUT_TIERS` exported)
`LIVING_ASSUMPTION_YEARS=110`, `MIN_VERIFICATION_QUESTIONS=3`, `VERIFY_MAX_ATTEMPTS_PER_24H=5` per (user,person), `SOFT_DELETE_PURGE_DAYS=30`, `SESSION_DAYS=30`, `CONTRIBUTOR_REVERT_OWN_ONLY=true`, `FAMILY_CODE_DEFAULT_MAX_USES=50` (NULL=unlimited), `EDIT_NOTIFY_COALESCE_MINUTES=10`, `TREE_FOCUS_MODE_THRESHOLD=500`, `PASSWORD_MIN_LENGTH=10` (max 72 bytes bcrypt), `PASSWORD_HASH_CONCURRENCY=2`, `MAX_TRAVERSAL_DEPTH=30`, `MAX_TRAVERSAL_NODES=5000`, `DEFAULT_FOCUS_DEPTH=3`, `IMPORT_MAX_BYTES=5242880` (5MB), `IMPORT_MAX_PERSONS=10000` / `IMPORT_MAX_RELATIONSHIPS=20000`, `MAIN_THREAD_BLOCK_BUDGET_MS=50`, `DEFAULT_JOIN_ROLE=contributor`, `MATCH_WEIGHTS` name 0.5/birth-date 0.3/birth-place 0.2, `DUPLICATE_MAX_PAIRS=200`, `UPLOAD_MAX_BYTES=10485760` / `IMAGE_MAX_PIXELS=25000000`, `MAINTENANCE_INTERVAL_HOURS=6`, `RATE_LIMITS`/`LOCKOUT_TIERS` per §8.

### Non-functional / DB pragmas (§3)
- R-PERF-1: initial JS <250KB gzip; tree chunk lazy. R-PERF-2: read <25ms p95 single user. R-PERF-3: search <150ms FTS / <300ms fuzzy on 50k/tree. R-PERF-4: 500-node layout+render <500ms. R-PERF-5: cold start <2s. R-PERF-6: RSS ≤200MB steady (import/backup/image peak reported, no target). R-PERF-7: p99 loop delay <100ms under bench incl. import (`perf_hooks.monitorEventLoopDelay`, bench + `/api/health`). R-PERF-8: GEDCOM at caps commits <5s. Measured+reported via `bench.ts` → `BENCHMARKS.md` (machine desc.); relative failure if search p95 >3× target; owner reruns on Pi (Pi4 1GB min).
- Pragmas at startup: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `cache_size=-64000`, `mmap_size=268435456`, `temp_store=MEMORY`. Multi-statement writes `db.transaction(fn).immediate()`.
- Event loop: main thread owns one RW conn; per-request sync DB/CPU ≤ `MAIN_THREAD_BLOCK_BUDGET_MS`. Over-budget → `node:worker_threads` (`src/lib/server/workers/`, no extra dep, own conn + same pragmas, on-demand exit-when-idle except fuzzy worker stays alive): GEDCOM parse+import, backup, full-tree export, fuzzy fallback. WAL allows concurrent worker reads; one writer; `SQLITE_BUSY` → `503 {error:{code:'BUSY'}}` + `Retry-After: 2`. Bulk inserts: prepared stmts in single txn. Hash concurrency cap + queue. No idle open read txn / un-exhausted `iterate()` (blocks TRUNCATE checkpoint); shutdown checkpoint retries 3× 1s apart + warn if busy.

### Security pragmas (§8)
- Passwords bcryptjs cost 12 async, reject >72 bytes. Sessions 32 random bytes base64url cookie, SHA-256 stored, `httpOnly`/`sameSite=lax`/`secure` in prod, `SESSION_DAYS` sliding refresh ≤1/day, rotate on login, wipe on pwd change/reset.
- Cloudflare: adapter-node `ORIGIN=<public https>`, `ADDRESS_HEADER=CF-Connecting-IP`; compose `expose:3000` never `ports:`; `docker-compose.dev.yml` publishes port, ADDRESS_HEADER unset.
- CSRF: keep Kit origin protection (`csrf.checkOrigin` or `trustedOrigins` per installed Kit — confirm in 1a + record) + explicit `Origin` check for JSON POST/PUT/PATCH/DELETE in `hooks.server.ts` vs ORIGIN.
- CSP via `kit.csp mode:'nonce'` (all SSR; inline theme script `nonce="%sveltekit.nonce%"`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` + `X-Frame-Options:DENY`, `X-Content-Type-Options:nosniff`, `Referrer-Policy:strict-origin-when-cross-origin`, HSTS prod. Playwright fails on CSP console violations (Phase 5).
- Rate limiting in-memory sliding window (lost on restart, documented). Over-limit 429+Retry-After. `RATE_LIMITS`: register 3/min/IP; login 5/min/IP + 10 fails/15min/account; logout 10/min/IP; forgot 3/hr/IP + 3/hr/email; join GET/POST 10/min/IP; verify PUT 5/24h per (user,person) persisted in claimAttempts + 20/hr/IP; claims POST 10/hr/user; search 60/min/IP; all other /api 100/min/IP.
- Lockout tiers (code+claim endpoints only: join GET/POST, verification answers; forgot has no failure concept): per IP+endpoint rolling 24h failures: 5→15min, 10→1h, 20→24h cap. Code-not-found counts; success does not reset. Login: no IP tiers; 5/min/IP + per-account 10 fails/15min → lock 15min any IP; reset clears (documented lockout trade-off).
- Zod all input; Drizzle/prepared only; FTS from escaped quoted tokens. Errors `{error:{code,message}}` generic; details server log + request ID. Codes: VALIDATION 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, JOIN_UNAVAILABLE 404, VERSION_CONFLICT 409, STALE_REVERT 409, REVERT_CONFLICT 409, NOT_REVERTIBLE 409, DUPLICATE 409, CYCLE 409, GRAPH_TOO_DEEP 409, PURGED 410, PAYLOAD_TOO_LARGE 413, IMAGE_TOO_LARGE 413, IMPORT_LIMIT 413, UNSUPPORTED_MEDIA 415, RATE_LIMITED 429, LOCKED 429, BUSY 503. New code needs DECISIONS.md line.
- Route-policy registry `src/lib/server/route-policies.ts`: one entry per (route,method) `{route,method,access:'public'|'session'|'tree'|'code',action?,allowPublic?,probe?}`; `requireTreeAccess` reads same registry; `probe(ctx)` returns params/body for success on seeded fixture (tree+persons+one user/role). AT-07/AT-09/AT-29 auto-generated, run every phase from introduction over all existing routes.

### Roles matrix (§4) — lives as data in permissions.ts
owner/editor/contributor/viewer. View tree/persons/history/media all ✅. Add/edit person/rel/event/photo O/E/C ✅ V ❌. Delete person/rel/photo O/E ✅ rest ❌. Revert O/E ✅, C own-only, V ❌. Create direct code O/E/C ✅. View/regen family O/E only. Approve join/claim O/E. Set verification Qs O/E/C ✅. Change roles/remove O only. Import/export-full/backup O/E. Privacy export all ✅. Transfer/delete tree O only. Owner cannot leave/demoted without transfer to active member. pending/rejected no read. Non-member tree route 404 (not 403); insufficient role 403. Entity routes `resolveTreeId(entityType,id)`; unknown vs no-access both 404 same body; `requireTreeAccess(event,treeId,action,ctx={authorUserId})` for C revert rule. Leave/remove → `persons.userId,claimedAt=NULL` same txn, row stays. Join roles: family → `DEFAULT_JOIN_ROLE`; direct carries `viewer|contributor|editor` ≤ creator role else 403. Public trees (Phase 5; flag stored earlier): anonymous only `allowPublic` routes (`GET /api/trees/:id`, `GET /api/persons/:id`, `GET relatives`, `GET relation`, `GET /photos/…` non-living) through §6.9 filter; rest 401; anonymous private/nonexistent → same 401 same body.

---

## Dependency Order (critical path)
```
1a Foundation → 1b Accounts → 2 Trees/People/Media/Graph → 3 Viz/Search → 4 Collab (codes/claims/history/notify) → 5 Import/Export/Public/PWA/Polish → 6 Hardening/Deploy (→ 7 optional)
```
- Cross-phase deps: permissions + route-policies (1a) must exist before any `tree` route (2+); session core (1a) before accounts (1b); `visible_persons` + FTS triggers (1a) before all tree queries/search/export/stats (2+); `graph.ts` bounds (2) before focus endpoint (3) + relation path; layout engine (3) behind lazy chunk for R-PERF-1; claim/search audience (4) needs join codes; privacy filter (5) needs living rule from §6.9 + `isPublic`; bench/maintenance/sweep (6) need seed + full app.
- Critical path items:
  - Drizzle + better-sqlite3 + FTS5 smoke (1a): open DB, pragmas, FTS5 query through Drizzle; Devanagari tokenchars test (नेपाल vs नीपाल must NOT cross-match).
  - Migrations mechanics (1a): `drizzle-kit generate` + `--custom --name=fts` + `--custom --name=views`, `--> statement-breakpoint` separators, trigger-as-single-statement, `migrate()` once before listen with explicit `MIGRATIONS_PATH`, post-migrate FTS count check + rebuild; verify fresh + upgrade-with-data; record drizzle-kit behaviour in DECISIONS.md.
  - Worker threads (3/5): `src/lib/server/workers/` no extra dep, own conns, on-demand exit (fuzzy stays alive); GEDCOM/backup/export/fuzzy off main thread; BUSY→503 mapping; bench proves R-PERF-7/8.
  - Route-policies registry (1a, recurring): harness + auto AT-07/09/29 from Phase 2 onward.
  - Layout engine with elkjs fallback (3): pure `layout.ts` (`buildUnits, assignGenerations, buildLayoutTree, subtreeWidth, placeUnit, routeEdges`), constants `NODE_W=160 NODE_H=72 H_GAP=24 SPOUSE_GAP=8 ROW_GAP=96`, generations longest-path + spouse align ≤`MAX_TRAVERSAL_DEPTH+1` rounds else `SPOUSE_ALIGNMENT_UNSTABLE` banner; after ONE documented fix attempt on failing fixtures may switch to `elkjs` in lazy Web Worker (record size+timings, R-PERF-1 still applies).

---

## Phase 1a — Foundation (no user-facing auth flows)

**Re-read (§0.3):** §3, §5, §6.3 (dates), §7.0–7.2, §8, §10, §11 + §0, §2, §14, §12 rows below.

**Scope sections:** Project init + pins; Tailwind 4 + Inter self-hosted woff2; Drizzle schema (all §5.1 tables even if unused yet) + FTS + views migrations; pragmas; `config.ts`; `migrate.ts`; session create/validate/delete by token hash + `hooks.server.ts` locals.user; in-memory rate limiter; hooks (CSP nonce, CSRF Origin check, security headers, proxy `ADDRESS_HEADER`); `permissions.ts` + `route-policies.ts` + harness; `utils/dates.ts` AD+BS; `contrast.ts`; `check-traceability.mjs` + unit test; root layout + dark mode (system default, localStorage+themePref, no-flash nonce inline script); `/api/health` (status/uptime/version/eventLoopDelayP99Ms, public, no secrets); Dockerfile + compose skeleton (migrations path, scripts, volume ownership, healthcheck `node -e fetch`); Drizzle+FTS smoke; `nepali-date-converter` range → DECISIONS.md; Kit `csrf.*` option confirm → DECISIONS.md.

**AT IDs in scope:** AT-19, AT-25, AT-28, AT-29 (registry over routes existing: health + skeleton), AT-35, AT-47.
- AT-19 proxy rate-limit independence (`CF-Connecting-IP`).
- AT-25 date parser (§6.3 examples + invalid + BS fixtures, 5+ cited BS↔AD pairs incl. month-boundary + leap).
- AT-28 contrast (all text pairs ≥4.5:1, large/UI 3:1, exits non-zero; run in `npm test`).
- AT-29 registry coverage + probe (no session 401, non-member 404, below-role 403, at-role success).
- AT-35 migrations fresh + upgrade-with-data, triggers sync on insert/update/soft-delete, consistency check rebuilds.
- AT-47 built server `/`: every inline script has nonce in CSP header, no `unsafe-inline` in script-src.

**Key files to create (per §10):**
`package.json` (exact), `package-lock.json`, `drizzle.config.ts`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `README.md` (skeleton), `DECISIONS.md`, `src/app.html` (nonce theme script), `src/app.css` (`@import "tailwindcss"`), `src/hooks.server.ts`, `src/service-worker.ts` (stub shell only — no caching logic until Phase 5, must not break build), `src/lib/config.ts`, `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/db/migrations/*`, `src/lib/server/permissions.ts`, `src/lib/server/route-policies.ts`, `src/lib/server/rate-limit.ts`, `src/lib/server/auth.ts` (session core only), `src/lib/utils/dates.ts`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/api/health/+server.ts`, `scripts/migrate.ts`, `scripts/seed.ts` (minimal fixture for probes), `scripts/contrast.ts`, `scripts/check-traceability.mjs`, `scripts/bench.ts` (stub returning TODO-free minimal? — DO NOT scaffold later phases: create only if needed for 1a checkpoint; prefer omit until Phase 6, note Deferred), `static/manifest.webmanifest`, `static/icons/`, `static/fonts/`, `tests/` (AT-19,25,28,29,35,47 + traceability self-test + FTS smoke incl. Devanagari).

**Dependencies:** None (first). Blocks all later (schema, pragmas, auth core, registry, dates, CSP/headers).

**Verification (§13+§14):**
```
CI=1 npm ls
CI=1 npm run check          # svelte-check + tsc --noEmit in CI
CI=1 npm run lint
CI=1 npm run test           # includes AT-19,25,28,29,35,47 + contrast via Vitest
CI=1 npm run check:traceability -- --phase 1a
CI=1 npm run build
docker compose build && <boot container, poll /api/health, kill>
```

---

## Phase 1b — Accounts

**Re-read:** §5.1 (users, oauthAccounts, sessions, token tables), §6.1, §7.0, §8, §9 (auth rows) + base (§0,§2,§14, rows).

**Scope:** Register (email lowercased unique, pwd 10–72 bytes, displayName), login (dummy bcrypt on unknown/OAuth-only, rotate session), logout, forgot/reset (generic responses; reset 1h single-use, wipes sessions, clears login lock), verify + resend (`POST /api/auth/verify`, `/verify/resend` 3/hr/user; unverified cannot mint codes/make public — enforce), password change (current required, revoke others), profile (displayName/avatar, theme `system|light|dark`, dateDisplay `AD|BS|both`, notifyPrefs JSON), account deletion (strip creds/sessions/OAuth/avatar, email → `deleted+<id>@invalid.invalid`, unlink persons userId/claimedAt NULL, delete memberships, keep history as "Deleted user", block if owns trees until transfer/delete), Google OAuth PKCE hand-flow (`GET /api/auth/google`, callback; only if both env set; require `email_verified=true`; unverified-local → clear pwdHash+sessions then link; verified → link; `oauth_state` cookie 10min via SESSION_SECRET), `mail.ts` (SMTP or console log link), login/register/forgot/reset/[token]/verify/[token] pages (plain Svelte forms, `preventDefault`+`fetch`, no actions), avatar pipeline reuse (caps per §6.7, path `PHOTO_PATH/_avatars/<userId>/`).

**AT IDs:** AT-18, AT-36 + all 1a (regression).
- AT-18: 6th login/min/IP 429+Retry-After; 10 fails/15min → account locked 15min even from other IP; reset clears.
- AT-36: register/forgot identical for known/unknown; unknown login still bcrypt-compares (spy); >72B rejected; reset single-use + wipes sessions; cookie `httpOnly,sameSite=lax,secure` in prod; ≤`PASSWORD_HASH_CONCURRENCY` concurrent hashes; mocked Google + unverified local clears pwd+sessions before link.

**Key files:** `src/lib/server/mail.ts`, `src/lib/server/oauth.ts`, extend `auth.ts`, `src/lib/schemas/auth.ts` (+ account), `src/routes/api/auth/*` (register, login, logout, forgot, reset, verify, verify/resend, password, google, google/callback), `src/routes/api/account/*` (GET/PUT/DELETE, avatar POST multipart), `src/routes/(auth)/login/+page.svelte`, `register/`, `forgot/`, `reset/[token]/`, `verify/[token]/`, `src/routes/profile/+page.svelte`, `src/lib/components/shared/Toast.svelte` (minimal, extended later), tests `AT-18, AT-36` + registry probes for new routes.

**Dependencies:** Needs 1a (session core, rate-limit, registry, hooks, mail env). Enables 2 (membership-gated routes need users/sessions).

**Verification:**
```
CI=1 npm run check && CI=1 npm run lint && CI=1 npm run test
CI=1 npm run check:traceability -- --phase 1b
# AT-18, AT-36 + AT-19,25,28,29,35,47 all green
```

---

## Phase 2 — Trees and People

**Re-read:** §3 (connections/event loop), §4, §5, §6.2, §6.3, §6.7, §6.11, §8 (route policies), §9, §10 + base.

**Scope:**
- Trees: CRUD (create → owner membership + active family code + prompt create/claim own person), dashboard cards (cover+member count), settings (rename/cover/public-toggle stored only until Phase 5, regen family code), members list/roles/transfer (owner-only changes, transfer atomic `trees.ownerId`+`ux_one_owner_per_tree`), delete (type-name confirm, files after commit), stats (people/rels/depth bounded, `truncated`), activity feed cursor endpoint (UI in Phase 4, endpoint here if §9 lists it — keep minimal list), `GET /api/trees/:id` full graph ≤`TREE_FOCUS_MODE_THRESHOLD` else focus subgraph (`?focus=&depth=` default own-person else oldest root, default `DEFAULT_FOCUS_DEPTH`, max `MAX_TRAVERSAL_DEPTH`, `totalPersons+truncated`, cap `MAX_TRAVERSAL_NODES`).
- Persons: versioned `PUT` (`WHERE id+version`, 409 + current), audit per-field `batchId` same txn (create 1 row field NULL, delete 1 row + snapshot), events CRUD (no version, last-wins + audited, delete needs delete-perm, types free-text + suggestions, birth/death/marriage stay in columns), relationships (parent/spouse/sibling/guardian; spouse/sibling `person1< person2`; `CHECK <>`; `UNIQUE triple`; txn checks: both exist visible in treeId, parent cycle bounded walk else `CYCLE`, >2 parents → warning not block, `GRAPH_TOO_DEEP` if chain would exceed cap; sibling only for unknown-parents, never duplicate derived; guardian dashed extra), relatives + derived relations + BFS relation path bounded (label or "not connected within limit"), dates canonical Gregorian `*Norm` + BS rules (§6.3: verbatim + `*Cal` toggle never auto, AD qualifiers strip + `BET x AND y`→x, BS partial → first-day conversion no `00`, out-of-range Norm NULL, display per pref, export NOTE rule deferred to Phase 5 but Norm logic here).
- Graph (`graph.ts`): iterative BFS (prepared stmt/level via `json_each`) or `WITH RECURSIVE … UNION` + `depth<:max` + `LIMIT :cap`; never whole-table load; partial + `truncated:true` never 500; 40-gen/5000-node caps.
- Members: removal/leave (unlink person same txn), account-deletion unlink path tested.
- Media: images jpg/png/gif/webp ≤`UPLOAD_MAX_BYTES` buffered (needs `BODY_SIZE_LIMIT=12M`), magic-byte + `sharp` re-encode (`limitInputPixels=IMAGE_MAX_PIXELS` → 413 `IMAGE_TOO_LARGE`, `concurrency(1)`, `cache(false)`, strip EXIF, 400px thumb), UUID filenames `PHOTO_PATH/<treeId>/<personId>/` (`_tree` if NULL, `_avatars/`, `<treeId>/_cover/`), `^[A-Za-z0-9-]+$` path guard, `persons.photoUrl` primary via `makePrimary`/PUT/clear-on-delete, `GET /photos/[...path]` membership/`isPublic`-not-living check + `Cache-Control: private,max-age=31536000,immutable` + `nosniff` + inline, no CF cache rule (README note in Phase 6, behavior here), delete-after-commit + rollback-keeps-files.
- Frontend: trees list/detail/members/activity/settings, persons/[id], PersonForm (progressive disclosure), AddPersonSheet, avatar/cover components, photo serve route; reads via `load`→services, writes via `fetch` + `invalidateAll` + toast.

**AT IDs:** AT-07, AT-09, AT-13, AT-14, AT-15, AT-16, AT-17, AT-27, AT-38, AT-41, AT-42 + AT-29 over all routes so far (recurring).
- AT-07 viewer-above-role →403 all; AT-09 cross-tree member →404 all; AT-13 parent cycle rejected no write; AT-14 spouse (B,A) duplicate + normalised; AT-15 stale version 409 no history; AT-16 bad-magic 415 / oversize 413 / `..` rejected / bomb 413 no file; AT-17 photos anon 401 / other-tree 404 + `private` never `public`; AT-27 delete person/photo/tree removes files post-commit, rollback removes none; AT-38 40-gen traversals ≤caps `truncated`, over-depth `GRAPH_TOO_DEEP`, cycle rejected, no 500; AT-41 event CRUD audit + timeline + viewer 403; AT-42 remove/leave/account-delete unlink semantics + email reusable.

**Key files:** `src/lib/server/trees.ts`, `members.ts`, `persons.ts`, `relations.ts`, `graph.ts`, `events.ts`, `media.ts`, `storage.ts`, extend `permissions.ts`/`route-policies.ts`, `src/lib/schemas/{trees,persons,relationships,events,media}.ts`, `src/routes/api/trees/*`, `persons/*`, `relationships/*`, `events/*`, `media/*`, `src/routes/photos/[...path]/+server.ts`, `src/routes/trees/*`, `persons/[id]/+page.svelte`, `src/lib/components/{person,tree,media}/*`, `src/lib/db/migrations/*` (if new indexes), tests for each AT + traversal caps + visibility (`visible_persons` join-back).

**Dependencies:** Needs 1a+1b (auth, registry, views/FTS). Blocks 3 (focus endpoint + names for search), 4 (codes/claims/history on persons/rels).

**Verification:**
```
CI=1 npm run check && CI=1 npm run lint && CI=1 npm run test
CI=1 npm run check:traceability -- --phase 2
# AT-07,09,13,14,15,16,17,27,29,38,41,42 + all 1a/1b green
```

---

## Phase 3 — Visualization and Search

**Re-read:** §3, §5.2, §6.8, §6.11, §7.3, §7.6 + base.

**Scope:**
- Layout `src/lib/tree/layout.ts` exact fns `buildUnits, assignGenerations, buildLayoutTree, subtreeWidth, placeUnit, routeEdges`; unions (shared-parents set + childless spouse pair; multi-partner order by marriage startDate); generations longest-path + spouse max-align ≤`MAX_TRAVERSAL_DEPTH+1` rounds else `SPOUSE_ALIGNMENT_UNSTABLE`; primary-parent tree (earliest-birth union, ties id; couple anchored to member with primary union / earlier Norm / root ordering); coords `NODE_W/H/GAP` constants, `unitWidth/subtreeWidth` order by birthNorm→name→id, top-down centre-over-children + `x≥prevRight+H_GAP` shift, `y=gen*(NODE_H+ROW_GAP)`, components gap `3*H_GAP`; edges orthogonal spouse-union horiz + union-child bus vertical, guardian dashed extra, sibling undrawn; focus mode >threshold (ancestors+descendants depth N dflt 3 + spouses/siblings + expand). `layout.worker.ts` + Web Worker >200 nodes. TreeCanvas lazy chunk (R-PERF-1), TreeControls, PersonNode, d3-zoom pan/wheel/pinch, search-highlight, Cmd/Ctrl+K, Escape. Fixtures: single-parent, two-parents, remarried+half-sibs, disjoint, 5-gen line, self-grandchild-marriage (terminates+warning), 500-node timing (R-PERF-4); assert no bbox overlap, parents-above, spouses-adjacent, deterministic rerun. Fallback: after ONE documented fix may switch to `elkjs` lazy Worker (record size+timings).
- Search: `GET /api/search?q=&treeId=` member-only; FTS5 prefix from escaped quoted tokens → zero-results → server fuzzy over `(id,normalised name)` DL distance ≤1 (token≤5) else ≤2, NFKC codepoints, ≤20 results, ≤300ms; filters name/birthYear/place; `surnames` GROUP BY lastName; `duplicates` same-norm-name + (±2yr or same place) via GROUP BY never nested loop, ≤`DUPLICATE_MAX_PAIRS`, ≤300ms, `truncated` when capped; fuzzy fallback worker keeps no cache; FTS hits join back to `visible_persons`. SearchBar + surname/duplicates UI + focus-mode endpoint wiring.
- Perf: bundle report from build (R-PERF-1 <250KB gzip initial), layout 500-node timing (R-PERF-4 <500ms layout+render: Vitest layout + Playwright render).

**AT IDs:** AT-26, AT-37, AT-40 (+ recurring 07/09/29 over new routes).
- AT-26 Devanagari typo found via prefix+fuzzy; vowel-sign pair never cross in FTS stage (exact + prefix).
- AT-37 all §7.6 fixtures incl. dual-parent couple + unstable-spouse warning; overlap/ordering/determinism.
- AT-40 >threshold tree: bounded payload ≤`MAX_TRAVERSAL_NODES`, `totalPersons+truncated`, focus deep descendant → ancestors to depth.

**Key files:** `src/lib/tree/layout.ts`, `src/lib/tree/layout.worker.ts`, `src/lib/server/search.ts`, `src/lib/server/workers/fuzzy-worker.ts`, `src/lib/schemas/search.ts`, `src/routes/api/search/+server.ts`, `src/routes/api/trees/[id]/{surnames,duplicates}/+server.ts`, `src/lib/components/tree/{TreeCanvas,TreeControls,PersonNode}.svelte`, `SearchBar.svelte`, focus-mode controls, tests `AT-26,37,40` + bundle/timing logs.

**Dependencies:** Needs 2 (persons/rels/graph/focus endpoint base, FTS triggers). Blocks 4 (duplicate pairs advisory, no merge) / 5 (bench search targets).

**Verification:**
```
CI=1 npm run check && CI=1 npm run lint && CI=1 npm run test
CI=1 npm run check:traceability -- --phase 3
CI=1 npm run build   # capture bundle report for R-PERF-1 + 500-node timing R-PERF-4
```

---

## Phase 4 — Collaboration

**Re-read:** §4, §5.1 (joinCodes, claims, changeHistory, notifications), §6.4–§6.6, §6.10, §7.3, §8 (limits/lockouts), §9 + base.

**Scope:**
- Join codes: format `<SLUG>-<8>` (`crypto.randomInt` over 32-symbol alphabet, slug cosmetic, lookup full string); family (one active/tree partial unique, `maxUses` NULL=unlimited dflt 50, pending person+membership txn + counter guarded `UPDATE … currentUses+1 WHERE active+cap+expiry` require 1 else abort, `invitedBy/joinedVia*`, history + `join_approval` notify owners/editors, pending excluded via active-membership join, approve→active+code role+visible+notify, reject→delete person + membership `rejected` personId NULL same txn + notify, rejected re-redeem generic failure); direct (single-use, any non-viewer creates, person+relation, role ≤ creator else 403, `self` = claim via null-guarded UPDATE, other relations per mapping parent/child/spouse/sibling normalised, one `immediate` txn: counter+person+rel+membership+history+notify, rollback all); shared expiry, `joinedViaType family|direct|claim|manual`; share (wa.me/mailto/copy/Web Share); already-member no-op message; unauth redirect register/login → `/join/CODE`; identical unknown/expired/exhausted/deactivated responses; join preview `GET /api/join/:code` + redeem `POST` (10/min, lockout tiers).
- Claiming: find-self only members/code-holders (non-members first+last-initial+birthYear only); methods self-code instant / questions (≥`MIN_VERIFICATION_QUESTIONS`, HMAC-SHA256 peppered NFKC-trim-lower-collapse, all-correct auto-approve, `claimAttempts` 5/24h per user+person + 20/hr/IP) / matching (deterministic `claims.ts` weights name .5/date .3/place .2, DL/Jaccard rules, missing=0 no renormalise, never auto-approve even ≥0.95) / manual; question texts readable same audience (never answers); reviewers set `linkedRelationType+linkedToPersonId` same-txn rel create; approval atomic null-guarded UPDATE (0 rows → loser `rejected` "already claimed"); `ux_person_user_per_tree` + partial pending unique; post-claim edit/add/code rights by role; claim search/review/verify routes.
- History/revert: per-person timeline, tree activity cursor pagination, visual diff (red strike/green), one-click revert + 10s undo toast same path; stale rule (update needs current==newValue else 409+current, `force:true` new revert row); revert-by-kind (create→soft/delete+snapshot, delete→restore+integrity recheck else 409 `REVERT_CONFLICT` / 410 `PURGED` post-purge, claim/tree →409 `NOT_REVERTIBLE`, unlink via member-remove); batchId atomic revert, 409 lists all stale fields; contributor own-only via `ctx.authorUserId`; edit notifications coalesced (one unread per claimed-person+editor per 10min via second index).
- Notifications: bell + `unreadCount`, paginated list, mark one/all read, types join/join_approval/claim/claim_review/edit, 60s visible-tab poll (no WS).

**AT IDs:** AT-01, AT-02, AT-03, AT-04, AT-05, AT-06, AT-08, AT-10, AT-11, AT-12, AT-20, AT-21, AT-31, AT-43, AT-44 (+ recurring 07/09/29).
- AT-01 20 concurrent direct redeem →1 success/19 fail, 1 person/membership/rel (≥2 conns/workers). AT-02 family maxUses=3, 10 concurrent →3 pending. AT-03 simultaneous claim same person →1 userId, loser rejected. AT-04 same user 2 persons same tree fails unique, across trees ok. AT-05 revert-after-edit 409+current, force ok + row. AT-06 delete-revert restores person+rels+events+media. AT-08 contributor others 403 own ok. AT-10 pending/rejected read 404. AT-11 pending excluded / no-membership visible. AT-12 unknown/expired/exhausted/deactivated byte-identical. AT-20 6th verify/24h blocked even correct. AT-21 score≥0.95 stays pending. AT-31 code tiers 5→15m/10→1h/20→24h + Retry-After, login unaffected. AT-43 create-revert 200 / rel-delete-after-endpoint 409 / post-purge 410 / claim 409 / batch atomic + stale list. AT-44 direct role>creator 403, redeem gets code role, family gets DEFAULT_JOIN_ROLE.

**Key files:** `src/lib/server/join-codes.ts`, `claims.ts`, `audit.ts`, `notifications.ts`, extend `permissions/route-policies`, `src/lib/schemas/{join,claims,history,notifications}.ts`, `src/routes/api/join/*`, `claims/*`, `history/revert`, `notifications/*`, `trees/[id]/{join-codes,members,activity}`, `src/routes/join/[code]/+page.svelte`, `claim/*`, `src/lib/components/{join,claim,history}/*` (JoinCodeGenerator, JoinFlow, ClaimProfileFlow, ClaimReview, ChangeHistory, ActivityFeed, Toast), tests each AT with multi-connection concurrency.

**Dependencies:** Needs 2+3 (persons/rels/visibility/search). Blocks 5 (export privacy + backup need stable collab writes).

**Verification:**
```
CI=1 npm run check && CI=1 npm run lint && CI=1 npm run test
CI=1 npm run check:traceability -- --phase 4
```

---

## Phase 5 — Import/Export, Public Trees, PWA, Polish

**Re-read:** §3, §4 (public), §6.9, §6.10, §7.3, §7.4, §8 (CSP) + base.

**Scope:**
- GEDCOM 5.5.1 UTF-8 (CONC/CONT, INDI/FAM/HUSB/WIFE/CHIL, BIRT/DEAT/MARR DATE/PLAC, NOTE/SEX/NAME+GIVN/SURN) in worker, one atomic txn, caps `IMPORT_MAX_BYTES/PERSONS/RELATIONSHIPS` pre-write reject, preview (parse-only counts+warnings) before commit, unknown tags ignored+counted, adds to `treeId` (no merge), each INDI new person `isLiving NULL`, one `create`/entity same `batchId note='gedcom import'`; BS export NOTE rule (Gregorian + original BS NOTE, no BS escape).
- Export GEDCOM/JSON/CSV; privacy filter (living if `isLiving=1` OR NULL+no-death AND (born<110yr OR birth unknown); living → name "Living", IDs+edges kept, drop dates/places/bio/notes/events/photos/claim); `excludeLiving` option; non-owner/public/"exclude" all filtered.
- Public trees: `isPublic` enforced, `allowPublic` only listed GETs + non-living photos, all through filter (living → "Living" no dates/places/bio/events/photos), anon private/nonexistent same 401 same body, writes/history/members/search/export/backup/notify 401 anon.
- Backup owner/editor: better-sqlite3 backup API in worker (page-exact, non-blocking) + photos tar stream; never raw WAL copy. `backup.sh` host → `docker compose exec tsx scripts/backup.ts`; `restore.sh` stop→restore→rebuild FTS→start.
- PWA: manifest/icons/splash installable, `service-worker.ts` precache shell+offline fallback only, never `/api|/photos|HTML` except fallback; offline mutations → toast; Playwright offline test (Cache Storage has no api/photos).
- Polish: onboarding 4-step tour, toasts/skeletons/undo, a11y (focus visible, ARIA icon labels, keyboard, aria-live errors, reduced-motion disables confetti), CSP Playwright no-violation on main pages, axe checks, e2e smoke (register→create→add→direct-join→claim) after `test:e2e:setup`.

**AT IDs:** AT-22, AT-23, AT-24, AT-30, AT-32, AT-33, AT-39, AT-45 (+ recurring).
- AT-22 backup→clean restore→FTS search identical + rebuilt. AT-23 filtered export anonymised, no PII, IDs/edges intact. AT-24 GEDCOM round-trip same people/rels/dates. AT-30 CSP zero violations. AT-32 anon allowPublic 200 filtered / private+nonexistent identical 401 / writes 401. AT-33 living → "Living" no PII, anon living photo 404. AT-39 caps import in worker + 50×health 200 <1s + 10 writes ok-or-503+Retry-After never 500 + atomic + p99. AT-45 SW offline shell-only.

**Key files:** `src/lib/server/gedcom.ts`, `export.ts`, `maintenance.ts` (stub scheduling only if needed — main in Phase 6), `src/lib/server/workers/{gedcom-worker,backup-worker}.ts`, `src/routes/api/gedcom/import`, `trees/[id]/{export,backup}`, `scripts/backup.ts`, `backup.sh`, `restore.sh`, `src/service-worker.ts`, `static/manifest…`, onboarding/toast/skeleton components, tests + `playwright.config.ts` + e2e specs.

**Dependencies:** Needs 1–4 (full data + collab + layout/search). Blocks 6 (bench + hardening need import/export/backup).

**Verification:**
```
CI=1 npm run check && CI=1 npm run lint && CI=1 npm run test
CI=1 npm run check:traceability -- --phase 5
npm run test:e2e:setup   # once, needs network; else Not verified
CI=1 npm run test:e2e    # line reporter, 120s global timeout
```

---

## Phase 6 — Hardening and Deployment

**Re-read:** §3, §6.12, §11, §13 + base.

**Scope:** `bench.ts` seed 50k → `BENCHMARKS.md` (machine desc., R-PERF-2/3/7/8 table, 3× relative fail, Pi rerun note); orphan sweep (`sweep-orphans.ts` unreferenced-only); maintenance (`maintenance.ts` startup+m `MAINTENANCE_INTERVAL_HOURS` worker, short txns: purge soft-deleted>30d + files post-commit, expired sessions, expired/used reset+verify tokens >24h, stale claimAttempts window+24h, fail→log+retry next, never block start); backup/restore exercised; README (requirements, local dev, Docker, Tunnel hostname→`http://familytree:3000` no `/photos/*` cache, env table incl. `ORIGIN DATABASE_PATH PHOTO_PATH SESSION_SECRET VERIFICATION_PEPPER CLOUDFLARE_TUNNEL_TOKEN SMTP_* GOOGLE_* ADDRESS_HEADER MIGRATIONS_PATH BODY_SIZE_LIMIT=12M`, backup/restore, upgrade, limitations: partial-BS approx sort, no realtime, in-mem limits reset, single-node); clean-clone `docker compose up -d` with documented env only; graceful SIGTERM (stop accept→drain→`wal_checkpoint(TRUNCATE)`→close); cold-start <2s timed (R-PERF-5); RSS ≤200MB steady via `docker stats` (R-PERF-6, peak import/backup/image reported); all AT-01…47 green.

**AT IDs:** AT-34, AT-46 + FULL SUITE AT-01…AT-47.
- AT-34 sweep removes only unreferenced. AT-46 seeded maintenance purges only expired (persons/files/sessions/tokens/attempts), newer untouched.

**Key files:** `scripts/bench.ts`, `scripts/sweep-orphans.ts`, `scripts/rebuild-fts.ts` (finalise), `scripts/backup.ts`, `src/lib/server/maintenance.ts`, `Dockerfile` (final: build needs python3/make/g++ only if no prebuilt, runtime no compilers, non-root, copy build+migrations+scripts+prod deps incl. tsx, mkdir/chown /data/db /data/photos, HEALTHCHECK `node -e fetch /api/health`), `docker-compose.yml`/`dev.yml`, `README.md`, `BENCHMARKS.md`, `DECISIONS.md` (final pass).

**Dependencies:** Needs 1–5 (entire app). No successors (except optional 7).

**Verification:**
```
CI=1 npm run check && CI=1 npm run lint && CI=1 npm run test
CI=1 npm run check:traceability -- --phase 6
CI=1 npm run bench            # writes BENCHMARKS.md, checks R-PERF-2/3/7/8
docker compose build && docker compose up -d  # clean clone
# backup → wipe → restore drill + graceful SIGTERM + cold-start + docker stats RSS
```

---

## Phase 7 (optional) — Interaction extras
Swipe actions, pull-to-refresh, drag-and-drop relationship creation, minimap. No ATs. Must keep R-PERF-1 (lazy chunk), a11y (keyboard + reduced-motion), CSP nonce, and all AT-01…47 green. Re-read §7.5 + base. Verify with `check/lint/test/traceability --phase 6` (no new ATs) + targeted e2e.

---

## Traceability Mapping (AT → Phase)

| AT | Phase | Title / Expectation |
|---|---|---|
| AT-01 | 4 | 20 concurrent direct-code redeems → 1 success |
| AT-02 | 4 | family maxUses=3, 10 concurrent → 3 pending |
| AT-03 | 4 | simultaneous claim same person → 1 wins, loser rejected |
| AT-04 | 4 | same user 2 persons same tree fails unique; cross-tree ok |
| AT-05 | 4 | revert-after-edit 409 + force ok |
| AT-06 | 4 | delete-revert restores all rows |
| AT-07 | 2 recurring | viewer above-role → 403 (from Phase 2, every phase after) |
| AT-08 | 4 | contributor others 403 own ok |
| AT-09 | 2 recurring | cross-tree member → 404 (from Phase 2) |
| AT-10 | 4 | pending/rejected read 404 |
| AT-11 | 4 | pending hidden / no-membership visible |
| AT-12 | 4 | unknown/expired/exhausted/deactivated byte-identical |
| AT-13 | 2 | parent cycle rejected |
| AT-14 | 2 | spouse reverse duplicate + normalised |
| AT-15 | 2 | stale version 409 no history |
| AT-16 | 2 | bad media 415/413, no file |
| AT-17 | 2 | photos 401/404 + private headers |
| AT-18 | 1b | login rate + account lock + reset clears |
| AT-19 | 1a | proxy IP independence |
| AT-20 | 4 | 6th verify/24h blocked |
| AT-21 | 4 | score≥0.95 stays pending |
| AT-22 | 5 | backup→restore→FTS identical |
| AT-23 | 5 | filtered export anonymised |
| AT-24 | 5 | GEDCOM round-trip equal |
| AT-25 | 1a | date parser incl. BS |
| AT-26 | 3 | Devanagari search + vowel-sign isolation |
| AT-27 | 2 | delete file-after-commit / rollback-keeps |
| AT-28 | 1a | contrast ≥4.5:1 |
| AT-29 | 1a recurring | registry entry + probe 401/404/403/success (from 1a over existing, expands each phase) |
| AT-30 | 5 | CSP zero violations |
| AT-31 | 4 | code lockout tiers, login unaffected |
| AT-32 | 5 | anon public/private/nonexistent/write matrix |
| AT-33 | 5 | public living filtered + photo 404 |
| AT-34 | 6 | sweep orphans only |
| AT-35 | 1a | migrations fresh+upgrade + FTS sync + rebuild |
| AT-36 | 1b | auth hygiene (enum/bcrypt/72B/token/sessions/cookies/concurrency/OAuth) |
| AT-37 | 3 | layout fixtures + unstable-spouse |
| AT-38 | 2 | 40-gen bounds + GRAPH_TOO_DEEP + cycle |
| AT-39 | 5 | caps import under load, health 200, BUSY 503 never 500 |
| AT-40 | 3 | focus mode bounds + deep focus |
| AT-41 | 2 | events audit + viewer 403 |
| AT-42 | 2 | remove/leave/account-delete unlink + reuse email |
| AT-43 | 4 | revert kinds (create/conflict/purged/not-revertible/batch atomic) |
| AT-44 | 4 | code roles (above-creator 403, code role, family default) |
| AT-45 | 5 | SW offline shell-only, no api/photos cache |
| AT-46 | 6 | maintenance purges only expired |
| AT-47 | 1a | nonce CSP, no unsafe-inline |

Recurring: AT-07, AT-09, AT-29 run in every phase from introduction over all routes existing at that time. Phase checkpoints cumulative: 1b includes 1a; 2 includes 1a–1b; etc.; Phase 6 requires AT-01…AT-47 all green + `BENCHMARKS.md` R-PERF-7/8 + drill + cold-start/memory.

### Per-phase checkpoint summary (§13)
- 1a: `npm ls` clean; AT-19,25,28,29,35,47; `docker compose build`; container `/api/health` OK.
- 1b: AT-18,36 + earlier.
- 2: AT-07,09,13,14,15,16,17,27,38,41,42 + AT-29 over routes so far.
- 3: AT-26,37,40 + bundle R-PERF-1 + layout R-PERF-4 timing.
- 4: AT-01–06,08,10,11,12,20,21,31,43,44.
- 5: AT-22,23,24,30,32,33,39,45 + axe + e2e smoke (after `test:e2e:setup`).
- 6: AT-34,46 + clean-clone deploy + backup→wipe→restore + AT-01…47 + BENCHMARKS R-PERF-7/8.
- Each checkpoint also: `npm run check`, `lint`, `test`, `check:traceability -- --phase <id>` (§13–14, strict + no TODO/FIXME/skip/only + DECISIONS.md updated + honest Not verified).
