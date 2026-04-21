## Context

Folio's current data shape is the residue of two prior lives — an events app (`events` table, live-stream filters, "Lucky Pick") and a feed-reader pivot (`sources` bundles, RSS-driven `inbox`, algorithmic Today's Issue). The user is now pivoting a third time, toward an editor-driven video magazine whose corpus is their own YouTube library. Phase 1 of that pivot does two things in one change: it *adds* the new corpus (OAuth + Likes/Subs/Playlists) and it *removes* the old ingestion machinery (RSS pipeline, sources table, Today's Issue auto-compose) so the codebase doesn't carry two mental models.

Relevant current state:
- [db/migrations/003_videos_schema.sql:46](db/migrations/003_videos_schema.sql) — the `oauth_tokens` table already exists (`provider PRIMARY KEY`, access/refresh/expires/scope/updated_at) and has been stubbed since the pivot. This change finally writes to it.
- The `videos` table is keyed on the raw YouTube video ID and is reusable as-is. Channels table ditto.
- [openspec/changes/archive/2026-04-21-oauth-youtube-import/design.md](openspec/changes/archive/2026-04-21-oauth-youtube-import/design.md) — archived, never-implemented OAuth design. Several decisions there (loopback redirect, state in signed cookie, plaintext tokens in SQLite, lazy refresh) are adopted verbatim. Decisions that change are called out below.
- The app is a single-user local install on port 6060. Installed-app OAuth 2.0. Unverified-app warning is acceptable.
- This is Phase 1 of 4. Subsequent phases redesign `/inbox`, `/library`, `/`, and add the editor workspace + curation agent. Phase 1 must leave the app in a usable state on its own, not a half-migrated intermediate.

## Goals / Non-Goals

**Goals:**

- The user can connect their YouTube account once via OAuth consent and the tokens persist until they explicitly disconnect or Google revokes them.
- Three manual-trigger imports exist — Likes, Subscriptions→uploads, Playlists — and each is idempotent (re-running doesn't duplicate videos or overwrite user consumption state).
- Every imported video carries **provenance**: which user action brought it in, with what signal weight. Phase 4's curation agent will lean on this.
- The RSS pipeline and the algorithmic Today's Issue are fully removed — no dead code, no orphaned tables, no disabled-but-present verbs.
- The one-time data reset is explicit, ordered, and reversible-by-backup: the user runs `just backup-db` before the destructive migration runs.
- `justfile` and `RUNBOOK.md` accurately describe the app after this change, per the CLAUDE.md operational invariant.

**Non-Goals:**

- No AI, LLM calls, embeddings, or recommendations (Phase 4).
- No issue composition (Phase 2/3). `/` becomes a trivial empty state.
- No redesign of `/inbox` or `/library` UI (Phase 3). Only the data source changes.
- No Watch Later import. Google removed `WL` from the API in 2016; Takeout-based ingest is a separate future change.
- No automatic or scheduled re-import. The user rejected background sync. Manual only.
- No OAuth push (the app never modifies the user's YouTube state). Scope is `youtube.readonly` and stays that way.
- No multi-account support. `oauth_tokens.provider` is a PRIMARY KEY; one YouTube identity at a time is fine.
- No transcript fetching (Phase 4 concern).
- No encryption of tokens at rest. The threat model is "filesystem access to events.db," which is identical to the threat model for all other app state.

## Decisions

### 1. Installed-app OAuth flow with loopback redirect

Google "Installed application" OAuth 2.0 with redirect `http://localhost:6060/api/youtube/oauth/callback`. Adopted verbatim from the archived design. Device-code flow rejected — the user is already in a browser when they hit `/settings/youtube`.

The redirect URI's port is hardcoded to `6060` to match the dev port. If the user runs the app on a different port, OAuth breaks until they update Google Cloud Console. `/authorize` fails loudly with a clear error if `process.env.PORT` disagrees with the compiled-in port. Documented in `.env.example` and RUNBOOK.

### 2. State parameter in a signed HttpOnly cookie, not DB

CSRF state generated in `/authorize`, set as HttpOnly + `SameSite=Lax` cookie with 10-minute expiry, verified in `/callback`. Adopted from archived design. No DB round-trip for ephemeral flow state.

Signing key: a dedicated `OAUTH_STATE_SECRET` env var. If not set, the app generates one and writes it to `events.db` in a new `app_secrets` (key, value) table — first-run convenience, no .env change required. The secret is never logged.

### 3. Token storage: plaintext in `oauth_tokens`

Adopted from archived design. `events.db` is gitignored; "filesystem access" is the universal threat model for the whole app. No envelope encryption.

### 4. Lazy refresh inside the YouTube API client

`src/lib/youtube-oauth.ts` exposes `getAccessToken(): Promise<string>` which:
- reads the current `oauth_tokens` row
- if `expires_at` is more than 60 seconds away, returns the current access token
- otherwise POSTs to `oauth2.googleapis.com/token` with `grant_type=refresh_token`, updates the row (new access_token, new expires_at, same refresh_token), and returns the new access token
- if the refresh call returns `invalid_grant`, throws a typed `TokenRevokedError`.

`src/lib/youtube-api.ts` wraps every API call. On `401`, it forces a refresh and retries **once**. On `TokenRevokedError`, it propagates — the import route maps it to HTTP 409 with `{ needs_reconnect: true }` and the settings page surfaces a "Reconnect YouTube" banner.

Deviation from the archived design: the archived design said `invalid_grant` should be surfaced "without disabling existing sources (they keep fetching via RSS)" — that clause is moot because RSS is being deleted.

### 5. Provenance model: many-to-one with videos

A new `video_provenance` table:

```sql
CREATE TABLE video_provenance (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('like', 'subscription_upload', 'playlist')),
  source_ref TEXT,                     -- playlist id for 'playlist', NULL otherwise
  imported_at TEXT NOT NULL,           -- UTC ISO
  signal_weight REAL NOT NULL,         -- 1.0 | 0.3 | 0.7 (see below)
  PRIMARY KEY (video_id, source_kind, source_ref)
);
CREATE INDEX idx_provenance_video ON video_provenance(video_id);
CREATE INDEX idx_provenance_kind ON video_provenance(source_kind);
```

Signal weights (Phase 4 will consume these; Phase 1 just records them):

| `source_kind` | weight | rationale |
|---|---|---|
| `like` | 1.0 | explicit endorsement |
| `playlist` | 0.7 | deliberate curation, not necessarily endorsement |
| `subscription_upload` | 0.3 | trust in channel, not the video |

The composite PK means a video in both Likes and a playlist gets two rows — correct, because the *signal* is multi-sourced. Re-importing Likes doesn't insert duplicates (ON CONFLICT DO UPDATE on `imported_at` and `signal_weight`, both idempotent).

**Alternative considered:** put provenance columns directly on `videos`. Rejected — a video legitimately has multiple origins, and the videos table shouldn't grow a 1:N relationship into a column.

### 6. Consumption-state defaults on import

When an import creates a NEW `videos` row, the orchestrator also inserts a `consumption` row with a provenance-dependent default status:

| `source_kind` | default `consumption.status` | rationale |
|---|---|---|
| `like` | `saved` | user already endorsed it |
| `playlist` | `saved` | user deliberately collected it |
| `subscription_upload` | `inbox` | unreviewed, from trusted channel |

When an import sees an EXISTING `videos` row, the consumption row is **left untouched**. This is the idempotence guarantee: re-importing never clobbers user state.

One edge case: if a video is imported via Likes (→ `saved`) and later appears as a subscription upload, the existing `saved` state wins — we don't demote to `inbox`. Correct behavior.

### 7. Subscription imports fetch per-channel uploads via `playlistItems`, not `search.list`

For each subscribed channel, we fetch `channels.list?id=<UCxxx>&part=contentDetails` to get the uploads playlist ID (`UUxxx` — always derivable as `UC` → `UU`, but we resolve via API to be safe), then paginate `playlistItems.list?playlistId=UUxxx&maxResults=50` until we've collected `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` (default 25) most-recent videos.

**Alternative considered:** `search.list?channelId=...&order=date`. Rejected — `search.list` costs 100 quota units per call vs `playlistItems.list` at 1 unit. For ~100 subscriptions that's 10,000 units (entire daily quota) vs ~100 units.

**Alternative considered:** fetch only `activities.list?channelId=...`. Rejected — activities omits videos older than ~30 days, and we want to seed the corpus with a reasonable backlog on first import.

### 8. Likes import via the `LL` pseudo-playlist

`playlistItems.list?playlistId=LL&mine=true` returns the authenticated user's liked videos. Paginate fully (no limit — Likes is a deliberate action, the user's total count is bounded and they want them all).

### 9. Playlist imports are two-step

- `GET /api/youtube/import/playlists` with no body → returns `{ playlists: [{ id, title, item_count, thumbnail }] }` from `playlists.list?mine=true`. Does NOT import anything. Settings page renders the list.
- `POST /api/youtube/import/playlists/:id` → imports one playlist's items.

**Alternative considered:** a single "Import all my playlists" button. Rejected — playlists often contain videos the user doesn't want in Folio (watch-later dumps, music queues, save-for-client work). Per-playlist opt-in is the correct affordance.

### 10. Settings page is server-rendered with small client islands

`/settings/youtube/page.tsx` is an RSC that reads `oauth_tokens`, last-import timestamps (from a new `import_log` table — see below), and the cached playlist list. The Connect button is a `<form action="/api/youtube/oauth/authorize">` — no client JS for auth. Import buttons are small client components that POST and show progress + result counts inline.

```
┌──────────────────────────────────────────────────────────────┐
│ Settings · YouTube                                           │
│                                                              │
│ Connected as: Jane Doe (jane@gmail.com)      [Disconnect]    │
│                                                              │
│ Import                                                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Likes                Last: 2026-04-21 10:02   [Import] │  │
│  │ Subscriptions        Last: 2026-04-21 10:05   [Import] │  │
│  │ Playlists            Last: never          [Load list]  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│ Your Playlists (6)                                           │
│  • Tech Deep Dives (42 videos)                    [Import]   │
│  • Saved for Later (17 videos)            ✓ imported 10:15   │
│  • …                                                         │
└──────────────────────────────────────────────────────────────┘
```

### 11. Import log table for reporting

New `import_log` table, append-only:

```sql
CREATE TABLE import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                  -- 'like' | 'subscription_upload' | 'playlist'
  source_ref TEXT,                     -- playlist id for 'playlist'
  started_at TEXT NOT NULL,
  finished_at TEXT,                    -- NULL = in progress
  status TEXT NOT NULL,                -- 'running' | 'ok' | 'error'
  videos_new INTEGER NOT NULL DEFAULT 0,
  videos_updated INTEGER NOT NULL DEFAULT 0,
  channels_new INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
```

Settings page shows "Last import" per kind as `MAX(finished_at) WHERE kind = ? AND status = 'ok'`. Simple. Gives the user an audit trail without a separate observability story.

### 12. The destructive migration

A single new migration `010_library_pivot.sql`:

```sql
BEGIN;

-- Drop old ingestion + algorithmic-issue tables.
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS issues;

-- Truncate content tables for a fresh corpus. (DELETE is the SQLite idiom; no TRUNCATE.)
DELETE FROM consumption;
DELETE FROM channel_tags;
DELETE FROM videos;
DELETE FROM channels;
DELETE FROM tags;
DELETE FROM sections;

-- Provenance + import log for the new corpus.
CREATE TABLE video_provenance ( ... );  -- as above
CREATE INDEX ...;
CREATE TABLE import_log ( ... );         -- as above

-- Signed-cookie secret store (Decision 2 convenience path).
CREATE TABLE app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

COMMIT;
```

The migration runs in a single transaction — it either completes or rolls back. There is no partial state.

**Safety gate:** the task plan puts `just backup-db` *before* the step that restarts the app. The migration runner itself does not check for a backup (there's no reliable signal — a user could rename the backup, or have one from a year ago). Responsibility is in the task plan and RUNBOOK, with both calling it out in bold.

**Rollback:** `cp events.db.bak.<timestamp> events.db` and redeploy without the migration. The migration runner records applied migrations in `_migrations`, so restoring the backup restores a pre-migration `_migrations` row — the migration will re-apply next boot if we're not careful. Mitigation: the RUNBOOK rollback section says to restore the backup AND `git revert` the migration commit in one step.

### 13. `justfile` + RUNBOOK updates in the same change

Per CLAUDE.md operational invariant. Concretely:

- **Remove** from justfile: `fetch`, `cron-install`, `cron-uninstall`, `seed`.
- **Add** to justfile: `youtube-auth` (prints the authorize URL), `youtube-import LIKES|SUBS|PLAYLIST=<id>` (POSTs the matching endpoint via curl).
- **Remove** from RUNBOOK: the cron + RSS ingestion sections.
- **Add** to RUNBOOK: "YouTube OAuth" (Google Cloud setup, scopes, token storage, reconnect flow), "Data reset" (the one-time migration, backup-first procedure, rollback).
- Update `Last verified:` to today's date.
- `package.json`: drop the `fetch` script.

### 14. Home page in Phase 1

`src/app/page.tsx` becomes a trivial RSC that reads `oauth_tokens` to detect connection status:

- **Not connected**: "Welcome to Folio. Connect your YouTube account to begin → [Go to Settings]".
- **Connected, empty corpus**: "Import your library to get started → [Go to Settings]".
- **Connected, non-empty corpus**: "Your library has N videos across M channels. Browse → [/inbox] or [/library]. Composing issues — coming soon."

No composition logic, no `issues` reads, no live-now strip. Phase 3 redesigns this.

## Risks / Trade-offs

- **[Risk]** Destructive data reset is irreversible without the backup. User could skip the backup step. → **Mitigation:** `just backup-db` is step 1 in tasks.md, bolded in RUNBOOK, and referenced in the proposal. The migration is gated behind "user restarts dev server" (i.e., user reads the RUNBOOK during setup). Not automated because any automation would falsely imply safety we can't guarantee.
- **[Risk]** Google "unverified app" warning on first consent may be disorienting. → **Mitigation:** RUNBOOK explicitly calls out the warning, screenshot in the docs, explains it's expected for single-user local installs and how to click through ("Advanced → Go to Folio (unsafe)").
- **[Risk]** Refresh token revocation (user revokes in Google security settings, or inactivity expiry). → **Mitigation:** `TokenRevokedError` propagates to a "Reconnect" banner on the settings page. Imports fail gracefully; existing data is untouched.
- **[Risk]** Quota exhaustion on a big Likes list. → **Mitigation:** `playlistItems.list` is 1 unit/page, 50 items/page. 10,000 Likes = 200 pages = 200 units. Daily quota is 10,000. Fine even for prolific users. Documented in RUNBOOK.
- **[Risk]** User's YouTube has a 10,000-item playlist that would take a long time to import. → **Mitigation:** per-playlist progress indication in the settings UI; the import endpoint streams Server-Sent Events OR returns a job id the client polls. Start with synchronous POST + in-flight spinner; upgrade to SSE only if import duration exceeds ~30s in practice.
- **[Risk]** Loopback redirect port drift — if the user changes `PORT`, OAuth breaks. → **Mitigation:** `/authorize` asserts the runtime port matches the expected `6060` and returns a clear error with remediation steps if not.
- **[Risk]** Deleting `src/fetchers/` deletes code someone might still want. → **Mitigation:** git history preserves it. The archived proposal at `openspec/changes/archive/2026-04-21-oauth-youtube-import/` already referenced the fetcher architecture as prior art; if Phase 2+ ever needs RSS again, it's a git revert away.
- **[Trade-off]** Choosing `playlistItems.list` for subscription uploads (Decision 7) means we always fetch exactly the most-recent N per channel, regardless of how often the user re-imports. If the user re-imports after 2 weeks of silence, they'll miss uploads older than position N but newer than their last import. → **Accepted:** Phase 1 is a corpus-seeding exercise, not a real-time sync. Phase 4 can add a "since last import" incremental path if needed. Manual-only cadence means the user is in control.
- **[Trade-off]** Per-playlist opt-in (Decision 9) means more clicks than a bulk "import everything" button. → **Accepted:** the user explicitly described this as a "sacred task." Deliberate pace is a feature, not a bug.

## Migration Plan

Ordered steps for the user (mirrored in `tasks.md`):

1. **Back up the DB.** Run `just backup-db`. Confirm the backup file exists.
2. **Uninstall the system cron entry.** Run `just cron-uninstall` (current command, still exists at this point in the migration sequence). This is done *before* the code change is merged, because `cron-uninstall` is being deleted.
3. **Create Google OAuth credentials.** Google Cloud Console → OAuth 2.0 Client ID → Web application → register `http://localhost:6060/api/youtube/oauth/callback`.
4. **Add env vars.** `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET` in `.env`.
5. **Pull the code change + run migrations.** `npm install && npm run dev` — migration `010_library_pivot.sql` runs on boot, destructively resetting the DB.
6. **Connect YouTube.** Open `/settings/youtube`, click Connect, consent.
7. **Import.** Click Likes → Subscriptions → Playlists (load list, import individually).
8. **Verify.** `/inbox` shows subscription uploads. `/library` shows Likes + imported playlists.

**Rollback:** `git revert <migration-commit>` AND `cp events.db.bak.<timestamp> events.db`. Both steps required — see Decision 12.

## Open Questions

- **Should Likes preserve the user's "like order"?** YouTube returns Likes in reverse-chronological-added order, which is usually what the user expects. We store `imported_at` per provenance row but not a "position in Likes." Acceptable for Phase 1; Phase 4 can reconsider if ordering matters for curation.
- **Should playlist imports track deletions?** If the user re-imports a playlist after removing a video from it, should that video's provenance row be deleted? **Proposed answer**: No in Phase 1. Provenance is append-only; a playlist `source_ref`'s absence on re-import is just... absence. The video stays in the corpus via whatever other provenance it has (likes, other playlists). If it has none, it becomes an orphan — still in `videos`, just no active provenance. Phase 4 can add a "prune orphans" tool if the user asks.
- **Should the subscription-upload limit be per-channel or global?** Proposed: per-channel, `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` default 25. Global would be weird ("why did channel A only give me 3 videos and channel B gave me 30?"). Documented in design; open for user input during implementation if they prefer otherwise.
- **Disconnect behavior.** Should Disconnect delete the token, delete the imported videos, or just delete the token and keep the corpus? **Proposed**: delete the token only. The corpus is already in the DB; deleting it on disconnect would be surprising and destructive. Re-connecting later just reuses the existing corpus. Documented in RUNBOOK.
