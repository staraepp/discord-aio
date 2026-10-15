#!/bin/sh
# Nightly PostgreSQL backup: one compressed dump per day, the newest BACKUP_KEEP_DAYS kept.
# Restore steps are in DEV_NOTES.md ("Database backups").
set -eu
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p /backups

backup() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  tmp="/backups/.aio-$stamp.dump.partial"
  # Custom format: compressed, and pg_restore can restore single tables from it.
  if pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$tmp"; then
    mv "$tmp" "/backups/aio-$stamp.dump"
    echo "backup ok: aio-$stamp.dump ($(du -h "/backups/aio-$stamp.dump" | cut -f1))"
  else
    rm -f "$tmp"
    echo "backup FAILED" >&2
  fi
  find /backups -name 'aio-*.dump' -mtime "+$KEEP" -delete
}

# First backup shortly after start, then once a day.
sleep 60
while true; do
  backup
  sleep 86400
done
