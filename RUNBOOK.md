# Runbook
_Last verified: 2026-04-23 (overnight-maintenance: nightly job + discovery substrate)_

## Overview
Folio — a personal, taste-aware consumption room for YouTube. Single-process
Next.js 16 app (React 19) on port **6060**, reading/writing a local SQLite
file (`events.db` at the repo root — still named `events.db` for historical
reasons; it now holds `videos`, `channels`, `consumption`, `video_provenance`,
`import_log`, the taste substrate, playlists, and per-day conversation logs).
All corpus data is imported **on demand** from the user's YouTube account
via the `/settings/youtube` page. No cron, no background jobs, no Docker,
no prod deployment, no staging — this runs locally only.

## Services & Ports
| Service    | Port | Purpose                                                   |
|------------|------|-----------------------------------------------------------|
| `next dev` | 6060 | Web UI + API routes. Launched foreground via `just dev`.  |
| SQLite     | —    | File at `./events.db` (+ `-wal`, `-shm`). WAL mode.       |

## Quick start — `just dev`
1. `npm install` (first time only).
2. Copy `.env.example` to `.env` and fill in `YOUTUBE_OAUTH_CLIENT_ID` /
   `YOUTUBE_OAUTH_CLIENT_SECRET` (see "YouTube OAuth" below).
3. `just dev` — foreground Next.js dev server on http://localhost:6060.
   Migrations run automatically on boot, including the library-pivot
   migration `010_library_pivot.sql` which creates an empty corpus on a
   first boot.
4. Visit http://localhost:6060/settings/youtube and click **Connect
   YouTube account**. After consent you'll land back on the settings page
   with Import buttons enabled.

## Before risky migrations — **`just backup-db`**
**Any destructive migration MUST be preceded by `just backup-db`.** Two
historical migrations are net-destructive on a populated DB:
`010_library_pivot.sql` (the original library pivot — truncated `videos`,
`channels`, `consumption`, `channel_tags`, `tags`, and dropped legacy
tables) and `016_magazine_teardown.sql` (dropped `issues`, `issue_slots`,
`sections`, `channels.section_id`, and reshaped `conversations` to
per-day scope). If you are re-applying either on a DB that already holds
content, back up first.

`just backup-db` checkpoints WAL and writes `events.db.YYYYMMDD-HHMMSS.bak`
alongside the live DB. To roll back after a botched migration:

1. Stop the dev server.
2. `cp events.db.<stamp>.bak events.db` (and delete any `-wal`/`-shm`
   siblings).
3. `git revert` the migration commit so the migration runner does not
   re-apply the migration on next boot.

Both steps are required — the restored backup contains a `_migrations` row
marking the migration as applied, so without the git revert the runner
would re-apply the migration on next boot.

## Is it running? — `just status`
Shows:
- Anything listening on `:6060` (the dev server).
- Size/presence of `events.db` and its WAL files.

## Stop everything — `just down`
Kills any process holding `:6060`.

## Environments
- **Local (only):** macOS, Node 24 (`v24.13.1` tested), `npm`/`npx tsx`. Port 6060.
  Secrets live in `.env` / `.env.local`.
- **Staging:** none.
- **Production:** none. Do not run `npm start` — the project is dev-only.

## YouTube OAuth
The app imports the user's YouTube library (Likes, Subscription uploads,
user-owned Playlists) via the YouTube Data API v3 with the
`https://www.googleapis.com/auth/youtube.readonly` scope. Read-only; Folio
never modifies your YouTube state.

### One-time Google Cloud setup
1. Create a project at https://console.cloud.google.com/.
2. **APIs & Services → Library → YouTube Data API v3 → Enable**.
3. **APIs & Services → OAuth consent screen** — pick **External**, fill in
   the minimum required fields, leave the app unpublished (**Testing**),
   and add your own Google account as a **Test user**. The consent screen
   will warn "Google hasn't verified this app" on sign-in — click
   **Advanced → Go to Folio (unsafe)**. Expected for a single-user local
   install.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   Application type **Web application**. Add authorized redirect URI:
   `http://localhost:6060/api/youtube/oauth/callback`. The port must match
   `next dev` (**6060**). If you change ports, update this URI in Google
   Cloud Console and update the hardcoded `REDIRECT_URI` in
   `src/lib/youtube-oauth.ts`.
