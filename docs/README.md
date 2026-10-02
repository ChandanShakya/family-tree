# Documentation

- [Installation](installation.md): run it locally or with Docker.
- [Configuration](configuration.md): every environment variable and tunable.
- [Usage](usage.md): trees, people, invitations, claims, privacy, import and export.
- [Architecture](architecture.md): how the code is organised and why.
- [Deployment](deployment.md): production with Docker, Cloudflare Tunnel, Raspberry Pi tuning, backups and upgrades.
- [Troubleshooting](troubleshooting.md): symptoms and fixes.
- [FAQ](faq.md): common questions.

## Design record

[`project/`](project) holds the documents the project was built from:

- [`SPECS.md`](project/SPECS.md): the specification, including the acceptance tests (AT-01 to AT-47).
- [`DECISIONS.md`](project/DECISIONS.md): every decision that deviates from or adds to the specification.
- [`ARCHITECTURE.md`](project/ARCHITECTURE.md), [`IMPLEMENTATION_PLAN.md`](project/IMPLEMENTATION_PLAN.md): derived from the specification.
- [`FINAL_AUDIT.md`](project/FINAL_AUDIT.md): the release audit and its follow-ups.
- [`BENCHMARKS.md`](project/BENCHMARKS.md): measured performance, written by `npm run bench`.
