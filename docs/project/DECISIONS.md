# DECISIONS.md — Collaborative Family Tree

Pre-implementation decision log. Every entry grounds in `SPECS.md` section refs.
Rule per §0.1.4: ambiguity → simplest option satisfying requirement + dated entry (decision, alternatives, reason).
Rule per §0.1.12: conflicts → §4, §5, §8 win over §6, §7. Record conflict, list under reply **Not verified**. Never silent.
Rule per §0.1.10: pinned §2 versions exact; deviations recorded here with error, change, reason.

## 2026-10-01 — Pre-implementation stub (no code yet)

### D-001: Pinned dependency versions accepted as last-known-good (§0.1.10, §2)
- **Decision:** Accept §2 pins as starting set. Phase 1a installs exactly these with `npm install --save-exact`, runs `npm ls`, records result here.
- **Alternatives:** Float versions / use `--legacy-peer-deps`.
- **Reason:** Spec header (2026-10-01 registry resolution + peer cross-check) makes pins last-known-good. §0.1.10 forbids `--force` / `--legacy-peer-deps`; failure path is newest version satisfying peer ranges, then previous major on runtime incompatibility, full phase test rerun.
- **Status:** ACCEPTED (pending Phase 1a `npm ls` evidence).

### D-002: Tunable defaults accepted pending owner review (§0.2, `src/lib/config.ts`)
- **Decision:** Accept all §0.2 defaults unchanged as one exported constant each in `src/lib/config.ts` (`RATE_LIMITS`, `LOCKOUT_TIERS` included). Owner reviews later; change = one-line edit.
- **Accepted values:** `LIVING_ASSUMPTION_YEARS=110`, `MIN_VERIFICATION_QUESTIONS=3`, `VERIFY_MAX_ATTEMPTS_PER_24H=5`, `SOFT_DELETE_PURGE_DAYS=30`, `SESSION_DAYS=30`, `CONTRIBUTOR_REVERT_OWN_ONLY=true`, `FAMILY_CODE_DEFAULT_MAX_USES=50` (`NULL`=unlimited), `EDIT_NOTIFY_COALESCE_MINUTES=10`, `TREE_FOCUS_MODE_THRESHOLD=500`, `PASSWORD_MIN_LENGTH=10` (max 72 bytes bcrypt limit), `PASSWORD_HASH_CONCURRENCY=2`, `MAX_TRAVERSAL_DEPTH=30`, `MAX_TRAVERSAL_NODES=5000`, `DEFAULT_FOCUS_DEPTH=3`, `IMPORT_MAX_BYTES=5242880`, `IMPORT_MAX_PERSONS=10000` / `IMPORT_MAX_RELATIONSHIPS=20000`, `MAIN_THREAD_BLOCK_BUDGET_MS=50`, `DEFAULT_JOIN_ROLE=contributor`, `MATCH_WEIGHTS=name 0.5, birth date 0.3, birth place 0.2`, `DUPLICATE_MAX_PAIRS=200`, `UPLOAD_MAX_BYTES=10485760` / `IMAGE_MAX_PIXELS=25000000`, `MAINTENANCE_INTERVAL_HOURS=6`, §8 `RATE_LIMITS` / `LOCKOUT_TIERS` as data.
- **Alternatives:** Tune values now without owner input.
- **Reason:** §0.2 states values are spec-author defaults for owner review; changing pre-review adds risk with no evidence.
- **Status:** ACCEPTED (pending owner review).

### D-003: Conflict rule acknowledged (§0.1.12)
- **Decision:** On any internal spec conflict, §§4–5–8 (data, security) win over §§6–7 (features, UI). Record conflict here + reply **Not verified**.
- **Alternatives:** None permitted by spec.
- **Reason:** Binding operating rule; prevents silent weakening of data/security requirements (§0.1.7).
- **Status:** ACCEPTED. No conflicts known pre-implementation.

### D-004: BS partial-date approximation consequences accepted (§6.3)
- **Decision:** Accept stated consequences: partial BS dates normalize to Gregorian conversion of first day of period (BS year `Y` → 1 Baisakh `Y`; BS year-month → day 1), full `YYYY-MM-DD` with no `00` placeholders; precision recovered by re-parsing verbatim text, never from `Norm`.
- **Accepted consequences:** `Norm` sort approximate for partial BS dates; FTS `birthYear` of BS-year-only birth can be one Gregorian year early; privacy filter unaffected in practice (110-year margin dwarfs 1-year error). Stated in README + date-field tooltip; tests cover rule. Out-of-range library dates → `Norm` NULL, verbatim shown. BS test fixtures cite authoritative published calendar (≥5 pairs incl. month-boundary + leap-year case).
- **Alternatives:** Store precision flags / `00` placeholders for BS partials.
- **Reason:** Spec mandates this encoding because BS period straddles two Gregorian years and `00` would be wrong.
- **Status:** ACCEPTED.

### D-005: In-memory rate-limit loss on restart accepted (§8, §5.1, §11)
- **Decision:** Accept `rate-limit.ts` in-memory sliding windows; state lost on restart. No `rateLimitHits` table (§5.1). Documented in README Limitations (§11). Persisted exception: verification-attempt limit in `claimAttempts` table (§5.1, §8).
- **Alternatives:** Persist counters in SQLite/Redis.
- **Reason:** Spec mandates in-memory design; persistence adds infra cost out of scope for single-node self-hosted v1.
- **Status:** ACCEPTED.

