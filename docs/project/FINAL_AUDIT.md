# FINAL_AUDIT.md — Collaborative Family Tree (SPECS.md v4.0)

Audit date: 2026-10-02. Reviewer: code review against `SPECS.md`, `DECISIONS.md` and the repository.
Rule followed: an item is **passed** only if a command run during this audit verified it. Items checked by reading code are marked **reviewed (not executed)**. Nothing was fixed during the audit.

Machine: Intel i5-2520M × 4, 7.6 GiB, Debian (Linux 6.12), Node v24.21.0. Docker is **not installed** on this machine.

---

## 1. Commands run and their real output

| Command | Result (quoted) |
|---|---|
| `npm run check:ci` (svelte-check + `tsc --noEmit`) | `COMPLETED 5036 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`; tsc silent (exit 0) |
| `npm run lint` | no findings (exit 0) |
| `npm run build` | succeeded |
| `npx vitest run` (full suite) | `Test Files 1 failed \| 24 passed (25)` — `Tests 164 passed (164)`. The failing *file* is a teardown error, not a test: `Error: ENOTEMPTY, Directory not empty: ./.test-tmp-access` in `afterAll` (tests/access.test.ts:219) |
| `npx vitest run tests/access.test.ts` (re-run alone) | `Test Files 1 passed (1)`, `Tests 5 passed (5)` |
| `npm run check:traceability -- --phase 6` | `traceability ok: 47 ATs in scope for phase 6, all covered` |
| `npm run contrast` | `all contrast pairs pass` |
| `CI=1 npm run test:e2e` | `17 passed (1.8m)`; `R-PERF-4 500-node layout+render: 250 ms` |
| `npm ls` | exit 0 (no missing/extraneous/invalid packages) |
| `npm audit --omit=dev` | `3 low severity vulnerabilities` (`cookie <0.7.0`, GHSA-pxg6-pf52-xh8x, via `@sveltejs/kit` 2.70.3 and `@sveltejs/adapter-node` 5.5.7); exit 1 |
| `npm run bench` | see §6 (all targets met on this machine) |
| gzip size of `build/client/_app/immutable/entry/*.js` + directly imported chunks | `45911 bytes` |
| Manual probe of a built server (`node build`, curl) | see §5 (one 500 found) |
| Route inventory script (each §9 row → `+server.ts` exports the method) | `section 9 routes missing: [] of 65` |
| `grep -rnE "TODO\|FIXME\|XXX" src scripts tests` | no matches |
| `sh -n scripts/backup.sh scripts/restore.sh` | syntax ok (behaviour reviewed, see §7) |

---

## 2. Dependency versions (§2)

