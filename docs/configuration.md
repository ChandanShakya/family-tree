# Configuration

Configuration comes from environment variables. With Docker, put them in `.env` next to `docker-compose.yml`; compose passes them to the container. Start from [`.env.example`](../.env.example).

## Required in production

| Variable | Meaning |
|---|---|
| `ORIGIN` | Public URL, for example `https://tree.example.com`, with no trailing slash. Used for links in emails, the OAuth redirect and the cross-site request check. |
| `SESSION_SECRET` | At least 32 random characters. Signs the OAuth state cookie. Generate with `openssl rand -base64 48`. |
| `VERIFICATION_PEPPER` | At least 32 random characters, different from the session secret. Answers to verification questions are hashed with it: **never change it** after people have set questions. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token of your Cloudflare Tunnel (Docker deployment). |

In production (`NODE_ENV=production`, which the image sets), the app refuses to start when either secret is missing or shorter than 32 characters.

## Mail (strongly recommended)

| Variable | Meaning |
|---|---|
| `SMTP_HOST` | SMTP server, for example `smtp-relay.brevo.com`. Leave empty to disable mail. |
| `SMTP_PORT` | `587` (STARTTLS, required) or `465` (TLS). Default `587`. |
| `SMTP_USER`, `SMTP_PASS` | SMTP login. |
| `SMTP_FROM` | Sender, for example `Family Tree <noreply@example.com>`. It must be a sender your provider has verified. |

Without SMTP, verification and password-reset links are written to the server log, and the server warns about it at start. Anyone who can read the log can then reset passwords.

## Google sign-in (optional)

| Variable | Meaning |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client of type "Web application". Add `${ORIGIN}/api/auth/google/callback` as an authorised redirect URI. |

The "Continue with Google" button appears only when both are set.

## Paths and runtime

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_PATH` | `./data/family.db` (image: `/data/db/family.db`) | SQLite database file. |
| `PHOTO_PATH` | `./photos` (image: `/data/photos`) | Photo storage. |
| `MIGRATIONS_PATH` | `src/lib/db/migrations` (image: `/app/migrations`) | Migrations folder. |
| `WORKERS_PATH` | `src/lib/server/workers` (image: `/app/lib/server/workers`) | Worker-thread scripts. |
| `BODY_SIZE_LIMIT` | `12M` in the image | Must allow 10 MB photo uploads. |
| `ADDRESS_HEADER` | `CF-Connecting-IP` in compose | Header that carries the client IP for rate limits. Set it only behind a trusted proxy. |
| `SHUTDOWN_TIMEOUT` | `12` in the image | Seconds that in-flight requests get to finish on shutdown. |
| `PORT` | `3000` | Listening port. |
| `RATE_LIMIT_API_MAX` | unset | Test servers only. Ignored when `NODE_ENV=production`. |

## Tunables

Limits that rarely change are constants in [`src/lib/config.ts`](../src/lib/config.ts), for example:

- the maximum photo size (10 MB) and pixel count;
- `SOFT_DELETE_PURGE_DAYS` (30): deleted people are removed for good after this many days;
- `LIVING_ASSUMPTION_YEARS`: people of unknown status born within this many years are treated as living;
- `TREE_FOCUS_MODE_THRESHOLD` (500): larger trees open in focus mode;
- GEDCOM import caps (5 MB, 10 000 people, 20 000 relationships);
- rate limits and lockout tiers;
- the maintenance interval (6 hours).

Change them there and rebuild.
