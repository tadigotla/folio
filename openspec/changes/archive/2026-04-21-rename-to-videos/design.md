## Context

The live-events aggregator was built around a pull-from-many-sources, time-boxed-events model. In practice, almost all content worth engaging with comes from YouTube, and the value isn't "catching something live" — it's discovering, triaging, consuming incrementally, and later reviewing. The current schema (`events` with status=scheduled/live/ended, `picks` for conflict resolution, `watched` as a boolean) doesn't model that workflow.

This change is the foundation for three follow-ons:
- `oauth-youtube-import` — importing liked videos, subscriptions, playlists from the user's private YouTube account
- `incremental-consumption` — IFrame Player API for position tracking and timestamped highlights capture
- `spaced-review` — hybrid SM-2-style review surfacing both videos and highlights on a schedule

Each of those assumes a `videos` table, a `consumption` lifecycle, a `channels` registry, and stub `highlights` / `oauth_tokens` tables are already in place. This change provides exactly that and keeps the app functional in between — the user can ingest via RSS, triage in the Inbox, save to the Library, and watch — but none of the follow-on power is yet wired up.

Constraints carried forward:
- SQLite via `better-sqlite3`; migrations in `db/migrations/NNN_*.sql` applied by lexical order.
- Next.js 16 + React 19. RSCs read SQLite directly; API routes exist only for mutations.
- Tampa time (`America/New_York`) via `src/lib/time.ts` for all display formatting.
- Dev server on port 6060, cron entrypoint via `tsx scripts/run-fetchers.ts`.

## Goals / Non-Goals

**Goals:**
- Single migration sequence that creates the new schema, moves usable existing data into it, and drops the old tables — no long-lived dual-schema period.
- YouTube RSS ingestion keeps working end-to-end the moment the change lands.
- App remains usable: Inbox, Library (Saved / In Progress / Archived), and the player view all render and navigate correctly.
- Schema is shaped right for the next three changes. In particular, `consumption.status_changed_at` is present now so `spaced-review` can build its due-queue against it without a schema change later.
- Legal state transitions are enforced at the mutation layer (typed TS functions), not merely documented.

**Non-Goals:**
- OAuth, token refresh, or any private-YouTube-account import. Stub table only.
- IFrame Player API, position tracking, any move from `saved` → `in_progress`. The In Progress list renders empty in this change.
- Timestamped highlights capture. Stub table only.
- Spaced repetition fields (`sr_ease`, `next_review_at`, etc.). Deferred to `spaced-review`.
- Tags / collections. Categories are being removed; tag-based organization is not being added in this change.
- Keyboard-driven triage. Click-to-act is sufficient for this change; keyboard comes with `incremental-consumption`.
- Bookmarklet, paste box, or any manual add flow. All video arrivals are via existing RSS ingestion.
- Migration reversibility. This is a one-way pivot; no rollback beyond "restore `events.db` from backup".

## Decisions

### Primary key on `videos` is the raw YouTube video ID, not a composite

Currently `events.id` is `${sourceId}:${sourceEventId}` (e.g. `youtube_culture:dQw4w9WgXcQ`). That let one video ingested from two sources produce two rows. In the new world, a video is a single thing regardless of how it was discovered; "how it got here" belongs in a separate relation (which this change does not add — it will be `discovery_events` in `oauth-youtube-import`).

- **Alternative considered:** keep the composite key. Rejected because it makes the `consumption` table awkward (one video could have two consumption rows) and duplicates the identity work YouTube already did for us.
- **Consequence:** during migration, if two existing `events` rows share the same YouTube video ID, the one with the more recent `updated_at` wins; the other is dropped.

### Drop the `category` enum and column entirely, not just deprecate

Category is currently a denormalized label attached per-event. With categories of interest shifting away from fixed buckets ("space", "news") toward user-defined organization (tags, playlists, channel-groupings), preserving category as a soft-deprecated column would just be dead weight.

- **Alternative considered:** keep `category` as freeform text. Rejected because it would leak into UI and queries until actively ripped out, which is more work than doing it now.
- **Consequence:** any existing filtering or grouping by category is deleted. Tagging comes in a future change.

