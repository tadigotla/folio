## Stance

Folio is a **personal consumption tool**, not a publication. One reader (the owner), two moods (curate occasionally, consume mostly), one organizing primitive (playlist), one self-model (taste clusters) that actually steers what appears on the home page.

Three non-negotiable commitments frame every phase:

1. **`/` is a room, not a workbench.** Opening the app surfaces a small, shaped set of things to watch *right now*. It is not a board to arrange, not a draft to edit, not an inbox to clear.
2. **The taste lab matters.** `taste_clusters.weight` is read, not just written. Adjusting the self-map visibly rearranges the room.
3. **Curation is a mode, not the primary loop.** Triage, playlist editing, and cluster tuning live one click away, not in your face. Most visits never touch them.

These are identity commitments. If a later phase bends them, the pivot is not done.

## The new shape of `/`

```
┌────────────────────────────────────────────────────────────────────┐
│  FOLIO                                                  Wed, Apr 23 │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  FOR RIGHT NOW                                              ↻      │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐       │
│  │ card │  │ card │  │ card │  │ card │  │ card │  │ ✦    │       │
│  │      │  │      │  │      │  │      │  │      │  │serend│       │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘       │
│                                                                    │
│  CONTINUE                                                          │
│  ┌─────────────┐  ┌─────────────┐                                  │
│  │ ▓▓▓▓░░ 62%  │  │ ▓▓░░░░ 21%  │                                  │
│  └─────────────┘  └─────────────┘                                  │
│                                                                    │
│  FRESH · 14 new since Tue · all enriched · 1 cluster shift         │
│  [ browse fresh → ]                                                │
│                                                                    │
│  PLAYLISTS                                                         │
│  Morning coffee · Research: compilers · Slow Sunday · + New        │
│                                                                    │
│  · Inbox (8) · Library · Taste · Tags                              │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Notes:

- **No issue, no cover, no slots, no publish.** The home is a view, not an artifact. Regenerate any time with ↻; state is not persisted as a "draft".
- **Serendipity slot** is one pick that's on-taste but far from the user's top clusters — the anti-filter-bubble release valve.
- **Continue** reads `consumption` where `status='in_progress'` and `last_position_seconds` is set.
- **Fresh** is a one-liner counter + link to a pre-sorted `/inbox`. No brief prose, no cards inline.
- **Playlists** is a horizontal strip of user-defined playlists (chrono or pinned order). "+ New" opens a create-playlist affordance.
- The **chat panel is gone from `/`**. The agent is reachable from `/taste` and from within `/playlists` where it earns its keep (curation verbs), and optionally from a dedicated `/chat` surface if the user wants one. Phase 3 decides final placement.

## Playlists vs. tags vs. sections — the taxonomy collapse

Current state: three overlapping taxonomies — **sections** (1:1 channel→section, structural), **tags** (many-to-many channel tags, additive slicing), **playlists** (not yet existing). This is one too many for a one-user consumption tool.

Collapse to two:

| | Playlist | Tag |
|---|---|---|
| Cardinality | video ↔ many playlists | video ↔ many tags (via channel_tags) |
| Ordered | yes | no |
| Purpose | mood / project / session | slicing, browse, search |
| User-authored | yes (explicit) | yes (assignable from `/tags`) |
| On home? | yes (optional per playlist) | no (but `/tag/:slug` survives) |
| Example | "Morning coffee", "Research: compilers" | `#philosophy`, `#longform`, `#live-demo` |

**Sections are dropped.** Migration: each `sections` row becomes a tag of the same name; every `channels.section_id` becomes a `channel_tags` row using that tag; `channels.section_id` column and `sections` table are removed. This is a one-shot migration in phase 4.

The `/section/[slug]` pages are removed; `/tag/[slug]` pages remain.

## Closing the taste loop — `rankForHome()`

The central new function. Called by `/` and by phase-5's nightly precompute.