`package.json` was compared with every row of the §2 table: **all 33 pins match exactly** (`@sveltejs/kit` 2.70.3, `svelte` 5.57.1, `@sveltejs/adapter-node` 5.5.7, `@sveltejs/vite-plugin-svelte` 7.3.1, `vite` 8.3.1, `typescript` 6.0.3, `svelte-check` 4.7.6, `tailwindcss`/`@tailwindcss/vite` 4.3.3, `@lucide/svelte` 1.49.0, `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11, `better-sqlite3` 13.0.3, `@types/better-sqlite3` 9.6.0, `zod` 4.6.5, `bcryptjs` 3.0.3, `d3-zoom` 3.0.0, `d3-selection` 3.0.0, `d3-shape` 3.2.0, `nodemailer` 10.0.13, `sharp` 0.35.5, `tar-stream` 3.2.1, `nepali-date-converter` 3.4.0, `vitest` 5.0.3, `@playwright/test` 1.63.0, `@axe-core/playwright` 4.13.0, `@types/node` 22.20.4, `tsx` 4.23.15 (production dependency, as required), `eslint` 10.11.0, `typescript-eslint` 8.71.0, `eslint-plugin-svelte` 3.23.0; `@eslint/js` 10.0.1 and `globals` 16.5.0 recorded in D-007a). No `d3-dag`, no `d3-hierarchy`, no `lucide-svelte`.

Extra dev dependencies not in §2: `@types/d3-selection` 3.0.12, `@types/d3-zoom` 3.0.9 (types only).

Findings:
- **Runtime mismatch on the dev machine:** Node v24.21.0 here; §2 requires 22.x. The Dockerfile pins `node:22-bookworm-slim`, but no build under Node 22 was run in this audit. `package.json` has no `engines` field to enforce 22.
- **`npm audit`: 3 low** — `cookie <0.7.0` reached through the pinned Kit/adapter versions. The only fix offered is Kit 3 (breaking, outside the pins). Risk is low (cookie *names/paths* with out-of-range characters; the app sets fixed names).

---

## 3. Acceptance tests (§12)

All 47 AT ids have at least one test titled with the id (`check:traceability` passed), and every test in the full Vitest and Playwright runs passed.

| AT | Where | AT | Where |
|---|---|---|---|
| 01–03 | concurrency.test.ts (4 server processes, one DB file) | 25 | dates.test.ts |
| 04, 05, 06, 08, 10, 11, 20, 21, 43 | collab.test.ts | 26 | search, fuzzy-core, phase5 (live HTTP fuzzy) |
| 07, 09 | access.test.ts (registry matrix, live server), trees.test.ts | 27 | media.test.ts |
| 12, 31, 44 | collab.test.ts + concurrency.test.ts (HTTP) | 28 | contrast.test.ts |
| 13–15, 38, 41, 42 | trees.test.ts | 29 | access.test.ts, registry.test.ts |
| 16, 17 | media.test.ts (live server) | 30, 45 | e2e/quality.spec.ts (Playwright, axe) |
| 18, 36 | auth.test.ts | 32, 33, 23, 24 | phase5.test.ts (live server) |
| 19 | rate-limit.test.ts | 34, 46 | maintenance.test.ts |
| 22 | backup.test.ts, phase5.test.ts, shutdown.test.ts (CLI) | 35 | fts.test.ts, migrations.test.ts |
| 37 | layout.test.ts | 39 | import-load.test.ts |
| 40 | search.test.ts | 47 | csp.test.ts |

### Missing or weak tests

1. **AT-11 (export leg):** the AT names "tree/search/export/stats/traversal". Tree, search, stats, traversal and the `visible_persons` view are tested; **no test asserts a pending person is absent from an export** (export code reads `visible_persons`, reviewed only).
2. **AT-29 for `/photos`:** the registry probe matrix only probes `access: 'tree'` entries; `/photos/[...path]` is `session` and is covered by AT-17 instead, not by the generated matrix.
3. **AT-31 tiers 2 and 3 over HTTP:** only the first tier (5 failures → 900 s) is exercised over HTTP; the 1 h / 24 h tiers are verified at the limiter level with injected time.
4. **AT-22 restore inside Docker:** restore logic is tested (functions and CLI); `scripts/restore.sh` is not (and is defective, §7).
5. **Flaky teardown:** `tests/access.test.ts` `afterAll` can race the killed server (ENOTEMPTY) — observed in this audit's full run; the tests themselves passed.
6. **No test** for: `Origin: null` / malformed Origin handling (see §5), theme preference application, notification preferences, relationship edit/delete UI, event edit UI.
7. **AT-30 coverage:** axe runs on 18 pages in light and dark mode, but not on states behind open dialogs (lightbox, add-person sheet, confirm dialog).

---

## 4. Requirements by section

Legend: **PASS** = verified by a command in §1 (named test or probe). **PARTIAL** = some part verified, a part missing. **FAIL** = verified missing or broken. **NOT VERIFIED** = reviewed only, could not be executed here.

### §0 Operating rules / §14 Definition of done
- PASS: required npm scripts all present (script check), `check`, `lint`, `test`, `check:traceability` green, no TODO/FIXME, traceability script rejects skip/only.
- PASS: Zod 4 forms, Svelte 5 runes (svelte-check strict, lint).
- PARTIAL: §0.1.6 reply format and DECISIONS entries exist (D-001…D-031); conflicts are recorded.

### §3 Non-functional
- PASS: SQLite pragmas (AT-35 smoke), `immediate` transactions, `SQLITE_BUSY → 503 BUSY + Retry-After: 2` (hardening.test.ts), password-hash concurrency limit (AT-36), workers for import/export/fuzzy/maintenance, graceful shutdown with WAL checkpoint and in-flight completion (shutdown.test.ts), event loop under import (AT-39).
- **FAIL: "Any single request must stay within `MAIN_THREAD_BLOCK_BUDGET_MS` (50 ms)"** — `GET /api/trees/:id` and `/stats` on a 50 000-person tree take p95 **436 ms** of synchronous main-thread work (bench, §6). Typical reads are within budget.

### §4 Roles and permissions
- PASS: matrix as data, every tree route probed (AT-07/09/29), 404 for non-members/pending/rejected (AT-09/10), contributor own-revert only (AT-08), owner cannot leave/be removed (AT-42), direct-code role cap (AT-44), public-tree anonymous rules (AT-32/33).

### §5 Database
- PASS: schema incl. partial unique indexes and `CHECK` (trees.test.ts "DB invariants"), FTS map table/triggers/Devanagari tokenchars (AT-35, AT-26), migrations fresh + upgrade (AT-35), `visible_persons` (AT-11), FTS consistency rebuild at start (AT-35, shutdown/startup tests).
- PASS: history: batch rows, snapshots, stale rule, revert by kind, 410/409 codes (AT-05/06/43).

### §6 Features
- 6.1 Accounts — PASS: register/login/logout/forgot/reset/verify/resend/password/Google (mocked)/account deletion (AT-18, AT-36, AT-42). **PARTIAL: `themePref` is stored but never applied** — the theme comes only from `localStorage` (`app.html`, layout toggle); §7.2 requires the manual toggle to persist in `themePref` and `localStorage`. **`notifyPrefs`** is stored but has no UI and does not affect notifications.
- 6.2 Trees — PASS (create with family code, dashboard cards, settings, members, transfer, delete with files, stats).
- 6.3 Persons/relationships/dates — PASS for API, versioning, audit, derived relations (kinship.test.ts), BS/AD parsing (AT-25), date display preference (e2e). **PARTIAL (UI):** no UI to edit or delete a relationship, to link two existing people, to edit an event, or to ask "How are we related?" (APIs exist and are tested).
- 6.4 Join codes — PASS (AT-01/02/12/31/44, e2e join flow).
- 6.5 Claiming — PASS (AT-03/04/20/21, e2e claim flows).
- 6.6 Audit/revert — PASS (AT-05/06/08/43, undo toast e2e).
- 6.7 Media — PASS (AT-16/17/27/33, EXIF strip and thumbnail in media.test.ts).
- 6.8 Search — PASS (AT-26, filters in search.test.ts, live fuzzy). **PARTIAL (UI):** name/birth-year/place filters are API-only.
- 6.9 Import/export — PASS (AT-23/24/39, CSV formula neutralisation). **Deviation (recorded D-030):** `GET /api/trees/:id/backup` is tree-scoped JSON + photos, not a SQLite snapshot; the snapshot is the operator script.
- 6.10 Notifications — PASS (collab.test.ts, e2e bell/notifications).
- 6.11 Traversal limits — PASS (AT-38, AT-40).
- 6.12 Maintenance — PASS (AT-46, startup pass in shutdown.test.ts).

### §7 Frontend
- PASS: CSP nonce/headers (AT-47, AT-30), contrast (AT-28), axe WCAG 2/2.1 A+AA on 18 pages light/dark (AT-30), PWA shell (AT-45), layout engine and focus mode (AT-37, AT-40, e2e).
- **FAIL: §7.3 `OnboardingTour (4 steps)`** — not implemented (§7.5 also lists onboarding).
- **PARTIAL: §7.3 components** — no `PersonCard`; `SkeletonLoader` exists as `src/lib/components/shared/Skeleton.svelte` but is **not used anywhere**; `BottomNav/TopBar/Sidebar` are combined in `AppNav.svelte` + layout header (functional equivalents).
- **PARTIAL: §7.0** "services return typed results `{ ok, data } | { ok: false, code, status }`": most services return `{ error }` unions; some routes contain authorisation logic beyond "thin wrapper" (e.g. `/photos`, `DELETE /api/join-codes/:id`). Behaviourally correct (tests pass), structurally not as specified.
- **PARTIAL: §10 structure** — `components/ui/` and `components/layout/` folders do not exist.

### §8 Security — see §5 below.

### §9 API contract
- PASS: all 65 listed method+route pairs exist (inventory script); every `+server.ts` has a registry entry (AT-29); error envelope and codes covered by route tests.

### §11 Deployment — NOT VERIFIED (no Docker). See §7.

### §13 Checkpoints
- PASS: Phase 1b–5 AT sets; Phase 6 AT-34/AT-46; `BENCHMARKS.md` reports R-PERF-7 and R-PERF-8.
- **NOT VERIFIED:** Phase 1a "`docker compose build`; container boots and `/api/health` returns OK"; Phase 6 "clean-clone `docker compose up -d`", "backup → wipe → restore drill" (done with the Node scripts, not with Docker), "cold-start and memory measurements" (done on bare Node, not in the container).

---

## 5. Security

### Verified controls (by tests or probes in this audit)
- Session tokens hashed (SHA-256), `httpOnly`, `sameSite=lax`, `secure` in production; rotation on login; sessions wiped on password reset/change (AT-36).
- bcryptjs cost 12 (`passwords.ts`), dummy compare for unknown/OAuth-only users, 72-byte cap (AT-36).
- Rate limits and lockouts (AT-18, AT-19, AT-31, hardening.test.ts 100/min/IP), proxy IP from `ADDRESS_HEADER` only.
- CSP with per-response nonce and no `unsafe-inline` in `script-src` (AT-47; header seen in the manual probe), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` (probe), HSTS in production (code).
- Cross-site `Origin` → 403 (probe); cross-site form post without Origin → 403 (Kit CSRF, probe).
- Uploads: magic bytes, size, pixel cap, re-encode/EXIF strip, path guard (AT-16); photos private, never `public` cache (AT-17, AT-33).
- Public trees and exports filtered; account ids stripped (AT-23, AT-32, AT-33).
- Production refuses to start with short secrets (shutdown.test.ts).
- Verification answers HMAC-peppered, attempts persisted (AT-20); claim races (AT-03/04).

### Concerns (most severe first)

1. **Malformed `Origin` header crashes the request (500).** Verified: `POST /api/auth/login` with `Origin: null` → **500**, and with `Origin: not a url` → **500** (`TypeError: Invalid URL` in the server log). Cause: `new URL(origin)` in `src/hooks.server.ts` (Origin check) is not guarded. Browsers send `Origin: null` from sandboxed iframes, `file:` pages and some privacy modes. Impact: noisy 500s, error-log flooding by any client; the request is still refused, so no bypass.
2. **Origin check skips requests without an `Origin` header** (`if (origin && …)`). Browsers send Origin on cross-site POST/PUT/DELETE, so this is acceptable in practice, but non-browser clients are unrestricted (they still need a session cookie). The 403 also uses code `VALIDATION` (a 400 code in §8's list).
3. **`RATE_LIMIT_API_MAX` env can disable the shared API limit in production.** Documented as test-only, but nothing prevents it in production (`hooks.server.ts`).
4. **Reset/verification links are logged when SMTP is unset** (spec §6.1). In Docker this places live reset tokens in container logs; anyone with `docker logs` access can take over accounts. Acceptable per spec, but operators must be told (DEPLOYMENT.md mentions links go to the log, not the risk).
5. **History snapshots outlive the hard purge.** `changeHistory.snapshot` keeps the full row (names, dates, places, bio) of persons that the maintenance job purged, indefinitely. Not forbidden by the spec; a privacy/retention issue.
6. **Uploads buffered in memory** (by design, §6.7): several concurrent 10 MB uploads plus sharp work on a 1 GB Pi can exhaust memory (`mem_limit` 640 MB in the Pi override would restart the container rather than freeze the host).
7. **In-memory rate limits and lockouts** reset on restart (documented trade-off, §8).
8. **Leftover debug code:** `event.request.headers.set('x-client-ip-debug', …)` after the response in `hooks.server.ts:174` — no effect on output, but should not be in production code.
9. **`npm audit`: 3 low** (`cookie` via Kit 2.70.3), see §2.

---

## 6. Performance (`npm run bench`, this audit's run, dev machine)

| ID | Target | Measured | Verdict |
|---|---|---|---|
| R-PERF-1 initial JS gzip | < 250 KB | 45 911 bytes gzip (entry + chunks it imports directly; measured on this audit's build); tree canvas is a dynamic import | PASS |
| R-PERF-2 typical read p95 (person, relatives) | < 25 ms | 12.1 ms | PASS |
| R-PERF-2 whole-tree reads p95 (tree view, stats, 50 000 people) | — | 436.3 ms | reported; violates §3 50 ms block budget |
| R-PERF-3 FTS p95 | < 150 ms | 13.1 ms | PASS |
| R-PERF-3 fuzzy p95 | < 300 ms | 234.1 ms | PASS |
| R-PERF-4 500-node layout+render | < 500 ms | 250 ms (Playwright), Vitest layout test passed | PASS |
| R-PERF-5 cold start | < 2 s | 1382 ms (empty DB), 1600 ms (50 000 people) | PASS (bare Node; not in container) |
| R-PERF-6 RSS steady state | ≤ 200 MB | 129.1 MB | PASS (bare Node with `--max-semi-space-size=2`) |
| R-PERF-6 RSS peak (import + 8 clients) | reported | 362.4 MB | reported |
| R-PERF-7 loop delay p99 under import + load | < 100 ms | 37 ms | PASS (load = 8 clients, ~80 req/s; definition is ours, D-031) |
| R-PERF-8 import at caps | < 5 s | 3642 ms | PASS |

### Concerns
1. **Main-thread blocking on large trees:** tree view / stats spend ~120–440 ms synchronously on the main thread for 50 000 people; while one runs, every other request waits. Fails §3's per-request budget.
2. **All numbers are from a laptop CPU.** The target is a Raspberry Pi 4; expect several times slower CPU-bound results. R-PERF-5 (1.6 s here) and R-PERF-3 fuzzy (234 ms here, 300 ms worker deadline) are the most likely to miss on the Pi. Not measured.
3. **Load definition chosen by the implementer:** at 12 clients with no think time (an earlier run) loop delay p99 was 114–214 ms; the reported 37 ms is at ~80 req/s.
4. **Peak RSS 362 MB** during a capped import is above half of the Pi override's 640 MB limit; two imports or uploads in parallel were not measured.
5. **Fuzzy search reads every name of the tree per query** (spec-mandated, no cache) — linear in tree size.

---

## 7. Production deployment readiness

Verdict: **not ready to declare production-ready.** The application passes its full test suite, but the container path was never executed and the restore script is broken.

| Item | Status |
|---|---|
| `Dockerfile` (3 stages, non-root, `NODE_ENV=production`, healthcheck via `node -e fetch`, `STOPSIGNAL`, `SHUTDOWN_TIMEOUT` 12 s < grace 15 s) | NOT VERIFIED — reviewed only, no Docker on this machine |
| `docker-compose.yml` (`expose` only, no `ports`, `${VAR:?}` required vars, `init`, log rotation, cloudflared after healthy app) | NOT VERIFIED — reviewed only |
| `docker-compose.pi.yml` (640 MB, 3 CPUs, V8 heap 256 MB) | NOT VERIFIED on a Pi |
| `scripts/backup.sh` | reviewed: plausible (`exec` → `tsx scripts/backup.ts /tmp/backup` → `docker cp` out); NOT VERIFIED |
| **`scripts/restore.sh`** | **FAIL (by review):** it `docker cp`s the backup into the *stopped service container's* `/tmp`, then runs the restore in a **new one-off container** (`docker compose run --rm`) that does not have those files; it also mounts `-v "$(pwd):/dev/null:ro"`, a meaningless bind onto `/dev/null`. The documented restore drill would fail. |
| Restore logic itself (`scripts/restore.ts`, migrate + FTS rebuild + photos) | PASS (backup.test.ts, shutdown.test.ts CLI run) |
| Graceful shutdown, startup migrations, maintenance at start, production secret check | PASS on bare Node (shutdown.test.ts, hardening.test.ts) |
| Node 22 runtime | NOT VERIFIED (dev runs Node 24; image pins 22) |
| `docker-compose.dev.yml` | works only with a dummy `CLOUDFLARE_TUNNEL_TOKEN` because `${…:?}` is evaluated for profiled-out services (documented) |
| Documentation (README, DEPLOYMENT.md, BENCHMARKS.md, Cloudflare settings, cron, restore drill) | present; restore drill depends on the broken `restore.sh` |

---

## 8. Summary

**Passed (verified):** 47/47 AT ids covered and passing; 164 Vitest tests and 17 Playwright tests passing; type check, lint, build, contrast, traceability; dependency pins exact; all 65 §9 routes present; R-PERF-2 (typical), 3, 4, 5, 6, 7, 8 on the dev machine; core security controls (sessions, hashing, CSP, CSRF, rate limits, lockouts, upload validation, private photos, privacy filter).

**Failed:**
1. `scripts/restore.sh` cannot work (one-off container lacks the copied files; bogus `/dev/null` mount).
2. Malformed `Origin` header → HTTP 500.
3. §3 main-thread budget exceeded by whole-tree reads on large trees (436 ms p95).
4. §7.3/§7.5 OnboardingTour missing.
5. §7.2/§6.1 `themePref` never applied; `notifyPrefs` unused.

**Partial / deviations:** UI gaps for relationship edit/delete, linking existing people, event edit, relation finder, search filters; `PersonCard` missing, `Skeleton.svelte` unused; §7.0 service result shape; §10 folder layout; tree-scoped backup route (D-030, intentional).

**Not verified:** anything requiring Docker or a Raspberry Pi; Node 22 build; Cloudflare Tunnel; SMTP; Google OAuth against Google.

**Missing tests:** AT-11 export leg; `/photos` in the generated AT-29 matrix; AT-31 tiers 2–3 over HTTP; `restore.sh`; malformed Origin; theme/notification preferences; axe on dialog states. Flaky teardown in `tests/access.test.ts`.

## 9. Follow-up fixes (2026-10-02)

Verified with commands after the audit:

- `scripts/restore.sh` rewritten: the backup files are bind-mounted read-only into the one-off restore container. A full drill in Docker passed: `backup.sh`, then a tree created after the backup, then `restore.sh`; afterwards only the pre-backup tree remained.
- `scripts/backup.sh`, DEPLOYMENT.md and README.md now call `node_modules/.bin/tsx`; bare `tsx` is not on the container's PATH (`which tsx` printed nothing).
- A malformed or `null` Origin now returns 403 instead of 500 (`tests/hardening.test.ts`, and `curl` against the container).
- `RATE_LIMIT_API_MAX` is ignored when `NODE_ENV=production`.
- The leftover `x-client-ip-debug` header line was removed.
- The mailer treats empty compose variables as unset; previously `SMTP_PORT=""` became port 0. It requires STARTTLS on 587 and never throws. Sending the reset email is fire-and-forget, so an SMTP outage cannot crash the process or reveal whether an account exists. Brevo SMTP login was verified with `transport.verify()`.
- The login page shows "Continue with Google" when Google OAuth is configured, and shows an error after a failed OAuth callback.
- The `access.test` teardown flake is fixed: live tests wait for the server process to exit before removing the temp directory (`stopServer` in `tests/helpers.ts`).
- Docker: the image builds (node 22.23.3) and the container becomes healthy. Data persisted across an image rebuild. `docker compose stop` took 387 ms with exit code 0. cloudflared registered 4 tunnel connections and all prechecks passed.
- Gates: check:ci 0 errors, lint clean, build ok, Vitest 165/165, traceability (phase 6) 47/47, contrast pass, e2e 17/17.

Still open: Cloudflare public hostname and `ORIGIN` (needs the domain), a real SMTP send (needs a Brevo-verified sender), and the feature gaps in §4 (OnboardingTour, themePref/notifyPrefs, relationship/event edit UI, relation finder UI, search filters).

## 10. Second follow-up (2026-10-02): live deployment, missing features, UI

Verified with commands:

- **Live:** `https://family-test.chandanshakya.com.np` is served by the production compose file. cloudflared is the only way in; the app has no host port, and `curl localhost:3000` fails as intended. Public pages return 200; the signed-in pages were checked with the same image on a scratch copy of local data, and all 12 return 200 with no logged errors.
- **SMTP:** Brevo accepted a test message from the container (`250 2.0.0 OK: queued`), and a registration over the public URL logged no send failure. Delivery to the inbox is the owner's to confirm.
- **Missing features:** onboarding tour; theme preference applied and saved; notification preferences (UI and delivery); relationship edit and remove; linking an existing person; in-place event edit; "How are we related?"; search filters; `PersonCard`; skeleton while the tree canvas loads. Each has a Playwright test (`tests/e2e/features.spec.ts`).
- **Missing tests:** AT-11 export leg (`collab.test.ts`); `/photos` in the AT-29 access suite (`access.test.ts`); axe with dialogs open in light and dark (`quality.spec.ts`); notifyPrefs; middle name; whole-tree scan cache invalidation; malformed Origin.
- **Security:** purged people no longer survive in history values or snapshots. Bad-origin requests get 403 with code `FORBIDDEN`. Production warns at start when SMTP is unset.
- **Performance:** the 50 000-person tree view went from p95 436 ms to 59 ms and stats to 70 ms (`BENCHMARKS.md`). The first read after an edit still runs one full scan of about 100 ms.
- **UI:** shadcn-svelte, with the §7.1 tokens, radii and 44 px targets, plus a sidebar, section tabs and a bottom nav. Every page was reviewed in light and dark and at desktop and phone sizes; contrast pairs and axe pass.
- **Middle name:** migration 0004, search, display, exports, GEDCOM, and the privacy filter.
- **Dependency defect found by deploying:** shadcn's installer had also listed four runtime packages under `devDependencies`, so `npm ci --omit=dev` left them out and every page returned 500 in the container while all local tests passed. Fixed, and `tests/deps.test.ts` now fails when a package the server bundle imports is not a production dependency, or when a version is not pinned.
- **Gates:** check:ci 0 errors, lint clean, Vitest 172/172, e2e 27/27, contrast pass, traceability 47/47.

Still open: Raspberry Pi measurements; Google OAuth (waiting for credentials).
