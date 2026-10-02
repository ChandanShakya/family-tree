#!/bin/sh
# Restore drill: stop the app, restore the snapshot (+ photos) in a one-off container that shares the
# app's volumes, rebuild FTS, start the app.
# usage: scripts/restore.sh backups/family-….db [backups/photos-….tar]
set -eu
[ $# -ge 1 ] || { echo "usage: $0 <database backup> [photos tar]" >&2; exit 2; }
DB="$(realpath "$1")"
PHOTOS="${2:+$(realpath "$2")}"
docker compose stop familytree
# The backup files are bind-mounted read-only; the one-off container sees the same named volumes as the app.
set -- -v "$DB:/restore/family.db:ro"
[ -n "$PHOTOS" ] && set -- "$@" -v "$PHOTOS:/restore/photos.tar:ro"
docker compose run --rm --no-deps "$@" familytree \
  node_modules/.bin/tsx scripts/restore.ts /restore/family.db ${PHOTOS:+/restore/photos.tar}
docker compose start familytree
