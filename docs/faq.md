# FAQ

**Is my family data sent anywhere?**
No. Everything stays in the SQLite file and the photos folder on your server. Cloudflare only relays traffic through the tunnel; photos are marked private so its cache does not keep them.

**Do I need Cloudflare?**
The provided compose file expects Cloudflare Tunnel, which needs no open ports or static IP. Any reverse proxy with HTTPS works too: publish port 3000 to the proxy, set `ORIGIN`, and set `ADDRESS_HEADER` to the header your proxy sends with the client IP.

**Can it run on a Raspberry Pi?**
Yes, a Pi 4 with 1 GB of RAM or more. Use `docker-compose.pi.yml`. Steady memory use is about 125 MB.

**How large can a tree get?**
It is tested with 50 000 people. Trees with more than 500 people open in focus mode around one person.

**What are BS dates?**
Bikram Sambat, the official calendar of Nepal. Enter a date and choose BS: it is stored as typed, converted for sorting, and shown in AD, BS or both, depending on each user's preference.

**Who can see living people?**
Members of the tree. Public viewers and filtered exports see "Living" without any details.

**Can I join two family trees, for example after a marriage?**
Trees are not merged. Instead, a person claimed in both trees gets **My families**, which draws them joined at that person and lets them choose who else can see it. Each tree keeps its own members and data. See [usage.md](usage.md#my-families).

**Can I import from another genealogy program?**
Yes, through GEDCOM 5.5.1 (most programs export it). Import adds people and merges nothing, so import into an empty tree or check the duplicate finder afterwards.

**How do I back up?**
Run `scripts/backup.sh` (for example from cron). It snapshots the database safely while the app runs and copies the photos. Test a restore once with `scripts/restore.sh`; see [deployment.md](deployment.md#7-backups).

**I lost access to my account.**
Use "Forgot password" (needs SMTP). An operator can also read a reset link from the server log when SMTP is not configured.

**How do I update?**
Back up, then `git pull && docker compose up -d --build`, or switch to a newer image tag. Migrations run automatically at start.

**Is there an API?**
The JSON API under `/api` is what the interface uses. It is session-based and not versioned for third parties yet.
