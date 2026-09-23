#!/usr/bin/env bash
#
# A nightly copy of the database, kept somewhere that is not the database.
#
#   npm run db:backup            # dump, upload, prune
#   bash scripts/backup-db.sh    # the same thing
#
# Neon takes its own snapshots, and they live inside the account that holds the
# only copy of the data. This is the copy that survives losing that account, a
# wrong `drop table` that nobody notices for a week, or a provider deciding the
# project is idle. It goes to R2, which is a different company.
#
# Kept: every backup for 14 days, then the first of each month for a year. A
# retention rule nobody can state is a retention rule nobody trusts.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a

stamp=$(date -u +%Y%m%d-%H%M%S)
dir=backups
mkdir -p "$dir"
file="$dir/aura-$stamp.dump"

# The direct endpoint, never the pooler.
#
# `DATABASE_URL` points at Neon's pgbouncer, which reuses one server connection
# across clients. `pg_dump` opens its session with
# `set_config('search_path', '', false)`, and pgbouncer then hands that
# connection — search path and all — to the application. It happened: sign-in
# broke with `relation "users" does not exist` while the health check stayed
# green, because `select 1` needs no schema.
DUMP_URL="${DATABASE_URL/-pooler/}"

echo "==> dump"
# Custom format: compressed, and restorable table by table, which is what you
# want at 3am when one table is wrong and the rest are fine.
pg_dump --no-owner --no-acl --format=custom "$DUMP_URL" -f "$file"
size=$(du -h "$file" | cut -f1)
echo "    $file ($size)"

# A dump that restores nothing is worse than no dump: it looks like insurance.
tables=$(pg_restore --list "$file" | grep -c "TABLE DATA" || true)
if [ "$tables" -lt 20 ]; then
  echo "!! only $tables tables carry data — refusing to upload a dump this thin" >&2
  exit 1
fi
echo "    $tables tables with data"

echo "==> upload"
node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server \
  --import tsx scripts/backup-upload.ts "$file" "backups/$(basename "$file")"

echo "==> prune local copies older than 14 days"
find "$dir" -name 'aura-*.dump' -mtime +14 -print -delete || true

echo "==> done"
