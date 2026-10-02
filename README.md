# Family Tree

[![Tests](https://github.com/chandanshakya/family-tree/actions/workflows/tests.yml/badge.svg)](https://github.com/chandanshakya/family-tree/actions/workflows/tests.yml)
[![Lint](https://github.com/chandanshakya/family-tree/actions/workflows/lint.yml/badge.svg)](https://github.com/chandanshakya/family-tree/actions/workflows/lint.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

<p align="center">
  <a href="docs/media/demo.mp4"><img src="docs/media/demo.gif" alt="Family Tree, a one-minute tour: start a tree, add family (links fill themselves), invite with a family code, relatives claim their profile, “How are we related?”, both families joined in My families, AD and Bikram Sambat dates, undo, privacy and mobile" width="860"></a>
  <br><sub>Plays automatically. <a href="docs/media/demo.mp4">Full-quality video (MP4)</a></sub>
</p>

Self-hosted, collaborative genealogy. Build a family tree together with relatives, keep every change in history, and stay in control of your data. It runs on a Raspberry Pi 4 or a small VPS behind a Cloudflare Tunnel, with SQLite as the only database.

## How it works

1. **Start a tree.** Name it and add yourself and your closest family.
2. **Add family.** Pick a relationship and the implied links are offered for you: add a child to a father and his wife is suggested as the other parent.
3. **Invite relatives.** Share one family code on WhatsApp or email; you approve each request.
4. **They claim themselves.** Relatives claim their own profile and keep their branch up to date. Married into another family? **My families** shows both trees joined at you.

## Features

- **Trees and people:** first, middle, last and maiden names, gender, birth and death dates in **AD or Bikram Sambat (BS)**, places, biography, events and photos.
- **Relationships:** parents, spouses, siblings and guardians. Grandparents, cousins and in-laws are derived, and "How are we related?" names the relation and shows the path.
- **Tree view:** zoom and pan, top-down or left-to-right layout, and a focus mode for large trees (tested up to 50 000 people).
- **Combined family view:** a person claimed in several trees (for example after a marriage) sees them joined at themselves, decides who else may see it, and can mark the same relative in both trees as one person.
- **Collaboration:** family and direct join codes, owner/editor/contributor/viewer roles, profile claims (with verification questions or owner review), notifications, and a full change history with one-click revert and undo.
- **Search:** full-text search (Latin and Devanagari), typo-tolerant fuzzy search, filters by birth year and place, a duplicate finder and a surname explorer.
- **Privacy:** private by default. Public trees and member exports hide living people. Photos are never cacheable by shared caches.
- **Import and export:** GEDCOM 5.5.1, JSON and CSV, plus tree backups and instance backup/restore scripts.
- **Accounts:** email and password, optional Google sign-in, email verification and password reset over SMTP.
- **Installable:** works as a PWA with an offline fallback page, in light and dark themes, on phones and desktops.

## Quick start

### Docker (production)

```bash
git clone https://github.com/chandanshakya/family-tree.git
cd family-tree
cp .env.example .env            # fill in ORIGIN, secrets, tunnel token, SMTP
docker compose up -d --build
```

The app is reachable only through Cloudflare Tunnel. See [docs/deployment.md](docs/deployment.md) for the full guide, including Raspberry Pi tuning, Cloudflare settings and backups.

### Local development

Requires Node 22 or newer.

```bash
npm ci
npm run dev                     # http://localhost:5173, creates ./data/family.db
```

## Documentation

| Guide | |
|---|---|
| [Installation](docs/installation.md) | Local and Docker setup |
| [Configuration](docs/configuration.md) | Every environment variable |
| [Usage](docs/usage.md) | Trees, people, invitations, claims, privacy |
| [Architecture](docs/architecture.md) | How it is built |
| [Deployment](docs/deployment.md) | Docker, Cloudflare Tunnel, Raspberry Pi, backups |
| [Troubleshooting](docs/troubleshooting.md) | Common problems |
| [FAQ](docs/faq.md) | Questions people ask |

The design record (specification, decisions, audit, benchmarks) lives in [docs/project](docs/project).

## Tech stack

SvelteKit 2 with Svelte 5, Node 22 (adapter-node), SQLite (better-sqlite3 and Drizzle ORM), Tailwind CSS 4 with shadcn-svelte, d3-zoom, sharp, Vitest and Playwright.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Chandan Shakya
