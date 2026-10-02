#!/bin/sh
# Host-side backup: snapshot the database with the SQLite backup API inside the container, then copy
# the snapshot and the photos volume out. Cron example (daily 03:15): 15 3 * * * /srv/family-tree/scripts/backup.sh
set -eu
OUT="${1:-./backups}"
mkdir -p "$OUT"
docker compose exec -T familytree node_modules/.bin/tsx scripts/backup.ts /tmp/backup
CID="$(docker compose ps -q familytree)"
docker cp "$CID:/tmp/backup/." "$OUT/"
docker compose exec -T familytree rm -rf /tmp/backup
echo "backup copied to $OUT"
