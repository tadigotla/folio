# Runbook
_Last verified: 2026-04-22 (conversational-editor-ui)_

## Overview
Folio — a personal YouTube-library magazine. Single-process Next.js 16 app
(React 19) on port **6060**, reading/writing a local SQLite file (`events.db`
at the repo root — still named `events.db` for historical reasons; it now
holds `videos`, `channels`, `consumption`, `video_provenance`, `import_log`,
etc.). All corpus data is imported **on demand** from the user's YouTube
account via the `/settings/youtube` page. No cron, no background jobs, no
Docker, no prod deployment, no staging — this runs locally only.

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
**Any destructive migration MUST be preceded by `just backup-db`.** The
library-pivot migration (`010_library_pivot.sql`) drops the `sources` and
`issues` tables and truncates `videos`, `channels`, `consumption`,
`channel_tags`, `sections`, and `tags`. It is the intended one-time reset
for the Phase 1 pivot — but if you are re-applying it on a DB that already
holds content, back up first.

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
tables (`videos`, `channels`, `consumption`, `channel_tags`, `sections`,
`tags`). It runs automatically on next boot after the migration file
lands in `db/migrations/`.

**Before the first boot with this migration** present:

1. `just backup-db` — write a timestamped copy of the pre-reset state.
2. Confirm the backup file exists and is non-empty.
3. Start `just dev` — migration runs, DB is reset, app boots into the
   "not connected" state.
4. Connect YouTube and import (see above).

**Rollback** is the two-step procedure in the "Before risky migrations"
section above: restore the backup **and** `git revert` the migration
commit.

## Editor workspace
The home page at `/` is the editor when a corpus is present. Compose an
issue by dragging videos from the inbox **pool** (right column) onto the
slots on the **board** (left column). Each issue has exactly 14 slots:
1 cover, 3 featured, 10 briefs. Empty slots render as dashed placeholders.

### Lifecycle
- `draft → published`, one direction. Published issues are frozen — the
  API rejects slot mutations on them with HTTP 409 `issue_frozen`.
- **At most one draft at a time.** `POST /api/issues` returns HTTP 409
  `{ error: 'draft_exists', draft_id }` if a draft already exists. The
  **Discard** button in the workspace header deletes the current draft
  (and all its slot assignments) so a new one can be started.
- Publishing a **partial** issue is allowed — any slot count from 1 to 14
  will publish. Empty slots render as muted placeholders on `/issues/[id]`.
- Assigning an inbox video to any slot auto-promotes its consumption
  status `inbox → saved` in the same transaction. Clearing or swapping a
  slot does **not** demote.

### Where published issues live
- `/issues` — reverse-chron grid of all published issues.
- `/issues/[id]` — read-only magazine-style view.

### Desktop only
The drag-and-drop workspace is **desktop-only**. On a mobile user agent
the home page renders an "open on desktop" message; `/library`,
`/issues`, `/issues/[id]`, and `/watch/[id]` remain fully mobile. There
is no touch drag-and-drop fallback in this phase.

### URL change
`/inbox` has been **removed**. Triage now happens inside the editor
workspace by dragging videos from the pool into slots, or dismissing
them with the hover button on the pool card. Bookmarks to `/inbox`
will 404.

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

No UI surfaces this yet. It is read by later changes (`taste-lab`,
`overnight-brief`, `editorial-agent`). Storage overhead is ~35 MB for 5,665
videos' embeddings plus variable transcript text.

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

`/taste` is the human-tending surface for the cluster map. Phase 1
(`taste-substrate`) populated the map; phase 2 (`taste-lab`) makes it
editable.

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
- A drift indicator in the masthead — the count of liked videos
  (`consumption.status IN ('saved','in_progress','archived')`) whose
  cluster-assignment cosine similarity is below 0.6. Hidden when fewer
  than 30 likes exist.

`/taste/[clusterId]` is the per-cluster page: full member list with
per-video similarity, a reassign dropdown per row, and Merge / Split /
Retire actions for the cluster as a whole.

### Editing rules

- **Labels** are free-form text; trimmed; an empty string is stored as
  `NULL`.
- **Weights** are floats in `[0.0, 3.0]`, step `0.1`. The agent (phase 3)
  will read these to scale theme emphasis. Today nothing reads them — the
  slider is **prospective**.
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
- Weights are stored but not consumed yet. They land in phase 3 of the
  conversational-editor umbrella, where the agent reads them to scale
  theme emphasis. Edit them ahead of time if you like — they will pick
  up where you left off when phase 3 ships.

## Editor agent

The home page at `/` gains a chat panel alongside the slot board once a
draft exists. The agent is bound to the current draft issue: it reads your
taste-cluster map, the draft state, and the inbox pool; calls a small set of
tools; and writes slot assignments through the same library path the drag
board uses. Conversations are persisted per draft and freeze when the
issue is published. Discarding a draft cascade-deletes its conversation.

### Model and cost

Default model is `claude-sonnet-4-6`. Set `AGENT_MODEL=claude-opus-4-7` in
`.env` for harder composition sessions (higher cost). Typical session cost:
**$0.05–0.20** at Sonnet pricing with prompt caching enabled. A runaway
tool loop is capped at `AGENT_MAX_TURNS` (default 10); worst case ~$0.50.

Prompt caching is enabled at two boundaries (system prompt + tool
descriptions, and the per-turn draft/pool/cluster snapshot) so repeated
turns within a session pay for only the new user message + assistant
response. TTL is 5 minutes — long idle gaps re-bill the prefix.

### Setup

1. Set `ANTHROPIC_API_KEY` in `.env`. See `.env.example`.
2. Restart `just dev`.
3. Visit `/` with a draft open — the chat panel should render to the
   right of the board at viewports ≥1280px, stacked below at narrower
   desktop widths, and hidden entirely on mobile.
4. Without a key, the chat panel renders a disabled card pointing back
   here. The board remains fully usable.

### Key rotation

Edit `ANTHROPIC_API_KEY` in `.env`, restart `just dev`. No app-side key
storage; the SDK client is lazily re-instantiated on first call per
process.

### Privacy posture

Every user turn (plus the bounded per-turn snapshot: cluster labels,
video titles/channels, current slot fill, draft title) is sent to the
Anthropic API. Anthropic's retention policy governs that data path.
Conversation turns are also persisted locally inside `events.db`
(`conversations`, `conversation_turns`). No third party beyond Anthropic
sees any of this. YouTube transcripts and video IDs may appear inside
tool results — `get_video_detail` truncates transcripts to 500 chars.

There is **no** local-model fallback for the conversational agent
itself. Local fallback remains available for embedding + enrichment
(see "Taste substrate").

### Force-dumping a runaway conversation

There is no separate "clear conversation" button. To abandon a
conversation mid-flight, click **Discard** on the draft — the
`conversations` row and all `conversation_turns` rows cascade-delete
along with the issue. Then start a new draft; a fresh conversation
begins automatically on the first message.

### No scheduled jobs

The editor agent runs only while a user is on `/` and sends a message.
No cron, no background workers, no `justfile` additions.

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
- **`/inbox` returns 404** — expected. The raw inbox page was removed
  in the editor-workspace change; use the editor at `/` instead.
- **Can't start a new issue, button is missing** — there is already a
  draft. Either finish it (Publish), or click **Discard** on the
  workspace header to throw it away. Only one draft may exist at a time.