### D-006: Layout fallback to elkjs after one fix attempt (§7.6)
- **Decision:** Build custom engine first (`buildUnits`, `assignGenerations`, `buildLayoutTree`, `subtreeWidth`, `placeUnit`, `routeEdges` in `src/lib/tree/layout.ts`). On fixture failure: one documented fix attempt, then stop iterating and switch to `elkjs` (layered) in lazily loaded Web Worker. Record bundle size + layout timings here. R-PERF-1 still applies (ELK in lazy chunk).
- **Alternatives:** Iterate custom engine unboundedly / start with elkjs.
- **Reason:** Pre-approved spec fallback bounds algorithm risk; keeps R-PERF-1/R-PERF-4 traceable.
- **Status:** ACCEPTED (not yet triggered).

### D-007: Phase 1a must-record items — VERIFIED (all rows a–e)
Per §§0.1.10, 2, 5, 5.2, 6.3, 7.2, 8, 12 (AT-35), 13 (Phase 1a), 14:

| # | Item | Spec ref | Status |
|---|---|---|---|
| D-007a | `npm ls` clean result on exact pins | §2, §0.1.10, Phase 1a checkpoint | VERIFIED 2026-10-01: `npm ls` exit 0, all §2 pins exact (`@eslint/js@10.0.1`, `globals@16.5.0` pinned as resolved). Env notes: host node is v24.21.0 (spec: 22.x; Dockerfile still pins `node:22-bookworm-slim`); `~/.npm-global` npm 12.0.2 writes broken `.bin` shims (package file content instead of symlinks) — `node_modules/.bin` regenerated with system npm 11.19.0 (`rm -rf node_modules/.bin && npm install`), no dependency versions changed. |
| D-007b | `drizzle-kit` behaviour: `generate` + `--custom --name=fts` / `--name=views`, `statement-breakpoint` handling, trigger/view recreation on `persons` changes | §5 steps 1–3, §5.1 view, §5.2 | VERIFIED 2026-10-01: `src/lib/db/migrations/` holds `0000` (base schema) + `0001_fts` (custom FTS: `person_fts_map`, `persons_fts` with Devanagari tokenchars, 3 triggers, one statement per trigger, `--> statement-breakpoint` separators) + `0002_views` (custom `visible_persons` view); journal `meta/_journal.json` tracks all three. Upgrade-test fix documents migrator gating: drizzle skips migrations with `folderMillis <= last created_at` in `__drizzle_migrations` (`sqlite-core/dialect.js` `migrate()`). `drizzle-kit generate` not re-run (would mint new migration files); AT-35 fresh + upgrade tests green. |
| D-007c | `nepali-date-converter@3.4.0` supported year range verification | §2 table note, §6.3 | VERIFIED 2026-10-01: constructor throws outside BS 2000/01/01–2090/12/30 (`"The date doesn't fall within 2000/01/01 - 2090/12/30"`); boundaries convert (BS 2000-01-01 → AD 1943-04-14; BS 2090-12-30 → AD 2034-04-13). Coded as `BS_MIN_YEAR=2000`, `BS_MAX_YEAR=2090` in `src/lib/utils/dates.ts:13-14`; out-of-range → `Norm` NULL per §6.3. |
| D-007d | CSRF option confirmed on installed Kit: `csrf.checkOrigin` vs `csrf.trustedOrigins` (+ explicit `Origin` check in `hooks.server.ts`) | §8 | VERIFIED 2026-10-01: installed Kit 2.70.3 deprecates `csrf.checkOrigin` in favour of `csrf.trustedOrigins` (`@sveltejs/kit/src/core/config/options.js:119-124`); default origin check left enabled, no `csrf` override in `svelte.config.js`; explicit `Origin` check for JSON `POST/PUT/PATCH/DELETE` in `src/hooks.server.ts:33` + `ADDRESS_HEADER` client-IP wiring (`:7`). |
| D-007e | CSP `kit.csp` `mode: 'nonce'` confirmed; every inline `<script>` carries `nonce="%sveltekit.nonce%"`, no `unsafe-inline` in `script-src` (AT-47) | §8, §7.2 inline theme script | VERIFIED 2026-10-01: `svelte.config.js:7` sets `mode: 'nonce'` with `script-src: ['self']`; AT-47 passes including live built-server assertion (CSP header carries per-request nonce, no `unsafe-inline`). |

## Recommended implementation order
- Follow `IMPLEMENTATION_PLAN.md` phase order (`1a, 1b, 2, 3, 4, 5, 6`, optional `7`) and per-phase re-read guide (§0.3), checkpoints (§13), acceptance rows (§12), done criteria (§14).
- This log updates every phase per §14 (`DECISIONS.md` updated for every ambiguity resolved).

## 2026-10-01 — Phase 1a resume (verification fixes)