5. Copy the client ID and client secret into `.env`:
   ```
   YOUTUBE_OAUTH_CLIENT_ID=...
   YOUTUBE_OAUTH_CLIENT_SECRET=...
   ```
6. Restart `just dev` and visit http://localhost:6060/settings/youtube →
   **Connect YouTube account**. Consent, then you'll land back with Import
   buttons.

### Where tokens live
Tokens are stored in the `oauth_tokens` table inside `events.db`, NOT in
`.env*`. The row is keyed on `provider = 'youtube'`. The DB file is
gitignored alongside the rest of app state. The access token is refreshed
lazily on each API call when it's within 60 seconds of expiry.

### Forcing re-auth
Click **Disconnect** on `/settings/youtube` — this deletes the
`oauth_tokens` row only. The imported corpus (videos, channels,
consumption, provenance) is untouched. Click **Connect** again to re-grant.

To revoke Folio's access from Google's side, visit
https://myaccount.google.com/permissions. After revocation, the next
import will fail with HTTP 409 and the settings page will show a
**Reconnect YouTube** banner.

## Importing your library
All imports are manual. Run them whenever you want; each is idempotent
(existing consumption state is preserved).

| Button | What it imports | Default consumption status | Signal weight |
|---|---|---|---|
| **Import likes** | Every video in your YouTube Likes (paginates through `LL`). | `saved` | 1.0 |
| **Import subscriptions** | The N most-recent uploads per subscribed channel (N = `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT`, default 25). | `inbox` | 0.3 |
| **Load my playlists → Import** | All items in a user-selected playlist. | `saved` | 0.7 |

Signal weight is written to `video_provenance.signal_weight` and is
consumed by a future Phase 4 curation agent; Phase 1 records it but does
not use it for ranking. A video imported by multiple routes gets multiple
`video_provenance` rows.

Quota notes: `playlistItems.list` and `subscriptions.list` are 1 unit per
page. Importing ~10k Likes (200 pages) + 100 subs + a handful of playlists
is comfortably under the 10,000 units/day default quota.

## Data reset
The library-pivot migration (`010_library_pivot.sql`) is destructive: it
drops the legacy `sources` and `issues` tables and truncates the content
tables (`videos`, `channels`, `consumption`, `channel_tags`, `tags`). It
runs automatically on next boot after the migration file lands in
`db/migrations/`.

**Before the first boot with this migration** present:

1. `just backup-db` — write a timestamped copy of the pre-reset state.
2. Confirm the backup file exists and is non-empty.
3. Start `just dev` — migration runs, DB is reset, app boots into the
   "not connected" state.
4. Connect YouTube and import (see above).

**Rollback** is the two-step procedure in the "Before risky migrations"
section above: restore the backup **and** `git revert` the migration
commit.

## Taste substrate
The taste substrate is phase-1 data plane work for the conversational-editor
umbrella. It builds two artifacts the later phases depend on:

- **Per-video embeddings** (`video_embeddings`) — one vector per video, under
  a `(provider, model)` key.
- **A cluster map of your taste** (`taste_clusters`, `video_cluster_assignments`) —
  themes derived from your likes, with every corpus video assigned to its
  nearest cluster.

Two supporting tables: `video_enrichment` (LLM-generated 50-word summary + 3
tags per video) and `video_transcripts` (YouTube auto-captions when available).

Surfaces that read it: `/taste` (the cluster lab), `/` (home ranking via
`taste_clusters.weight`), and the curation agent's `get_taste_clusters` /
`rank_by_theme` tools. Storage overhead is ~35 MB for 5,665 videos'
embeddings plus variable transcript text.

