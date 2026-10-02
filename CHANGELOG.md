# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Focus view** on the tree page: the chart, search, selection actions (Add relative, Link with…) and Add person fill the screen; Esc or ✕ leaves it.
- Tree cards show gender with a coloured bar and ♂/♀/⚧ mark.

### Fixed

- Parents are centred over their children; the chart opens centred across the generations in both orientations.
- Toasts show above the focus view.

## [0.2.0] - 2026-10-02

### Added

- **My families:** a person claimed in several trees sees them joined at themselves, with generation limits, sharing (only me, members of two trees, chosen people), same-person matches across trees, a cross-tree "How are we related?", sharing history and a share notification. Owners can opt a tree out. Migrations 0006 and 0007.
- **Implied links:** adding a relative offers the links that follow (the spouse as other parent, the new spouse as parent of existing children, siblings' parents, a second parent as spouse); **Link with…** links two existing people the same way.
- Tree setting changes appear in the tree's activity.
- "How it works" on the landing page and README, a GitHub link, a new one-minute demo video, and a new favicon and app icons.

### Fixed

- Bikram Sambat dates were not converted in the production build (CommonJS import); existing dates are repaired at startup.
- Viewers no longer see add, edit, delete or upload controls; only the owner sees tree deletion.
- Mobile: duplicate bottom-bar button, cramped profile header, wrapping toolbar and truncated placeholders; surname chips now fill and focus the search, also on a second tap.
- CI: route folders named `photos` and `data` were ignored by git.

## [0.1.0] - 2026-10-02

First public release.

### Added

- Accounts: email and password, email verification, password reset over SMTP, optional Google sign-in, account deletion.
- Trees, people (first, middle, last and maiden names, gender, AD and BS dates, places, biography), relationships, events and photos.
- Tree view with zoom, two orientations and a focus mode for large trees. "How are we related?", relationship and event editing, linking existing people.
- Collaboration: family and direct join codes (family codes are unlimited by default), roles, profile claims (owners claim themselves without review), notifications with per-type preferences, change history with revert and undo.
- Search: full text (Latin and Devanagari), fuzzy fallback, birth-year and place filters, duplicate finder, surname explorer.
- Privacy filter for public trees and member exports. GEDCOM, JSON and CSV import and export. Tree backups and instance backup/restore scripts.
- Installable PWA with an offline page, light and dark themes, an onboarding tour, and a shadcn-svelte interface.
- Docker deployment behind a Cloudflare Tunnel, Raspberry Pi 4 tuning, a maintenance worker, and benchmarks.

[Unreleased]: https://github.com/chandanshakya/family-tree/compare/v0.1.0...HEAD
[0.2.0]: https://github.com/chandanshakya/family-tree/releases/tag/v0.2.0
[0.1.0]: https://github.com/chandanshakya/family-tree/releases/tag/v0.1.0