### D-008: Broken `node_modules/.bin` shims repaired without touching pins (§0.1.10, §2)
- **Decision:** Deleted `node_modules/.bin` and re-ran `npm install` with system npm 11.19.0 to regenerate symlinks; no version changed (`npm ls` clean, lockfile pins intact).
- **Alternatives:** Manually rewrite shims; downgrade host node; `--force` reinstall.
- **Reason:** `~/.npm-global` npm 12.0.2 copies each package's bin file content into `.bin` instead of symlinking, so relative `require`/`import` paths resolve against `.bin/` and every CLI (`vitest`, `svelte-check`, …) fails. Environment repair, not a dependency change, so §0.1.10 failure procedure does not apply.
- **Status:** APPLIED. Contributors must use system npm 11.x (`PATH=/usr/bin:$PATH`) until npm 12 bin-linking is fixed.

### D-009: AT-35 upgrade test marks base migration applied via journal row (§5, §12 AT-35)
- **Decision:** After applying `0000` statements manually, the test inserts a `__drizzle_migrations` row with that migration's `when` (read from `meta/_journal.json`) before running the full migrator.
- **Alternatives:** Drop tables before migrating (would not test upgrade); fork drizzle migrator.
- **Reason:** Drizzle's sqlite `migrate()` skips entries with `folderMillis <= last created_at`; without the marker row the full migrator re-applies `0000` and fails with `table changeHistory already exists`. This mirrors a real upgrade (base applied by an older binary, rest by the new one).
- **Status:** APPLIED (`tests/migrations.test.ts`), 24/24 green.

### D-010: `check-traceability.mjs` typed with JSDoc instead of `// @ts-nocheck` (§14)
- **Decision:** Keep the script plain Node ESM with zero dependencies and satisfy strict `checkJs` + `ban-ts-comment` lint via JSDoc parameter/return annotations.
- **Alternatives:** `// @ts-nocheck` (rejected by `ban-ts-comment` lint); exclude `scripts/` from `tsconfig` (hides real errors); convert to TypeScript (violates "plain Node ESM, no dependencies").
- **Reason:** Satisfies both `svelte-check`/`tsc --noEmit` strict clean and `eslint` clean with no spec deviation.
- **Status:** APPLIED (`scripts/check-traceability.mjs`).

### D-011: `better-sqlite3` moved to `dependencies` + explicit SSR external (§2, §5, §11, §12 AT-47)
- **Decision:** `better-sqlite3@13.0.3` moved from `devDependencies` to `dependencies` (same exact pin, lockfile re-synced); `vite.config.ts` keeps `environments.ssr.resolve.external: ['better-sqlite3']`.
- **Alternatives:** Leave in devDependencies and rely on bundling (crashes); bundle with a CJS-shim patch.
- **Reason:** The app opens SQLite at runtime (`hooks.server.ts`, `scripts/migrate.ts`, container `tsx` scripts), so the driver must ship in the production image, which installs production deps only. As a side effect this also fixes the production build: Vite 8 bundles devDependencies into the SSR output, inlining better-sqlite3's binding loader whose `require.main === module` probe throws under ESM (`ReferenceError: require is not defined`), so `node build` crashed before serving anything. After the move the driver stays external, `node build` boots, `/api/health` returns 200, and AT-47's live-server assertion passes for real (earlier green runs were vacuous — no `build/` existed so the test returned early).
- **Status:** APPLIED (`package.json`, `package-lock.json`, `vite.config.ts`). Verified: `node build` + `GET /` shows per-request `nonce-…` in CSP header with matching inline-script nonces and no `unsafe-inline` in `script-src`.

## 2026-10-01 — Phase 1b (accounts)

### D-012: Avatar binary upload deferred to Phase 2 (§6.1, §6.7, §9)
- **Decision:** `PUT /api/account` covers display name, theme/date-display prefs and notify prefs. `POST /api/account/avatar` (multipart) ships with the Phase 2 media pipeline (sharp re-encode, `PHOTO_PATH/_avatars/`, authenticated `/photos` serving route).
- **Alternatives:** Store avatar bytes now with no serving route (dead files); build a one-off upload path outside the media pipeline (duplicated validation).
- **Reason:** An uploaded avatar is useless until the Phase 2 authenticated photo route can serve it; one validated pipeline avoids two.
- **Status:** DEFERRED to Phase 2 (listed in phase reply).

### D-013: Google OAuth callback redirects instead of returning JSON (§7.0, §9)
- **Decision:** `GET /api/auth/google/callback` sets the session cookie and issues a 302 (`/` on success, `/login?error=oauth` on failure); all other API routes return JSON.
- **Alternatives:** Return JSON from the callback (breaks the browser redirect flow).
- **Reason:** The authorization-code flow completes as a browser navigation to the callback URL; a redirect is the only usable response there. Service logic (`googleCallback`) stays JSON-mappable and is covered by AT-36 with mocked fetch.
- **Status:** APPLIED.

### D-014: Register creates no session (§6.1 anti-enumeration)
- **Decision:** `POST /api/auth/register` returns the same generic message for new and existing emails and never sets a session cookie; the user logs in separately.
- **Alternatives:** Auto-login on register (reveals whether the email was already registered via session side effect).
- **Reason:** Any observable difference between new/existing emails breaks the §6.1 generic-response rule probed by AT-36.
- **Status:** APPLIED.