### Setup

1. **Install Ollama** (https://ollama.com) and pull a small enrichment model:
   ```
   ollama pull gemma3:4b
   ```
   Any instruction-tuned model that follows a "return JSON" prompt is fine.
   Verify Ollama is running and the model is available:
   ```
   curl -s http://localhost:11434/api/tags | jq '.models[].name'
   ```
2. **Set env vars** in `.env`:
   ```
   OPENAI_API_KEY=sk-...               # only if EMBEDDING_PROVIDER=openai (default)
   # EMBEDDING_PROVIDER=openai         # openai | bge-local
   # OLLAMA_HOST=http://localhost:11434
   # OLLAMA_ENRICHMENT_MODEL=gemma3:4b
   ```
   Embeddings default to OpenAI's `text-embedding-3-small`. A full rebuild
   of ~5,665 videos runs about $0.30. To avoid all cloud cost, set
   `EMBEDDING_PROVIDER=bge-local` and pull a local embedding model (`ollama
   pull bge-m3`).

### Commands

- `just taste-build` — end-to-end: fetch transcripts → enrich → embed → cluster.
  Each step is incremental; re-runs skip work already done. First full run on
  a large corpus can take 30–60 min depending on Ollama speed. Safe to
  interrupt and resume.
- `just taste-cluster` — cheap re-run of just the cluster step. Do this after
  importing new likes; clustering is seconds.

### What to do when Ollama is not running

Enrichment fails hard rather than falling back silently to cloud inference
(that would burn money without telling you). You'll see:

```
[enrich] Could not reach Ollama at http://localhost:11434. See RUNBOOK "Taste substrate" for setup.
```

Start Ollama (`ollama serve` in a separate terminal, or via the menu-bar
app) and re-run `just taste-build`. If the error names a missing model, run
`ollama pull <model>` or change `OLLAMA_ENRICHMENT_MODEL` to something you
have.

### Switching providers

The `video_embeddings` table is keyed on `(video_id, provider, model)`, so
switching `EMBEDDING_PROVIDER` writes new rows under the new key without
disturbing the old ones. Clustering always operates on the currently-active
provider+model — it will not mix generations. To fully migrate, run `just
taste-build` once under the new provider; old rows can be left in place or
dropped manually.

### Cluster ID preservation

When re-clustering, new clusters whose centroid matches an old active
cluster above cosine 0.85 inherit the old cluster's ID and label. Old
clusters that find no match are marked `retired_at` (not deleted) so any
user-assigned label is preserved for history.

## Taste lab

`/taste` is the human-tending surface for the cluster map. The substrate
populates the map; the lab makes it editable.

### What lives there

- The active-cluster list, sorted by member count desc. Each row shows
  the cluster id, label (inline-editable), weight slider (0.0–3.0),
  member + fuzzy counts, a preview strip of up to 8 representative
  thumbnails, and a link into the per-cluster detail page.
- An "Empty clusters" disclosure for active clusters with zero
  assignments — they stay alive (not retired) so a future rebuild can
  re-acquire members.
- A "Retired" disclosure listing soft-deleted clusters, most-recent
  first. Their labels and centroids are preserved for history.
- A drift indicator in the page header — the count of liked videos
  (`consumption.status IN ('saved','in_progress','archived')`) whose
  cluster-assignment cosine similarity is below 0.6. Hidden when fewer
  than 30 likes exist.

`/taste/[clusterId]` is the per-cluster page: full member list with
per-video similarity, a reassign dropdown per row, and Merge / Split /
Retire actions for the cluster as a whole.

### Editing rules

- **Labels** are free-form text; trimmed; an empty string is stored as
  `NULL`.
- **Weights** are floats in `[0.0, 3.0]`, step `0.1`. They are read by the
  home ranking (`rankForHome` clamps to `[0, 2]`) and surfaced to the
  curation agent's snapshot.
- **Reassigning a single video** updates that one assignment row; it does
  not recompute centroids and does not retire an emptied source cluster.
- **Merging** moves the source's assignments into the target, recomputes
  the target centroid, recomputes per-member similarities, and
  soft-retires the source (label preserved). Pick the target as the
  cluster you want the *label* to live on.
- **Splitting** runs K-means on a cluster's members and partitions them
  into k children. The first child reuses the original cluster's id and
  label; the rest are inserted as fresh clusters with `label = NULL` and
  `weight = 1.0`. The split dialog previews silhouette + size
  distribution at k ∈ [2, min(5, memberCount)].
- **Retiring** is reversible only by manual SQL — clear the
  `retired_at` column. The intended path is "create or merge a new
  cluster instead."

### How edits survive a rebuild

`just taste-cluster` rebuilds the map from your likes. Cluster IDs are
preserved by greedy centroid-matching at cosine ≥ 0.85, so:

- Labels and weights you set on cluster #N stay attached to row #N
  whenever the new build's centroid still matches #N's prior centroid.
- Clusters whose centroid no longer matches anything are marked
  `retired_at` (label preserved, row not deleted).
- Newly-discovered themes get fresh ids with `label = NULL` and
  `weight = 1.0`.

If a rebuild silently drops a label you cared about, the underlying
theme drifted enough to fall below the 0.85 match threshold. Your
options: re-label the new cluster, or merge it into a sibling whose
label still fits.

### Concurrency

All edits go through `src/lib/taste-edit.ts` and use optimistic locking
on the cluster row's `updated_at`. If a rebuild ran between page-load
and submit, the API returns HTTP 409 and the UI surfaces "cluster was
rebuilt; reload."

### Operational notes

- No new `just` verbs. Rebuild remains `just taste-cluster`.
- No new env vars. The drift threshold (0.6) and minimum-likes gate
  (30) are constants in `src/lib/taste-read.ts`; tweak in code if you
  want different signals.
- Weights are read by the home ranking and the curation agent. Edits
  take effect on the next `/` render and on the next agent turn.

## Curation agent

`/chat` mounts the curation companion. It reads your taste-cluster map,
your consumption counts, in-progress videos, and your playlists; calls a
small set of tools; and writes through the same library paths the rest of
the app uses (`setConsumptionStatus`, `addToPlaylist`, etc.).
Conversations are scoped to the local-day (one row per
`scope_date` in `conversations`); the first message of a day inserts the
row, every subsequent message that day appends to it. Conversations carry
no draft binding; they are not freezable, only purgeable.

### Model and cost

Default model is `claude-sonnet-4-6`. Set `AGENT_MODEL=claude-opus-4-7` in
`.env` for harder sessions (higher cost). Typical session cost:
**$0.05–0.20** at Sonnet pricing with prompt caching enabled. A runaway
tool loop is capped at `AGENT_MAX_TURNS` (default 10); worst case ~$0.50.

Prompt caching is enabled at two boundaries (system prompt + tool
descriptions, and the per-turn consumption-home snapshot) so repeated
turns within a session pay for only the new user message + assistant
response. TTL is 5 minutes — long idle gaps re-bill the prefix.

### Setup

1. Set `ANTHROPIC_API_KEY` in `.env`. See `.env.example`.
2. Restart `just dev`.
3. Visit `/chat`. The panel hydrates today's conversation, if any, and is
   ready to accept input.
4. Without a key, the chat panel renders a disabled card pointing back
   here. The rest of the app is unaffected.

### Tools

Eleven tools, no slot tools, no taste-table mutations beyond the per-day
mute. See `openspec/specs/curation-agent/spec.md` for the canonical list:
`search_pool`, `rank_by_theme`, `get_video_detail`, `get_taste_clusters`,
`create_playlist`, `add_to_playlist`, `remove_from_playlist`,
`reorder_playlist`, `triage_inbox`, `mute_cluster_today`, `resurface`.

### Key rotation

Edit `ANTHROPIC_API_KEY` in `.env`, restart `just dev`. No app-side key
storage; the SDK client is lazily re-instantiated on first call per
process.

### Privacy posture

Every user turn (plus the bounded per-turn snapshot: cluster labels with
weights, top members, in-progress titles, playlist names + counts,
consumption counts) is sent to the Anthropic API. Anthropic's retention
policy governs that data path. Conversation turns are also persisted
locally inside `events.db` (`conversations`, `conversation_turns`). No
third party beyond Anthropic sees any of this. YouTube transcripts and
video IDs may appear inside tool results — `get_video_detail` truncates
transcripts to 500 chars.

There is **no** local-model fallback for the conversational agent
itself. Local fallback remains available for embedding + enrichment
(see "Taste substrate").

### Force-dumping a runaway conversation

To abandon today's conversation, drop it from SQL:

```
sqlite3 events.db "DELETE FROM conversations WHERE scope_date = date('now','localtime')"
```

Cascading `ON DELETE CASCADE` on `conversation_turns.conversation_id`
takes the turns with it. The next message that day starts fresh.

### No scheduled jobs

The curation agent runs only while a user is on `/chat` and sends a
message. No cron, no background workers, no `justfile` additions.

## Playlists

`/playlists` is a surface for grouping videos into named, ordered
collections. A video may be in any number of playlists simultaneously
and may also be in the inbox or library — these are independent axes.

### Creation and editing

- `/playlists` lists existing playlists sorted by most-recently-edited.
  Click **+ New playlist** in the header → enter a name (required) and
  optional description → land on the new detail page.
- `/playlists/[id]` is the per-playlist page. Header has **Edit**
  (inline rename + description) and **Delete** (two-click confirm; on
  confirm redirects to `/playlists`).
- Each item row has **↑ / ↓** buttons to reorder and **Remove** to
  drop the video from this playlist. None of these affect the video's
  consumption state.

### Adding a video to a playlist

- Every video card on `/library` shows an **Add to playlist** popover
  (the small `♪` button next to the consumption action). The button
  label flips to **♪ In N** when the video is already in N playlists.
- The popover lists all playlists with checkboxes; toggling a checkbox
  immediately POSTs/DELETEs an item — no separate save step.
- **+ Create new playlist** at the bottom of the popover creates a
  playlist and adds the current video to it in two API calls.

### Position rebalance notes

- `playlist_items.position` is a dense integer but only the affected
  range is renumbered on reorder, so occasional gaps after removals
  are tolerated. Ordered reads use `ORDER BY position ASC` and are
  gap-tolerant. There is no eager compaction.
- Adding a video defaults to appending at `MAX(position) + 1`. Adding
  with an explicit `position` shifts everything at-or-above it up by
  one inside the same transaction.
- Reorder requests are clamped to `[1, COUNT(*)]`; a no-op reorder
  (target equals current position) does NOT touch `updated_at`.

### `show_on_home` flag

`PATCH /api/playlists/[id]` accepts `{ show_on_home: true|false }` and
persists the value. `/` renders every playlist with `show_on_home = 1`
as a card in the **On the shelf** rail, ordered by `updated_at DESC`.
Toggle from the command line:

```
curl -X PATCH http://localhost:6060/api/playlists/7 \
  -H 'content-type: application/json' \
  -d '{"show_on_home": true}'
```

There is no in-UI toggle yet; that belongs to a follow-up change.

### Manual SQL recovery

- Force-delete a playlist (cascade clears items):
  `sqlite3 events.db "DELETE FROM playlists WHERE id=?"`
- Inspect raw item order:
  `sqlite3 events.db "SELECT position, video_id FROM playlist_items WHERE playlist_id=? ORDER BY position"`
- Renormalize positions (dense 1..N) for one playlist if reorder
  history left awkward gaps:
  ```sql
  WITH ranked AS (
    SELECT video_id, ROW_NUMBER() OVER (ORDER BY position) AS rn
      FROM playlist_items WHERE playlist_id = :id
  )
  UPDATE playlist_items SET position = (
    SELECT rn FROM ranked WHERE ranked.video_id = playlist_items.video_id
  ) WHERE playlist_id = :id;
  ```
  Expected to be rare enough not to warrant a UI affordance.
- Drop the entire feature (rollback):
  `sqlite3 events.db "DROP TABLE playlist_items; DROP TABLE playlists; DELETE FROM _migrations WHERE name='014_playlists.sql';"`
  then revert the migration commit.

### No new env vars or jobs

Playlists add no env vars, no cron jobs, no background workers, and
no `just` verbs. All mutations are user-initiated through the UI or
direct `/api/playlists/**` calls.

## Home ranking rail

`/` is the consumption home: top-to-bottom, `TopNav` → **"For right
now"** rail → **Continue** rail (up to 4 `in_progress` videos) →
**On the shelf** rail (playlists with `show_on_home = 1`) → a quiet
entry-point footer (Library · Playlists · Inbox · Taste · Settings).
Rendered whenever a corpus is present (connected + `videos > 0`). The
"For right now" rail reads `taste_clusters.weight` — cluster-weight
edits on `/taste` observably shift the rail on next page load.

`ContinueRail` and `ShelfRail` each render nothing when empty (no
heading, no container), so a low-state home is just "For right now"
plus the footer. The footer renders unconditionally in the
connected-with-corpus branch. There is no masthead; the consumption
home runs without a title card. Container width is `max-w-5xl`.

### Scoring

Per-video score is `clusterWeight × freshness × stateBoost × fuzzyPenalty`.
Candidate pool filters to `consumption.status IN ('inbox', 'saved', 'in_progress')`.

| Component      | Value                                                                   |
|----------------|-------------------------------------------------------------------------|
| `clusterWeight`| `taste_clusters.weight` clamped to `[0, 2]`; `0.5` when unembedded or the assigned cluster is retired; `0` when muted today. |
| `freshness`    | `exp(-ageDays / 14)` with `ageDays` clamped to `>= 0`; `0.5` when `published_at IS NULL`. Half-life constant `HOME_RANKING_HALF_LIFE_DAYS = 14`. |
| `stateBoost`   | `1.0` inbox, `1.3` saved, `1.5` in_progress.                            |
| `fuzzyPenalty` | `0.7` when `video_cluster_assignments.is_fuzzy = 1`, else `1.0`.        |

The rail shows up to 10 candidates. Sort is score desc with `video_id`
asc tie-break; results are deterministic for a given `now`. No caching —
each `/` render recomputes from SQLite. Constants live in
`src/lib/home-ranking.ts` (`HOME_RANKING_HALF_LIFE_DAYS`, `FUZZY_PENALTY`,
`UNKNOWN_CLUSTER_WEIGHT`, `UNKNOWN_FRESHNESS`); no env overrides.

### Mute-today

Every cluster row on `/taste` and the detail header on
`/taste/[clusterId]` has a **Mute today** button. A mute zeroes
`clusterWeight` for videos assigned to that cluster for the rest of the
local day (America/New_York) without touching `taste_clusters.weight`
or its `updated_at`. Click again to un-mute within the same day. Mutes
auto-clear at local midnight because queries filter by today's date —
no sweeper job.

Persistence is one row per `(cluster_id, muted_on)` in
`taste_cluster_mutes` (migration `015_taste_cluster_mutes.sql`).
Manual inspection:

```
sqlite3 events.db "SELECT * FROM taste_cluster_mutes WHERE muted_on = date('now','localtime')"
```

### Debug API

`GET /api/home/ranking?limit=20&debug=1` returns the score breakdown for
every candidate:

```json
{ "candidates": [
  { "videoId": "abc123", "score": 1.29,
    "clusterWeight": 1.5, "freshness": 0.82,
    "stateBoost": 1.3, "fuzzyPenalty": 1.0,
    "clusterId": 7, "clusterLabel": "systems thinking" }
] }
```

Without `debug`, only `videoId` and `score` are returned. `limit` must
be an integer in `[1, 100]`; malformed values get `400`. The route is
read-only and safe to hammer.

### Reverting

Full removal: drop the migration's table
(`DROP TABLE taste_cluster_mutes; DELETE FROM _migrations WHERE name='015_taste_cluster_mutes.sql';`),
revert the migration commit, and remove the `<RightNowRail />` line from
[src/app/page.tsx](src/app/page.tsx).

### No new `just` verbs

Ranking is data-driven; nothing to schedule, rebuild, or re-seed. The
existing `dev`/`status`/`logs`/`backup-db` verbs are unchanged.

## Accessing the dev server from another host

`next dev` on **6060** is bound to `*` (all interfaces), so you can hit it
from another machine on your LAN or over Tailscale. Next 16 blocks
cross-origin requests to `/_next/*` dev resources by default, which
manifests as HMR WebSocket failures **and** client-side hydration silently
failing — buttons, sliders, and inputs appear rendered but do nothing.

Allow the host in [`next.config.ts`](./next.config.ts) via
`allowedDevOrigins` and restart `just dev`:

```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ['100.113.5.65', 'localhost'],
};
```

Swap `100.113.5.65` for your Tailscale IP / LAN hostname / whatever
shows up in the warning the dev server logs on first request. Config
changes are **not** hot-reloaded — you must restart the dev server.

## Overnight maintenance

A single local-only nightly job that runs the full ingest → enrich → embed →
recluster → description-graph pipeline in one process. Opt-in via launchd;
if you never install the agent, the rest of the app behaves as it does today.

### What the nightly does

`scripts/nightly.ts` runs seven steps sequentially:

1. `runMigrations()` — applies any new `db/migrations/*.sql`.
2. **OAuth import** — `importLikes()` + `importSubscriptions()`, the same
   paths the `/settings/youtube` buttons call. If no `oauth_tokens` row
   exists, the run exits early with `status = 'skipped'`.
3. **Transcripts** — `fetchTranscript()` for every video without a row in
   `video_transcripts`. Polite ~250–500ms jitter between requests.
4. **Enrich** — Ollama summary + 3 topic tags for every video without a
   row in `video_enrichment`.
5. **Embed** — incremental embed for every video without a row in
   `video_embeddings` under the active `(provider, model)`.
6. **Recluster** — incremental: assign new embeddings to the nearest
   active cluster, recompute affected centroids, and only trigger the full
   `rebuildClusters()` path if max centroid drift exceeds
   `RECLUSTER_REBUILD_DRIFT` (default 0.20).
7. **Description-graph** — scan descriptions + transcripts of every
   `consumption.status IN ('saved', 'in_progress')` video for YouTube
   links, channel IDs, and `@handles`. Score each new candidate against the
   active taste clusters; survivors at or above `DISCOVERY_FUZZY_FLOOR`
   (default 0.55) are inserted into `discovery_candidates` with
   `status = 'proposed'`.

A per-step failure is captured in `nightly_runs.counts.steps` and
`nightly_runs.last_error` but does not abort subsequent steps. Exactly one
`nightly_runs` row is written per invocation, with a single-sentence
digest in `notes` that `/` renders above `RightNowRail`.

The job never calls Anthropic. `ANTHROPIC_API_KEY` can be unset.

`scripts/nightly.ts` loads `.env.local` via `process.loadEnvFile()` before
importing anything else, so `YOUTUBE_OAUTH_CLIENT_{ID,SECRET}`,
`OPENAI_API_KEY`, and friends are available whether the job runs under
`just nightly` from a shell or under launchd (which does not inherit your
shell env). Keep secrets in `.env.local`; do not re-declare them in the
plist.

### Install / uninstall

- `just nightly` — run once, on demand. Equivalent to `npx tsx scripts/nightly.ts`.
- `just nightly-install` — generates `~/Library/LaunchAgents/com.folio.nightly.plist`
  from `ops/com.folio.nightly.plist.tmpl`, templates the current repo path
  and `NIGHTLY_HOUR` (default 3), then `launchctl load -w`s it. Idempotent —
  safe to re-run (and required if you move the repo).
- `just nightly-uninstall` — unloads and removes the plist. Safe to run
  when nothing is installed.

**If you move the repo, re-run `just nightly-install`.** The plist hard-codes
`WorkingDirectory` and the `cd` inside `ProgramArguments`; moving the checkout
silently breaks the job until it's regenerated.

### Environment knobs

| Var | Default | Effect |
|---|---|---|
| `NIGHTLY_HOUR` | `3` | Hour (0–23, local time) launchd fires the job. Read only at install time. |
| `DISCOVERY_FUZZY_FLOOR` | `0.55` | Score floor for inserting a candidate. |
| `RECLUSTER_REBUILD_DRIFT` | `0.20` | Centroid drift that flips step 6 from incremental to full. |
| `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` | `25` | Pre-existing; caps uploads imported per subscription per run. |

### Log and digest inspection

- Launchd log: `~/Library/Logs/folio-nightly.log`. Contains both stdout
  and stderr (one combined file).
- Digest history:
  ```bash
  sqlite3 events.db "SELECT run_at, status, notes FROM nightly_runs ORDER BY run_at DESC LIMIT 5"
  ```
- Full structured counts for a single run:
  ```bash
  sqlite3 events.db "SELECT counts FROM nightly_runs ORDER BY run_at DESC LIMIT 1"
  ```

## Discovery candidates (substrate)

Phase 5 of the consumption-first umbrella stages proposed imports but
**does not surface them yet**. The `discovery_candidates` table
accumulates rows that no UI reads; phase 6 owns the active discovery
surfaces (`/inbox` "Proposed" rail, approve/dismiss API, `search_youtube`
agent tool).

### Inspect proposed candidates

```bash
sqlite3 events.db "SELECT id, kind, target_id, score, status FROM discovery_candidates WHERE status='proposed' ORDER BY score DESC LIMIT 20"
```

To see scoring provenance for one row:

```bash
sqlite3 events.db "SELECT score_breakdown FROM discovery_candidates WHERE id = 1"
```

### Rejection list

`discovery_rejections(target_id PRIMARY KEY, kind, dismissed_at)` is the
permanent dismiss list — the description-graph scan skips any `target_id`
present here, forever. Phase 6's dismiss endpoint will append to this
table; in phase 5 it stays empty.

Clear a single entry by hand (e.g. if a target was rejected by mistake):

```bash
sqlite3 events.db "DELETE FROM discovery_rejections WHERE target_id = '<id>'"
```

## Troubleshooting
- **"Port 6060 in use"** — `just down`, or `lsof -i :6060` to see what's
  holding it.
- **"Reconnect required" banner on settings page** — the stored refresh
  token was revoked (manually, via Google security settings, or by
  prolonged inactivity). Click Connect to re-consent. Imports will
  resume; the existing corpus is untouched.
- **"Missing YOUTUBE_OAUTH_CLIENT_ID"** at
  `/api/youtube/oauth/authorize` — env vars not loaded. Restart
  `just dev` after editing `.env` / `.env.local`.
- **Import button returns an error with HTTP 403 / quota** — you've
  exhausted the daily YouTube API quota. Wait until midnight Pacific and
  retry. See quota notes above.
- **"DB is locked" / busy** — SQLite busy timeout is 5s. Don't hold a
  `sqlite3 events.db` shell open while the dev server is writing.
- **"Where did dev server logs go?"** — `next dev` runs in the
  foreground. Logs only exist in whatever terminal ran `just dev`.
- **`/compose`, `/issues`, `/sections`, `/section/*` all 404** —
  expected. The magazine surface (issue editor, section management,
  published-issue archive) was removed by `magazine-teardown` on
  2026-04-23. Triage now lives at `/inbox`; the curation companion
  lives at `/chat`; ranked candidates live on `/`.
