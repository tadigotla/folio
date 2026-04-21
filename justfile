# Show available recipes
default:
    @just --list

# Start the Next.js dev server on port 6060 (foreground)
dev:
    npm run dev

# Kill whatever is holding port 6060
down:
    #!/usr/bin/env bash
    set -euo pipefail
    pids=$(lsof -ti :6060 || true)
    if [ -z "$pids" ]; then
        echo "Nothing listening on :6060"
    else
        echo "Killing pid(s) on :6060: $pids"
        kill $pids
    fi

# Is it already running? Ports, processes, cron, DB.
status:
    #!/usr/bin/env bash
    echo "=== Port 6060 (next dev) ==="
    lsof -i :6060 || echo "(nothing listening)"
    echo
    echo "=== Fetcher cron ==="
    if crontab -l 2>/dev/null | grep -q "folio:fetch"; then
        crontab -l | grep "folio:fetch"
    else
        echo "(not installed — run \`just cron-install\`)"
    fi
    echo
    echo "=== SQLite DB ==="
    if [ -f events.db ]; then
        ls -lh events.db events.db-wal events.db-shm 2>/dev/null | awk '{print $NF, $5}'
    else
        echo "(events.db missing — run \`just seed\`)"
    fi

# Tail logs (dev runs foreground; only the fetcher cron writes a log file)
logs:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f .logs/fetch.log ]; then
        tail -f .logs/fetch.log
    else
        echo ".logs/fetch.log not present yet."
        echo "next dev runs in the foreground — its logs go to whatever terminal ran \`just dev\`."
        echo "The fetcher cron writes to .logs/fetch.log once \`just cron-install\` has been run and has fired at least once."
        exit 1
    fi

# No test runner configured. Run the linter instead.
test:
    @echo "No test runner in this project (see CLAUDE.md). Running lint:"
    npm run lint

# One-shot run of the ingestion orchestrator (what cron invokes)
fetch:
    npm run fetch

# Apply migrations and upsert seed rows in `sources`
seed:
    npx tsx db/seed-sources.ts

# Force a YouTube subscription re-sync (normally runs on each fetcher tick)
youtube-sync:
    npx tsx scripts/sync-subscriptions.ts

# Timestamped copy of events.db (run before risky migrations)
backup-db:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f events.db ]; then
        echo "events.db missing — nothing to back up."
        exit 1
    fi
    sqlite3 events.db "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
    stamp="$(date +%Y%m%d-%H%M%S)"
    dest="events.db.${stamp}.bak"
    cp events.db "$dest"
    echo "Wrote $dest ($(ls -lh "$dest" | awk '{print $5}'))"

# Install the every-30-min fetcher cron entry for this checkout
cron-install:
    #!/usr/bin/env bash
    set -euo pipefail
    repo="$(pwd)"
    mkdir -p "$repo/.logs"
    marker="# folio:fetch ($repo)"
    line="*/30 * * * * /bin/zsh -lc 'cd \"$repo\" && npm run fetch' >> \"$repo/.logs/fetch.log\" 2>&1 $marker"
    existing="$(crontab -l 2>/dev/null || true)"
    if echo "$existing" | grep -Fq "$marker"; then
        echo "Already installed:"
        echo "$existing" | grep -F "$marker"
        exit 0
    fi
    { echo "$existing"; echo "$line"; } | sed '/^$/d' | crontab -
    echo "Installed:"
    echo "  $line"
    echo "Logs: $repo/.logs/fetch.log"

# Remove the fetcher cron entry for this checkout
cron-uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    repo="$(pwd)"
    marker="# folio:fetch ($repo)"
    existing="$(crontab -l 2>/dev/null || true)"
    if ! echo "$existing" | grep -Fq "$marker"; then
        echo "No entry for this checkout."
        exit 0
    fi
    echo "$existing" | grep -Fv "$marker" | crontab -
    echo "Removed cron entry for $repo"