### `consumption` is a separate 1:1 table, not columns on `videos`

`videos` holds content metadata (what it IS). `consumption` holds user state (what the user DID). Keeping them separate:
- Makes re-import / re-ingest safe — a background fetch can freely update `videos` without touching consumption state.
- Matches the upcoming `highlights` and future `sr_state` tables in shape.
- Lets us express "video exists but consumption row missing" as a repair condition rather than a nullable-column mess.

- **Alternative considered:** flatten into `videos.status`, `videos.status_changed_at`, etc. Rejected for the reasons above.
- **Consequence:** every query joins `videos` to `consumption`. For an app of this size that is fine; index `consumption(status, status_changed_at)` for list queries.

### Default new videos to `inbox`, not `saved`

The user chose a **triage** model over an auto-save model. New RSS ingestions go to inbox, user must act to save. Dismissed items stay dismissed forever (simpler than an expiring "seen" flag).

- **Alternative considered:** auto-save and use "unread" as a visual marker. Rejected — the user explicitly chose triage.
- **Consequence:** if RSS floods a lot of videos the user isn't interested in, the inbox fills up. Acceptable for now; a filtering/muting feature can be added if it becomes a problem.

### Legal-transition enforcement lives in a single TS helper, not the database

We don't use CHECK constraints or triggers for the transition matrix. Instead, `setConsumptionStatus(videoId, next)` is the only entry point for status changes and validates the transition against the current value.

- **Alternative considered:** CHECK constraints / triggers. Rejected — SQLite's constraint language for "allowed transitions" (current-value-dependent) is clunky, and centralizing in TS makes the rules readable in one place alongside the UI actions that invoke them.
- **Consequence:** bypass by direct SQL is possible. Acceptable — this is a single-user local app.

### `is_live_now` is recomputed per-fetch, not maintained by a sweep

RSS doesn't tell us when a live stream ends. Rather than building a sweep, we let `is_live_now` be set only by sources that positively know live state (none yet — RSS sets it false), and re-evaluated on every successful fetch. When OAuth import arrives, it can set `is_live_now` from `liveBroadcastContent`; until then, live-ness remains false, which is acceptable (this change isn't about live streams).

- **Alternative considered:** keep a sweep that flips live→not-live after N hours. Rejected — no need given no source writes `is_live_now = true` in this change.
- **Consequence:** the "Live Now" home strip will be empty until `oauth-youtube-import` lands. That's fine.

### Sweep, picks, and always_on are deleted, not migrated

- Old `events.status = 'ended'` rows: the corresponding video rows are migrated with no lifecycle-state equivalent. They land in `inbox` like fresh rows. Rationale: after archive of this change, `ended` had no meaning; the user either wants to triage or not.
- `picks` table: dropped. Conflict resolution doesn't apply.
- `always_on`: those rows all came from non-YouTube sources being removed; nothing to migrate.

### Existing `watched` rows become `archived`, not `saved`

A video the user explicitly marked watched in the old app is closer to "I'm done with this" than "I want to watch it." Put them in Archived so they are retrievable but not cluttering Saved.

- **Alternative considered:** put them in Saved. Rejected — likely to fill Saved with stale content the user has already consumed.
- **Consequence:** users will see a possibly-large Archived list on first load. Acceptable.

### Migrations: one file, additive first, then cleanup

```
003_videos_schema.sql       — create videos, channels, consumption,
                              highlights stub, oauth_tokens stub
004_backfill_from_events.sql — copy YT rows into videos + consumption,
                              populate channels from distinct channel IDs,
                              migrate watched → consumption(archived)
005_drop_events.sql         — drop events, picks, watched;
                              delete non-YT rows from sources
```

Three files rather than one for readability and because if something goes wrong mid-backfill we can re-run 005 separately after fixing data manually.

### The `sources` table stays — scoped down

`sources` is still the right home for registered YouTube channel feeds (where to fetch, how often, last error). It is NOT the home for channel identity — that's `channels`. Think: `sources` = polling config, `channels` = the YouTube entity itself.