### D-015: ESLint TS parser wired for `*.svelte` (tooling fix found in 1b)
- **Decision:** Added `parserOptions.parser: tseslint.parser` for `**/*.svelte` in `eslint.config.js`; without it, TS annotations in `<script lang="ts">` fail with `Parsing error: Unexpected token :`.
- **Alternatives:** Strip type annotations from components (breaks strict `svelte-check` under `noImplicitAny`).
- **Reason:** Phase 1a components carried no annotations so the gap was latent; 1b forms exposed it. Standard eslint-plugin-svelte configuration.
- **Status:** APPLIED.

## 2026-10-01 — Phase 2 (trees and people; media deferred per owner direction)

### D-016: Media work deferred out of Phase 2 on owner instruction (§13, §12)
- **Decision:** Phase 2 ships tree/person/relationship/event services, permissions, and API routes. Media upload/serve, avatar/cover handling, and file-after-commit deletion move to a later phase, together with AT-16, AT-17 and AT-27. `npm run check:traceability -- --phase 2` therefore reports those 3 ATs missing; the gate is honestly red, not waived.
- **Alternatives:** Implement media now against the explicit direction; write vacuous media tests (forbidden by §0.1.7).
- **Reason:** Owner message scopes Phase 2 to CRUD/permissions/API and explicitly excludes media. The `media` table and `photoUrl`/`coverImage` columns exist (Phase 1a schema); `GET /api/persons/:id` already returns a `media` array (empty until the pipeline lands).
- **Status:** DEFERRED.

### D-017: Tree-settings update gated on the `delete` action (§4)
- **Decision:** `PUT /api/trees/:id` (rename, description, cover, public toggle) requires the `delete` role level (owner/editor). The permission matrix has no tree-settings action.
- **Alternatives:** Add a new matrix action (needs a spec error code line and matrix change beyond Phase 2 need); gate on `add` (lets contributors rename trees).
- **Reason:** Settings edits are destructive-adjacent; owner/editor already hold delete rights. Smallest change satisfying §4 without inventing matrix semantics.
- **Status:** APPLIED.

### D-018: Stored `sibling` links rejected when parents are shared (§6.3)
- **Decision:** `createLink` returns `SHARED_PARENTS` (400) for a stored sibling link between two people sharing a parent; derived siblings come from shared parents, stored links cover only the parents-unknown case.
- **Alternatives:** Accept and draw duplicate edges.
- **Reason:** Spec states stored sibling links exist only for unknown-parent cases and derived siblings are never duplicated by a stored link; rejection enforces it at the write path.
- **Status:** APPLIED.

### D-019: `guardian` links excluded from traversals and relation paths (§6.3, §6.11)
- **Decision:** Ancestor/descendant walks, generation depth, and BFS relation paths traverse `parent`/`spouse`/`sibling` links only; `guardian` rows are stored and returned nowhere in Phase 2 read paths except raw relationship lists.
- **Alternatives:** Treat guardian as a parent edge (would corrupt generation math and cycle checks for a non-biological link).
- **Reason:** Spec gives guardian no role in unit/generation logic and defines traversals over the biological graph; the dashed-edge rendering that uses guardian arrives with the layout phase.
- **Status:** APPLIED.

### D-020: Tree creation writes an inert family-code row (§6.2 vs Phase 4)
- **Decision:** `createTree` inserts one active `family` join-code row in `<SLUG>-<8 chars>` format; redemption/approval endpoints arrive in Phase 4, so the code is inert until then.
- **Alternatives:** Skip the row (violates §6.2 "creates … one active family code"); build redemption now (Phase 4 scope).
- **Reason:** Satisfies the §6.2 creation contract with no Phase 4 logic; data/security sections win on format (§5.1 code format used verbatim).
- **Status:** APPLIED.

### D-021: AT-38 40-generation fixture inserted via raw SQL (§6.11, §12)
- **Decision:** The 41-person/40-link chain is inserted with raw SQL, bypassing `createLink`: the `GRAPH_TOO_DEEP` guard correctly rejects link 31+ through the API, so no API-built fixture can exceed 30 generations.
- **Alternatives:** Weaken the guard for fixtures (weakens a requirement to make a test pass — forbidden by §0.1.7).
- **Reason:** AT-38 requires traversals to terminate bounded on deeper-than-cap input; only out-of-band state (legacy data, direct DB writes) can produce it, which is exactly what the fixture simulates.
- **Status:** APPLIED (`tests/trees.test.ts`).

### D-022: All entity IDs are UUIDv4 (§5)
- **Decision:** Replaced `randomBytes(16).hex` id generation with `crypto.randomUUID()` in every server module (trees, persons, links, events, users, sessions, tokens rows, history rows). Session/reset tokens stay `base64url` random (they are secrets, not IDs).
- **Alternatives:** Keep hex ids (violates §5 ID rule and breaks `z.uuid()` request validation).
- **Reason:** The live-server probe caught it: `POST /api/persons` returned 400 for service-minted tree ids. Spec-literal fix.
- **Status:** APPLIED.

