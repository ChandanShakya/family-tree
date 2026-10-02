# Troubleshooting

## Deployment

| Symptom | Check |
|---|---|
| `docker compose` complains about a missing variable | `.env` is missing `ORIGIN`, a secret or the tunnel token (the error names it). |
| Container exits at start with `… must be set to at least 32 characters` | `SESSION_SECRET` / `VERIFICATION_PEPPER` too short. |
| Site returns 502/1033 from Cloudflare | `docker compose ps`: is `familytree` healthy? Is the tunnel hostname's service exactly `http://familytree:3000`? `docker compose logs cloudflared`. |
| Login works but everyone shares one rate limit / lockout | `ADDRESS_HEADER` is not `CF-Connecting-IP`, or the traffic is not coming through the tunnel. |
| Forms or the tree view do not work, console shows CSP errors | Cloudflare Rocket Loader / Auto Minify is on (§3). |
| Photos do not load after a restore | Restore the photos tar too; then `sweep-orphans` is not needed. Check `docker compose exec familytree ls /data/photos`. |
| Uploads fail with 413 | `BODY_SIZE_LIMIT` must stay `12M`. |
| Container restarts under load on a 1 GB Pi | `docker stats`; look for the memory limit; run `npm run bench` on the board; reduce concurrent photo uploads. |
| `503 BUSY` for a moment during an import | Expected: writers wait for the import's short transaction and retry. |
| Disk keeps growing | `docker system df`; log rotation is already limited to 3 × 10 MB per service; old backups. |

## Local development

| Symptom | Check |
|---|---|
| `npm ci` fails building `better-sqlite3` or `sharp` | Use Node 22 or newer. If no prebuilt binary exists for your platform, install `python3`, `make` and `g++` and retry. |
| Vitest live-server tests fail with connection errors | Run `npm run build` first: those tests start the built server. |
| Playwright says the port is in use | Another server is on port 4173. Stop it, or wait for a previous run to exit. |
| "Bad origin" (403) on every form | `ORIGIN` does not match the address in your browser, including the scheme and port. |
| No verification email | SMTP is not configured: the link is in the server log. With SMTP, check that `SMTP_FROM` is a sender your provider has verified. |
| Google button missing | Both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be set. |
| Google sign-in fails with `redirect_uri_mismatch` | The authorised redirect URI must be exactly `${ORIGIN}/api/auth/google/callback`. |
| Search misses a person that exists | Restart the server: the full-text index is checked and rebuilt at startup. Or run `npm run rebuild-fts`. |

## `docker compose up --build` hangs at `npm ci`

The build container cannot resolve the npm registry. This happens when the host uses a DNS server that build containers cannot reach, such as Tailscale's `100.100.100.100`. Build with the host's network, then start without rebuilding:

```sh
docker build --network host -t family-tree:latest .
docker compose up -d --no-build
```

## Getting help

Search the [issues](https://github.com/chandanshakya/family-tree/issues), then open a bug report with the server log lines (each error has a request id) and the steps to reproduce. Do not post real people's personal data.
