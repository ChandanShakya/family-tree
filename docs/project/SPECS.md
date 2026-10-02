# SPECS.md — Collaborative Family Tree (v4.0)

Dependency versions in §2 were resolved against the npm registry on 2026-10-01 and their peer ranges were cross-checked. Everything else in this file is a requirement, not a claim that it has been built or tested. Treat the §2 pins as the author's last-known-good set: the first action of Phase 1a is to install exactly these and run `npm ls`; any deviation follows §0.1.10.

---

## 0. How to use this file

**For the human:** put this file at the repo root. Send one message per phase:

> Read SPECS.md fully. Implement **Phase N only**, following §0.1. Stop at the checkpoint.

**For the model (binding rules):**

### 0.1 Operating rules
1. Implement only the named phase. Do not scaffold later phases.
2. Complete, working code for everything in scope. No stubs, no fake APIs, no `TODO`/`FIXME`. Anything you cannot finish goes in the **Deferred** list of your reply, never into code as a placeholder.
3. Use the pinned versions in §2 exactly. If an API differs from what you remember, read the installed package's types/docs before using it. Do not guess signatures.
4. Where this spec is ambiguous, choose the simplest option that satisfies the stated requirement and add a dated entry to `DECISIONS.md` (decision, alternatives, reason).
5. Never report a command as passing unless you ran it in this session. Quote the real summary line (e.g. `Tests 42 passed`). If you could not run something (ARM performance, Cloudflare, SMTP), say so explicitly.
6. Every phase reply ends with: **Files changed**, **Commands to verify**, **Results (real output)**, **Not verified**, **Deferred**.
7. Do not weaken a requirement to make a test pass. If a requirement seems wrong, stop and report it.
8. Acceptance tests (`AT-…`) and performance requirements (`R-PERF-…`) are the only ID'd items; tests carry the AT id in their title so coverage is traceable: `test('AT-07: …')`. Other requirements have no IDs; they are covered by the AT rows of §12 and by the section rules.
9. **Every command must be non-interactive and terminate.** Never run a watch mode or a foreground dev server. `package.json` must define at least these scripts (plus the extra scripts listed after the table), and you must run them in this form:

| Script | Command | Notes |
|---|---|---|
| `check` | `svelte-check --tsconfig ./tsconfig.json` | plus `tsc --noEmit` in CI step |
| `test` | `vitest run` | never bare `vitest` (watch mode hangs) |
| `test:e2e` | `playwright test --reporter=line` | `playwright.config.ts` uses `webServer` with `reuseExistingServer: false`, builds and starts the app itself, and sets a global timeout of 120 s |
| `lint` | `eslint .` | |
| `db:generate` | `drizzle-kit generate` | add `--custom --name=<name>` for hand-written SQL migrations |
| `build` | `vite build` | |
| `test:e2e:setup` | `playwright install --with-deps chromium` | run once before the first `test:e2e`; needs network. If it cannot run, say so under **Not verified** and do not claim e2e results |
| `check:traceability` | `node scripts/check-traceability.mjs --phase <id>` | plain Node ESM script, no dependencies; see §14 |
| `db:migrate` | `tsx scripts/migrate.ts` | applies migrations to `DATABASE_PATH` |
| `contrast` | `tsx scripts/contrast.ts` | also invoked by a Vitest test (AT-28) |
| `bench` | `tsx scripts/bench.ts` | writes `BENCHMARKS.md` (§3) |
| `seed` | `tsx scripts/seed.ts` | development and test fixtures |
| `rebuild-fts` | `tsx scripts/rebuild-fts.ts` | §5.2 |
| `sweep-orphans` | `tsx scripts/sweep-orphans.ts` | §6.7 |

10. **Dependency failure procedure.** If a pinned package fails to install or run: never use `--force` or `--legacy-peer-deps`; find the newest version that satisfies the peer ranges (`npm view <pkg> versions`); if the failure is a runtime incompatibility (for example Drizzle with `better-sqlite3`), try the previous major of the failing package; record the error, the change and the reason in `DECISIONS.md`; rerun the whole phase's tests.
11. **Start every phase reply with a `Scope:` line** listing the sections of this file you read (use §0.3) and the AT ids in scope for the phase. Re-read the listed sections at the start of each phase; do not rely on memory of earlier phases.
12. **Conflicts inside this file.** If two statements conflict, the data and security sections (§4, §5, §8) win over the feature and UI sections (§6, §7). Record the conflict in `DECISIONS.md` and list it under **Not verified** in the reply. Never resolve a conflict silently.

Set `CI=1` for all runs. If you need a running server for a manual check, start it in the background with output redirected to a log file, poll `/api/health` with a timeout, and kill it afterwards. Prefix any command that could block with `timeout 300`.

### 0.2 Tunable defaults
All product-policy numbers live in `src/lib/config.ts`, one exported constant each, so changing a decision is a one-line edit. The rate limits and lockout tiers of §8 are exported from the same file as `RATE_LIMITS` and `LOCKOUT_TIERS`. The values below are **defaults chosen by the spec author**; the project owner should review them.

| Constant | Default | Meaning |
|---|---|---|
| `LIVING_ASSUMPTION_YEARS` | 110 | If `isLiving` is unknown and no death date, treat as living when born within this many years (or birth unknown) |
| `MIN_VERIFICATION_QUESTIONS` | 3 | Minimum questions on a person before auto-approval by answers is possible |
| `VERIFY_MAX_ATTEMPTS_PER_24H` | 5 | Per (user, person) |
| `SOFT_DELETE_PURGE_DAYS` | 30 | Hard purge of soft-deleted persons |
| `SESSION_DAYS` | 30 | Session lifetime |
| `CONTRIBUTOR_REVERT_OWN_ONLY` | true | Contributors can revert only their own changes |
| `FAMILY_CODE_DEFAULT_MAX_USES` | 50 | `NULL` in DB means unlimited |
| `EDIT_NOTIFY_COALESCE_MINUTES` | 10 | Coalescing of `edit` notifications |
| `TREE_FOCUS_MODE_THRESHOLD` | 500 | Nodes above which focus mode is used |
| `PASSWORD_MIN_LENGTH` | 10 | Max is 72 bytes (bcrypt limit) |
| `PASSWORD_HASH_CONCURRENCY` | 2 | Max simultaneous bcrypt operations (queue the rest) |
| `MAX_TRAVERSAL_DEPTH` | 30 | Hard cap, in generations, for any ancestor/descendant/relationship-path traversal |
| `MAX_TRAVERSAL_NODES` | 5000 | Hard cap on nodes returned or visited by one traversal |
| `DEFAULT_FOCUS_DEPTH` | 3 | Generations each way for a focus view |
| `IMPORT_MAX_BYTES` | 5242880 | GEDCOM upload cap (5 MB) |
| `IMPORT_MAX_PERSONS` / `IMPORT_MAX_RELATIONSHIPS` | 10000 / 20000 | Import caps |
| `MAIN_THREAD_BLOCK_BUDGET_MS` | 50 | Longest synchronous DB/CPU work allowed on the main thread per request |
| `DEFAULT_JOIN_ROLE` | `contributor` | Role of members who join through a family code, or a direct code without an explicit role |
| `MATCH_WEIGHTS` | name 0.5, birth date 0.3, birth place 0.2 | Weights of the advisory matching score (§6.5) |
| `DUPLICATE_MAX_PAIRS` | 200 | Cap on candidate pairs from the duplicate finder (§6.8) |
| `UPLOAD_MAX_BYTES` / `IMAGE_MAX_PIXELS` | 10485760 / 25000000 | Image upload size and decoded-pixel caps (§6.7) |
| `MAINTENANCE_INTERVAL_HOURS` | 6 | Period of the maintenance job (§6.12) |
| `RATE_LIMITS` / `LOCKOUT_TIERS` | see §8 | Every number in the §8 tables, as data |

### 0.3 Reading guide (what to re-read per phase)
Read the whole file once at the start of Phase 1a. In every later phase, re-read §0, §2, §14, the §12 rows for that phase, and the sections below, plus anything they reference.

| Phase | Re-read |
|---|---|
| 1a | §3, §5, §6.3 (dates), §7.0–7.2, §8, §10, §11 |
| 1b | §5.1 (users, oauthAccounts, sessions, token tables), §6.1, §7.0, §8, §9 (auth rows) |
| 2 | §3 (connections and the event loop), §4, §5, §6.2, §6.3, §6.7, §6.11, §8 (route policies), §9, §10 |
| 3 | §3, §5.2, §6.8, §6.11, §7.3, §7.6 |
| 4 | §4, §5.1 (joinCodes, claims, changeHistory, notifications), §6.4–§6.6, §6.10, §7.3, §8 (limits and lockouts), §9 |
| 5 | §3, §4 (public trees), §6.9, §6.10, §7.3, §7.4, §8 (CSP) |
| 6 | §3, §6.12, §11, §13 |

---

## 1. Product

Families build genealogy trees together. A user can own or join many trees. Within a tree, a user can be linked to at most one person, and a person can be linked to at most one user. All changes are audited and revertible. The app is self-hosted (Raspberry Pi 4 with ≥1 GB RAM, or a small VPS), exposed through Cloudflare Tunnel, free to run.

Non-goals for v1: real-time sync, offline editing, merging duplicate people, media other than photos, a translated UI (the interface is English only; names, places and notes may use any script), non-Gregorian *storage* (Bikram Sambat is supported as an input/display mode on top of Gregorian canonical values, see §6.3).

---

## 2. Stack (pinned; do not substitute)

Use `npm install --save-exact`. Do not use `--legacy-peer-deps`; if npm reports a peer conflict, stop, pick the nearest compatible version, and record it in `DECISIONS.md`.

