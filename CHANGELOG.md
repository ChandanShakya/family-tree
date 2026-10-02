# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
[0.1.0]: https://github.com/chandanshakya/family-tree/releases/tag/v0.1.0
