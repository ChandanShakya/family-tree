# Contributing

Thank you for helping. This guide covers setup, conventions and how changes are reviewed.

## Getting started

1. Fork the repository and clone your fork.
2. Install Node 22 or newer, then run `npm ci`. Versions are pinned exactly; `npm ci` keeps them.
3. Run `npm run dev` and open http://localhost:5173.
4. For browser tests, run `npm run test:e2e:setup` once.

## Before you open a pull request

Run the same checks as CI:

```bash
npm run check:ci        # svelte-check + tsc
npm run lint
npm run build
npm test                # Vitest (needs the build: some tests start the built server)
npm run test:e2e        # Playwright
npm run contrast        # colour contrast of the design tokens
npm run check:traceability -- --phase 6
```

## Conventions

- **Svelte 5 runes only.** No legacy `$:` statements or stores for component state.
- **Reads** go through `+page.server.ts` loads; **writes** go through `fetch` to `/api/*` followed by `invalidateAll()`.
- **Every API route** needs an entry in `src/lib/server/route-policies.ts`; the access tests probe them all.
- **Database changes** need a migration (`npm run db:generate`, then review the SQL) and must keep the full-text index triggers in sync.
- **Dependencies** are pinned exactly (`npm install --save-exact`). Anything the server imports at runtime belongs in `dependencies`, not `devDependencies` (`tests/deps.test.ts` checks this).
- **UI:** use the components in `src/lib/components/ui` (shadcn-svelte) and the design tokens in `src/app.css`. Keep 44 px touch targets, and add a contrast pair to `src/lib/utils/contrast.ts` for any new colour pair.
- **Tests:** new behaviour needs a test. Acceptance tests are named after their id (`AT-12: …`).
- **Decisions:** a choice that deviates from or adds to the specification gets an entry in `docs/project/DECISIONS.md`.

## Commits and pull requests

- Use short, imperative commit subjects, for example `fix: keep death fields hidden for living people`. Conventional Commit prefixes (`feat`, `fix`, `docs`, `chore`, `test`, `refactor`) are preferred; release notes are grouped by pull request label.
- Keep each pull request to one topic, and fill in the template.
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Reporting bugs and requesting features

Use the issue forms on GitHub. For security problems, follow [SECURITY.md](SECURITY.md) and do not open a public issue.