| Package | Version | Notes |
|---|---|---|
| node | 22.x (≥ 22.12) | Docker base `node:22-bookworm-slim`; `better-sqlite3` requires ≥ 22 |
| `@sveltejs/kit` | 2.70.3 | |
| `svelte` | 5.57.1 | runes only; no legacy `$:` or stores for component state |
| `@sveltejs/adapter-node` | 5.5.7 | |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | requires Vite 8 |
| `vite` | 8.3.1 | |
| `typescript` | 6.0.3 | **Not 7.x**: Kit and svelte-check peer ranges stop at 6 |
| `svelte-check` | 4.7.6 | |
| `tailwindcss` + `@tailwindcss/vite` | 4.3.3 | `@import "tailwindcss"` in `app.css`; no tailwind config file |
| `@lucide/svelte` | 1.49.0 | Svelte 5 package. Do not use `lucide-svelte` |
| `drizzle-orm` | 0.45.3 | |
| `drizzle-kit` | 0.31.11 | dev |
| `better-sqlite3` | 13.0.3 | `@types/better-sqlite3` 9.6.0 (dev). Phase 1a smoke test must open a DB, run all pragmas and an FTS5 query through Drizzle to prove this combination works |
| `zod` | 4.6.5 | Zod 4 API (`z.email()`, `z.uuid()`, `error:` param). Do not write Zod 3 code |
| `bcryptjs` | 3.0.3 | Pure JS, async API only, cost 12 |
| `d3-zoom` 3.0.0, `d3-selection` 3.0.0, `d3-shape` 3.2.0 | | Rendering/zoom only (no `d3-hierarchy`: nothing uses it). Layout is custom (§7.6). **No `d3-dag`** |
| `nodemailer` | 10.0.13 | Optional SMTP |
| `sharp` | 0.35.5 | Prebuilt `linux-arm64` binary exists; if install fails the build fails (no silent fallback) |
| `tar-stream` | 3.2.1 | Backup export |
| `nepali-date-converter` | 3.4.0 | BS↔AD conversion (§6.3). Phase 1a must verify its supported year range and record it in `DECISIONS.md` |
| `vitest` | 5.0.3 | with matching `@vitest/*` packages if used |
| `@playwright/test` 1.63.0, `@axe-core/playwright` 4.13.0 | | Phase 5 (browser install: `test:e2e:setup`) |
| `@types/node` | 22.20.4 | matches runtime major |
| `tsx` | 4.23.15 | runs `scripts/*.ts`; a **production** dependency, because `rebuild-fts`, `sweep-orphans` and `backup` run inside the container (§11) |
| `eslint` 10.11.0, `typescript-eslint` 8.71.0, `eslint-plugin-svelte` 3.23.0 | | `typescript-eslint` accepts TypeScript < 6.1, so 6.0.3 is fine. Also install `@eslint/js` (same major as eslint) and `globals`; pin whatever resolves and record it |

Google OAuth: hand-written authorization-code flow with PKCE using `fetch`. No auth library.

### 2.1 Syntax rules for libraries newer than most training data

**Zod 4** (`zod` 4.x). Use the Zod 4 forms; the old chained forms still exist but are deprecated, and mixing styles is forbidden in this codebase:
```ts
import { z } from 'zod';
const Email = z.email();                    // not z.string().email()
const Id = z.uuid();                        // not z.string().uuid()
const Name = z.string({ error: 'Name is required' }).trim().min(1).max(100);
type In = z.infer<typeof Schema>;
const r = Schema.safeParse(body);           // on failure: r.error.issues
```
Use `error:` for custom messages (not `message:` / `invalid_type_error:`). Before using any other Zod API, check the installed package's types.

**Svelte 5 runes.** Components use `let { data, children } = $props()`, `$state`, `$derived`, `$effect`, `{@render children()}`, and `onclick={…}` attributes. Forbidden: `export let`, `$:`, `<slot>`, `on:click`, `createEventDispatcher`, and `writable`/`readable` stores for component-local state. Shared client state goes in `.svelte.ts` modules using `$state`.

**Data flow rule (see §7.0):** page data arrives from `+page.server.ts` `load` as `data`. Derive view state with `$derived(data.x)`. Copy into `$state` only when the user edits a local draft (e.g. a form), and resync after `invalidateAll()`.

---

## 3. Non-functional requirements

