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

# Is it already running? Ports, DB.
status:
    #!/usr/bin/env bash
    echo "=== Port 6060 (next dev) ==="
    lsof -i :6060 || echo "(nothing listening)"
    echo
    echo "=== SQLite DB ==="
    if [ -f events.db ]; then
        ls -lh events.db events.db-wal events.db-shm 2>/dev/null | awk '{print $NF, $5}'
    else
        echo "(events.db missing — start \`just dev\` to apply migrations)"
    fi

# Tail logs. next dev runs in the foreground; there's no log file for it.
logs:
    @echo "next dev runs in the foreground — its logs go to whatever terminal ran \`just dev\`."
    @echo "There is no background job in this project."

# Run the vitest suite (covers src/lib/consumption.ts and src/lib/taste-edit.ts
# only — see RUNBOOK "Tests" for the deliberately narrow scope).
test:
    npm run test

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

# Print the OAuth authorize URL. Open it in a browser while `just dev` is running.
youtube-auth:
    @echo "Start \`just dev\`, then open:"
    @echo "  http://localhost:6060/api/youtube/oauth/authorize"

# Build the full taste substrate: transcripts → enrichment → embeddings → clusters.
# Each step is incremental. See RUNBOOK "Taste substrate" for setup.
taste-build:
    npx tsx scripts/taste/build-all.ts

# Re-run just the clustering step (cheap). Useful after importing new likes.
taste-cluster:
    npx tsx scripts/taste/cluster.ts

# Run the overnight maintenance pipeline once, on demand.
# Same entrypoint launchd fires at NIGHTLY_HOUR (default 03:00). Logs to
# stdout when run by hand; launchd redirects to ~/Library/Logs/folio-nightly.log.
nightly:
    npx tsx scripts/nightly.ts

# Install the launchd agent that runs `just nightly` every day at NIGHTLY_HOUR
# (default 03:00). Idempotent — re-running rewrites the plist with the current
# repo path, so `just nightly-install` from a moved repo updates the job.
nightly-install:
    #!/usr/bin/env bash
    set -euo pipefail
    repo_path="$(pwd)"
    hour="${NIGHTLY_HOUR:-3}"
    plist_src="ops/com.folio.nightly.plist.tmpl"
    plist_dst="$HOME/Library/LaunchAgents/com.folio.nightly.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    mkdir -p "$HOME/Library/Logs"
    sed \
      -e "s|{{ '{{' }}REPO_PATH{{ '}}' }}|$repo_path|g" \
      -e "s|{{ '{{' }}HOUR{{ '}}' }}|$hour|g" \
      -e "s|{{ '{{' }}HOME{{ '}}' }}|$HOME|g" \
      "$plist_src" > "$plist_dst"
    if launchctl list | grep -q com.folio.nightly; then
      launchctl unload "$plist_dst" >/dev/null 2>&1 || true
    fi
    launchctl load -w "$plist_dst"
    echo "Installed com.folio.nightly at hour $hour (repo: $repo_path)."
    echo "Logs: $HOME/Library/Logs/folio-nightly.log"

# Remove the launchd agent. Safe to run when nothing is installed.
nightly-uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    plist_dst="$HOME/Library/LaunchAgents/com.folio.nightly.plist"
    had_something=0
    if launchctl list | grep -q com.folio.nightly; then
      launchctl unload "$plist_dst" >/dev/null 2>&1 || true
      had_something=1
    fi
    if [ -f "$plist_dst" ]; then
      rm -f "$plist_dst"
      had_something=1
    fi
    if [ "$had_something" -eq 0 ]; then
      echo "nothing to uninstall — com.folio.nightly not loaded and no plist on disk."
    else
      echo "Uninstalled com.folio.nightly."
    fi

# Trigger a YouTube import via the running dev server.
# KIND is one of: likes | subscriptions | playlist
# For KIND=playlist, also pass ID=<playlist_id>
youtube-import KIND="" ID="":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{KIND}}" in
      likes)
        curl -sS -X POST http://localhost:6060/api/youtube/import/likes ;;
      subscriptions)
        curl -sS -X POST http://localhost:6060/api/youtube/import/subscriptions ;;
      playlist)
        if [ -z "{{ID}}" ]; then
          echo "Usage: just youtube-import KIND=playlist ID=<playlist_id>" >&2
          exit 1
        fi
        curl -sS -X POST "http://localhost:6060/api/youtube/import/playlists/{{ID}}" ;;
      *)
        echo "Usage: just youtube-import KIND=<likes|subscriptions|playlist> [ID=<playlist_id>]" >&2
        exit 1 ;;
    esac
    echo