### D-023: Media pipeline shape (§6.7, §5.1, §4)
- **Decision:** Dynamic path components must match `^[A-Za-z0-9-]+$`; the fixed markers `_tree`, `_cover`, `_avatars` are allowed verbatim. `/photos` authorizes by the media row (not the path's tree id) and `/photos` is registry `access: 'session'` because ownership is decided per row. Tree `coverImage` is set only through `POST /api/trees/:id/cover` (arbitrary-URL `PUT` removed). Soft-deleting a person keeps its media files so the delete stays revertible; files go on `purgePerson` (hard purge), `deleteMedia`, `deleteTree`, and account deletion (avatar dir), always after commit via `commitThenDelete`.
- **Alternatives:** Remove files on soft delete (breaks revert); trust the path's tree id (spoofable); keep `coverImage` writable by `PUT` (orphan files, foreign URLs).
- **Reason:** Spec says `^[A-Za-z0-9-]+$` for components yet fixes underscore-prefixed folders; revert snapshots must stay restorable; AT-27 needs post-commit, rollback-safe removal.
- **Status:** APPLIED.

### D-024: DB invariants added in migration 0003 (§5.1, §0.1.12)
- **Decision:** `drizzle-kit generate --name=invariants` adds `ux_person_user_per_tree`, `ux_one_owner_per_tree`, `ux_family_code_per_tree`, `ux_claim_pending` (partial unique) and `CHECK (person1Id <> person2Id)` on `relationships` (table rebuilt by drizzle). `transferOwnership` now demotes the old owner before promoting the new one (the new index exposed the old order).
- **Alternatives:** Service-layer checks only (leaves direct DB writes unguarded).
- **Reason:** §5 outranks feature sections; invariants belong in the schema.
- **Status:** APPLIED.

### D-025: Operational limits and mapping (§3, §8)
- **Decision:** `hooks.server.ts` applies a shared 100/min/IP bucket to `/api` routes that have no limiter of their own (`RATE_LIMIT_API_MAX` env lifts it for test servers only), tags every response with `X-Request-Id`, and maps `SQLITE_BUSY` to `503 BUSY` + `Retry-After: 2` (SvelteKit turns endpoint throws into 500 responses, so `handleError` flags the request and `handle` rewrites the response). Session `lastSeenAt` is written at most every 5 minutes (was every request). A busy DB during session lookup is no longer treated as "signed out".
- **Alternatives:** Per-route limiters; mapping inside every route.
- **Reason:** One place, spec-listed numbers, no write per read.
- **Status:** APPLIED (`tests/hardening.test.ts`).

### D-026: Server startup and shutdown (§5 migration mechanics, §3)
- **Decision:** The SvelteKit `init` hook creates the DB directory, runs `migrateAndCheck` with `MIGRATIONS_PATH`, and installs SIGTERM/SIGINT handlers that run `wal_checkpoint(TRUNCATE)` (3 tries, 1 s apart) then exit 0. The Dockerfile copies `src/lib/db` (scripts import it) and the worker folder and sets `WORKERS_PATH`.
- **Alternatives:** Run `db:migrate` as a separate container step.
- **Reason:** Spec requires migrate-before-listen; a bare `node build` otherwise starts with no tables.
- **Status:** APPLIED; container build not run in this environment.

### D-027: Pages read through `load`, LR layout by transposition (§7.0, §7.6)
- **Decision:** All pages read via `+page.server.ts` using `lib/server/page-load.ts` (`withUser/withTree/withEntity`: same access rules as API routes; anonymous → `/login`, foreign or unknown → 404). Focus/depth/pagination are URL parameters so each is an ordinary load. LR orientation lays out a TB tree of swapped-size boxes and transposes the result, keeping every gap, bus and edge exact.
- **Alternatives:** Client `fetch` for reads (violates §7.0); a second layout implementation for LR.
- **Reason:** Binding paradigm rule; transposition reuses and keeps one engine under test.
- **Status:** APPLIED.

### D-028: Family code regeneration and kinship labels (§6.2, §6.3)
- **Decision:** `GET /api/trees/:id/join-codes` and `POST /api/join-codes` (family only; direct codes come with the join flow) need `manageFamilyCode`; regeneration also needs a verified email. Family codes default to `FAMILY_CODE_DEFAULT_MAX_USES`. Derived relations (grandparent, great-, aunt/uncle, niece/nephew, nth cousin k times removed, in-law) are computed in `kinship.ts` from the BFS path.
- **Alternatives:** Defer to Phase 4.
- **Reason:** §6.2 lists it under tree settings; labels are required by §6.3.
- **Status:** APPLIED.

### D-029: Phase 4 collaboration decisions (§4, §5.1, §6.4–§6.6, §6.10)
- **Claim approval by a code holder:** approving a claim for a user with no membership row creates an active membership with `DEFAULT_JOIN_ROLE` (`joinedViaType='claim'`). The claim and the person link are one immediate transaction around the null-guarded `UPDATE persons … WHERE userId IS NULL`; a UNIQUE failure from `ux_person_user_per_tree` rejects the claim ("already linked") instead of erroring. Other pending claims on the person are rejected in the same transaction.
- **Family joiners' person:** the person created at family-code redemption is linked to the joiner (`userId`, `claimedVia='join_code'`) while the membership is `pending`; `visible_persons` hides it until approval, and rejection deletes it.
- **Verification answers:** attempts are counted before answers are compared (so the 6th try fails even when correct, AT-20) and committed even when the answers are wrong; the window is 24 h per (user, person). Every stored question must be answered, at least `MIN_VERIFICATION_QUESTIONS` must exist. `VERIFICATION_PEPPER` falls back to a fixed dev value only outside production.
- **Revert:** one request is one transaction; rows are checked first (permission per row: contributors own changes only, stale rule per row), then applied. `*Norm` columns are derived: they are recomputed after a date revert and cannot be reverted alone. Reverting a create soft-deletes persons (with snapshot) and deletes other rows; reverting a delete restores from the snapshot after the integrity checks (endpoints visible, no duplicate, no cycle, depth cap). A media delete cannot be restored because its files are removed after commit (409 `REVERT_CONFLICT`); a person delete keeps its media files, so restoring a person restores its photos. `claim` and `tree` rows are `NOT_REVERTIBLE`; a purged person is 410 `PURGED`. Person delete snapshots now include the person's relationships.
- **Notifications:** `edit` notifications to a claimed person are coalesced per (person, editor) while an unread one exists inside `EDIT_NOTIFY_COALESCE_MINUTES`; edits by the claimed person themselves never notify. `join` goes to the direct-code creator, `join_approval` to owner/editors on a family request and to the joiner on the decision.
- **Concurrency tests** spawn four separate Node server processes on one database file, so `BEGIN IMMEDIATE` contention is real; each request carries its own `x-test-ip` (`ADDRESS_HEADER`) so rate limits do not interfere.
- **Registry:** `access: 'code'` routes (join, claim search/submit/questions/verify) are authorised inside the handler (member or valid code holder) and are not part of the probe matrix; `POST /api/join-codes` is registered with `createDirectCode` and a second check (`manageFamilyCode`) for the family type.
- **Not done in Phase 4:** export-level checks of AT-11 (export is Phase 5); public-tree read paths and the PWA (excluded by the brief).
- **Status:** APPLIED.

### D-030: Phase 5 — public trees, privacy filter, exports, GEDCOM, backup, PWA (§4, §6.9, §7.4, §8)
- **Shared plain-ESM modules:** `src/lib/shared/{dates-ad,privacy,gedcom}.mjs` hold the AD date parser, the living/anonymise rules and the GEDCOM reader/writer. The app, the worker threads and the tests import the same files, so an export, an import and a page can never disagree about who is living or what a date means. They live outside `lib/server` because `dates.ts` is also client code; the image copies `lib/shared` next to `lib/server/workers` so the workers' relative imports resolve (`WORKERS_PATH=/app/lib/server/workers`).
- **Privacy filter:** living = `isLiving=1`, or unknown with no death date and born within `LIVING_ASSUMPTION_YEARS` (or birth unknown). A living person keeps only id and tree: name "Living", gender `U`, no dates, places, bio, photo, claim link or account ids. Events and media of living people are dropped; the id and edges stay, but dates and notes on an edge touching a living person are cleared. Account ids (`userId`, `createdBy`, …) are stripped from every export and every public response.
- **Public access:** the four `allowPublic` GET routes and `/photos` use `readAccess`: members get the full view, a signed-in non-member or an anonymous caller sees a public tree filtered, a private or nonexistent tree is the same 401 for anonymous callers (404 for signed-in non-members). A living person's photo is 404 for non-members even in a public tree; a photo is never cacheable by shared caches (`Cache-Control: private`).
- **Exports run in a worker thread** (own read-only connection). Everyone may export through the filter; owner/editor get the full tree unless `excludeLiving`. CSV neutralises cells starting with `= + - @`.
- **Backup:** `GET /api/trees/:id/backup` (owner/editor) is tree-scoped: the full JSON export plus that tree's photos as a tar. A whole-instance snapshot would hand one tree's owner every other tree's data, so instance backups are an operator script (`scripts/backup.ts`, SQLite backup API; `restore.ts` rebuilds the FTS index). This narrows §9's wording on purpose (§0.1.12: §4 and §8 outrank §9).
- **GEDCOM import:** worker thread, one `BEGIN IMMEDIATE` transaction with prepared statements, caps checked before any write (5 MB, 10 000 people, 20 000 relationships → 413 `IMPORT_LIMIT`), parent cycles and depth over the cap rejected as a whole (400). Parentless families with 2+ children become sibling links, and sibling links are written back the same way. Guardian links have no GEDCOM form and are not exported. Every imported entity gets one `create` history row sharing one `batchId` with note `gedcom import`; people get `isLiving` NULL.
- **Event loop under load:** better-sqlite3 waits for a held write lock synchronously, so writers that arrive during an import would freeze every request. `hooks.server.ts` therefore makes unsafe `/api` requests wait asynchronously (a `BEGIN IMMEDIATE`/`ROLLBACK` probe every 20 ms, up to 4.5 s, then `503 BUSY`) before the handler runs; the synchronous `busy_timeout` only covers the remaining race. `/api/health` reports the p99 loop delay since its previous call.
- **PWA:** `service-worker.ts` precaches build assets and static files (a Set: a duplicate URL makes `cache.addAll` reject and the install fail) plus `/offline.html`; pages are network-only with the offline page as fallback; `/api/*` and `/photos/*` are never touched. Icons are generated PNGs.
- **Not done in Phase 5:** onboarding tour (not in the requested list), restore/backup scripts are not exercised inside Docker, no axe run against states behind dialogs.
- **Status:** APPLIED.

### D-031: Phase 6 — maintenance, shutdown, deployment, benchmarks (§3, §6.12, §11, §13)
- **Maintenance:** `maintenance-core.mjs` (plain ESM, own connection) runs in a worker thread from `startMaintenance()` (1 s after init, then every `MAINTENANCE_INTERVAL_HOURS`; timers are `unref`'d). Persons are purged in batches of 200, one short `IMMEDIATE` transaction per batch; dependents cascade, claims/attempts of the person are deleted explicitly, files are removed only after the commit and the emptied person folder is removed. Each step catches its own error, so one failure does not stop the others. "Claim-attempt window ended more than 24 h ago" is read as `windowStart` older than 48 h (windows last 24 h).
- **Shutdown:** the earlier hand-written SIGTERM handler exited immediately and could cut in-flight requests. adapter-node already stops accepting connections, waits for in-flight requests (`SHUTDOWN_TIMEOUT`) and emits `sveltekit:shutdown`; the hook now only checkpoints the WAL there and exits 0. Tested with an import in flight (`tests/shutdown.test.ts`).
- **Production secrets:** the `init` hook throws when `NODE_ENV=production` and `SESSION_SECRET`/`VERIFICATION_PEPPER` are shorter than 32 characters; compose uses `${VAR:?…}` so a missing variable is caught before the container starts. The image now sets `NODE_ENV=production` (it did not, so secure cookies and HSTS were off).
- **Image:** three stages (build, production deps, runtime) so compilers, if a native module has no prebuilt binary for the architecture, never reach the runtime image; `.dockerignore` keeps tests, data and `.env` out of the build context; `init: true`, log rotation, `SHUTDOWN_TIMEOUT=12` inside the 15 s grace period. `docker-compose.pi.yml` caps memory (640 MB, no swap), CPUs (3) and the V8 heap (256 MB). The dev override puts `cloudflared` behind a profile.
- **Benchmarks:** `scripts/bench.ts` measures over loopback HTTP with the built server (the same code path production runs), seeds directly in SQL, and uses `x-bench-ip` as `ADDRESS_HEADER` so the per-IP limiters do not distort latency. It reads RSS from `/proc` (Linux only) and reports numbers rather than asserting them; it exits non-zero only when search p95 exceeds 3× its target (§3).
- **Defects the benchmark exposed (fixed):** (1) `damerauLevenshtein` in `utils/fuzzy.ts` omitted the substitution cost, so every substitution was free (`abc`~`abd` = 0, kitten~sitting = 1): fuzzy search and the claim matching score were too permissive; it now returns true Damerau-Levenshtein values (tests: `tests/fuzzy-core.test.ts`). (2) The fuzzy worker had its own copy of the distance with a local `deadline = 0` that made every comparison throw, so the live fuzzy fallback never returned a hit; it now shares `shared/fuzzy-core.mjs` (bounded distance, per-query memo, deadline checked every 256 rows) and has a live HTTP test. (3) Tree stats and the focus view took 0.8–1 s on 50 000 people: the planner scanned the whole tree's links for every level, so graph queries pin `ix_rel_p1`/`ix_rel_p2` (`INDEXED BY`), "either end" lookups are two index probes instead of an `OR`, `generationDepth` is level-batched, visible-people counts avoid the per-row view check, and roots come from one anti-join. (4) `sharp` and `nodemailer` load on first use (about 25 MB each). (5) The image runs `node --max-semi-space-size=2`, which roughly halves resident memory.
- **Load definition:** R-PERF-7 is measured while a GEDCOM import at the caps commits and 8 clients send about 80 requests/s in total; a single-threaded server saturates well above that and loop delay then only measures queueing. The 12-client, no-think-time run of the earlier benchmark is not representative of a family.
- **Whole-tree reads:** the tree view and stats on a 50 000-person tree take ~120–420 ms (one anti-join over the links plus bounded traversals); R-PERF-2 is about typical reads, so these are reported separately rather than against the 25 ms target.
- **Not verified here:** no Docker on the development machine, so the image, compose files, `backup.sh`/`restore.sh` and the Pi settings were reviewed but not executed; the Pi numbers are the owner's to measure.
- **Status:** APPLIED.

### D-032 — 2026-10-02 — Post-audit fixes and deployment (§3, §6.1, §6.10, §6.12, §7.2, §8, §11)
- **Deployment verified in Docker:** image builds, the container is healthy, data survives a rebuild, `docker compose stop` exits 0 in under 0.5 s, the `backup.sh` → change → `restore.sh` drill restores the snapshot, and cloudflared serves the app on the owner's hostname with the production compose file (no host port). `restore.sh` was broken (it copied files into the stopped service container, then ran the restore in a new one-off container): it now bind-mounts the backup files read-only into the one-off container. Scripts call `node_modules/.bin/tsx`; bare `tsx` is not on the container's PATH.
- **Mail:** compose passes unset optional variables as empty strings, so `SMTP_PORT=""` became port 0; the mailer now treats empty as unset, requires STARTTLS on 587, and never throws (callers fire and forget, so an SMTP failure can neither crash the process nor reveal through timing or a 500 whether an account exists). Production logs a warning at start when SMTP is unset.
- **Origin check:** compares the header string with `new URL(ORIGIN).origin`; `null` or junk is a mismatch (403 `FORBIDDEN`, was a 500 from an unguarded `new URL`). `RATE_LIMIT_API_MAX` is ignored when `NODE_ENV=production`.
- **Purge and history:** when maintenance purges a person, their history rows stay (who, when, what kind) but values and snapshots that mention them are nulled. Reverting such a row reports `PURGED`.
- **Main-thread budget:** the focus view loaded every link of the tree and filtered in JS (~200 ms on 50 000 people); it now asks for links between the shown people through `ix_rel_p1`. Chain roots, generation depth and the visible count are memoised per tree behind an index-only fingerprint (link count + newest link rowid, live person count, newest soft-delete time, non-active member count), so they are recomputed only after a change. Measured over HTTP on 50 000 people: tree view p95 59 ms, stats p95 70 ms (were 436 ms); the first read after a change still pays one full scan.
- **Preferences:** `themePref` is applied from the account on every device (the inline script only prevents a flash) and the header toggle saves it. `notifyPrefs` is `{ [type]: boolean }` with a missing key meaning on; `notify()` skips muted types; corrupt JSON fails open.
- **Onboarding:** four-step tour on the home page for a user with no trees; dismissal is per browser (`localStorage`), which is enough for a one-time hint and needs no schema change.
- **UI gaps closed:** relationship edit/remove and "link an existing person" (person page), in-place event edit, "How are we related?", search filters (birth year, place), `PersonCard`, skeleton while the canvas chunk loads.
- **Status:** APPLIED.

### D-033 — 2026-10-02 — UI framework and middle name (§2, §5.1, §7)
- **Decision:** adopt shadcn-svelte (bits-ui 2.19.4, tailwind-variants 3.3.1, cn 0.4.0, @internationalized/date 3.12.4; shadcn-svelte 1.7.0 and tw-animate-css 1.4.0 as build-time dev dependencies) for a consistent, professional look requested by the owner. Generated components live in `src/lib/components/ui/` (lint-ignored, excluded from the plain `tsc` pass via `tsconfig.tsc.json`; svelte-check covers them). Tokens keep the §7.1 colours and radii (inputs 10, buttons 12, cards 16, modals 20) and 44 px touch targets; new token pairs are in `utils/contrast.ts`. Plain element styles sit in `@layer base` and skip `[data-slot]`, so shadcn components and utilities always win. Native `<dialog>` and `<select>` are kept (accessible, and the tests address them by role and label). Desktop: sidebar with the current tree's sections; tablet/mobile: section tabs; mobile: bottom nav.
- **Middle name:** nullable `persons.middleName` (migration 0004), included in the FTS name column (triggers recreated), fuzzy search, duplicate finder, display names (`fullName()` in `utils/format.ts`), exports and GEDCOM `GIVN`/`NAME` (GEDCOM has no separate middle-name tag, so an import keeps all given names in `firstName`), and anonymised to null for living people.
- **Alternatives:** Skeleton UI or Flowbite (heavier, different token model); hand-written CSS only (what existed, judged not production-grade).
- **Status:** APPLIED.

### D-034 — 2026-10-02 — Owner self-claim, unlimited family codes, person form (§5.1, §6.4, §6.5)
- **Owner self-claim:** the owner reviews claims, so a claim by the tree's owner is applied in the same transaction (`submitClaim` → `applyClaim`, status `approved`, reviewer = owner). The person page shows the owner a single "This is me" button. Everyone else keeps the review flow.
- **Avatar on claim:** when any claim is applied, a user without an avatar takes the claimed person's photo; an existing avatar is never replaced.
- **Family codes:** unlimited by default (`FAMILY_CODE_DEFAULT_MAX_USES = null`; migration 0005 clears the limit on existing family codes). Overrides the §1 default of 50 at the owner's request. Approval of each join request still applies, and direct codes stay single-use.
- **Person form:** names and gender are always shown; dates, places, maiden name, status and biography sit behind "More details". Death date and place appear only when the status is Deceased; a stored death date implies Deceased. Choosing Living clears the death fields on save, while Unknown leaves them unchanged. Date inputs have a help tooltip and use native validity: a value `parseDate` cannot read blocks the submit with the list of accepted formats. The add-person dialog takes an optional photo, uploaded as the primary photo once the person exists. Dialog buttons: Cancel on the left, the primary action on the right.
- **Status:** APPLIED.

## Template for future entries (per §0.1.4)```markdown
### D-XXX — YYYY-MM-DD — Title (§ref)
- **Decision:**
- **Alternatives:**
- **Reason:**
- **Status:**
```

## D-035: Combined family view instead of merging trees

- **Decision:** A user whose profile is claimed in two or more trees (up to 3) gets `/families/:userId`, a read-only page that draws those trees joined at their own person, with a colour per tree. They choose who may open it: only themselves (default), members of at least two of the trees, or people they pick from their co-members. They also set a generation limit (default: everything recorded); viewers can narrow it further. A viewer sees a tree's side only if they are a member of that tree. Tree owners can opt their tree out (`trees.allowCrossTree`).
- **Reason:** Marriages connect families, but a merge (non-goal, §1) would mix members, permissions, claims and history. Joining at a verified claimed person shows both families without copying data or widening anyone's access.
- **Status:** Implemented (migration 0006, `src/lib/server/combined.ts`, `tests/combined.test.ts`, e2e in `tests/e2e/tree.spec.ts`).