```
rankForHome({
  pool: Video[],               // candidate pool
  targetSize: number,           // default 6
  now: Date,                    // for freshness decay
  moodHints?: {
    maxDurationSeconds?: number,  // e.g. 900 = "short only"
    mutedClusters?: number[],     // cluster IDs to zero-weight this call
  },
  excludeVideoIds?: string[],   // e.g. already in Continue rail
}): Video[]
```

Scoring per video:

```
score = base_relevance × cluster_weight_product × freshness_decay × state_modifier

base_relevance    = mean cosine(v.embedding, c.centroid) over clusters c where v ∈ c
cluster_weight_   = product over clusters c where v ∈ c of max(0, c.weight)
  product           (weight is a multiplicative modulator, default 1.0, range 0.0–2.0)
freshness_decay   = exp(−(now − v.published_at) / τ),  τ = 14 days
state_modifier    = {
  inbox:       1.0,
  saved:       1.2,    // user explicitly kept it
  in_progress: 0.0,    // excluded entirely; it's on the Continue rail
  archived:    0.0,
  dismissed:   0.0,
}
```

Pool selection for home ranking:

- `inbox` and `saved` rows, optionally bounded to the last 90 days.
- Excludes anything in `in_progress` (Continue rail) and anything in `excludeVideoIds`.

Final selection:

1. Take top `targetSize − 1` by score.
2. Pick one **serendipity** slot: from the pool *minus* the top picks, choose the video with highest base_relevance × freshness_decay among those whose dominant cluster is NOT in the user's top-3 weighted clusters. Floor on base_relevance so it stays on-taste.
3. Return in display order: top pick first, serendipity last (visually distinguished).

**Weight semantics:**

- `taste_clusters.weight` is written by `/taste` via `src/lib/taste-edit.ts`, already in place.
- Semantic defined here: `0.0` = muted (zero contribution), `1.0` = neutral (default), `2.0` = boosted (doubles contribution). Clamped on write in phase 2.
- "Mute cluster today" is an ephemeral override that does NOT write to `taste_clusters.weight`; it sets `moodHints.mutedClusters` for the current home regenerate only. Scope decision: session-only, not persisted. If the user wants persistent mute, they set `weight = 0` in the lab.

**Determinism:** ranking is deterministic given the same inputs (pool, weights, moodHints, now truncated to the hour). The ↻ button advances the "now" truncation to allow refresh without random shuffle.

## Agent reorientation — from editor to curation companion

Old tool set (seven tools, slot-biased):

```
search_pool, rank_by_theme, get_video_detail, get_taste_clusters,
assign_slot, swap_slots, clear_slot
```

New tool set (~ten tools, curation-biased):

```
# read (unchanged)
search_pool           - query the pool by text / cluster / tag / recency
rank_by_theme         - return top-N videos for a described theme
get_video_detail      - full metadata + enrichment + clusters for one video
get_taste_clusters    - read-only view of cluster map

# playlist mutation (new)
create_playlist       - create a named playlist; optional show_on_home
add_to_playlist       - append / insert at position
remove_from_playlist  - remove a video
reorder_playlist      - move a video to a new position

# curation helpers (new)
triage_inbox          - batch: propose save/dismiss for each inbox item,
                        returns proposals; user confirms before commit
mute_cluster_today    - session-scoped; adjusts home ranking for this session only
resurface             - "find me the thing I saved ~N months ago about X" —
                        searches library across enrichment + title + transcripts

# slot verbs — REMOVED
# assign_slot, swap_slots, clear_slot → deleted
```

House-style prompt rewritten to drop editor-in-chief framing. The agent is a *curator's assistant*, not an editor. It never talks about "cover" or "issue" or "publish"; it talks about playlists, clusters, and what you might want to watch.

**Agent never writes to taste tables.** Cluster edits remain exclusively on `/taste`. Same policy as phase-3.

**Conversation scope: per-day (locked).** Phase 3's `conversations` table is 1:1 with issues. Post-magazine, that coupling is nonsense. The new shape: one `conversations` row per calendar date in `America/New_York`, created lazily on the first agent turn of the day. Concretely:

```sql
-- After phase 4 reshape:
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_date TEXT NOT NULL UNIQUE,   -- 'YYYY-MM-DD' in America/New_York
  created_at TEXT NOT NULL
);
-- conversation_turns is unchanged structurally; only its parent FK target changes.
```

Why per-day vs. alternatives:

- **vs. per-playlist:** playlists aren't always the subject of chat; curation can cross many playlists in one session. Forcing a playlist context to open chat adds friction.
- **vs. stateless:** the "what did we talk about yesterday" affordance is cheap to keep and valuable for the curation mood.
- **vs. per-session:** session boundaries are fuzzy; calendar day is a clean, auditable unit.

Migration of existing `conversations` rows in phase 4: their `issue_id` FK is dropped and each row is rewritten to use `scope_date = DATE(created_at)` in NY time; conflicts (multiple existing conversations on the same day) are merged by concatenating `conversation_turns` in `id` order. If merging is too hairy on the real data, the fallback is drop-and-recreate (a personal tool's chat history is not load-bearing).

## Nightly job — from editorial to maintenance

The in-flight `overnight-brief` change plans a nightly job that drafts tomorrow's skeleton issue and writes a markdown brief. Both artifacts assume a publication framing. Both go.

Rescoped as `overnight-enrichment` in phase 5:

```
nightly:
  1. runMigrations()
  2. orchestrator fetch     # catches anything the 30-min cron missed
  3. embed new videos       # batches only what arrived since last run
  4. enrich new videos      # Ollama, transcripts, short summaries
  5. recluster incrementally  # cheap on small deltas; full rebuild only if drift > threshold
  6. precompute home pool   # score the pool so / renders instantly
  7. write nightly_runs row { run_at, counts, notes, last_error, status }
```

`morning_briefs` table (from in-flight phase-4) is replaced by `nightly_runs` with a trimmer schema:

```sql
CREATE TABLE nightly_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at     TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ok','failed','skipped')),
  counts     TEXT,           -- JSON blob: { new_videos, enriched, cluster_shifts }
  notes      TEXT,           -- short one-liner surfaced on /
  last_error TEXT
);
```

UI surface: the "FRESH" line on `/` reads the latest `nightly_runs.counts` + `notes`. No markdown rendered anywhere. No conversation turn scheduled during sleep.

If `overnight-brief` is already shipped when this umbrella begins, phase 5 migrates `morning_briefs` → `nightly_runs` (one-shot data copy) and drops the old table.

## Teardown plan — phase 4 specifics

This is the one-way door. A separate phase so it's isolated, reviewable, and preceded by a required backup.

Destructive steps (all inside one migration, `NNN_magazine_teardown.sql`):

```sql
BEGIN;

-- 1. Drop issue-related tables (cascades to issue_slots via FK):
DROP TABLE IF EXISTS issue_slots;
DROP TABLE IF EXISTS issues;

-- 2. Collapse sections → tags (data migration first, then drop):
INSERT OR IGNORE INTO tags (slug, name) SELECT slug, name FROM sections;
INSERT OR IGNORE INTO channel_tags (channel_id, tag_slug, created_at)
  SELECT c.id, s.slug, datetime('now') FROM channels c
  JOIN sections s ON c.section_id = s.id
  WHERE c.section_id IS NOT NULL;
ALTER TABLE channels DROP COLUMN section_id;
DROP TABLE IF EXISTS sections;

-- 3. Decouple conversations from issues:
--    (Strategy chosen in phase 3; example assumes per-day binding)
CREATE TABLE conversations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
-- Copy or archive existing rows per phase-3 decision, then swap.

-- 4. Drop morning_briefs if present (phase 5 will create nightly_runs):
DROP TABLE IF EXISTS morning_briefs;

COMMIT;
```

Code paths deleted in the same phase:

- `src/lib/issue.ts` (compose/pick/cover/effective)
- `src/app/api/issues/*`
- `src/app/section/[slug]/`
- `/sections` management page and its components
- Slot mutation helpers (`assignSlot`, `swapSlots`, `clearSlot` — already used by the drag board)
- Drag-board components on `/`
- `composeIssue`, `scoreVideoForCover`, `pickFeatured`, `pickBriefs`, `effectiveCoverId`, `setCoverPin`
- `/api/issues/publish` route

Required preconditions before phase 4 runs:

- Phase 3 shipped and burned in for ≥ 7 days.
- `just backup-db` run; timestamped copy retained.
- All `conversations` rows reviewed / exported if any are worth keeping.
- `CLAUDE.md` and `RUNBOOK.md` updated in the same change (per the operational invariant).

## Discovery (phase 6)

The corpus is closed-world by design — you only see videos from sources you've imported. Over time that becomes echo chamber. Phase 6 opens the world back up without re-inviting YouTube's recommender: two feeders into one user-gated surface.

### The anti-algorithm contract

Three invariants, enforceable across both feeders:

1. **Nothing imports without an explicit click.** Candidates are proposals, not imports. The pool only grows when the user says so.
2. **Sources are editorial or user-queried, never algorithmic.** Description-graph follows creator-to-creator links. Direct-search runs on the user's own query or a cluster-label-derived query. YouTube's `search.list` is allowed; `related_videos` / homepage / "up next" style endpoints are not.
3. **One-hop by default.** Description-graph expands one degree of separation from existing corpus. Two-degree expansion can be unlocked per-candidate (approving a one-hop channel lets its description-graph run next night), but the mechanism never cascades unsupervised.

### The two feeders

```
                     ┌──────────────────────────────┐
                     │  Nightly (phase 5 pipeline)  │
                     │                              │
                     │  • parse descriptions        │
                     │    of saved + in_progress    │
                     │    videos for YouTube links  │
                     │    and @handles              │
                     │  • parse transcripts for     │
                     │    explicit channel shout-   │
                     │    outs                      │
                     │  • score candidates against  │
                     │    taste clusters            │
                     │  • write new discovery_      │
                     │    candidates rows           │
                     └───────┬──────────────────────┘
                             │
(a) description-graph        │
─────────────────────────────┤
                             ▼
                     ┌──────────────────────────────┐
                     │ discovery_candidates table   │
                     └───────┬──────────────────────┘
                             ▲
(b) direct search            │
─────────────────────────────┤
                             │
                     ┌───────┴──────────────────────┐
                     │  Interactive (agent tool)    │
                     │                              │
                     │  user: "search youtube for   │
                     │         emacs config tours"  │
                     │  agent: search_youtube(…)    │
                     │         -> list of hits      │
                     │         -> ranked by taste   │
                     │         -> written as        │
                     │            discovery_        │
                     │            candidates rows   │
                     └──────────────────────────────┘
                             │
                             ▼
            ┌──────────────────────────────────┐
            │  /inbox "Proposed" rail          │
            │                                  │
            │  • thumbnail + title + why       │
            │  • [ Approve ]  [ Dismiss ]      │
            │                                  │
            │  Approve:                        │
            │   - new channel → write row to   │
            │     sources (user-kind),         │
            │     enqueue next fetch           │
            │   - new video in existing ch     │
            │     → insert video row,          │
            │     create inbox consumption     │
            │   - transcript / embed pipeline  │
            │     runs on next enrichment pass │
            │                                  │
            │  Dismiss: row → discovery_       │
            │   rejections; never re-proposed  │
            └──────────────────────────────────┘
```

### Schema

```sql
CREATE TABLE discovery_candidates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind       TEXT NOT NULL CHECK (source_kind IN
                      ('description_link', 'transcript_mention', 'search_result')),
  source_video_id   TEXT REFERENCES videos(id) ON DELETE SET NULL,  -- null for search_result
  target_kind       TEXT NOT NULL CHECK (target_kind IN ('channel', 'video')),
  target_channel_id TEXT,    -- UCxxxxxx, present iff target_kind='channel' OR video's channel
  target_video_id   TEXT,    -- raw YouTube video id, present iff target_kind='video'
  target_title      TEXT,    -- snapshot so the surface renders without a live fetch
  target_thumbnail  TEXT,    -- url snapshot
  taste_score       REAL NOT NULL,   -- cosine × weighted cluster match, 0..1
  explanation       TEXT NOT NULL,   -- human-readable why, e.g.
                                     -- "linked from @RecurseCenter you saved last week"
                                     -- "matches your 'Philosophy of Mind' cluster (0.82)"
                                     -- "you searched for emacs config tours"
  query             TEXT,    -- present iff source_kind='search_result'
  discovered_at     TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'dismissed'))
                      DEFAULT 'proposed'
);

CREATE INDEX idx_disc_cand_status ON discovery_candidates(status, taste_score DESC);
CREATE UNIQUE INDEX idx_disc_cand_target
  ON discovery_candidates(target_kind, COALESCE(target_video_id, ''), COALESCE(target_channel_id, ''))
  WHERE status = 'proposed';

CREATE TABLE discovery_rejections (
  target_kind       TEXT NOT NULL CHECK (target_kind IN ('channel', 'video')),
  target_channel_id TEXT,
  target_video_id   TEXT,
  rejected_at       TEXT NOT NULL,
  PRIMARY KEY (target_kind, COALESCE(target_video_id, ''), COALESCE(target_channel_id, ''))
);
```

The `discovery_rejections` table is intentionally narrow: only the identity of what the user said no to. Future discovery passes consult it before writing a new `discovery_candidates` row, so dismissed items don't come back. If the user wants to reconsider, they manually clear the row (a "forget my dismissals" action is out-of-scope for v1 — cheap to add later if wanted).

Approvals don't need their own table — on approve, we write the appropriate row(s) into `sources` / `videos` / `consumption` and delete (or mark `status='approved'`) the candidate.

### Ranking

```
discovery_score(candidate) =
    base_taste_match(candidate)       // cosine to nearest cluster × that cluster's weight
  × source_trust(source_kind, src)    // 1.0 for description_link from saved video,
                                      // 0.9 for transcript_mention,
                                      // 0.7 for search_result
  × novelty_bonus(candidate)          // +0.1 if target_channel_id is not in sources yet
```

A candidate with score < threshold (default `0.35`) is not proposed — we'd rather under-surface than drown the user. Threshold is a per-user constant in a small `discovery_settings` row (or just a constant for v1; configurable if the user asks).

### Description-graph feeder (phase 6a)

Runs inside the nightly job after enrichment:

1. For each video whose `consumption.status IN ('saved', 'in_progress')` and whose `video_enrichment` is fresh:
   - parse `videos.description` for YouTube links (`youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/@handle`, `youtube.com/channel/UC...`)
   - parse `video_transcripts.text` for lines that name a channel with a URL or `@handle`
2. Resolve handles to channel IDs via a single batched lookup (YouTube Data API `channels.list` with `forHandle=` param, 1 unit each; negligible quota).
3. For each unique target, if not already in `sources` (channel) or `videos` (video), and not in `discovery_rejections`, upsert into `discovery_candidates`.
4. Score and gate as above.

Nothing in this path requires the user to be present. The UI simply shows whatever's proposed next morning.

### Direct-search feeder (phase 6b)

New agent tool:

```ts
search_youtube(input: {
  query: string,           // user-provided or cluster-label-derived
  maxResults?: number,     // default 10
  channelId?: string,      // optional: constrain to one channel
  publishedAfter?: string, // optional ISO date
}): {
  candidates: Array<{
    kind: 'video' | 'channel',
    id: string,
    title: string,
    channelTitle: string,
    thumbnail: string,
    publishedAt: string,
    taste_score: number,
    explanation: string,
  }>
}
```

Server-side:

1. Calls `search.list?part=snippet&q=…&maxResults=…&type=video,channel` (100 units per call).
2. For each hit, compute a quick taste-score by embedding the title + channel title and running cosine against cluster centroids.
3. Filter out anything in `sources`/`videos` (already have it) or `discovery_rejections` (dismissed already).
4. Write the survivors as `discovery_candidates` rows with `source_kind='search_result'` and the original `query` preserved.
5. Return the candidates to the agent so it can present them in chat.

The agent is encouraged (by prompt) to show 3–5 candidates in chat with the explanation and let the user react there — but the canonical surface is still `/inbox`'s Proposed rail. In-chat approve/dismiss are sugar over the same underlying mutation.

Paired tool:

```ts
propose_import(input: { candidateId: number }): { ok: true }  // no-op if already proposed
```

This is not strictly necessary — `search_youtube` already writes candidate rows — but gives the agent a way to flag "I think *this one* is especially for you" by re-asserting a candidate, and is also used when the agent proposes something from an already-existing candidate (e.g., from description-graph) that the user seemed interested in.

### Quota and cost

- Description-graph: zero API quota (uses descriptions + transcripts already fetched).
- Handle-resolution for description-graph: `channels.list` is 1 unit per call, batchable up to 50 handles per call. Even a heavy-discovery night will cost < 50 units.
- Direct-search: 100 units per `search.list` call. 10,000/day free = 100 searches/day. For a single user this is vast.
- **Total daily quota at heavy use:** ~500 units. **At light use:** ~10–50 units. Well under the default free tier.
- Anthropic cost: direct-search's taste-scoring step is local (embeddings over the existing cluster centroids); no LLM call required to generate candidates. The agent's chat surfacing of candidates uses the normal interactive cost budget.

No new paid service. `YOUTUBE_API_KEY` env var added (a Google Cloud project with Data API v3 enabled). Different from the existing OAuth client used for library import — this is an unauthenticated key, separate credential.

### UI surface

Primary: a **"Proposed" rail at the top of `/inbox`**. Renders when `discovery_candidates` has any `status='proposed'` rows. Each card:

```
┌─────────────────────────────────────────────────────────────┐
│ [thumb] Title here                                          │
│         @ChannelName · 23 min                               │
│         linked from @RecurseCenter you saved last week      │
│         taste match: 0.82 (Philosophy of Mind)              │
│         [ Approve ]  [ Dismiss ]                            │
└─────────────────────────────────────────────────────────────┘
```

Ordering: `taste_score DESC`, then `discovered_at DESC`.

Secondary: the chat panel. When the agent calls `search_youtube`, it renders an inline mini-list of the top candidates with approve/dismiss buttons bound to the same mutation API. Any action in chat immediately reflects on `/inbox`'s Proposed rail.

### Approve semantics

Approving a candidate performs one of:

- `target_kind='channel'`: insert a `sources` row with `kind='youtube_channel'`, `id=${target_channel_id}_user`, enable it, enqueue a fetch. The next orchestrator tick pulls its recent videos into `inbox`.
- `target_kind='video'` where the channel is NOT in `sources`: insert both — the channel row as above *and* a `videos` row for the specific target, with a consumption row in `inbox`. Subsequent fetches keep the channel in sync.
- `target_kind='video'` where the channel IS already in `sources`: the video is likely to appear via RSS soon anyway, but we don't want to wait — fetch its metadata via `videos.list?id=…` (1 unit), insert `videos` + `consumption` directly.

All three branches end with the candidate's `discovery_candidates.status` set to `'approved'` (kept briefly for audit, swept after 30 days) and no `discovery_rejections` row.

### Open questions (phase 6 proposal will settle)

- Do we keep approved-candidate rows permanently as a provenance audit ("how did this video enter my pool?"), or sweep after N days? The `video_provenance` table exists and could be extended with a `discovery_candidate_id` FK instead of keeping the candidates table fat.
- Do cluster-label-derived queries run automatically during the nightly job (the agent proposes 1 search per cluster every N days) or only on explicit user request? Lean: explicit for v1 — "auto-search" feels closer to a recommender and harder to trust.
- Serendipity: should the home ranking's serendipity slot *also* pull from the Proposed rail on days when proposals are ripe? Probably yes, but opt-in — discovery candidates need to earn their way into the "for right now" rail, not shortcut in. Defer to a phase 6.x follow-up.
- Clear-rejections affordance: should there be a button in some admin corner to wipe `discovery_rejections`, or is the expected path "edit SQLite directly"? Lean: small button on `/settings` in v1.

## Risks and open questions

| Risk | Mitigation |
|---|---|
| Phase 2's rankForHome looks worse than the deterministic composer it replaces | Feature-flag the new home in phase 2; park it on a secondary route until phase 3 decides to flip |
| Serendipity slot feels random / off-taste | Tune base_relevance floor; make serendipity opt-in per regenerate if it keeps missing |
| Playlists proliferate and become a mess | No platform-side limits; if it's a problem, add a "last used" sort and `archived` flag in a later tweak |
| User misses the daily "artifact" feeling | Past home snapshots could be optionally persisted (cheap, a single JSON per day). Defer; add only if the feeling is missed after 30 days |
| conversational-editor umbrella's archived specs contradict new reality | Phase 4 archives/rewrites the affected specs (`editorial-workspace`, `home-view`, `editorial-agent`). Old specs are retained in archive for history |
| Taste weight scale is wrong (0–2 too narrow, or muting via 0 is too blunt) | First ship with 0–2 × default 1.0; if the user wants finer control, widen in a minor follow-up |
| Agent's "triage_inbox" bulk tool commits too aggressively | Tool returns proposals only; commit requires a follow-up `confirm_triage(batch_id)` call or equivalent UI confirmation |
| Description-graph explodes — one popular saved video with 50 linked channels floods the Proposed rail | Per-night cap (default 10 new candidates across all sources); overflow deferred. Score threshold (0.35) also bounds volume |
| Direct-search accidentally becomes "just YouTube search from inside my app" and loses the anti-algorithm stance | Search runs only on user-typed queries or cluster-label queries; no "trending" / "related" / "recommended" endpoints are wired. Prompt + RUNBOOK explicitly forbid widening |
| Rejected candidate keeps re-appearing because YouTube changes an ID / handle | `discovery_rejections` uses whatever stable identifier was rejected (channel UC… or video ID). Edge cases accepted; user can clear rejections if a ghost appears |
| YouTube API quota exceeded (heavy agent use) | Tool handles 429/403 explicitly, returns a user-friendly "quota reached — try tomorrow or use a description-graph candidate" `tool_result`. Never silent-fails |
| API key leakage | `YOUTUBE_API_KEY` is env-only, never logged in conversation turns. Sent server-side only. Documented in RUNBOOK's privacy section |

Open questions, answered in phase-specific design docs:

- **Phase 3:** where does the agent surface live? Inline on `/taste`, inline on `/playlists`, a dedicated `/chat`, or a floating button? (Conversation scope is fixed per-day; surface is still open.)
- **Phase 3:** is the `↻` button on the "For right now" rail an overt affordance or implicit (refreshes on navigation)?
- **Phase 5:** does `overnight-enrichment` run even when `ANTHROPIC_API_KEY` is absent? (Probably yes — steps 1–6 have no Anthropic dependency.)
- **Phase 4:** do we keep archived `issues` rows as a JSON export before dropping? Default in the cleanup inventory: yes, one-shot export to `backups/issues-pre-teardown.json`.

## Non-goals

- **Multi-user / sharing / publishing.** Still not a publication. If that ever returns, it's a new umbrella.
- **Discovery / propose_import.** Deferred; was phase 5 of `conversational-editor` and remains out of scope here.
- **Mobile / push / email surfaces.** Desktop-local only.
- **Full-text search over transcripts.** `resurface` is a thin retrieval using existing enrichment; a proper search layer is out of scope.
- **Visual redesign.** Typography, color, layout polish are not specified here. A focused visual phase could follow phase 3 if the aesthetic lags the functional pivot.
