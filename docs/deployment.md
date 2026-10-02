# Deployment guide

Target: a Raspberry Pi 4 (1 GB RAM or more) or a small VPS, behind a Cloudflare Tunnel. Nothing listens on a public port.

```
Internet ──► Cloudflare (TLS, WAF) ──► cloudflared (container) ──► familytree:3000 (container, no published port)
                                                                      ├─ volume family-db     /data/db      SQLite (WAL)
                                                                      └─ volume family-photos /data/photos  re-encoded photos
```

## 1. Prerequisites

| Need | Notes |
|---|---|
| 64-bit OS | Raspberry Pi OS Lite (64-bit) or Debian 12. The image is multi-arch (`amd64`, `arm64`). |
| Docker Engine + Compose v2 | `curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker $USER` and log in again. |
| A domain on Cloudflare | Any hostname, e.g. `tree.example.com`. |
| Storage | An SSD over USB 3 is strongly recommended: SQLite and photo writes wear an SD card. |
| Correct clock | `timedatectl status` should say synchronised: sessions, tokens and TLS depend on it. |

## 2. Configure

```sh
git clone <your repo> family-tree && cd family-tree
cp .env.example .env
```

Edit `.env`:

| Variable | Value |
|---|---|
| `ORIGIN` | `https://tree.example.com` (the public URL, no trailing slash) |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `VERIFICATION_PEPPER` | `openssl rand -base64 48` (different value) |
| `CLOUDFLARE_TUNNEL_TOKEN` | from step 3 |
| `SMTP_*` | strongly recommended; without SMTP, password-reset and verification links are written to the container log, and anyone who can read `docker compose logs` can take over accounts. Port 587 uses STARTTLS (required); 465 uses TLS. `SMTP_FROM` must be a sender your provider has verified, e.g. `Family Tree <email@example.com>` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional; the redirect URI is `${ORIGIN}/api/auth/google/callback` |

In production the app **refuses to start** if `SESSION_SECRET` or `VERIFICATION_PEPPER` is missing or shorter than 32 characters, and `docker compose` refuses to run without `ORIGIN`, the two secrets and the tunnel token. Keep `.env` out of git (it is ignored).

Do not change `VERIFICATION_PEPPER` later: stored verification-question answers are hashed with it and would stop matching.

