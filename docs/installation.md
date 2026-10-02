# Installation

## Requirements

- **Local development:** Node 22 or newer, npm, and a C++ toolchain only if `better-sqlite3` or `sharp` has no prebuilt binary for your platform.
- **Production:** Docker with Compose v2, a Cloudflare account with a domain, and ideally an SMTP provider.

## Local development

```bash
git clone https://github.com/chandanshakya/family-tree.git
cd family-tree
npm ci
npm run dev
```

Open http://localhost:5173 and register. The first start creates `./data/family.db` and runs the migrations. Photos go to `./photos`.

Without SMTP, verification and reset links are printed in the terminal. Copy the link from there.

### Running the built app

```bash
npm run build
ORIGIN=http://localhost:3000 node build
```

### Tests

```bash
npm run build && npm test          # Vitest
npm run test:e2e:setup             # once: installs Chromium
npm run test:e2e                   # Playwright
```

## Docker

### Production (Cloudflare Tunnel)

```bash
cp .env.example .env               # see configuration.md
docker compose up -d --build
docker compose ps                  # familytree should be "healthy"
```

The app has no published port: `cloudflared` is the only way in. Create the tunnel and its public hostname as described in [deployment.md](deployment.md#3-cloudflare-tunnel).

### Raspberry Pi 4

```bash
docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d --build
```

This caps memory at 640 MB and uses 3 CPUs, leaving room for the OS and `cloudflared`.

### Local Docker without a tunnel

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The app is published on http://localhost:3000. Set `ORIGIN=http://localhost:3000` in `.env` for this mode.

### Prebuilt image

Each release publishes a multi-architecture image (amd64 and arm64):

```bash
docker pull ghcr.io/chandanshakya/family-tree:latest
```

To use it, replace `build: .` with `image: ghcr.io/chandanshakya/family-tree:<version>` in `docker-compose.yml`.