| ID | Requirement | How it is verified |
|---|---|---|
| R-PERF-1 | Initial JS < 250 KB gzip; tree chunk lazy-loaded | Phase 3 bundle report printed from build output |
| R-PERF-2 | Typical read query < 25 ms p95 single user | `scripts/bench.ts` |
| R-PERF-3 | Search < 150 ms (FTS) and < 300 ms (fuzzy) in one tree of 50k people | `scripts/bench.ts` |
| R-PERF-4 | Layout + render of 500 nodes < 500 ms | Phase 3 Vitest benchmark (layout) + Playwright timing (render) |
| R-PERF-5 | Cold start < 2 s | timed in Phase 6 |
| R-PERF-6 | RSS ≤ 200 MB steady state after warm-up (the peak during import, backup or image work is measured and reported, with no target) | `docker stats` capture in Phase 6 |
| R-PERF-7 | Event loop stays responsive: p99 loop delay < 100 ms under the bench load, including during an import | `perf_hooks.monitorEventLoopDelay`, reported by `bench.ts` and by `/api/health` |
| R-PERF-8 | A GEDCOM import at the caps commits in < 5 s (so it fits inside other writers' `busy_timeout`) | `bench.ts` |

Performance numbers are **measured and reported, not asserted**. `scripts/bench.ts` seeds 50k people and prints a table to `BENCHMARKS.md` with the machine description. Budgets are enforced as relative failures on the dev machine (the script exits non-zero if search p95 exceeds 3× the target) and the owner runs it once on the Pi. Pi 4 minimum is 1 GB RAM.

SQLite pragmas at startup: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `cache_size=-64000`, `mmap_size=268435456`, `temp_store=MEMORY`. Multi-statement writes use `db.transaction(fn).immediate()`.

**Connections and the event loop.** `better-sqlite3` is synchronous, so long work on the main thread blocks every request. Rules:
- The main thread owns one read/write connection for ordinary request work. Any single request must stay within `MAIN_THREAD_BLOCK_BUDGET_MS` of synchronous DB/CPU work.
- Work that can exceed that budget runs in a `node:worker_threads` worker (code in `src/lib/server/workers/`, no extra dependency), each worker opening its own connection with the same pragmas: GEDCOM parse + import, backup, full-tree export, and the fuzzy-search fallback. Workers are created on demand and exit when idle, except the fuzzy worker, which stays alive.
- WAL mode lets worker reads proceed alongside main-thread writes. There is still exactly one writer at a time; writers wait up to `busy_timeout`.
- `SQLITE_BUSY` is never surfaced as a 500: map it to `503` with `{ error: { code: 'BUSY' } }` and `Retry-After: 2`.
- Bulk inserts use prepared statements inside a single transaction (never one transaction per row).
- Password hashing is limited to `PASSWORD_HASH_CONCURRENCY` simultaneous operations; others queue.
- No worker or request keeps a read transaction, or an un-exhausted `iterate()`, open while idle: an open reader blocks `wal_checkpoint(TRUNCATE)`. The shutdown checkpoint retries up to 3 times, 1 s apart, and logs a warning if it still reports busy (the WAL is recovered at the next start; no data is lost).

---

## 4. Roles and permission matrix

Roles: `owner`, `editor`, `contributor`, `viewer`. The matrix lives as data in `permissions.ts`; every route calls `requireTreeAccess(event, treeId, action)`. No inline role checks anywhere else.

| Action | owner | editor | contributor | viewer |
|---|---|---|---|---|
| View tree, persons, history, media | ✅ | ✅ | ✅ | ✅ |
| Add/edit person, relationship, event, photo | ✅ | ✅ | ✅ | ❌ |
| Delete person / relationship / photo | ✅ | ✅ | ❌ | ❌ |
| Revert a change | ✅ | ✅ | own changes only | ❌ |
| Create direct join code | ✅ | ✅ | ✅ | ❌ |
| View / regenerate family code | ✅ | ✅ | ❌ | ❌ |
| Approve/reject join and claim requests | ✅ | ✅ | ❌ | ❌ |
| Set verification questions for a person | ✅ | ✅ | ✅ | ❌ |
| Change roles, remove members | ✅ | ❌ | ❌ | ❌ |
| Import GEDCOM | ✅ | ✅ | ❌ | ❌ |
| Full export, backup | ✅ | ✅ | ❌ | ❌ |
| Privacy-filtered export | ✅ | ✅ | ✅ | ✅ |
| Transfer ownership, delete tree | ✅ | ❌ | ❌ | ❌ |

Rules:
- The owner cannot leave or be demoted; ownership must be transferred first to an `active` member.
- `pending` and `rejected` members have no read access to tree data.
- Any route for a tree the caller has no active membership in returns **404**, never 403, so tree existence is not disclosed. Authenticated but insufficient role returns 403.
- **Entity-keyed routes** (person, relationship, event, media, history row, claim) resolve their tree inside the service call with `resolveTreeId(entityType, id)`. An unknown id and an id in a tree the caller cannot access both return 404 with the same body. `requireTreeAccess(event, treeId, action, ctx?)` takes `ctx = { authorUserId }` for the contributor revert rule ("own changes only").
- Any non-owner member may remove themselves from a tree. Removing a member, or leaving, sets `persons.userId` and `claimedAt` to NULL for that member's person in that tree in the same transaction; the person row stays.
- **Roles granted at join.** Members who join through a family code get `DEFAULT_JOIN_ROLE`. A direct code carries a `role` (`viewer`, `contributor` or `editor`, never `owner`) that must not exceed the role of the member creating it; a higher value is rejected with 403.
- **Public trees** (`isPublic`; implemented in Phase 5 together with the privacy filter, and until then the flag is only stored). Anonymous callers may use only routes whose policy has `allowPublic: true`: `GET /api/trees/:id`, `GET /api/persons/:id`, `GET /api/persons/:id/relatives`, `GET /api/persons/:id/relation`, and `GET /photos/…` for non-living persons. Every such response passes through the privacy filter of §6.9 (living/unknown persons appear as "Living" with no dates, places, bio, events or photos). Everything else (history, activity, members, codes, search, export, backup, notifications, every write) requires a session and returns 401 to anonymous callers. An anonymous request to a *private* tree, or to a tree id that does not exist, returns the same 401 with the same body, so existence is not disclosed to anonymous callers either.

---

## 5. Database

Schema in `src/lib/db/schema.ts` (Drizzle). IDs: UUIDv4 text. Timestamps: ISO-8601 UTC text. Booleans: integer 0/1.

**Migration mechanics (single ordered sequence):**
1. Generate schema migrations with `drizzle-kit generate`.
2. Generate the FTS migration with `drizzle-kit generate --custom --name=fts`, which creates an empty, journal-tracked SQL file in the same `migrations/` folder; write the SQL of §5.2 into it. Any later migration that alters `persons` columns used by the FTS triggers must use another `--custom` migration to drop and recreate those triggers. The `visible_persons` view (§5.1) is created the same way (`--custom --name=views`) and is recreated by a custom migration whenever `persons` is rebuilt.
3. Within a hand-written migration file, separate statements with the `--> statement-breakpoint` marker. A `CREATE TRIGGER … BEGIN … END;` block is **one** statement and contains no breakpoint inside it.
4. At startup, call `migrate()` from `drizzle-orm/better-sqlite3/migrator` once, before the server listens. The migrations folder is passed explicitly from `MIGRATIONS_PATH` (default `src/lib/db/migrations`; the image copies it and sets the variable, §11); a relative path inside the bundled server output is a known way to break production. Do **not** run the FTS SQL in a separate script before the migrator: on a fresh database the `persons` table does not exist yet, and ordering with later schema changes would be lost.
5. After migration, run the FTS consistency check of §5.2 (count compare, rebuild on mismatch).
6. Phase 1a verifies this on a fresh database *and* on an upgrade from an earlier migration, and records the exact `drizzle-kit` behaviour in `DECISIONS.md`.

### 5.1 Tables

**users**: `id`, `email` (unique, stored lowercase), `passwordHash` (nullable for OAuth-only), `displayName`, `avatarUrl`, `emailVerifiedAt`, `themePref` (`system|light|dark`, default `system`), `dateDisplayPref` (`AD|BS|both`, default `AD`), `notifyPrefs` (JSON), `createdAt`, `deletedAt`.

**oauthAccounts**: `id`, `userId` (FK cascade), `provider`, `providerUserId`; unique `(provider, providerUserId)`.

**trees**: `id`, `name`, `description`, `ownerId` (FK users), `coverImage`, `isPublic` (default 0), `createdAt`, `updatedAt`.

**persons**: `id`, `treeId` (FK cascade, not null), `userId` (FK users, ON DELETE SET NULL), `claimedAt`, `claimedVia` (`claim_code|verification|matching|manual|join_code|created`), `firstName` (not null), `lastName`, `maidenName`, `birthDate`, `birthDateCal` (`AD|BS`, default `AD`), `birthDateNorm`, `deathDate`, `deathDateCal`, `deathDateNorm`, `gender` (`M|F|X|U`, default `U`), `birthPlace`, `deathPlace`, `photoUrl`, `bio`, `isLiving` (nullable; NULL = unknown), `createdBy`, `lastEditedBy`, `version` (integer, default 1), `createdAt`, `updatedAt`, `deletedAt`.
- Partial unique index `ux_person_user_per_tree` on `(treeId, userId) WHERE userId IS NOT NULL` (a user is at most one person per tree; the same user may appear in many trees).
- "One person, one claimant" is enforced by `UPDATE persons SET userId=?, claimedAt=?, claimedVia=? WHERE id=? AND userId IS NULL AND deletedAt IS NULL` and requiring `changes === 1` inside the transaction.
- Indexes: `(treeId, lastName, firstName)`, `(treeId, deletedAt)`.
- There is **no** stored `generation` column. Generation is computed by the layout engine and by the stats query (§7.6).
- **Visibility.** A person is *visible* when `deletedAt IS NULL` and no `treeMembers` row with `personId = persons.id` has `status <> 'active'`. Define the SQL view `visible_persons` as `SELECT * FROM persons p WHERE p.deletedAt IS NULL AND NOT EXISTS (SELECT 1 FROM treeMembers m WHERE m.personId = p.id AND m.status <> 'active')`. Every tree query, traversal, search (FTS hits are joined back to the view), export and statistic reads `visible_persons`; only writers and the maintenance job read `persons` directly. (Joining *to* an active membership would wrongly hide every person who has no membership row.)
- **Source of truth for claims** is `persons.userId`; `treeMembers.personId` is a denormalised copy updated in the same transaction.

**treeMembers**: `id`, `treeId` (FK cascade), `userId` (FK cascade), `personId` (FK persons, **ON DELETE SET NULL**, nullable), `role`, `status` (`active|pending|rejected`), `invitedBy`, `joinedAt`, `joinedViaCode`, `joinedViaType` (`family|direct|claim|manual`); unique `(treeId, userId)`. Partial unique index `ux_one_owner_per_tree` on `(treeId) WHERE role='owner'`; `trees.ownerId` and the `owner` row change together in the transfer transaction. A `rejected` row is kept (with `personId` NULL) so a rejected visitor cannot re-apply with the same code; an owner clears it with "remove member".

**relationships**: `id`, `treeId` (FK cascade), `person1Id` (FK cascade), `person2Id` (FK cascade), `type` (`parent|spouse|sibling|guardian`), `startDate`, `endDate`, `notes`, `createdBy`, `createdAt`.
- `parent`: `person1Id` = parent, `person2Id` = child. `guardian`: same direction.
- `spouse`/`sibling`: stored with `person1Id < person2Id` (string comparison), normalised in the service layer before insert.
- `CHECK (person1Id <> person2Id)`; `UNIQUE (person1Id, person2Id, type)`.
- Indexes: `treeId`, `person1Id`, `person2Id`.
- Service-layer checks inside the write transaction: both persons exist, are not soft-deleted, and belong to `treeId`; `parent` links must not create a cycle (bounded ancestor walk of the proposed parent per §6.11; reject if the child is reached; reject with `GRAPH_TOO_DEEP` if the walk would exceed `MAX_TRAVERSAL_DEPTH`); a person with 2 existing `parent` links gets a warning flag in the response, not a block (adoptive/step cases use `guardian`).

**joinCodes**: `id`, `code` (unique), `type` (`family|direct`), `treeId` (FK cascade), `createdBy`, `linkedPersonId` (FK persons, ON DELETE CASCADE, nullable), `linkedRelationType` (`parent|child|spouse|sibling|self`, nullable), `role` (`viewer|contributor|editor`, default `DEFAULT_JOIN_ROLE`), `expiresAt`, `maxUses` (NULL = unlimited, family only; direct is always 1), `currentUses` (default 0), `isActive`, `createdAt`.
- Partial unique index: `UNIQUE(treeId) WHERE type='family' AND isActive=1`.
- Redemption increments atomically:
  `UPDATE joinCodes SET currentUses=currentUses+1 WHERE id=? AND isActive=1 AND (maxUses IS NULL OR currentUses<maxUses) AND (expiresAt IS NULL OR expiresAt>?)` → require `changes===1`, otherwise abort the transaction with no side effects.
- Code format: `<SLUG>-<8 chars>`; the 8 characters come from `crypto.randomInt` over `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 symbols, 32^8 ≈ 1.1 × 10^12). The slug is cosmetic and never trusted; lookup is by the full string.
- Unknown, expired, exhausted and deactivated codes return an identical response (same status, same body, similar timing).
- A direct code with `linkedRelationType='self'` is the **only** code-based claim mechanism. There is no `claimCodes` table.

**profileClaims**: `id`, `userId`, `personId`, `treeId`, `proofMethod` (`verification|matching|manual`), `claimedFirstName`, `claimedLastName`, `claimedBirthDate`, `claimedBirthPlace`, `claimedRelation`, `matchScore` (real, nullable), `status` (`pending|approved|rejected|auto_approved`), `reviewedBy`, `reviewedAt`, `reviewNote`, `linkedRelationType`, `linkedToPersonId`, `createdAt`; partial unique index on `(userId, personId) WHERE status='pending'` (prevents duplicate pending submissions; a rejected claim may be resubmitted as a new row). Multiple users may have pending claims on one person; approval is atomic and the first wins.

**verificationQuestions**: `id`, `personId` (FK cascade), `treeId` (FK cascade), `createdBy`, `question`, `answerHash`, `createdAt`.
- `answerHash` = HMAC-SHA256 with `VERIFICATION_PEPPER` over the normalised answer: Unicode NFKC, trim, lowercase, collapse internal whitespace.
- Auto-approval requires ≥ `MIN_VERIFICATION_QUESTIONS` stored questions and **all** answers correct. Attempts are limited per (user, person) by the persisted table below.

**claimAttempts**: `userId`, `personId`, `count`, `windowStart`; PK `(userId, personId)`.

**changeHistory**: `id`, `treeId` (FK **cascade**), `entityType` (`person|relationship|event|media|tree`), `entityId` (no FK; polymorphic), `changedBy` (FK users), `changedAt`, `action` (`create|update|delete|revert|claim`), `field`, `oldValue` (JSON text), `newValue` (JSON text), `snapshot` (JSON text, nullable), `batchId`, `note`, `revertedFrom`, `isReverted`, `revertedBy`, `revertedAt`.
- One user action produces N rows sharing a `batchId` (one per changed field).
- `delete` rows carry a `snapshot` containing the full entity row plus dependent relationships, events and media rows, so deletion is revertible. Persons are soft-deleted (`deletedAt`); hard purge after `SOFT_DELETE_PURGE_DAYS` or on tree deletion.
- **Stale-revert rule**: reverting an `update` succeeds only if the field's current value equals that row's `newValue`. Otherwise return 409 with the current value; the client may resend with `force: true`, which writes a new `revert` row.
- A revert writes its own `changeHistory` row; reverting a revert follows the same rule.
- **Revert by kind.** `POST /api/history/revert` takes `{ historyId or batchId, force? }`; a `batchId` reverts all rows of that batch atomically (the stale rule is checked per row; the 409 lists every conflicting field).
  - `update` → the stale rule above.
  - `create` of a person, relationship, event or media → soft-delete / delete (writes a `delete` row with a snapshot and `revertedFrom`; files removed after commit).
  - `delete` → restore from `snapshot` after re-running the integrity checks (endpoints exist and are not soft-deleted, no cycle, depth cap); failure → 409 `REVERT_CONFLICT` with the reason; after the hard purge → 410 `PURGED`.
  - `claim` and `tree` rows are not revertible (409 `NOT_REVERTIBLE`); an owner or editor unlinks a claimed person by removing the member (§4).
- Indexes: `(entityType, entityId)`, `treeId`, `changedBy`, `changedAt`, `batchId`.
- No `merge` action in v1.

**events**: `id`, `personId` (FK cascade), `treeId` (FK cascade), `type`, `date`, `dateCal`, `dateNorm`, `place`, `description`, `createdAt`.

**media**: `id`, `personId` (FK cascade, nullable), `treeId` (FK cascade), `uploadedBy`, `storagePath`, `thumbPath`, `mime`, `sizeBytes`, `type` (`photo` only in v1), `caption`, `createdAt`.
- Deleting a media row, person or tree deletes the files **after** the DB transaction commits (`storage.deleteFiles(paths[])`). `scripts/sweep-orphans.ts` removes files with no row.

**sessions**: `id`, `userId` (FK cascade), `tokenHash` (unique), `expiresAt`, `createdAt`, `lastSeenAt`, `userAgent`; indexes on `userId`, `tokenHash`.

**notifications**: `id`, `userId` (FK cascade), `treeId` (FK cascade, nullable), `actorId` (FK users, ON DELETE SET NULL, nullable), `personId` (nullable, no FK), `type` (`join|join_approval|claim|claim_review|edit`), `title`, `body`, `linkUrl`, `isRead`, `createdAt`; indexes `(userId, isRead, createdAt)` and `(userId, type, personId, actorId, createdAt)`. `edit` notifications are coalesced (using the second index): at most one unread per (claimed person, editor) per `EDIT_NOTIFY_COALESCE_MINUTES`.

**passwordResetTokens**: `id`, `userId` (FK cascade), `tokenHash` (unique), `expiresAt` (1 h), `usedAt`, `createdAt`. Successful reset deletes all of that user's sessions.

**emailVerificationTokens**: same shape, 24 h. Unverified users can use the app but cannot generate join codes or make a tree public.

There is no `rateLimitHits` table; rate limiting is in memory (§8).

### 5.2 Full-text search (raw SQL migration)

Because `persons` has a text primary key, its implicit `rowid` is **not guaranteed stable across `VACUUM` or `VACUUM INTO`** (an operator may run either, and a restored copy must not depend on it). So FTS rows are keyed by a map table with an explicit integer key:

```sql
CREATE TABLE person_fts_map (
  fts_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  personId TEXT NOT NULL UNIQUE REFERENCES persons(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE persons_fts USING fts5(
  name, birthYear, place,
  personId UNINDEXED, treeId UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2 tokenchars 'ऀँंःऺऻ़ऽािीुूृॄॅॆेैॉॊोौ्ॎॏ॒॑॓॔ॕॖॗॢॣ'",
  prefix = '2 3'
);
```

`tokenchars` lists the Devanagari combining marks (U+0900–U+0903, U+093A–U+094F, U+0951–U+0957, U+0962–U+0963). By default `unicode61` treats combining marks as separators, so vowel signs are discarded at index and query time: names that differ only in a vowel sign (नेपाल / नीपाल) match each other and tokens degrade to bare consonants, which makes prefix search noisy (checked on SQLite 3.45.1). With the marks as token characters, only the exact vowel signs match. The Phase 1a smoke test indexes both names and asserts that searching for one does not return the other.

Triggers (all three write through `person_fts_map.fts_id` as the FTS `rowid`, so deletes are O(log n), not table scans):
- `AFTER INSERT ON persons WHEN NEW.deletedAt IS NULL`: insert map row; insert FTS row with `name = trim(firstName || ' ' || coalesce(lastName,'') || ' ' || coalesce(maidenName,''))`, `birthYear = substr(birthDateNorm,1,4)` (empty if NULL or `0000`), `place = trim(coalesce(birthPlace,'') || ' ' || coalesce(deathPlace,''))`.
- `AFTER UPDATE OF firstName, lastName, maidenName, birthDateNorm, birthPlace, deathPlace, deletedAt ON persons`: delete the FTS row by `fts_id` (if a map row exists); if `NEW.deletedAt IS NULL`, `INSERT OR IGNORE` the map row and insert the FTS row (this also covers a restore from soft-delete and a person first inserted while deleted).
- `AFTER DELETE ON persons`: delete FTS row (map row cascades).

`scripts/rebuild-fts.ts` rebuilds the index from `persons`. On startup, if `count(persons_fts) != count(persons WHERE deletedAt IS NULL)`, log a warning and rebuild. Restore (`restore.sh`) runs the rebuild.

---

## 6. Features

### 6.1 Accounts
- Register (email, password 10–72 bytes, display name), login, logout, password reset by email (if SMTP is unset, log the link to the server console), email verification, profile (display name, avatar), theme and date-display preferences, account deletion, optional Google OAuth (enabled only when both env vars are set).
- Anti-enumeration: register, forgot-password and login return generic messages. Login performs a dummy bcrypt comparison when the email does not exist, or the account has no password (OAuth-only), so timing is similar.
- Change password (current password required; revokes every other session) and resend the verification email (`POST /api/auth/password`, `POST /api/auth/verify/resend`).
- **Google sign-in and account linking:** accept only a result with `email_verified = true`. If a local account with that email exists and its `emailVerifiedAt` is NULL, clear its `passwordHash` and delete its sessions before linking (stops pre-registration takeover); if it is verified, link it. `SESSION_SECRET` signs the short-lived (10 min) `oauth_state` cookie that carries `state` and the PKCE verifier.
- Account deletion: remove credentials, sessions, OAuth links and avatar; set `email` to `deleted+<id>@invalid.invalid` (freeing the address); set `persons.userId` and `claimedAt` to NULL in every tree (the person rows stay) and delete the user's memberships; keep authored history rows displayed as "Deleted user"; if the user owns trees, require ownership transfer or tree deletion first.

### 6.2 Trees
Create (creates owner membership and one active family code; prompts the owner to create or claim their own person), dashboard (cards with cover and member count), settings (rename, cover, public toggle, regenerate family code), member list with roles, transfer ownership, delete (confirm by typing the tree name; files removed after commit), statistics (people, relationships, generation depth computed by a bounded traversal, §6.11).

### 6.3 Persons, relationships, dates

**Concurrency:** `PUT /api/persons/:id` requires the client's `version`; the update is `… WHERE id=? AND version=?` and increments `version`. Zero rows changed → 409 with the current row.

**Audit:** each update writes one `changeHistory` row per changed field with a shared `batchId`, in the same transaction. Create writes one row (`field` NULL). Delete writes one row with `snapshot`.

**Events:** `POST /api/events`, `PUT/DELETE /api/events/:id` (any non-viewer may add or edit; delete needs the delete permission). `type` is free text with suggested values (`residence`, `occupation`, `education`, `burial`, `other`); birth, death and marriage live in their own columns, not in events. Audit rules are those of persons, minus `version` (events have no optimistic lock: last write wins and is audited). Events are returned by `GET /api/persons/:id`.

**Relationships:** parent, spouse (marriage date in `startDate`), sibling, guardian. A `sibling` link exists only for siblings whose parents are unknown (siblings through shared parents are derived and never duplicated by a stored link); `guardian` is an extra, non-biological link drawn as a dashed edge. Add/edit/delete via sheet or modal. Derived relations (grandparent, great-*, aunt/uncle, niece/nephew, cousin and removal degree, in-law) are computed from stored links and never stored. "How are we related?" is a breadth-first search over the relationship graph, bounded by §6.11, returning the path and a human label (or "not connected within the search limit").

**Dates (Gregorian canonical, Bikram Sambat as an input/display mode):**
- The user's text is stored verbatim in `birthDate` / `deathDate` / `events.date`. The sibling `*Cal` column records whether that text is `AD` or `BS`; the form has an explicit AD/BS toggle (never auto-detected).
- `*Norm` is always **Gregorian** `YYYY-MM-DD`, with `00` for the unknown parts of **AD** inputs (BS partial dates follow the rule below), used for sorting, filtering, FTS birth year, and privacy rules.
- AD parsing: strip qualifiers `about|abt|ca|circa|c.|bef|before|aft|after|est|cal` (case-insensitive, optional dots); `BET x AND y` uses `x`; accept `YYYY-MM-DD`, `YYYY-MM`, `YYYY`, `D Month YYYY`, `D Mon YYYY`, `Month YYYY`; unparseable → NULL. Impossible dates (`31 Feb 1985`) → NULL.
- BS parsing: accept `YYYY-MM-DD` (month 1–12), `YYYY-MM`, `YYYY`, and `D Month YYYY` using the romanised month names Baisakh, Jestha, Ashadh, Shrawan, Bhadra, Ashwin, Kartik, Mangsir, Poush, Magh, Falgun, Chaitra (case-insensitive, common alternate spellings listed in `dates.ts`).
  - Full BS dates convert exactly through the library.
  - Partial BS dates: `Norm` is the Gregorian conversion of the **first day** of the period (BS year `Y` → 1 Baisakh `Y`; BS year-month → day 1 of that month), written as a complete `YYYY-MM-DD` with **no** `00` placeholders, because a BS period straddles two Gregorian years and `00` would be wrong. Precision is recovered by re-parsing the verbatim text, never from `Norm`. Accepted consequences, stated in the README and in the date field's tooltip: sorting by `Norm` is approximate for partial BS dates; the FTS `birthYear` of a BS-year-only birth can be one Gregorian year early; the privacy filter is unaffected in practice (the 110-year margin dwarfs a 1-year error). Tests cover the rule.
  - Dates outside the library's supported range → `Norm` NULL; the verbatim text is still shown.
- Display: per `dateDisplayPref`: `AD` shows the Gregorian display form (`15 March 1985`, `March 1985`, `1985`); `BS` shows the BS form converted from `Norm` when full, otherwise the stored text if it was entered as BS; `both` shows AD with BS in parentheses where convertible.
- GEDCOM 5.5.1 has no Bikram Sambat calendar escape. Export writes the Gregorian value and puts the original BS text in a `NOTE`.
- **Test fixtures:** BS↔AD pairs in tests must come from an authoritative published calendar and be cited in the test file comments. Do not invent conversion values from memory; cross-check at least five pairs (including a month-boundary and a leap-year case) against the source.

### 6.4 Join codes

**Family code** (type `family`, one active per tree): the visitor sees "Join *Tree Name*", fills their own details (name, DOB, gender, bio; a photo can be added after approval, because pending members cannot upload) and submits. One transaction creates the `persons` row (created by that user) and a `treeMembers` row with `status='pending'`, increments `currentUses`, writes history, and notifies owner and editors (`join_approval`). Pending persons are excluded from every tree query by joining to an `active` membership. Approve → `active` with the code's `role`, person visible, notify. Reject → delete the person and set the membership to `rejected` (`personId` NULL) in one transaction, notify the user; redeeming any code again as a rejected user returns the same generic failure as an unknown code.

**Direct code** (type `direct`, single use, created by any non-viewer member for a person + relation): the visitor sees "Join *Tree Name* as *relation* of *Person*", fills their own details, and one `immediate` transaction does: counter increment (guarded), person creation, relationship insert, active membership with the code's `role`, history rows, notifications. Any failure rolls back everything.

Relationship insert on redemption (new = the person created at redemption; linked = `linkedPersonId`):
- `parent` → `(person1=new, person2=linked, 'parent')`
- `child` → `(person1=linked, person2=new, 'parent')`
- `spouse` / `sibling` → normalised order
- `self` → no new person; the linked person is claimed by the redeemer via the null-guarded UPDATE of §5.1 (fails if already claimed)

Both types: optional expiry; `invitedBy`, `joinedViaCode`, `joinedViaType` recorded; share via WhatsApp (`https://wa.me/?text=`), email (`mailto:`), copy link, and the Web Share API when available. A user who is already an active member of that tree gets a clear message with no side effects. Redemptions of a code by an unauthenticated visitor redirect through register/login and return to `/join/CODE`.

### 6.5 Claiming (privacy-safe)
- "Find yourself" search is allowed only to (a) active tree members and (b) holders of a valid code for that specific tree. Non-members see first name, last initial and birth year only, and no places, notes or photos.
- Methods: `self` direct code (instant); verification questions (auto-approve if all correct and the minimum question count is met); matching (computes a score, **never auto-approves**, the score is shown to the reviewer); manual (reviewer decides). Claimants read question texts (never answers) through `GET /api/claims/questions/:personId`, open to the same audience as claim search.
- **Matching score** (deterministic, in `claims.ts`, weights from `MATCH_WEIGHTS`): `name` = 1 − DL(normalised full name, normalised claimed name) / max(length of the two), clamped to [0,1]; `birth date` = 1 if the claimed date normalises equal at the claimed precision, 0.5 if only the year matches, else 0; `birth place` = 1 if the normalised strings are equal, 0.5 if their token sets overlap (Jaccard ≥ 0.5), else 0. A missing claimed field scores 0 for its term (weights are not renormalised). Normalisation is that of §6.8. The score is advisory only.
- Reviewers (owner/editor) may set `linkedRelationType` + `linkedToPersonId` on approval; the relationship is created in the same transaction as the claim.
- Approval is atomic with the null-guarded UPDATE; if it changes 0 rows the claim becomes `rejected` with the note "already claimed".
- After claiming, the person may edit their own details, add relatives, and create direct codes (subject to role).

### 6.6 Audit trail and revert
Per-person timeline; tree-wide activity feed with cursor pagination; visual diff (old red strikethrough, new green); one-click revert subject to the stale-revert rule and permission matrix; an undo toast for 10 seconds after any edit that calls the same revert path; claimed persons are notified of edits (coalesced).

### 6.7 Media
- Images only: jpg, png, gif, webp; ≤ `UPLOAD_MAX_BYTES` (buffered in memory, which is why `BODY_SIZE_LIMIT` must be raised, §11); magic-byte validation; re-encode with `sharp` (configured with `limitInputPixels = IMAGE_MAX_PIXELS`, `sharp.concurrency(1)`, `sharp.cache(false)`; an image over the pixel cap → 413 `IMAGE_TOO_LARGE`) to strip EXIF/GPS and create a 400 px thumbnail; filenames are server-generated UUIDs under `PHOTO_PATH/<treeId>/<personId>/` (`_tree` instead of `<personId>` when `personId` is NULL); reject any path component not matching `^[A-Za-z0-9-]+$`.
- Served only by an authenticated route `/photos/[...path]` that checks tree membership (or `isPublic` and the person is not living/unknown). Headers: `Cache-Control: private, max-age=31536000, immutable` (filenames are never reused), `X-Content-Type-Options: nosniff`, correct `Content-Type`, `Content-Disposition: inline`.
- README tells the operator not to add a Cloudflare cache rule for `/photos/*`.
- `persons.photoUrl` holds the `/photos/…` URL of the person's primary media row (set with `makePrimary` on upload or by `PUT /api/media/:id`, cleared when that row is deleted). User avatars and tree covers use the same pipeline and limits and live under `PHOTO_PATH/_avatars/<userId>/` and `PHOTO_PATH/<treeId>/_cover/`; `/photos` serves an avatar to any signed-in user who shares an active tree with its owner, and a cover to active members of that tree.
- Per-person gallery, per-tree gallery, captions, lightbox.

### 6.8 Search
`GET /api/search?q=&treeId=` requires tree membership. Order: FTS5 prefix query built from escaped, quoted tokens; if zero results, a **server-side** fuzzy fallback over `(id, normalised name)` of that tree using Damerau-Levenshtein (max distance 1 for tokens ≤ 5 characters, else 2; NFKC-normalised code points so non-Latin names work), capped at 20 results and 300 ms. Filters: name, birth year, place. Surname explorer = grouped by `lastName`. Duplicate finder = same normalised name with birth years within ±2 or same birth place, returned as candidate pairs only (no merge). Candidates come from a `GROUP BY` on the normalised name (never a nested loop over all persons), capped at `DUPLICATE_MAX_PAIRS` pairs and 300 ms, with `truncated: true` when capped (common names are common in real trees). The fuzzy fallback reads `(id, name)` per query and keeps no cache in v1. Routes: `GET /api/trees/:id/surnames`, `GET /api/trees/:id/duplicates`.

### 6.9 Import / export
- **GEDCOM 5.5.1 import** (UTF-8; `CONC`/`CONT`; `INDI`, `FAM`, `HUSB`/`WIFE`/`CHIL`, `BIRT`/`DEAT`/`MARR` with `DATE`/`PLAC`, `NOTE`, `SEX`, `NAME` with `GIVN`/`SURN`): runs in a worker thread (§3) as one atomic transaction, capped at `IMPORT_MAX_BYTES`, `IMPORT_MAX_PERSONS` and `IMPORT_MAX_RELATIONSHIPS` (reject over-cap files with a clear error before writing anything), with a **preview** step (parse only, no writes) showing counts and warnings before commit; unknown tags are ignored and counted in the report. Import **adds** to the existing tree named by `treeId` in the request; nothing is merged or overwritten, each `INDI` becomes a new person with `isLiving` NULL, and the import is audited as one `create` row per entity sharing one `batchId` with `note = 'gedcom import'`.
- **Export**: GEDCOM, JSON, CSV.
- **Privacy filter** (applies to non-owner exports, public trees and the "exclude living" option): a person is treated as living if `isLiving = 1`, or `isLiving IS NULL` with no death date and (born within `LIVING_ASSUMPTION_YEARS` years or birth unknown). Living persons are exported with name "Living", IDs and relationship structure preserved; dates, places, bio, notes, events, photos and claim status are dropped.
- **Backup** (owner/editor): SQLite snapshot using the better-sqlite3 backup API in a worker thread (page-exact copy, does not block the event loop), plus photos, streamed as a tar. Never a raw file copy of a live WAL database.

### 6.10 Notifications
Bell with unread count (`unreadCount` in the `GET /api/notifications` response) in the top bar; list with pagination; mark one/all read; types per schema. Client polls every 60 s while the tab is visible (no WebSockets in v1).

### 6.11 Graph traversal limits (no unbounded recursion)

Every traversal of the relationship graph (cycle check, ancestors, descendants, relatives expansion, relation path, stats depth, focus views) is bounded by `MAX_TRAVERSAL_DEPTH` generations and `MAX_TRAVERSAL_NODES` nodes.

- Implement traversals either as an iterative breadth-first search in application code (one prepared statement per level, parent ids passed via `json_each`) or as `WITH RECURSIVE … UNION` (never `UNION ALL`, so cycles terminate) with a `depth < :max` condition and a `LIMIT :cap`. Do not load the whole persons table into memory for a traversal.
- When a limit stops a traversal, return the partial result with `truncated: true`. Never throw, hang, or return 500.
- Adding a `parent` link that would make any ancestor chain exceed `MAX_TRAVERSAL_DEPTH` is rejected with `GRAPH_TOO_DEEP`. (30 generations is far beyond a realistic family tree, so real data never hits this; it exists to bound cost and to defeat pathological input such as a hostile GEDCOM.)
- `GET /api/trees/:id` returns the full graph only if the tree has ≤ `TREE_FOCUS_MODE_THRESHOLD` persons. Otherwise it returns a focus subgraph around `?focus=<personId>` (default: the caller's own person, else the oldest root person) with `?depth=` (default `DEFAULT_FOCUS_DEPTH`, max `MAX_TRAVERSAL_DEPTH`), plus `{ totalPersons, truncated }`. The client's focus mode (§7.6) calls this endpoint to expand branches.
- Memory budget on a 1 GB host: a response never carries more than `MAX_TRAVERSAL_NODES` persons. The only whole-tree scan allowed is the fuzzy-search worker, which reads `(id, name)` pairs only.

### 6.12 Maintenance job

`src/lib/server/maintenance.ts` runs once at startup (after migrations and the FTS check) and then every `MAINTENANCE_INTERVAL_HOURS`, in a worker thread (no cron dependency). Each pass, in separate short transactions: hard-purge persons soft-deleted longer than `SOFT_DELETE_PURGE_DAYS` together with their dependent rows (files removed after commit, §6.7); delete expired sessions; delete expired or used password-reset and email-verification tokens older than 24 h; delete `claimAttempts` whose window ended more than 24 h ago. A failed pass logs and retries at the next interval; it never blocks startup.

---

## 7. Frontend

### 7.0 Client/server paradigm (binding)

- **Reads:** pages load data in `+page.server.ts` `load` functions that call the `lib/server/*` service functions directly (the same functions the API routes use, with `requireTreeAccess` applied). Load functions do not `fetch()` the app's own `/api` routes.
- **Mutations:** all writes are client-side `fetch()` calls with JSON bodies to the `/api/*` routes in §9. After success, call `invalidateAll()` (or update local `$state`) and show a toast. **Do not use SvelteKit Form Actions** (`export const actions`) anywhere.
- Consequence: login, register, join and claim forms are ordinary Svelte forms whose submit handler calls `event.preventDefault()` and `fetch`. They require JavaScript, which is acceptable for this app (stated in the README under Limitations).
- Every API route is a thin wrapper: parse with Zod → `requireTreeAccess` → call one service function → map the result to JSON. No business logic in route files.
- Services return typed results (`{ ok: true, data } | { ok: false, code, status }`) so routes and `load` functions map errors identically.

### 7.1 Design tokens (all text pairs ≥ 4.5:1)
- Primary `#047857` (white text), hover `#065F46`; on dark, primary `#34D399` with `#0F172A` text
- Secondary `#6D28D9` (white text)
- Background `#FAFAFA` / `#0F172A`; surface `#FFFFFF` / `#1E293B`
- Text `#111827` / `#F1F5F9`; secondary text `#4B5563` / `#94A3B8`
- Success `#047857`, error `#B91C1C`, warning `#B45309`
- `scripts/contrast.ts` computes WCAG ratios for every foreground/background token pair and exits non-zero on any text pair below 4.5:1 (3:1 for large text and UI components). It runs in `npm test`.

Typography (Inter, self-hosted woff2): H1 24/36 px weight 800; H2 20/28 px 700; H3 18/22 px 600; body 15/16 px 400; buttons 15/16 px 600; all inputs 16 px. Spacing on an 8 px grid (4, 8, 16, 24, 32, 48). Radii: buttons 12, cards 16, inputs 10, avatars 50%, modals 20. Touch targets ≥ 44 × 44 px.

### 7.2 Layout
Mobile (320–640): bottom nav (Home, Trees, Add FAB, Search, Me), full-width cards, bottom sheets. Tablet (640–1024): top nav, 2-column grid. Desktop (≥ 1024): sidebar + content, modals. Safe-area insets honoured. Dark mode: follows system by default, manual toggle persisted in `themePref` and `localStorage`; no flash of wrong theme (inline theme script carries the CSP nonce).

### 7.3 Components
`BottomNav, TopBar, Sidebar, PersonCard, PersonForm (progressive disclosure), AddPersonSheet, JoinCodeGenerator, JoinFlow, ClaimProfileFlow, ClaimReview, ChangeHistory, ActivityFeed, TreeCanvas, TreeControls, PersonNode, PhotoGallery, PhotoUpload, Lightbox, SearchBar, Toast, ConfirmDialog, SkeletonLoader, OnboardingTour (4 steps)`. All interactive elements have a visible focus state, ARIA labels on icon buttons, full keyboard operation; toasts and form errors use `aria-live`; `prefers-reduced-motion` disables animation including confetti.

### 7.4 PWA
Manifest, icons, splash, installable. `src/service-worker.ts` precaches the static shell and serves a read-only offline fallback page. No offline mutation queue; mutations while offline show an "You're offline" toast. The service worker precaches only build assets and static files; it never caches `/api/*`, `/photos/*` or any HTML except the offline fallback page, so a shared device never keeps another person's data.

### 7.5 Interaction scope
v1: tap, buttons, wheel and pinch zoom (d3-zoom), pan, search-and-highlight, Cmd/Ctrl+K, Escape, undo toast, CSS-only confetti on join/claim, onboarding. **Phase 7 (optional):** swipe actions, pull-to-refresh, drag-and-drop relationship creation, minimap.

### 7.6 Tree layout (custom; no d3-dag)

Pure functions in `src/lib/tree/layout.ts`, no DOM access, so they are unit-testable and can run in a Web Worker (required above 200 nodes).

**Input:** persons (id, birthDateNorm, gender) and relationships. **Output:** for each person `{x, y, generation}`, for each union `{x, y}`, edge polylines, and an optional `layoutWarning`.

Algorithm:
1. **Unions.** Create one union node per distinct set of parents that share at least one child, and one per spouse pair without children. A person with several partners belongs to several unions.
2. **Generations.** Build a directed graph parent → union → child. Assign `generation` by longest path from roots (persons with no parents). Then align every spouse pair to the maximum of the two generations (re-propagate to children until stable, for **at most `MAX_TRAVERSAL_DEPTH + 1` rounds**. The parent-cycle check does not cover spouse links: a person married to their own grandchild never stabilises. If the cap is reached, keep the last assignment, set `layoutWarning: 'SPOUSE_ALIGNMENT_UNSTABLE'` and show a banner). Disjoint components each start at generation 0.
3. **Primary-parent tree.** To avoid solving a general DAG layout, build a layout *tree* per component: each person has at most one *primary parent union* (the union whose parents have the earliest birth; ties by id). Other parent links are drawn later as extra edges. A couple unit is anchored to the member who has a primary parent union. If both members have parents, anchor to the one with the earlier `birthDateNorm` (ties by id) and draw the other member's parent link as an extra edge. If neither has parents, the couple is a root unit ordered by its earlier member. An in-marrying spouse without parents is therefore never a separate root.
4. **Coordinates (deterministic width-based placement).** Constants: `NODE_W = 160`, `NODE_H = 72`, `H_GAP = 24`, `SPOUSE_GAP = 8`, `ROW_GAP = 96`. In `TB` orientation (swap axes for `LR`):
   - `unitWidth(u)` = sum of its member node widths plus `SPOUSE_GAP` between them (a person with several partners: member order is partner1, person, partner2 …, by marriage `startDate`).
   - `subtreeWidth(u)` = `max(unitWidth(u), Σ subtreeWidth(child units) + H_GAP × (k−1))` where child units are ordered by `birthDateNorm`, then name, then id.
   - Place top-down: a root unit's left edge starts at the component's cursor; children are laid out left to right inside the parent's allotted span, then the **parent unit is centred over the span of its children** (centre = midpoint of first and last child unit centres) while never overlapping its left neighbour (`x ≥ prevRight + H_GAP`; if the centre rule would violate this, shift the whole subtree right).
   - `y = generation × (NODE_H + ROW_GAP)`.
   - Components are placed left to right with a gap of `3 × H_GAP`.
   - Crossing reduction is out of scope for v1 beyond the deterministic ordering above (no barycenter sweeps). Extra non-primary parent edges are drawn as curved paths and may cross; that is accepted.
   - Implement functions with these exact names in `layout.ts`: `buildUnits`, `assignGenerations`, `buildLayoutTree`, `subtreeWidth`, `placeUnit`, `routeEdges`, so tests can target them.
5. **Edges.** Orthogonal polylines: spouse–union horizontal, union–child vertical with a shared bus line. `guardian` links are drawn as dashed extra edges and take no part in unit or generation logic; `sibling` links are not drawn (siblings appear through shared parents).
6. **Focus mode** above `TREE_FOCUS_MODE_THRESHOLD` nodes: render only the selected person's ancestors and descendants to depth N (default 3) plus their spouses and siblings, with controls to expand a branch.

Required layout fixtures (each asserts: no node bounding boxes overlap (using the constants above), parents above children, spouses adjacent, output is identical on two runs): single parent with children; two parents with children; divorced-and-remarried with half-siblings; two disjoint trees; 5-generation straight line; a person married to their own grandchild (terminates with the warning); a 500-node generated tree (timing recorded for R-PERF-4).

**Pre-approved fallback:** if the custom engine fails the fixtures after **one** documented fix attempt following the first failing run, the implementer must stop iterating on the algorithm and may switch to `elkjs` (layered algorithm) in a lazily loaded Web Worker, recording bundle size and layout timings in `DECISIONS.md`. The initial-JS budget (R-PERF-1) still applies, since ELK lives in the lazy chunk.

---

## 8. Security

- **Passwords:** bcryptjs cost 12, async API; reject passwords over 72 bytes. **Sessions:** 32 random bytes, base64url cookie; SHA-256 of the token stored; `httpOnly`, `sameSite=lax`, `secure` when `NODE_ENV=production`; lifetime `SESSION_DAYS` with sliding refresh at most once per day; new token on login; all sessions deleted on password change/reset.
- **Behind Cloudflare Tunnel:** adapter-node env `ORIGIN=<public https URL>` and `ADDRESS_HEADER=CF-Connecting-IP`. In `docker-compose.yml` the app uses `expose: 3000` and **never** `ports:`, so only cloudflared can reach it and the header cannot be spoofed. A `docker-compose.dev.yml` override publishes the port for local development with `ADDRESS_HEADER` unset.
- **CSRF:** keep SvelteKit's built-in origin protection enabled (use the option the installed Kit version documents: `csrf.checkOrigin` or `csrf.trustedOrigins`; confirm in Phase 1a and record it) and add an explicit `Origin` check for JSON `POST/PUT/PATCH/DELETE` in `hooks.server.ts` against `ORIGIN`.
- **CSP** via `kit.csp` with `mode: 'nonce'` (every page is server-rendered; the hand-written inline theme script in `app.html` carries `nonce="%sveltekit.nonce%"`, which `hash` mode would not cover): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Also `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and HSTS in production. A Playwright test (Phase 5) loads each main page and fails on any CSP violation console message.
- **Rate limiting:** in-memory (`rate-limit.ts`), sliding window keyed as shown. The numbers below are the defaults of `RATE_LIMITS` in `config.ts`. State is lost on restart (documented). Over-limit → 429 + `Retry-After`.

| Endpoint | Limit |
|---|---|
| `POST /api/auth/register` | 3/min/IP |
| `POST /api/auth/login` | 5/min/IP and 10 failures/15 min/account |
| `POST /api/auth/logout` | 10/min/IP |
| forgot-password | 3/hour/IP and 3/hour/email |
| `GET/POST /api/join/:code` | 10/min/IP |
| `PUT /api/claims/questions/verify/:personId` | 5 attempts/24 h per (user, person) (persisted in `claimAttempts`) and 20/hour/IP |
| `POST /api/claims` | 10/hour/user |
| `GET /api/search` | 60/min/IP |
| all other `/api` | 100/min/IP |

- **Lockout tiers** apply to the **code and claim endpoints only** (`/api/join/:code` GET and POST, and verification answers; forgot-password has no notion of failure because its response is always generic, so only its rate limit applies), keyed per IP + endpoint, counting failures in a rolling 24 h window: 5 failures → blocked 15 min; 10 → 1 h; 20 → 24 h (cap; no further doubling). A "code not found" response counts as a failure; a successful redemption does not reset the counter. Shared-IP households are accepted as a trade-off here because code entry is a rare action.
- **Login** does not use IP lockout tiers. It uses the 5/min/IP rate limit plus a per-account lock: 10 failed attempts in 15 min lock that account for 15 min (from any IP). A successful password reset clears the lock. Documented trade-off: an attacker can force a 15-minute account lock, but cannot go beyond it, and password reset still works.
- All input validated with Zod; all SQL through Drizzle or prepared statements; FTS queries built from escaped quoted tokens.
- Errors return `{ "error": { "code": "...", "message": "..." } }` with generic messages; details go to the server log with a request ID.
- Error codes in use (status): `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `JOIN_UNAVAILABLE` 404, `VERSION_CONFLICT` 409, `STALE_REVERT` 409, `REVERT_CONFLICT` 409, `NOT_REVERTIBLE` 409, `DUPLICATE` 409, `CYCLE` 409, `GRAPH_TOO_DEEP` 409, `PURGED` 410, `PAYLOAD_TOO_LARGE` 413, `IMAGE_TOO_LARGE` 413, `IMPORT_LIMIT` 413, `UNSUPPORTED_MEDIA` 415, `RATE_LIMITED` 429, `LOCKED` 429, `BUSY` 503. A new code needs a `DECISIONS.md` line.
- **Route policy registry.** `src/lib/server/route-policies.ts` exports one entry per `(route, method)`: `{ route, method, access: 'public' | 'session' | 'tree' | 'code', action?, allowPublic?, probe? }`. `access: 'tree'` entries name the permission-matrix `action`; `probe(ctx)` returns the params/body for a request that would succeed for an authorized caller on a seeded fixture (tree, persons, and one user per role). `requireTreeAccess` reads the same registry, so a route cannot be protected differently from how it is declared. AT-09, AT-29 and AT-07 are auto-generated from this registry and run in every phase from the phase in which they are introduced, over all routes that exist at that time.

---

## 9. API contract

All routes return JSON, validate with Zod, require a session unless marked *public*. Status codes: 200/201 success, 400 validation, 401 unauthenticated, 403 role, 404 not found or not a member, 409 version/state conflict, 413 upload too large, 415 bad media type, 429 rate limited. Every row below has an entry in the route policy registry of §8. Success bodies are `{ "data": … }`; list endpoints return `{ "data": [...], "nextCursor": string | null }` with opaque base64url cursors; fields such as `truncated` and `totalPersons` sit inside `data`. Zod schemas live in `src/lib/schemas/`, one file per area, and are the single source of request types.

| Method + route | Purpose | Notes |
|---|---|---|
| `POST /api/auth/register` | create account | *public*, 3/min |
| `POST /api/auth/login` | login, rotate session | *public*, 5/min |
| `POST /api/auth/logout` | invalidate session | |
| `POST /api/auth/forgot` | request reset | *public*, generic response |
| `POST /api/auth/reset` | complete reset | *public* |
| `POST /api/auth/verify` | verify email | |
| `POST /api/auth/verify/resend` | resend verification email | session, 3/hour/user |
| `POST /api/auth/password` | change password (current password required) | session |
| `GET /api/auth/google`, `/api/auth/google/callback` | OAuth | only if configured |
| `DELETE /api/account` | delete account | |
| `PUT /api/account`, `POST /api/account/avatar` | profile and preferences / avatar upload (multipart) | |
| `GET /api/trees` / `POST /api/trees` | list mine / create (also creates family code) | |
| `GET /api/trees/:id` | people + relationships + members; bounded per §6.11 (`?focus=&depth=`) | `allowPublic` in Phase 5 |
| `PUT /api/trees/:id` / `DELETE /api/trees/:id` | update / delete | owner for delete |
| `GET /api/trees/:id/activity` | feed, cursor-paginated | |
| `GET /api/trees/:id/stats` | people, relationships, generation depth (bounded, `truncated`) | |
| `GET /api/trees/:id/surnames`, `GET /api/trees/:id/duplicates` | surname explorer / duplicate candidates | |
| `GET /api/trees/:id/media` | tree gallery, cursor-paginated | |
| `GET /api/trees/:id/join-codes` | family code (owner/editor) and the caller's own direct codes | |
| `GET /api/trees/:id/members`, `PUT /api/trees/:id/members/:userId`, `DELETE …` | list / role change / remove | owner for changes |
| `POST /api/trees/:id/transfer` | transfer ownership | owner |
| `POST /api/trees/:id/members/:userId/review` | approve/reject pending join | owner/editor |
| `GET /api/trees/:id/export?format=gedcom\|json\|csv&excludeLiving=` | export | |
| `GET /api/trees/:id/backup` | tar stream | owner/editor |
| `POST /api/persons` | add (body has `treeId`) | |
| `GET/PUT/DELETE /api/persons/:id` | read (includes events and media) / update (needs `version`) / soft-delete | |
| `GET /api/persons/:id/history` | paginated | |
| `GET /api/persons/:id/relatives` | parents, children, spouses, siblings | |
| `GET /api/persons/:id/relation?to=:otherId` | "How are we related?" | |
| `POST /api/relationships`, `PUT /api/relationships/:id`, `DELETE /api/relationships/:id` | manage links | |
| `POST /api/join-codes` | create direct code (optional `role`) / regenerate family code | |
| `DELETE /api/join-codes/:id` | deactivate a code | creator, owner or editor |
| `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id` | manage events | |
| `GET /api/join/:code` | preview (tree name, relation, inviter) | auth optional, 10/min |
| `POST /api/join/:code` | redeem | 10/min |
| `GET /api/claims/search` | scoped search of unclaimed persons | members or code holders |
| `POST /api/claims` / `GET /api/claims?treeId=` / `PUT /api/claims/:id` | submit / list pending (owner/editor) / review (approve + link relation) | |
| `POST /api/claims/questions/:personId`, `GET /api/claims/questions/:personId` | set questions / read question texts only | GET: same audience as claim search |
| `PUT /api/claims/questions/verify/:personId` | verify answers | attempt-limited |
| `POST /api/history/revert` | revert by `historyId` or `batchId`, `force` optional (§5.1) | |
| `POST /api/media`, `PUT /api/media/:id`, `DELETE /api/media/:id` | upload (multipart, optional `makePrimary`) / caption and primary / delete | |
| `GET /photos/[...path]` | authenticated image | not under `/api` |
| `GET /api/search?q=&treeId=` | FTS + fuzzy | 60/min |
| `POST /api/gedcom/import?preview=1` | import into the tree named by `treeId` (multipart), with preview step | owner/editor |
| `GET/PUT /api/notifications` | list with `unreadCount` / mark read | |
| `GET /api/health` | status, uptime, version, `eventLoopDelayP99Ms` | *public*, no secrets |

---

## 10. Project structure

```
family-tree/
├── Dockerfile, docker-compose.yml, docker-compose.dev.yml
├── package.json (exact versions), package-lock.json
├── drizzle.config.ts, svelte.config.js, vite.config.ts, tsconfig.json
├── README.md, SPECS.md, DECISIONS.md, BENCHMARKS.md
├── scripts/  backup.sh restore.sh sweep-orphans.ts rebuild-fts.ts backup.ts migrate.ts seed.ts bench.ts contrast.ts check-traceability.mjs
├── tests/    (unit, api, e2e)
├── static/   manifest.webmanifest, icons/, fonts/
└── src/
    ├── app.html, app.css, hooks.server.ts, service-worker.ts
    ├── lib/
    │   ├── config.ts                   ← tunables (§0.2)
    │   ├── db/ schema.ts index.ts migrations/
    │   ├── server/ auth.ts audit.ts claims.ts join-codes.ts trees.ts persons.ts
    │   │           relations.ts graph.ts workers/ members.ts permissions.ts route-policies.ts storage.ts search.ts events.ts media.ts maintenance.ts
    │   │           gedcom.ts export.ts notifications.ts rate-limit.ts mail.ts oauth.ts
    │   ├── schemas/                    ← Zod schemas, one file per area (§9)
│   ├── tree/ layout.ts layout.worker.ts
    │   ├── components/ ui/ layout/ person/ tree/ join/ claim/ history/ media/ shared/
    │   └── utils/ dates.ts helpers.ts
    └── routes/
        ├── +layout.svelte, +page.svelte, login, register, forgot, reset/[token], verify/[token]
        ├── join/[code], claim, search, profile, notifications
        ├── trees/ (+page, [id]/ +page, members, activity, settings)
        ├── persons/[id]
        ├── photos/[...path]/+server.ts
        └── api/ …(per §9)
```

Named Docker volumes `family-db` and `family-photos` are mounted at `/data/db` and `/data/photos`. The `data/` and `photos/` folders are for local development only and are git-ignored.

---

## 11. Deployment

- Multi-stage `Dockerfile` on `node:22-bookworm-slim`: build stage installs `python3 make g++` only if a native module has no prebuilt binary for the target arch; runtime stage has no compilers, runs as a non-root user, copies the built output, the `migrations/` folder (`MIGRATIONS_PATH` points at it), the `scripts/` folder and production dependencies (including `tsx`, so operators can run `rebuild-fts`, `sweep-orphans` and `backup` with `docker compose exec`), creates `/data/db` and `/data/photos` owned by the non-root user so named volumes inherit that ownership, and defines `HEALTHCHECK` on `/api/health` using `node -e` with `fetch` (the slim image has no curl or wget).
- `docker-compose.yml`: `familytree` (`expose: 3000`, volumes, env, `restart: unless-stopped`, `stop_grace_period: 15s`) and `cloudflared` (`tunnel --no-autoupdate run`, `TUNNEL_TOKEN` from `CLOUDFLARE_TUNNEL_TOKEN`, `depends_on` healthy app).
- Environment: `ORIGIN`, `DATABASE_PATH`, `PHOTO_PATH`, `SESSION_SECRET`, `VERIFICATION_PEPPER`, `CLOUDFLARE_TUNNEL_TOKEN`, `SMTP_HOST|PORT|USER|PASS|FROM`, `GOOGLE_CLIENT_ID|SECRET`, `ADDRESS_HEADER`, `MIGRATIONS_PATH`, `BODY_SIZE_LIMIT`. `BODY_SIZE_LIMIT` must be set to `12M`: adapter-node's default is 512 kB, which would reject photo uploads and GEDCOM files with 413 before the app sees them. In production the app refuses to start if `SESSION_SECRET` or `VERIFICATION_PEPPER` is missing or shorter than 32 characters.
- Graceful shutdown on SIGTERM: stop accepting connections, finish in-flight requests, `PRAGMA wal_checkpoint(TRUNCATE)`, close the DB.
- Backup: `backup.sh` runs on the host and calls `docker compose exec familytree tsx scripts/backup.ts` (better-sqlite3 backup API; the runtime image has no `sqlite3` CLI), then tars the photos volume; `restore.sh` (stop app, restore, rebuild FTS, start). README includes a cron example and a restore drill.
- README sections: requirements, local dev, Docker run, Cloudflare Tunnel setup (public hostname → `http://familytree:3000`, no cache rule for `/photos/*`), environment table, backup/restore, upgrade, limitations (partial BS dates sort approximately, no real-time sync, in-memory rate limits reset on restart, single-node only).

---

## 12. Acceptance tests (must exist as automated tests)

Each test title starts with its ID (`AT-07: …`). The **Phase** column is the phase in which the test must first exist and pass; it then keeps passing in every later phase. Rows marked *recurring* are auto-generated from the route policy registry (§8) and run over every route that exists at the time.

| ID | Phase | Scenario | Expected |
|---|---|---|---|
| AT-01 | 4 | 20 concurrent redemptions of one direct code | exactly 1 success; 19 fail; one person, one membership, one relationship created |
| AT-02 | 4 | Family code with `maxUses=3`, 10 concurrent redemptions | exactly 3 pending memberships |
| AT-03 | 4 | Two users claim the same unclaimed person simultaneously | exactly one `persons.userId` set; loser's claim `rejected` |
| AT-04 | 4 | Same user claims two persons in one tree | second fails on `ux_person_user_per_tree`; same user in two trees succeeds |
| AT-05 | 4 | Revert an update after a later edit to the same field | 409 with current value; `force` succeeds and logs a revert row |
| AT-06 | 4 | Revert a person delete | person, relationships, events, media rows restored from snapshot |
| AT-07 | 2, recurring | Viewer calls every route whose policy requires a role above viewer | 403 on all |
| AT-08 | 4 | Contributor reverts another user's change | 403; own change succeeds |
| AT-09 | 2, recurring | Active member of tree A calls every `tree`-access route against tree B | 404 on all |
| AT-10 | 4 | Pending or rejected member reads tree data | 404 |
| AT-11 | 4 | Pending person in tree/search/export/stats/traversal queries; a person with no membership row | pending: never; no-membership person: always visible |
| AT-12 | 4 | Unknown, expired, exhausted, deactivated code | byte-identical response bodies and status |
| AT-13 | 2 | Parent link that would create a cycle | rejected; no row written |
| AT-14 | 2 | Spouse (A,B) then (B,A) | second is a duplicate error; stored order normalised |
| AT-15 | 2 | Stale `version` on person update | 409; no history rows written |
| AT-16 | 2 | Upload with wrong magic bytes, oversize, `..` in path, decompression bomb (pixels over `IMAGE_MAX_PIXELS`) | 415 / 413 / rejected / 413 `IMAGE_TOO_LARGE`; no file written |
| AT-17 | 2 | `/photos/…` without session or from another tree | 401 / 404 respectively; response headers contain `private` and never `public` |
| AT-18 | 1b | Login: 6th attempt in one minute from one IP; 10 failures on one account in 15 min | 429 + `Retry-After`; account locked 15 min from another IP; password reset clears the lock |
| AT-19 | 1a | Behind proxy: requests with different `CF-Connecting-IP` are limited independently | independent counters |
| AT-20 | 4 | Verification answers: 6th attempt in 24 h | blocked even with correct answer |
| AT-21 | 4 | Matching claim with score ≥ 0.95 | stays `pending`, never auto-approved |
| AT-22 | 5 | Backup then restore into a clean DB, then FTS search | results identical; FTS rebuilt |
| AT-23 | 5 | Privacy-filtered export | living/unknown persons anonymised; no places, bios, events, photos; IDs and edges intact |
| AT-24 | 5 | GEDCOM export → import round trip on a fixture | same people, relationships, dates |
| AT-25 | 1a | Date parser: every example in §6.3 plus invalid dates, BS fixtures | matches expected values |
| AT-26 | 3 | Non-Latin (Devanagari) name search with typo; two names differing only in a vowel sign, searched exactly and by prefix | found by prefix and fuzzy; the FTS stage never returns the other name |
| AT-27 | 2 | Deleting a person, a photo, and a tree | files removed after commit; none removed if the transaction rolls back |
| AT-28 | 1a | Contrast script | all text pairs ≥ 4.5:1 |
| AT-29 | 1a, recurring | Every `+server.ts` export under `src/routes/api` and `src/routes/photos` | has a registry entry; every `tree` entry is probed: no session → 401, non-member → 404, below the role the matrix requires for the entry's `action` → 403, at that role → success |
| AT-30 | 5 | CSP | no violations on main pages (Playwright) |
| AT-31 | 4 | Code endpoint failures from one IP | 5 → blocked 15 min, 10 → 1 h, 20 → 24 h, with matching `Retry-After`; login endpoint is unaffected by these tiers |
| AT-32 | 5 | Anonymous access: `allowPublic` route on a public tree; same route on a private tree and on a nonexistent tree id; any write/history/members/search/export route | 200 filtered; 401 (identical bodies for private and nonexistent); 401 |
| AT-33 | 5 | Public tree response content | living/unknown persons are "Living" with no dates, places, bio, events or photos; `/photos/…` of a living person returns 404 to anonymous callers |
| AT-34 | 6 | `sweep-orphans.ts` on a photos directory with referenced and unreferenced files | removes only unreferenced files |
| AT-35 | 1a | Migrations: fresh DB, and upgrade from the previous migration with data present | schema complete; data preserved; FTS triggers keep `persons_fts` in sync on insert, update and soft-delete; the startup consistency check detects a missing FTS row and rebuilds |
| AT-36 | 1b | Auth hygiene | register/forgot return identical responses for existing and unknown emails; login for an unknown email still runs a bcrypt compare (spy); passwords over 72 bytes rejected; reset token is single-use and deletes all of the user's sessions; session cookie is `httpOnly`, `sameSite=lax`, `secure` in production; no more than `PASSWORD_HASH_CONCURRENCY` hashes run at once; Google sign-in (mocked) with an email matching an unverified local account clears that password and its sessions before linking |
| AT-37 | 3 | Layout fixtures (§7.6), including a couple where both partners have parents and the unstable-spouse-alignment case (terminates, `layoutWarning` set) | no bounding-box overlap; parents above children; spouses adjacent; identical output on two runs |
| AT-38 | 2 | 40-generation parent chain: ancestors, descendants, relation path, stats; then add a parent link that would exceed the depth cap; then a link that would create a cycle | traversals return ≤ caps with `truncated: true` and finish; over-depth link rejected with `GRAPH_TOO_DEEP`; cycle rejected; no 500s |
| AT-39 | 5 | GEDCOM import at the caps in a worker, while 50 concurrent `GET /api/health` and 10 concurrent writes run | all health calls 200 within 1 s; each write succeeds or returns `503 BUSY` with `Retry-After` (never 500); import is atomic (all or nothing); p99 loop delay reported |
| AT-40 | 3 | Tree with more than `TREE_FOCUS_MODE_THRESHOLD` persons, `GET /api/trees/:id` with and without `focus` | bounded payload (≤ `MAX_TRAVERSAL_NODES`), `totalPersons` and `truncated` present; focus on a deep descendant returns its ancestors up to the depth |
| AT-41 | 2 | Add, edit and delete an event | history rows written (create: 1; update: 1 per changed field; delete: with snapshot) and shown in the person timeline; viewer gets 403 |
| AT-42 | 2 | Remove a member; a member leaves; a user deletes their account | person row stays with `userId` NULL; membership gone; after account deletion the email can register again |
| AT-43 | 4 | Revert a create; revert a relationship delete after an endpoint was deleted; revert a delete after purge; revert a claim row; revert a whole `batchId` | 200; 409 `REVERT_CONFLICT`; 410 `PURGED`; 409 `NOT_REVERTIBLE`; batch revert is atomic and a 409 lists every stale field |
| AT-44 | 4 | Direct code with a `role` above the creator's role; redemption of a code with a `role`; family code redemption | 403; member has the code's `role`; family joiners get `DEFAULT_JOIN_ROLE` |
| AT-45 | 5 | Service worker (Playwright): sign in, then go offline | only shell and fallback page are served; Cache Storage holds no `/api/` or `/photos/` entry |
| AT-46 | 6 | Maintenance pass on a seeded DB | persons soft-deleted longer than `SOFT_DELETE_PURGE_DAYS` purged with their files; expired sessions and tokens and old `claimAttempts` removed; newer rows untouched |
| AT-47 | 1a | Built server, `GET /` | every inline `<script>` has a `nonce` that appears in the CSP header; `script-src` has no `unsafe-inline` |

Concurrency tests (AT-01, AT-02, AT-03, AT-39) must use at least two independent `better-sqlite3` connections (separate workers), so that `BEGIN IMMEDIATE` contention really happens; `Promise.all` over one synchronous connection proves nothing.

---

## 13. Phases and checkpoints

Phase ids are `1a, 1b, 2, 3, 4, 5, 6, 7`. Each checkpoint must run green, with real output quoted, before the next phase starts. Every checkpoint also includes `npm run check`, `npm run lint`, `npm run test`, and `npm run check:traceability -- --phase <id>`.

**Phase 1a — Foundation (no user-facing auth flows).** Project init with exact pins (§2); Tailwind 4; self-hosted Inter; Drizzle schema; migrations including the `--custom` FTS migration and the `visible_persons` view migration (§5, §5.1, §5.2); pragmas; `config.ts`; `scripts/migrate.ts`; session core (create/validate/delete by token hash) wired into `hooks.server.ts` so `locals.user` is populated; in-memory rate limiter; hooks (CSP nonce mode, CSRF, headers, proxy settings); `permissions.ts` and `route-policies.ts` with the registry test harness; `utils/dates.ts` (AD and BS); `scripts/contrast.ts`; `scripts/check-traceability.mjs` (with its own unit test); root layout and dark mode; `/api/health`; Dockerfile + compose skeleton (migrations, scripts, volume ownership and healthcheck per §11); smoke test proving Drizzle + better-sqlite3 + FTS5 work.
*Checkpoint:* `npm ls` clean; AT-19, AT-25, AT-28, AT-29, AT-35, AT-47; `docker compose build`; container boots and `/api/health` returns OK.

**Phase 1b — Accounts.** Register, login, logout, forgot/reset, email verification, optional Google OAuth, account deletion, profile page, theme and date-display preferences, `mail.ts`, login/register/forgot/reset pages (client `fetch`, §7.0).
*Checkpoint:* AT-18, AT-36 plus all earlier tests.

**Phase 2 — Trees and people.** Tree CRUD, members list/roles/transfer, persons with versioning and audit, relationships with integrity rules, relatives endpoint, derived relations and "how are we related", bounded graph traversals (§6.11, `graph.ts`), profile page, events, member removal and leaving (unlinking), avatar and cover handling, media upload/serve with EXIF stripping and the authenticated photo route, file deletion after commit.
*Checkpoint:* AT-07, AT-09, AT-13, AT-14, AT-15, AT-16, AT-17, AT-27, AT-38, AT-41, AT-42 and AT-29 over all routes so far.

**Phase 3 — Visualization and search.** Layout engine + fixtures, TreeCanvas lazy chunk, controls, focus mode backed by the bounded `focus`/`depth` tree endpoint, FTS search with the fuzzy fallback in its worker, surname explorer, duplicate finder.
*Checkpoint:* AT-26, AT-37, AT-40, bundle size report (R-PERF-1), layout timing for 500 nodes (R-PERF-4).

**Phase 4 — Collaboration.** Family and direct codes, claiming (all methods), approvals, history UI, stale-safe revert, activity feed, notifications.
*Checkpoint:* AT-01 to AT-06, AT-08, AT-10, AT-11, AT-12, AT-20, AT-21, AT-31, AT-43, AT-44.

**Phase 5 — Import/export, public trees, PWA, polish.** GEDCOM with preview and worker-thread import, JSON/CSV, privacy filter, public-tree read path, backup export, onboarding, PWA/service worker, toasts/skeletons/undo, accessibility pass, Playwright smoke flow (register → create tree → add person → join via direct code → claim). Run `npm run test:e2e:setup` first.
*Checkpoint:* AT-22, AT-23, AT-24, AT-30, AT-32, AT-33, AT-39, AT-45, axe checks on key pages.

**Phase 6 — Hardening and deployment.** `bench.ts` run and `BENCHMARKS.md`, orphan sweep (AT-34), maintenance job (§6.12, AT-46), backup/restore scripts exercised, README, clean-clone `docker compose up -d`, graceful shutdown test, cold-start and memory measurements.
*Checkpoint:* AT-34, AT-46; clean-clone deploy works with documented env only; backup → wipe → restore drill succeeds; AT-01…AT-47 all green; `BENCHMARKS.md` reports R-PERF-7 and R-PERF-8.

**Phase 7 (optional).** Swipe actions, pull-to-refresh, drag-and-drop relationships, minimap.

---

## 14. Definition of done (per phase)

- `svelte-check` and `tsc --noEmit` pass in strict mode; lint clean.
- Every acceptance test named in the phase checkpoint exists and passes; the reply quotes the real test summary.
- `npm run check:traceability -- --phase <id>` passes. The script (plain Node ESM, no dependencies) parses the §12 table, and for every AT whose phase is ≤ the given phase it requires at least one test title in `tests/**` starting with that ID, and fails if any such test uses `.skip`, `.todo`, `.only`, `xit`, `xdescribe` or `fixme`.
- No `TODO`, `FIXME`, empty handlers or placeholder data in code for the phase.
- `DECISIONS.md` updated for every ambiguity resolved.
- The reply's **Not verified** section is honest and specific.