## 3. Cloudflare Tunnel

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → type **Cloudflared** → name it `family-tree`.
2. Choose **Docker** and copy the token from the shown command (the long string after `--token`). Put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`. You do not install anything on the host: the compose file runs `cloudflared`.
3. **Public hostname** tab → add a hostname:
   - Subdomain/domain: `tree` / `example.com`
   - Service type **HTTP**, URL **`familytree:3000`** (the compose service name, not `localhost`).
4. Save. Cloudflare creates the DNS record for you.

Then in the Cloudflare dashboard for the zone, check these, because they change what the app sees:

- **No cache rule for `/photos/*`.** Photos are private; the app sends `Cache-Control: private` and a shared cache must never keep them. Do not use "Cache Everything" on this hostname. If you have a broad cache rule, add an exception that bypasses the cache for `tree.example.com/photos/*`.
- **Turn off HTML/JS rewriting:** Speed → Optimization → *Rocket Loader* off, *Auto Minify* off, and Scrape Shield → *Email Address Obfuscation* off. The app's Content-Security-Policy uses per-response nonces; anything that injects scripts or rewrites inline scripts breaks the page.
- **TLS mode** can stay on the default; traffic between Cloudflare and your server travels inside the tunnel.
- Optional: a WAF rate-limiting rule on `/api/auth/*` in addition to the app's own limits; and, if only family should reach the site, a Cloudflare Access policy in front of the hostname.

How client IPs work: the compose file sets `ADDRESS_HEADER=CF-Connecting-IP` and the app service has `expose: 3000` and **never `ports:`**, so only `cloudflared` can reach it. That is why the header can be trusted for per-IP rate limits and lockouts. Never add `ports:` to the production file; for local development use the dev override (§9), which clears `ADDRESS_HEADER`.

## 4. Raspberry Pi 4 tuning

Use the Pi override, which caps memory and CPU so a runaway request restarts the container instead of freezing the board:

```sh
docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d --build
```

What it sets, and why:

| Setting | Value | Reason |
|---|---|---|
| `mem_limit` / `memswap_limit` | 640 MB, no swap | The measured steady state is about 125 MB and the peak during a 10 000-person import plus clients about 360 MB (see [`BENCHMARKS.md`](project/BENCHMARKS.md)); the cap is a safety net. On a 1 GB Pi this leaves room for the OS, Docker and `cloudflared`. |
| `NODE_OPTIONS=--max-old-space-size=256` | 256 MB V8 heap | The heap is only part of RSS (sharp, SQLite cache/mmap, worker threads sit on top). |
| `node --max-semi-space-size=2` (in the image's `CMD`) | 2 MB young generation | Halves resident memory at start (about 220 MB → 110 MB measured): V8's default young generation grows to tens of MB while the server loads. |
| `cpus` | 3.0 | Keeps one core for the OS, `cloudflared` and SD/SSD I/O. |
| `UV_THREADPOOL_SIZE` | 4 | File and DNS work; sharp already runs with `concurrency(1)`. |

Host settings worth making:

- **Memory cgroups** (Raspberry Pi OS): for `mem_limit` to work, `/boot/firmware/cmdline.txt` needs `cgroup_enable=memory cgroup_memory=1` on its single line; reboot. Check with `docker stats` (the MEM LIMIT column must show 640 MiB, not the whole host).
- **A little swap on the host** (zram or a 1 GB swap file) protects the OS during an image upload spike; the container itself has none.
- **Power and cooling:** use the official supply; a heatsink or fan avoids throttling (`vcgencmd get_throttled` should print `0x0`).
- **Do not run on an SD card** if you can avoid it; if you must, back up more often.

Measure on your own board once and keep the result: [`BENCHMARKS.md`](project/BENCHMARKS.md) explains how, and §8 below shows the in-container command.

## 5. Start and check

```sh
docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d --build   # or without the Pi file on a VPS
docker compose ps                       # familytree should become "healthy", then cloudflared starts
docker compose logs -f familytree       # "Listening on …", then "maintenance: purged 0 people …"
docker compose exec familytree node -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(console.log)"
```

Open `https://tree.example.com`, register the first account and create a tree. Migrations run automatically before the server listens; the full-text index is checked and rebuilt if it disagrees with the data.

## 6. What runs by itself

A **maintenance job** runs once shortly after start and then every `MAINTENANCE_INTERVAL_HOURS` (6) in a worker thread: it permanently removes people deleted more than `SOFT_DELETE_PURGE_DAYS` (30) ago together with their photo files, and deletes expired sessions, old used/expired reset and verification tokens, and finished claim-attempt windows. A failure is logged and retried at the next interval; it never blocks startup. The log line looks like `maintenance: purged 0 people (0 files), 2 sessions, 1 tokens, 0 claim attempts`.

**Shutdown** (`docker compose stop`, restart, host reboot): the app stops accepting connections, lets in-flight requests finish (up to `SHUTDOWN_TIMEOUT`=12 s, inside Docker's 15 s grace period), folds the write-ahead log into the database file and exits with code 0.

## 7. Backups

State lives in two named volumes. A running SQLite database in WAL mode must never be copied as a file; use the scripts, which use SQLite's backup API (a consistent snapshot while the app keeps running).

```sh
scripts/backup.sh /srv/backups       # database snapshot + photos tar, copied to the host
```

Cron example (daily 03:15, keep 14 days):

```cron
15 3 * * * cd /srv/family-tree && ./scripts/backup.sh /srv/backups && find /srv/backups -name 'family-*' -mtime +14 -delete && find /srv/backups -name 'photos-*' -mtime +14 -delete
```

Copy `/srv/backups` off the machine (another disk, `rclone` to cloud storage). A backup that lives only on the same SD card is not a backup.

Individual owners can also download their own tree (JSON + photos) from *Tree → Data → Backup*; that is a convenience, not a replacement for the server backup.

### Restore drill (do this once before you need it)

```sh
scripts/restore.sh /srv/backups/family-2026-10-01T03-15-00-000Z.db /srv/backups/photos-2026-10-01T03-15-00-000Z.tar
```

The script stops the app, replaces the database, migrates it to the current schema, **rebuilds the full-text index**, restores the photos and starts the app. Then open a tree, run a search and open a photo. To rehearse without touching production, run the same steps on a second machine with a copy of the backup files.

`npm run sweep-orphans` (inside the container: `docker compose exec familytree node_modules/.bin/tsx scripts/sweep-orphans.ts`) deletes photo files that no database row references, e.g. after a failed restore.

## 8. Upgrading and benchmarking

```sh
git pull
docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d --build
```

Migrations run at startup. Take a backup first; to roll back, check out the previous version, rebuild and restore the backup (a newer schema is not downgraded automatically).

Benchmarks (about two minutes, seeds a throw-away 50 000-person database in `/app/.bench-tmp`):

```sh
docker compose run --rm --no-deps -e PORT=4240 familytree node_modules/.bin/tsx scripts/bench.ts
docker compose cp familytree:/app/docs/project/BENCHMARKS.md ./BENCHMARKS.pi.md   # only if the container still exists; otherwise run on the host with `npm run bench`
```

Run it while the app container is stopped or idle so the numbers are not skewed. [`BENCHMARKS.md`](project/BENCHMARKS.md) in the repository was produced on the development machine; keep a Pi copy next to it.

## 9. Local development with Docker

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This publishes `http://localhost:3000`, clears `ADDRESS_HEADER` and does not start `cloudflared` (it is behind the `tunnel` profile). `ORIGIN`, the two secrets and a (dummy) tunnel token must still be set in `.env`.

## 10. Troubleshooting

See [troubleshooting.md](troubleshooting.md).

## 11. Security checklist

- [ ] `ports:` is not present in `docker-compose.yml` (only `expose`).
- [ ] `.env` has two different 48-byte random secrets and is not committed.
- [ ] No cache rule matches `/photos/*`; Rocket Loader and Auto Minify are off.
- [ ] Backups are copied off the machine and a restore has been rehearsed.
- [ ] The Docker host is patched (`unattended-upgrades`), SSH uses keys only, and nothing else listens on a public port.
- [ ] Email is verified before owners publish a tree or hand out codes (the app enforces this).
- [ ] Public trees show living and unknown people as "Living"; check one in a private window before sharing the link.

## 12. Known limits

Single node only (one SQLite writer); no real-time sync; per-IP rate limits and lockouts are in memory and reset when the container restarts; partial Bikram Sambat dates sort approximately; the interface is English only.
