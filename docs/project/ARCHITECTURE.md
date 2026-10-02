# ARCHITECTURE.md — Collaborative Family Tree (v4.0)

> Derived entirely from `SPECS.md` v4.0 (resolved 2026-10-01). No implementation detail beyond spec. Exact names, values, and paths preserved.

## 1. System Overview

**Stack (pinned, `npm install --save-exact`, §2):**

| Layer | Package / Version |
|---|---|
| Runtime | node 22.x (≥ 22.12), Docker base `node:22-bookworm-slim` |
| Framework | `@sveltejs/kit` 2.70.3, `svelte` 5.57.1 (runes only), `@sveltejs/adapter-node` 5.5.7 |
| Build | `vite` 8.3.1, `@sveltejs/vite-plugin-svelte` 7.3.1, `typescript` 6.0.3 (not 7.x), `svelte-check` 4.7.6 |
| CSS / Icons | `tailwindcss` + `@tailwindcss/vite` 4.3.3 (`@import "tailwindcss"` in `app.css`, no config file), `@lucide/svelte` 1.49.0 |
| DB | `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11 (dev), `better-sqlite3` 13.0.3 + `@types/better-sqlite3` 9.6.0 (dev) |
| Validation | `zod` 4.6.5 (Zod 4 API: `z.email()`, `z.uuid()`, `error:` param) |
| Auth crypto | `bcryptjs` 3.0.3 (pure JS, async API only, cost 12) |
| Tree rendering | `d3-zoom` 3.0.0, `d3-selection` 3.0.0, `d3-shape` 3.2.0 (zoom/render only; no `d3-hierarchy`, no `d3-dag`; layout custom) |
| Mail | `nodemailer` 10.0.13 (optional SMTP) |
| Images | `sharp` 0.35.5 (prebuilt `linux-arm64`; install failure = build failure, no silent fallback) |
| Backup | `tar-stream` 3.2.1 |
| Dates | `nepali-date-converter` 3.4.0 (BS↔AD) |
| Test | `vitest` 5.0.3, `@playwright/test` 1.63.0, `@axe-core/playwright` 4.13.0 |
| Tooling | `@types/node` 22.20.4, `tsx` 4.23.15 (production dep — runs `rebuild-fts`, `sweep-orphans`, `backup` in container), `eslint` 10.11.0 + `typescript-eslint` 8.71.0 + `eslint-plugin-svelte` 3.23.0 + `@eslint/js` + `globals` |
| OAuth | Hand-written authorization-code flow with PKCE via `fetch`. No auth library. |

**Hosting / runtime topology:**

- Self-hosted target: Raspberry Pi 4 ≥ 1 GB RAM or small VPS. Free to run.
- `adapter-node` serves on port 3000 inside Docker.
- Exposed via Cloudflare Tunnel (`cloudflared tunnel --no-autoupdate run`, `TUNNEL_TOKEN` from `CLOUDFLARE_TUNNEL_TOKEN`). Public hostname → `http://familytree:3000`.
- `docker-compose.yml`: `familytree` uses `expose: 3000`, never `ports:` (only cloudflared reaches app); `restart: unless-stopped`; `stop_grace_period: 15s`; named volumes `family-db` → `/data/db`, `family-photos` → `/data/photos`. `docker-compose.dev.yml` override publishes port locally with `ADDRESS_HEADER` unset.
- SQLite via `better-sqlite3`, WAL mode. Pragmas at startup (§3):
  `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `cache_size=-64000`, `mmap_size=268435456`, `temp_store=MEMORY`.
- Multi-statement writes use `db.transaction(fn).immediate()`.
- `SQLITE_BUSY` never 500: mapped to `503 { error: { code: 'BUSY' } }` + `Retry-After: 2`.
- Bulk inserts: prepared statements inside single transaction, never one tx per row.
- Graceful shutdown on SIGTERM: stop accepting connections, finish in-flight, `PRAGMA wal_checkpoint(TRUNCATE)`, close DB. Shutdown checkpoint retries 3× 1 s apart, warns if still busy (WAL recovered next start, no data loss).

**Tunables (`src/lib/config.ts`, §0.2 — one exported constant each):**

| Constant | Default |
|---|---|
| `LIVING_ASSUMPTION_YEARS` | 110 |
| `MIN_VERIFICATION_QUESTIONS` | 3 |
| `VERIFY_MAX_ATTEMPTS_PER_24H` | 5 (per user+person) |
| `SOFT_DELETE_PURGE_DAYS` | 30 |
| `SESSION_DAYS` | 30 |
| `CONTRIBUTOR_REVERT_OWN_ONLY` | true |
| `FAMILY_CODE_DEFAULT_MAX_USES` | 50 (`NULL` = unlimited) |
| `EDIT_NOTIFY_COALESCE_MINUTES` | 10 |
| `TREE_FOCUS_MODE_THRESHOLD` | 500 |
| `PASSWORD_MIN_LENGTH` | 10 (max 72 bytes, bcrypt limit) |
| `PASSWORD_HASH_CONCURRENCY` | 2 (queue rest) |
| `MAX_TRAVERSAL_DEPTH` | 30 generations |
| `MAX_TRAVERSAL_NODES` | 5000 |
| `DEFAULT_FOCUS_DEPTH` | 3 (generations each way) |
| `IMPORT_MAX_BYTES` | 5242880 (5 MB) |
| `IMPORT_MAX_PERSONS` / `IMPORT_MAX_RELATIONSHIPS` | 10000 / 20000 |
| `MAIN_THREAD_BLOCK_BUDGET_MS` | 50 |
| `DEFAULT_JOIN_ROLE` | `contributor` |
| `MATCH_WEIGHTS` | name 0.5, birth date 0.3, birth place 0.2 |
| `DUPLICATE_MAX_PAIRS` | 200 |
| `UPLOAD_MAX_BYTES` / `IMAGE_MAX_PIXELS` | 10485760 / 25000000 |
| `MAINTENANCE_INTERVAL_HOURS` | 6 |
| `RATE_LIMITS` / `LOCKOUT_TIERS` | see §8 tables (exported as data) |

## 2. Client/Server Paradigm (§7.0, binding)

- **Reads:** `+page.server.ts` `load` functions call `lib/server/*` service functions directly (same functions API routes use, with `requireTreeAccess` applied). Load functions do NOT `fetch()` own `/api` routes.
- **Mutations:** all writes are client-side `fetch()` with JSON bodies to `/api/*` (§9). After success call `invalidateAll()` (or update local `$state`) + toast. **No SvelteKit Form Actions** (`export const actions`) anywhere.
- Consequence: login, register, join, claim forms are ordinary Svelte forms with `event.preventDefault()` + `fetch`. Require JavaScript (stated in README Limitations).
- Every API route is thin wrapper: Zod parse → `requireTreeAccess` → call one service function → map to JSON. No business logic in route files.
- Services return typed results `{ ok: true, data } | { ok: false, code, status }` so routes and `load` map errors identically.
- Svelte 5 runes only: `let { data, children } = $props()`, `$state`, `$derived`, `$effect`, `{@render children()}`, `onclick={…}`. Forbidden: `export let`, `$:`, `<slot>`, `on:click`, `createEventDispatcher`, `writable`/`readable` for component-local state. Shared client state in `.svelte.ts` modules with `$state`.
- Data flow: page data arrives as `data` from `load`. Derive with `$derived(data.x)`. Copy to `$state` only for local edit drafts, resync after `invalidateAll()`.
- Zod 4 style only (`z.email()`, `z.uuid()`, `error:` param, `safeParse` → `r.error.issues`). No mixing with Zod 3 chains.

## 3. Project Structure (§10)

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
    │   ├── config.ts
    │   ├── db/ schema.ts index.ts migrations/
    │   ├── server/ auth.ts audit.ts claims.ts join-codes.ts trees.ts persons.ts
    │   │           relations.ts graph.ts workers/ members.ts permissions.ts route-policies.ts storage.ts search.ts events.ts media.ts maintenance.ts
    │   │           gedcom.ts export.ts notifications.ts rate-limit.ts mail.ts oauth.ts
    │   ├── schemas/  (Zod, one file per area, single source of request types)
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

- `data/` and `photos/` are local-dev only, git-ignored. Production uses `/data/db` + `/data/photos` via named volumes.
- `scripts` required: `migrate.ts` (`db:migrate`), `seed.ts` (`seed`), `bench.ts` (`bench` → `BENCHMARKS.md`), `contrast.ts` (`contrast`, also run by Vitest AT-28), `rebuild-fts.ts` (`rebuild-fts`), `sweep-orphans.ts` (`sweep-orphans`), `backup.ts` (invoked via `backup.sh` → `docker compose exec familytree tsx scripts/backup.ts`), `check-traceability.mjs` (`check:traceability --phase <id>`, plain Node ESM, no deps).
- `package.json` scripts minimum: `check` (`svelte-check --tsconfig ./tsconfig.json`, plus `tsc --noEmit` in CI), `test` (`vitest run`), `test:e2e` (`playwright test --reporter=line`, config uses `webServer` with `reuseExistingServer: false`, builds+starts app, global timeout 120 s), `lint` (`eslint .`), `db:generate` (`drizzle-kit generate`), `build` (`vite build`), `test:e2e:setup` (`playwright install --with-deps chromium`), `check:traceability`, `db:migrate`, `contrast`, `bench`, `seed`, `rebuild-fts`, `sweep-orphans`.

## 4. Database Design (§5.1, §5.2)

Conventions (§5): `src/lib/db/schema.ts` (Drizzle). IDs UUIDv4 text. Timestamps ISO-8601 UTC text. Booleans integer 0/1.

### 4.1 Tables

**users:** `id`, `email` (unique, stored lowercase), `passwordHash` (nullable for OAuth-only), `displayName`, `avatarUrl`, `emailVerifiedAt`, `themePref` (`system|light|dark`, default `system`), `dateDisplayPref` (`AD|BS|both`, default `AD`), `notifyPrefs` (JSON), `createdAt`, `deletedAt`.

**oauthAccounts:** `id`, `userId` (FK cascade), `provider`, `providerUserId`; unique `(provider, providerUserId)`.

**trees:** `id`, `name`, `description`, `ownerId` (FK users), `coverImage`, `isPublic` (default 0), `createdAt`, `updatedAt`.

**persons:** `id`, `treeId` (FK cascade, not null), `userId` (FK users, ON DELETE SET NULL), `claimedAt`, `claimedVia` (`claim_code|verification|matching|manual|join_code|created`), `firstName` (not null), `lastName`, `maidenName`, `birthDate`, `birthDateCal` (`AD|BS`, default `AD`), `birthDateNorm`, `deathDate`, `deathDateCal`, `deathDateNorm`, `gender` (`M|F|X|U`, default `U`), `birthPlace`, `deathPlace`, `photoUrl`, `bio`, `isLiving` (nullable; NULL = unknown), `createdBy`, `lastEditedBy`, `version` (integer default 1), `createdAt`, `updatedAt`, `deletedAt`.
- Partial unique `ux_person_user_per_tree` on `(treeId, userId) WHERE userId IS NOT NULL` (≤1 person per user per tree; same user in many trees OK).
- Claim atomicity: `UPDATE persons SET userId=?, claimedAt=?, claimedVia=? WHERE id=? AND userId IS NULL AND deletedAt IS NULL` requiring `changes === 1` in-tx.
- Indexes: `(treeId, lastName, firstName)`, `(treeId, deletedAt)`.
- No stored `generation`; computed by layout engine + stats query.
- Source of truth for claims = `persons.userId`; `treeMembers.personId` is denormalised copy updated in same tx.

**treeMembers:** `id`, `treeId` (FK cascade), `userId` (FK cascade), `personId` (FK persons ON DELETE SET NULL, nullable), `role`, `status` (`active|pending|rejected`), `invitedBy`, `joinedAt`, `joinedViaCode`, `joinedViaType` (`family|direct|claim|manual`); unique `(treeId, userId)`. Partial unique `ux_one_owner_per_tree` on `(treeId) WHERE role='owner'`; `trees.ownerId` + owner row change together in transfer tx. `rejected` row kept with `personId` NULL (blocks re-apply with same code; owner clears via remove member).

**relationships:** `id`, `treeId` (FK cascade), `person1Id` (FK cascade), `person2Id` (FK cascade), `type` (`parent|spouse|sibling|guardian`), `startDate`, `endDate`, `notes`, `createdBy`, `createdAt`.
- `parent`: person1 = parent, person2 = child. `guardian`: same direction.
- `spouse`/`sibling`: stored `person1Id < person2Id` (string compare), normalised in service pre-insert.
- `CHECK (person1Id <> person2Id)`; `UNIQUE (person1Id, person2Id, type)`. Indexes: `treeId`, `person1Id`, `person2Id`.
- Service checks in write tx: both persons exist, not soft-deleted, belong to `treeId`; `parent` must not create cycle (bounded ancestor walk per §6.11; reject if child reached; `GRAPH_TOO_DEEP` if walk would exceed cap); person with 2 existing `parent` links → warning flag in response, not block (`guardian` for adoptive/step).

**joinCodes:** `id`, `code` (unique), `type` (`family|direct`), `treeId` (FK cascade), `createdBy`, `linkedPersonId` (FK persons ON DELETE CASCADE, nullable), `linkedRelationType` (`parent|child|spouse|sibling|self`, nullable), `role` (`viewer|contributor|editor`, default `DEFAULT_JOIN_ROLE`), `expiresAt`, `maxUses` (NULL = unlimited, family only; direct always 1), `currentUses` (default 0), `isActive`, `createdAt`.
- Partial unique `UNIQUE(treeId) WHERE type='family' AND isActive=1`.
- Atomic redemption: `UPDATE joinCodes SET currentUses=currentUses+1 WHERE id=? AND isActive=1 AND (maxUses IS NULL OR currentUses<maxUses) AND (expiresAt IS NULL OR expiresAt>?)` → require `changes===1` else abort with no side effects.
- Format `<SLUG>-<8 chars>`; 8 chars from `crypto.randomInt` over `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32^8 ≈ 1.1e12). Slug cosmetic, never trusted; lookup by full string.
- Unknown/expired/exhausted/deactivated → identical response (same status/body/similar timing).
- Direct code `linkedRelationType='self'` is only code-based claim mechanism. No `claimCodes` table.

**profileClaims:** `id`, `userId`, `personId`, `treeId`, `proofMethod` (`verification|matching|manual`), `claimedFirstName`, `claimedLastName`, `claimedBirthDate`, `claimedBirthPlace`, `claimedRelation`, `matchScore` (real nullable), `status` (`pending|approved|rejected|auto_approved`), `reviewedBy`, `reviewedAt`, `reviewNote`, `linkedRelationType`, `linkedToPersonId`, `createdAt`; partial unique on `(userId, personId) WHERE status='pending'`. Multiple users may pend on one person; approval atomic, first wins.

**verificationQuestions:** `id`, `personId` (FK cascade), `treeId` (FK cascade), `createdBy`, `question`, `answerHash`, `createdAt`. `answerHash` = HMAC-SHA256 with `VERIFICATION_PEPPER` over normalised answer (Unicode NFKC, trim, lowercase, collapse whitespace). Auto-approval requires ≥ `MIN_VERIFICATION_QUESTIONS` stored + all correct.

**claimAttempts:** `userId`, `personId`, `count`, `windowStart`; PK `(userId, personId)`.

**changeHistory:** `id`, `treeId` (FK cascade), `entityType` (`person|relationship|event|media|tree`), `entityId` (no FK, polymorphic), `changedBy` (FK users), `changedAt`, `action` (`create|update|delete|revert|claim`), `field`, `oldValue` (JSON text), `newValue` (JSON text), `snapshot` (JSON text nullable), `batchId`, `note`, `revertedFrom`, `isReverted`, `revertedBy`, `revertedAt`.
- One user action → N rows sharing `batchId` (one per changed field).
- `delete` rows carry `snapshot` (full entity + dependent relationships/events/media) for revert. Persons soft-deleted (`deletedAt`); hard purge after `SOFT_DELETE_PURGE_DAYS` or tree deletion.
- Stale-revert rule: reverting `update` succeeds only if current field value == row's `newValue`; else 409 + current value; client may resend `force: true` → new `revert` row. Revert writes own row; reverting revert follows same rule. No `merge` action in v1.
- Revert by kind (`POST /api/history/revert` `{ historyId or batchId, force? }`; `batchId` reverts all rows atomically, stale check per row, 409 lists every conflicting field): `update` → stale rule; `create` (person/relationship/event/media) → soft-delete/delete + `delete` row with snapshot + `revertedFrom`, files removed after commit; `delete` → restore from `snapshot` after re-running integrity checks (endpoints exist + not soft-deleted, no cycle, depth cap), failure → 409 `REVERT_CONFLICT`, after hard purge → 410 `PURGED`; `claim` + `tree` rows not revertible (409 `NOT_REVERTIBLE`; unlink claimed person by removing member).
- Indexes: `(entityType, entityId)`, `treeId`, `changedBy`, `changedAt`, `batchId`.

**events:** `id`, `personId` (FK cascade), `treeId` (FK cascade), `type`, `date`, `dateCal`, `dateNorm`, `place`, `description`, `createdAt`.

**media:** `id`, `personId` (FK cascade nullable), `treeId` (FK cascade), `uploadedBy`, `storagePath`, `thumbPath`, `mime`, `sizeBytes`, `type` (`photo` only v1), `caption`, `createdAt`. File deletion after DB commit via `storage.deleteFiles(paths[])`; `sweep-orphans.ts` removes files with no row.

**sessions:** `id`, `userId` (FK cascade), `tokenHash` (unique), `expiresAt`, `createdAt`, `lastSeenAt`, `userAgent`; indexes `userId`, `tokenHash`.

**notifications:** `id`, `userId` (FK cascade), `treeId` (FK cascade nullable), `actorId` (FK users ON DELETE SET NULL nullable), `personId` (nullable, no FK), `type` (`join|join_approval|claim|claim_review|edit`), `title`, `body`, `linkUrl`, `isRead`, `createdAt`; indexes `(userId, isRead, createdAt)` and `(userId, type, personId, actorId, createdAt)`. `edit` coalesced via second index: ≤1 unread per (claimed person, editor) per `EDIT_NOTIFY_COALESCE_MINUTES`.

**passwordResetTokens:** `id`, `userId` (FK cascade), `tokenHash` (unique), `expiresAt` (1 h), `usedAt`, `createdAt`. Success deletes all user's sessions.

**emailVerificationTokens:** same shape, 24 h. Unverified users can use app but cannot generate join codes or make tree public.

No `rateLimitHits` table; rate limiting in-memory (§8).

### 4.2 Visibility view

```sql
-- visible_persons
SELECT * FROM persons p
WHERE p.deletedAt IS NULL
AND NOT EXISTS (
  SELECT 1 FROM treeMembers m
  WHERE m.personId = p.id AND m.status <> 'active'
);
```

- Every tree query, traversal, search (FTS hits joined back to view), export, statistic reads `visible_persons`; only writers + maintenance read `persons` directly.
- Joining to active membership would wrongly hide persons with no membership row; `NOT EXISTS (status <> 'active')` preserves them while hiding pending persons.

### 4.3 FTS5 (§5.2, raw SQL migration)

Because `persons` has text PK, implicit `rowid` not stable across `VACUUM` / `VACUUM INTO`. FTS keyed via map table with explicit integer key:

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

- `tokenchars` = Devanagari combining marks U+0900–U+0903, U+093A–U+094F, U+0951–U+0957, U+0962–U+0963. Default `unicode61` strips vowel signs (नेपाल / नीपाल would conflate to bare consonants, noisy prefix); with marks as token chars only exact vowel signs match (verified SQLite 3.45.1; Phase 1a smoke test asserts).
- Triggers (write through `person_fts_map.fts_id` as FTS `rowid`, deletes O(log n)):
  - `AFTER INSERT ON persons WHEN NEW.deletedAt IS NULL`: insert map row; insert FTS row with `name = trim(firstName || ' ' || coalesce(lastName,'') || ' ' || coalesce(maidenName,''))`, `birthYear = substr(birthDateNorm,1,4)` (empty if NULL or `0000`), `place = trim(coalesce(birthPlace,'') || ' ' || coalesce(deathPlace,''))`.
  - `AFTER UPDATE OF firstName, lastName, maidenName, birthDateNorm, birthPlace, deathPlace, deletedAt ON persons`: delete FTS row by `fts_id` (if map row exists); if `NEW.deletedAt IS NULL`, `INSERT OR IGNORE` map row + insert FTS row (covers restore + first-insert-while-deleted).
  - `AFTER DELETE ON persons`: delete FTS row (map cascades).
- `scripts/rebuild-fts.ts` rebuilds from `persons`. Startup check: if `count(persons_fts) != count(persons WHERE deletedAt IS NULL)` → log warning + rebuild. `restore.sh` runs rebuild.

### 4.4 Migration mechanics (single ordered sequence, §5)

1. Schema migrations via `drizzle-kit generate`.
2. FTS migration via `drizzle-kit generate --custom --name=fts` (empty journal-tracked SQL file in same `migrations/`; write §5.2 SQL into it). Later migrations altering `persons` FTS columns use another `--custom` migration to drop/recreate triggers. `visible_persons` view via `--custom --name=views`, recreated whenever `persons` rebuilt.
3. Within hand-written file separate statements with `--> statement-breakpoint`. `CREATE TRIGGER … BEGIN … END;` is one statement, no breakpoint inside.
4. At startup call `migrate()` from `drizzle-orm/better-sqlite3/migrator` once before listen. Migrations folder passed explicitly from `MIGRATIONS_PATH` (default `src/lib/db/migrations`; image copies it + sets var). Never run FTS SQL in separate pre-migrator script (fresh DB has no `persons` yet; ordering lost).
5. After migration run FTS consistency check (count compare, rebuild on mismatch).
6. Phase 1a verifies fresh DB + upgrade from earlier migration, records exact `drizzle-kit` behaviour in `DECISIONS.md`.

## 5. Permissions, Route Policies, Access Enforcement (§4, §8)

**Roles:** `owner`, `editor`, `contributor`, `viewer`. Matrix lives as data in `permissions.ts`; every route calls `requireTreeAccess(event, treeId, action)`. No inline role checks elsewhere.

| Action | owner | editor | contributor | viewer |
|---|---|---|---|---|
| View tree, persons, history, media | ✅ | ✅ | ✅ | ✅ |
| Add/edit person, relationship, event, photo | ✅ | ✅ | ✅ | ❌ |
| Delete person / relationship / photo | ✅ | ✅ | ❌ | ❌ |
| Revert a change | ✅ | ✅ | own only | ❌ |
| Create direct join code | ✅ | ✅ | ✅ | ❌ |
| View / regenerate family code | ✅ | ✅ | ❌ | ❌ |
| Approve/reject join and claim requests | ✅ | ✅ | ❌ | ❌ |
| Set verification questions for person | ✅ | ✅ | ✅ | ❌ |
| Change roles, remove members | ✅ | ❌ | ❌ | ❌ |
| Import GEDCOM | ✅ | ✅ | ❌ | ❌ |
| Full export, backup | ✅ | ✅ | ❌ | ❌ |
| Privacy-filtered export | ✅ | ✅ | ✅ | ✅ |
| Transfer ownership, delete tree | ✅ | ❌ | ❌ | ❌ |

Rules (§4):

- Owner cannot leave or be demoted; transfer ownership first to `active` member.
- `pending`/`rejected` members have no read access.
- Tree caller has no active membership in → **404**, never 403 (no existence disclosure). Authenticated but insufficient role → 403.
- Entity-keyed routes (person, relationship, event, media, history row, claim) resolve tree inside service via `resolveTreeId(entityType, id)`. Unknown id and inaccessible-tree id both → 404 same body. `requireTreeAccess(event, treeId, action, ctx?)` takes `ctx = { authorUserId }` for contributor revert own-only rule.
- Any non-owner member may remove self; removing/leaving sets `persons.userId` + `claimedAt` NULL for that member's person in that tree in same tx; person row stays.
- Join roles: family-code joiners get `DEFAULT_JOIN_ROLE`. Direct code carries `role` (`viewer|contributor|editor`, never `owner`) ≤ creator's role else 403.
- Public trees (`isPublic`; stored until Phase 5 implements filter): anonymous may use only `allowPublic: true` routes: `GET /api/trees/:id`, `GET /api/persons/:id`, `GET /api/persons/:id/relatives`, `GET /api/persons/:id/relation`, `GET /photos/…` for non-living. Every such response passes §6.9 privacy filter (living/unknown → "Living", no dates/places/bio/events/photos). Everything else requires session → 401 to anonymous. Anonymous to private tree or nonexistent id → same 401 same body (no disclosure).

**Route policy registry (§8):** `src/lib/server/route-policies.ts` exports one entry per (route, method): `{ route, method, access: 'public'|'session'|'tree'|'code', action?, allowPublic?, probe? }`. `access: 'tree'` names matrix `action`; `probe(ctx)` returns params/body for request that would succeed for authorized caller on seeded fixture (tree, persons, one user per role). `requireTreeAccess` reads same registry — declared protection == enforced protection. AT-07, AT-29, AT-09 auto-generated from registry, run every phase from introduction over all existing routes.

## 6. Graph Traversal Bounds (§6.11)

- Caps: `MAX_TRAVERSAL_DEPTH = 30` generations, `MAX_TRAVERSAL_NODES = 5000` nodes. Apply to every traversal: cycle check, ancestors, descendants, relatives expansion, relation path, stats depth, focus views.
- Implementation: iterative BFS in app code (one prepared statement per level, parent ids via `json_each`) OR `WITH RECURSIVE … UNION` (never `UNION ALL`, so cycles terminate) with `depth < :max` + `LIMIT :cap`. Never load whole `persons` into memory.
- Limit hit → partial result + `truncated: true`. Never throw/hang/500.
- `parent` link making any ancestor chain exceed depth → rejected `GRAPH_TOO_DEEP` (30 far beyond real trees; bounds cost + defeats hostile GEDCOM).
- `GET /api/trees/:id` returns full graph only if ≤ `TREE_FOCUS_MODE_THRESHOLD` (500) persons. Else focus subgraph around `?focus=<personId>` (default caller's own person, else oldest root) with `?depth=` (default `DEFAULT_FOCUS_DEPTH` 3, max `MAX_TRAVERSAL_DEPTH`) + `{ totalPersons, truncated }`. Client focus mode (§7.6) expands branches via this endpoint.
- Memory budget (1 GB host): response never > `MAX_TRAVERSAL_NODES` persons. Only whole-tree scan allowed is fuzzy-search worker reading `(id, name)` pairs.

## 7. Workers + Event Loop (§3)

- `better-sqlite3` synchronous → long main-thread work blocks all requests.
- Main thread owns one read/write connection for ordinary requests. Single request must stay within `MAIN_THREAD_BLOCK_BUDGET_MS` (50 ms) sync DB/CPU work.
- Over-budget work runs in `node:worker_threads` workers (`src/lib/server/workers/`, no extra dep), each opening own connection with same pragmas, created on demand, exit when idle except fuzzy worker (stays alive): GEDCOM parse+import, backup, full-tree export, fuzzy-search fallback.
- WAL lets worker reads proceed alongside main-thread writes. Exactly one writer at a time; writers wait up to `busy_timeout`.
- Password hashing limited to `PASSWORD_HASH_CONCURRENCY` (2) simultaneous; rest queue.
- No worker/request keeps read tx or un-exhausted `iterate()` open while idle: open reader blocks `wal_checkpoint(TRUNCATE)`.

## 8. Auth, Sessions, CSRF, CSP, Rate Limits, Lockout (§8, §6.1)

**Passwords/sessions:**

- bcryptjs cost 12, async API; reject > 72 bytes. Register requires 10–72 bytes + display name; anti-enumeration: register/forgot/login return generic messages. Login does dummy bcrypt compare when email missing or OAuth-only (similar timing).
- Sessions: 32 random bytes, base64url cookie; SHA-256 hash stored (`sessions.tokenHash` unique); `httpOnly`, `sameSite=lax`, `secure` when `NODE_ENV=production`; lifetime `SESSION_DAYS` (30) with sliding refresh ≤ once/day; new token on login; all sessions deleted on password change/reset. `change password` requires current password, revokes every other session. Session core wired into `hooks.server.ts` → `locals.user`.
- Password reset (1 h expiry, single-use, success deletes all sessions; if SMTP unset log link to console). Email verification (24 h expiry). Change password `POST /api/auth/password`, resend verification `POST /api/auth/verify/resend`.
- Google sign-in + linking: accept only `email_verified=true`. Local account with same email + `emailVerifiedAt` NULL → clear `passwordHash` + delete sessions before linking (stops pre-registration takeover); if verified → link. `SESSION_SECRET` signs short-lived (10 min) `oauth_state` cookie carrying `state` + PKCE verifier.
- Account deletion: remove credentials, sessions, OAuth links, avatar; `email` → `deleted+<id>@invalid.invalid` (frees address); `persons.userId` + `claimedAt` NULL in every tree (rows stay), delete memberships; keep authored history as "Deleted user"; must transfer/delete owned trees first.
- Production refuses start if `SESSION_SECRET` or `VERIFICATION_PEPPER` missing or < 32 chars.

**Tunnel/proxy:** adapter-node env `ORIGIN=<public https URL>`, `ADDRESS_HEADER=CF-Connecting-IP`. `expose: 3000` never `ports:` so header unspoofable. Dev override publishes port with `ADDRESS_HEADER` unset.

**CSRF:** SvelteKit built-in origin protection enabled (`csrf.checkOrigin` or `csrf.trustedOrigins` per installed Kit docs; confirm Phase 1a + record) plus explicit `Origin` check for JSON `POST/PUT/PATCH/DELETE` in `hooks.server.ts` against `ORIGIN`.

**CSP** via `kit.csp` `mode: 'nonce'` (all pages SSR; hand-written inline theme script in `app.html` carries `nonce="%sveltekit.nonce%"`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS in production. Playwright test (Phase 5) fails on any CSP console violation.

**Rate limiting:** in-memory `rate-limit.ts`, sliding window. State lost on restart (documented). Over-limit → 429 + `Retry-After`.

| Endpoint | Limit |
|---|---|
| `POST /api/auth/register` | 3/min/IP |
| `POST /api/auth/login` | 5/min/IP + 10 failures/15 min/account |
| `POST /api/auth/logout` | 10/min/IP |
| forgot-password | 3/hour/IP + 3/hour/email |
| `GET/POST /api/join/:code` | 10/min/IP |
| `PUT /api/claims/questions/verify/:personId` | 5 attempts/24 h per (user,person) persisted in `claimAttempts` + 20/hour/IP |
| `POST /api/claims` | 10/hour/user |
| `GET /api/search` | 60/min/IP |
| all other `/api` | 100/min/IP |

**Lockout tiers** (code + claim endpoints only: `/api/join/:code` GET/POST + verification answers; forgot-password always generic so only rate limit applies), keyed per IP+endpoint, failures in rolling 24 h: 5 → blocked 15 min; 10 → 1 h; 20 → 24 h (cap, no further doubling). Code-not-found counts as failure; success does not reset. Shared-IP tradeoff accepted (code entry rare).

**Login:** no IP lockout tiers. 5/min/IP rate limit + per-account lock: 10 failures in 15 min locks account 15 min (any IP). Successful reset clears lock. Tradeoff documented: attacker can force 15-min lock but not beyond; reset still works.

**Validation/errors:** all input Zod; all SQL via Drizzle/prepared; FTS from escaped quoted tokens. Errors `{ error: { code, message } }` generic; details server-logged with request ID. Codes (status): `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `JOIN_UNAVAILABLE` 404, `VERSION_CONFLICT` 409, `STALE_REVERT` 409, `REVERT_CONFLICT` 409, `NOT_REVERTIBLE` 409, `DUPLICATE` 409, `CYCLE` 409, `GRAPH_TOO_DEEP` 409, `PURGED` 410, `PAYLOAD_TOO_LARGE` 413, `IMAGE_TOO_LARGE` 413, `IMPORT_LIMIT` 413, `UNSUPPORTED_MEDIA` 415, `RATE_LIMITED` 429, `LOCKED` 429, `BUSY` 503. New code needs `DECISIONS.md` line.

## 9. Media Pipeline (§6.7)

- Images only: jpg, png, gif, webp; ≤ `UPLOAD_MAX_BYTES` (buffered in memory → `BODY_SIZE_LIMIT=12M` required, §11; adapter-node default 512 kB would 413 early); magic-byte validation; re-encode with `sharp` (`limitInputPixels = IMAGE_MAX_PIXELS`, `sharp.concurrency(1)`, `sharp.cache(false)`; over pixel cap → 413 `IMAGE_TOO_LARGE`) to strip EXIF/GPS + create 400 px thumbnail; filenames server UUIDs under `PHOTO_PATH/<treeId>/<personId>/` (`_tree` when `personId` NULL); reject path component not matching `^[A-Za-z0-9-]+$`.
- Serve only via authenticated `GET /photos/[...path]` checking tree membership (or `isPublic` + person not living/unknown). Headers: `Cache-Control: private, max-age=31536000, immutable` (filenames never reused), `X-Content-Type-Options: nosniff`, correct `Content-Type`, `Content-Disposition: inline`. Never `public`. README: no Cloudflare cache rule for `/photos/*`.
- `persons.photoUrl` = `/photos/…` URL of primary media row (set via `makePrimary` on upload or `PUT /api/media/:id`, cleared on row delete). Avatars + covers use same pipeline/limits under `PHOTO_PATH/_avatars/<userId>/` and `PHOTO_PATH/<treeId>/_cover/`; `/photos` serves avatar to any signed-in user sharing active tree with owner, cover to active members of that tree.
- Per-person + per-tree galleries, captions, lightbox. Deleting media/person/tree deletes files after commit; rollback deletes nothing. `sweep-orphans.ts` removes files with no row.

## 10. Dates AD/BS (§6.3)

- Verbatim user text stored in `birthDate`/`deathDate`/`events.date`. Sibling `*Cal` records `AD|BS`; form has explicit AD/BS toggle, never auto-detected.
- `*Norm` always Gregorian `YYYY-MM-DD` with `00` for unknown parts of AD inputs (BS partials follow special rule below); used for sorting/filtering/FTS birth year/privacy.
- AD parsing: strip qualifiers `about|abt|ca|circa|c.|bef|before|aft|after|est|cal` (case-insensitive, optional dots); `BET x AND y` uses `x`; accept `YYYY-MM-DD`, `YYYY-MM`, `YYYY`, `D Month YYYY`, `D Mon YYYY`, `Month YYYY`; unparseable → NULL. Impossible (`31 Feb 1985`) → NULL.
- BS parsing: `YYYY-MM-DD` (month 1–12), `YYYY-MM`, `YYYY`, `D Month YYYY` with romanised months Baisakh, Jestha, Ashadh, Shrawan, Bhadra, Ashwin, Kartik, Mangsir, Poush, Magh, Falgun, Chaitra (case-insensitive + alternates in `dates.ts`). Full BS converts exactly via library. Partial BS: `Norm` = Gregorian conversion of first day of period (year `Y` → 1 Baisakh `Y`; year-month → day 1), written complete `YYYY-MM-DD` with no `00` (BS period straddles two Gregorian years; `00` wrong). Precision recovered by re-parsing verbatim, never `Norm`. Accepted consequences (README + tooltip): `Norm` sort approximate for partial BS; FTS `birthYear` of BS-year-only can be one year early; privacy unaffected (110-year margin dwarfs 1-year error). Outside library range → `Norm` NULL, verbatim still shown.
- Display per `dateDisplayPref`: `AD` → Gregorian (`15 March 1985`, `March 1985`, `1985`); `BS` → BS converted from `Norm` when full else stored BS text; `both` → AD with BS in parens where convertible.
- GEDCOM 5.5.1 has no BS escape: export writes Gregorian + original BS text in `NOTE`.
- Test fixtures: BS↔AD pairs from authoritative published calendar, cited in test comments; ≥5 pairs incl. month-boundary + leap-year, cross-checked. Never invent from memory.

## 11. Layout Engine (§7.6)

Pure functions in `src/lib/tree/layout.ts`, no DOM, unit-testable, runnable in Web Worker (required > 200 nodes). Exact function names: `buildUnits`, `assignGenerations`, `buildLayoutTree`, `subtreeWidth`, `placeUnit`, `routeEdges`.

- **Input:** persons (id, birthDateNorm, gender) + relationships. **Output:** per person `{x, y, generation}`, per union `{x, y}`, edge polylines, optional `layoutWarning`.
- **1. Unions:** one union node per distinct parent set sharing ≥1 child, plus one per childless spouse pair. Person with several partners in several unions.
- **2. Generations:** directed graph parent → union → child. `generation` = longest path from roots (no parents). Align every spouse pair to max of two generations (re-propagate to children until stable, ≤ `MAX_TRAVERSAL_DEPTH + 1` rounds; parent-cycle check excludes spouse links — person married to own grandchild never stabilises; cap hit → keep last, `layoutWarning: 'SPOUSE_ALIGNMENT_UNSTABLE'` + banner). Disjoint components each start 0.
- **3. Primary-parent tree:** each person ≤1 primary parent union (parents with earliest birth; ties by id). Other parent links drawn later as extra edges. Couple anchored to member with primary parent union. Both with parents → anchor to earlier `birthDateNorm` (ties id), other's parent link extra edge. Neither with parents → couple is root unit ordered by earlier member. In-marrying spouse without parents never separate root.
- **4. Coordinates (deterministic width-based):** `NODE_W=160`, `NODE_H=72`, `H_GAP=24`, `SPOUSE_GAP=8`, `ROW_GAP=96`. `TB` (swap axes for `LR`): `unitWidth(u)` = member widths + `SPOUSE_GAP` (multi-partner order: partner1, person, partner2… by marriage `startDate`); `subtreeWidth(u)` = `max(unitWidth(u), Σ subtreeWidth(children) + H_GAP×(k−1))` ordered by `birthDateNorm`, name, id; top-down: root left edge at component cursor; children left-to-right in parent span, parent centred over children (midpoint first/last centres) never overlapping left neighbour (`x ≥ prevRight + H_GAP`; shift subtree right if needed); `y = generation × (NODE_H + ROW_GAP)`; components left-to-right gap `3×H_GAP`. No barycenter sweeps v1; non-primary extra edges curved, may cross (accepted).
- **5. Edges:** orthogonal polylines: spouse–union horizontal, union–child vertical with shared bus. `guardian` dashed extra edges, excluded from unit/generation logic; `sibling` not drawn (via shared parents).
- **6. Focus mode** above `TREE_FOCUS_MODE_THRESHOLD`: render only selected person's ancestors+descendants to depth N (default 3) + spouses/siblings, branch-expand controls.
- Fixtures (assert no bbox overlap with constants, parents above children, spouses adjacent, deterministic re-run): single parent+children; two parents+children; divorced-remarried half-siblings; two disjoint trees; 5-gen line; married-to-grandchild (terminates + warning); 500-node generated (timing for R-PERF-4).
- Pre-approved fallback: if custom engine fails fixtures after one documented fix attempt post-first-fail, stop iterating, may switch to `elkjs` (layered) in lazy Web Worker, recording bundle + timings in `DECISIONS.md`. R-PERF-1 still applies (ELK in lazy chunk).

## 12. Notifications, Maintenance, Backup (§6.10, §6.12, §11)

**Notifications (§6.10, schema §5.1):** bell + unread count (`unreadCount` in `GET /api/notifications`) in top bar; paginated list; mark one/all read; types `join|join_approval|claim|claim_review|edit`. Client polls every 60 s while tab visible (no WebSockets v1). `edit` coalesced: ≤1 unread per (claimed person, editor) per `EDIT_NOTIFY_COALESCE_MINUTES` (10). Family-code submit notifies owner+editors (`join_approval`); approval/rejection notifies user; claimed persons notified of edits.

**Maintenance (`src/lib/server/maintenance.ts`, §6.12):** runs once at startup (after migrations + FTS check) then every `MAINTENANCE_INTERVAL_HOURS` (6), in worker thread (no cron dep). Each pass in separate short txs: hard-purge persons soft-deleted > `SOFT_DELETE_PURGE_DAYS` + dependents (files after commit); delete expired sessions; delete expired/used password-reset + email-verification tokens older than 24 h; delete `claimAttempts` whose window ended > 24 h ago. Failed pass logs + retries next interval; never blocks startup.

**Backup / export / deployment (§6.9, §11):**

- Backup (owner/editor): SQLite snapshot via better-sqlite3 backup API in worker (page-exact copy, non-blocking event loop) + photos, streamed as tar. Never raw copy of live WAL DB. `backup.sh` (host) → `docker compose exec familytree tsx scripts/backup.ts` (runtime image has no `sqlite3` CLI) then tars photos; `restore.sh` (stop app, restore, rebuild FTS, start). README cron example + restore drill.
- Dockerfile multi-stage `node:22-bookworm-slim`: build installs `python3 make g++` only if native module lacks prebuilt for target arch; runtime no compilers, non-root user, copies built output + `migrations/` (`MIGRATIONS_PATH` points there) + `scripts/` + prod deps incl. `tsx`, creates `/data/db` + `/data/photos` owned by non-root (volume inheritance), `HEALTHCHECK` on `/api/health` via `node -e` + `fetch` (slim has no curl/wget).
- Env: `ORIGIN`, `DATABASE_PATH`, `PHOTO_PATH`, `SESSION_SECRET`, `VERIFICATION_PEPPER`, `CLOUDFLARE_TUNNEL_TOKEN`, `SMTP_HOST|PORT|USER|PASS|FROM`, `GOOGLE_CLIENT_ID|SECRET`, `ADDRESS_HEADER`, `MIGRATIONS_PATH`, `BODY_SIZE_LIMIT` (= `12M`).
- Design tokens (§7.1, all text pairs ≥4.5:1, `contrast.ts` enforces, AT-28): Primary `#047857` (white text) hover `#065F46`; dark primary `#34D399` with `#0F172A` text; Secondary `#6D28D9` (white); BG `#FAFAFA`/`#0F172A`; surface `#FFFFFF`/`#1E293B`; text `#111827`/`#F1F5F9`; secondary text `#4B5563`/`#94A3B8`; success `#047857`, error `#B91C1C`, warning `#B45309`. Typography Inter self-hosted woff2: H1 24/36 800; H2 20/28 700; H3 18/22 600; body 15/16 400; buttons 15/16 600; inputs 16 px. 8 px grid (4,8,16,24,32,48). Radii buttons 12, cards 16, inputs 10, avatars 50%, modals 20. Touch ≥44×44. Layout: mobile 320–640 bottom nav (Home, Trees, Add FAB, Search, Me) + sheets; tablet 640–1024 top nav 2-col; desktop ≥1024 sidebar+content + modals. Safe-area honoured. Dark follows system default, manual toggle in `themePref` + `localStorage`; inline theme script with CSP nonce (no flash).
- PWA (§7.4): manifest/icons/splash/installable. `src/service-worker.ts` precaches static shell only, serves read-only offline fallback; never caches `/api/*`, `/photos/*`, or HTML except fallback (no cross-user leak on shared device). Mutations offline → "You're offline" toast. No offline queue.

## 13. Performance Budgets (§3)

| ID | Requirement | Verification |
|---|---|---|
| R-PERF-1 | Initial JS < 250 KB gzip; tree chunk lazy-loaded | Phase 3 bundle report from build output |
| R-PERF-2 | Typical read query < 25 ms p95 single user | `bench.ts` |
| R-PERF-3 | Search < 150 ms (FTS) and < 300 ms (fuzzy) in one tree of 50k people | `bench.ts` |
| R-PERF-4 | Layout + render of 500 nodes < 500 ms | Phase 3 Vitest benchmark (layout) + Playwright timing (render) |
| R-PERF-5 | Cold start < 2 s | timed Phase 6 |
| R-PERF-6 | RSS ≤ 200 MB steady state after warm-up (peak during import/backup/image measured+reported, no target) | `docker stats` Phase 6 |
| R-PERF-7 | Event loop responsive: p99 loop delay < 100 ms under bench load incl. import | `perf_hooks.monitorEventLoopDelay`, `bench.ts` + `/api/health` |
| R-PERF-8 | GEDCOM import at caps commits in < 5 s (fits writers' `busy_timeout`) | `bench.ts` |

- Measured + reported, not asserted. `bench.ts` seeds 50k people, prints table to `BENCHMARKS.md` with machine description. Enforced as relative failures on dev machine (exit non-zero if search p95 > 3× target); owner runs once on Pi. Pi 4 minimum 1 GB RAM.

## 14. Component List (§7.3) + Interaction Scope

Components: `BottomNav, TopBar, Sidebar, PersonCard, PersonForm (progressive disclosure), AddPersonSheet, JoinCodeGenerator, JoinFlow, ClaimProfileFlow, ClaimReview, ChangeHistory, ActivityFeed, TreeCanvas, TreeControls, PersonNode, PhotoGallery, PhotoUpload, Lightbox, SearchBar, Toast, ConfirmDialog, SkeletonLoader, OnboardingTour (4 steps)`. A11y: visible focus, ARIA on icon buttons, full keyboard, `aria-live` for toasts/form errors, `prefers-reduced-motion` disables animation incl. confetti.

Interactions v1: tap, buttons, wheel+pinch zoom (d3-zoom), pan, search-and-highlight, Cmd/Ctrl+K, Escape, undo toast, CSS-only confetti on join/claim, onboarding. Phase 7 optional: swipe, pull-to-refresh, drag-and-drop relationship creation, minimap.

## 15. API Surface Summary (§9)

All JSON, Zod-validated, session required unless *public*. Success `{ data: … }`; lists `{ data: [...], nextCursor: string|null }` (opaque base64url cursors; `truncated`/`totalPersons` inside `data`). Zod schemas `src/lib/schemas/`, one file per area. Every row has route-policy registry entry (§8).

| Method + route | Purpose |
|---|---|
| `POST /api/auth/register` *public* 3/min | create account |
| `POST /api/auth/login` *public* 5/min | login, rotate session |
| `POST /api/auth/logout` | invalidate session |
| `POST /api/auth/forgot` *public* generic | request reset |
| `POST /api/auth/reset` *public* | complete reset |
| `POST /api/auth/verify` | verify email |
| `POST /api/auth/verify/resend` session 3/hour/user | resend verification |
| `POST /api/auth/password` session | change password (current required) |
| `GET /api/auth/google`, `/api/auth/google/callback` | OAuth (only if configured) |
| `DELETE /api/account` | delete account |
| `PUT /api/account`, `POST /api/account/avatar` multipart | profile+prefs / avatar upload |
| `GET /api/trees` / `POST /api/trees` | list mine / create (also creates family code) |
| `GET /api/trees/:id` (`?focus=&depth=`) `allowPublic` Phase 5 | people+relationships+members, bounded §6.11 |
| `PUT /api/trees/:id` / `DELETE /api/trees/:id` | update / delete (owner for delete; confirm by typing name) |
| `GET /api/trees/:id/activity` | feed, cursor-paginated |
| `GET /api/trees/:id/stats` | people, relationships, generation depth (bounded, `truncated`) |
| `GET /api/trees/:id/surnames`, `GET /api/trees/:id/duplicates` | surname explorer / duplicate candidates |
| `GET /api/trees/:id/media` | tree gallery, cursor-paginated |
| `GET /api/trees/:id/join-codes` | family code (owner/editor) + caller's own direct codes |
| `GET /api/trees/:id/members`, `PUT /api/trees/:id/members/:userId`, `DELETE …` | list / role change / remove (owner for changes) |
| `POST /api/trees/:id/transfer` owner | transfer ownership |
| `POST /api/trees/:id/members/:userId/review` owner/editor | approve/reject pending join |
| `GET /api/trees/:id/export?format=gedcom\|json\|csv&excludeLiving=` | export |
| `GET /api/trees/:id/backup` owner/editor | tar stream |
| `POST /api/persons` (body `treeId`) | add |
| `GET/PUT/DELETE /api/persons/:id` | read (incl. events+media) / update (needs `version`) / soft-delete |
| `GET /api/persons/:id/history` | paginated |
| `GET /api/persons/:id/relatives` | parents, children, spouses, siblings |
| `GET /api/persons/:id/relation?to=:otherId` | "How are we related?" (BFS bounded, path + label or "not connected within the search limit") |
| `POST /api/relationships`, `PUT /api/relationships/:id`, `DELETE /api/relationships/:id` | manage links |
| `POST /api/join-codes` | create direct code (optional `role`) / regenerate family code |
| `DELETE /api/join-codes/:id` | deactivate (creator, owner, editor) |
| `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id` | manage events (add/edit any non-viewer; delete needs delete perm) |
| `GET /api/join/:code` auth optional 10/min | preview (tree name, relation, inviter) |
| `POST /api/join/:code` 10/min | redeem |
| `GET /api/claims/search` | scoped search unclaimed (members or code holders; non-members see first name + last initial + birth year only) |
| `POST /api/claims` / `GET /api/claims?treeId=` / `PUT /api/claims/:id` | submit / list pending (owner/editor) / review (approve + link relation) |
| `POST /api/claims/questions/:personId`, `GET /api/claims/questions/:personId` | set / read texts only (same audience as claim search) |
| `PUT /api/claims/questions/verify/:personId` attempt-limited | verify answers |
| `POST /api/history/revert` | revert by `historyId`/`batchId`, `force?` |
| `POST /api/media`, `PUT /api/media/:id`, `DELETE /api/media/:id` | upload multipart optional `makePrimary` / caption+primary / delete |
| `GET /photos/[...path]` authenticated image, not under `/api` | membership or public+non-living gated |
| `GET /api/search?q=&treeId=` 60/min | FTS + fuzzy |
| `POST /api/gedcom/import?preview=1` multipart owner/editor | import into `treeId` tree, preview step |
| `GET/PUT /api/notifications` | list with `unreadCount` / mark read |
| `GET /api/health` *public* no secrets | status, uptime, version, `eventLoopDelayP99Ms` |

Key feature flows tied to API: concurrency (`PUT /api/persons/:id` `WHERE id=? AND version=?`, 409 + current row on zero changes); audit (update → 1 row/field shared `batchId` same tx; create → 1 row `field` NULL; delete → 1 row + `snapshot`); events (free-text `type` + suggested `residence|occupation|education|burial|other`; no `version`, last-write-wins + audited); join redemption txs (§6.4 relation mapping `parent`→`(new,linked,parent)`, `child`→`(linked,new,parent)`, `spouse|sibling` normalised, `self`→ null-guarded claim); claiming methods (`self` instant, verification auto-approve if ≥ minimum + all correct, matching score advisory never auto-approve, manual reviewer decides; score `name = 1 − DL/maxlen` clamped [0,1], birth `1` equal at precision / `0.5` year-only / `0`, place `1` equal / `0.5` Jaccard ≥0.5 / `0`; missing field scores 0, no renormalisation); search order (FTS5 prefix from escaped quoted tokens → server fuzzy Damerau-Levenshtein dist ≤1 tokens ≤5 else ≤2, NFKC, cap 20 + 300 ms; filters name/birthYear/place; surnames `GROUP BY lastName`; duplicates same-normalised-name + years ±2 or same place, `GROUP BY` never nested loop, cap `DUPLICATE_MAX_PAIRS` + 300 ms + `truncated`); GEDCOM 5.5.1 import (UTF-8, `CONC/CONT`, `INDI/FAM/HUSB/WIFE/CHIL/BIRT/DEAT/MARR/DATE/PLAC/NOTE/SEX/NAME/GIVN/SURN`, worker + atomic tx + caps + preview counts/warnings, unknown tags counted, adds-only each `INDI`→new person `isLiving` NULL, audited one `create`/entity shared `batchId` `note='gedcom import'`); export GEDCOM/JSON/CSV + privacy filter (living if `isLiving=1` or NULL + no death + born within 110 y or birth unknown → name "Living", IDs+structure kept, dates/places/bio/notes/events/photos/claim dropped); derived relations (grandparent, great-*, aunt/uncle, niece/nephew, cousin+removal, in-law computed never stored; `sibling` stored only when parents unknown; `guardian` dashed extra).