- **Consequence:** one YouTube channel ID might appear in both tables; they are not merged. When OAuth subscription import arrives, it writes to `channels` only. If the user adds a channel as an RSS feed, they get a `sources` row too.

### Fetchers change shape: `NormalizedEvent` → `NormalizedVideo`

New type in `src/lib/types.ts`:

```ts
interface NormalizedVideo {
  videoId: string;
  title: string;
  description?: string;
  channelId: string;
  channelName: string;
  publishedAt: string;       // ISO UTC
  durationSeconds?: number;  // RSS doesn't carry this; fill later via OAuth/API
  thumbnailUrl?: string;
  isLiveNow: boolean;
  scheduledStart?: string;
  raw: unknown;
}
```

`Fetcher` becomes `{ sourceId: string; fetch(): Promise<NormalizedVideo[]> }`. Only the YouTube channel fetcher remains.

## Risks / Trade-offs

- **[Losing historic event data]** → Rows from non-YouTube sources are discarded outright. Mitigation: take a pre-migration backup of `events.db` (the justfile/RUNBOOK should gain a backup step before running migrations). This is a one-way change; the project accepts that.
- **[Backfill leaves `duration_seconds` and `published_at` partially null]** → RSS feeds do carry `<published>` (good), but duration isn't in RSS. Mitigation: leave nullable; duration is populated later via the Data API (OAuth change) or remains null indefinitely. Library/Inbox UI must handle null duration gracefully.
- **[Primary key collision during migration]** → Two `events` rows with the same YouTube ID produce a conflict. Mitigation: migration uses `INSERT OR REPLACE` and picks the most-recently-updated row; log the count of conflicts.
- **[Transition enforcement bypassed by raw SQL]** → Because rules live in TS, someone writing direct SQL queries could put a row into an illegal state. Mitigation: all mutations go through `src/lib/consumption.ts`; API routes call only that helper. Acceptable risk for a single-user app.
- **[Empty In Progress list is confusing]** → Users might wonder why it exists. Mitigation: the empty-state note reads "Comes alive in the next release" or similar — copywriting, not code.
- **[Operational invariant]** → `RUNBOOK.md` and `justfile` must be updated in the same change (drop 5-min cron, mention 30-min default, remove non-YT source mentions, add a pre-migration DB backup tip, update `Last verified` date). This is a project rule, not optional.

## Migration Plan

1. **Backup.** Before running migrations, copy `events.db` to `events.db.pre-pivot.bak`. Document this in `RUNBOOK.md`.
2. **Apply schema.** Run `npm run fetch` (or direct `tsx db/seed-sources.ts`) which invokes `runMigrations()`. New migrations 003–005 apply in order.
3. **Verify data.** Counts to check post-migration:
   - `SELECT COUNT(*) FROM videos` roughly equals pre-migration count of YouTube-sourced `events`.
   - `SELECT COUNT(*) FROM consumption WHERE status = 'archived'` equals pre-migration `watched` row count.
   - `SELECT COUNT(*) FROM channels` equals distinct channel IDs across videos.
4. **Sanity-check ingestion.** Run `npm run fetch` a second time; no new videos should be inserted if feeds are stable. `sources.last_error` should be NULL for YT sources.
5. **Update ops docs.** `RUNBOOK.md` gets: drop non-YT service rows, new cadence, backup step, updated last-verified date. `justfile` gets a `backup-db` verb.
6. **No rollback.** Restoring `events.db.pre-pivot.bak` is the rollback. Code changes are reverted via git.

## Open Questions

- Should the home page "Live Now" strip stay even though nothing will be live until `oauth-youtube-import` lands? Current spec says yes (it shows when non-empty and hides otherwise), which is fine for now.
- Should the app keep cron running at 30-min cadence or let the user trigger refresh manually? Leaning toward cron; ops doc can document both.
- What does the Archived list do when it gets huge (thousands of rows from old `watched` plus future archives)? No pagination in this change. If it becomes painful, add pagination or a "this month / this year / older" grouping in a follow-up — not blocking.
