## Why

The `conversational-editor` umbrella committed Folio to a *magazine* framing: issues, covers, featured/briefs slots, publish buttons, an editor-in-chief stance, and an overnight job that drafts tomorrow's issue. Phases 1–3 shipped that surface. In practice the framing costs more than it pays: a publication metaphor implies readers, and there are none. The drag board, the slot taxonomy, the `issues`/`issue_slots` tables, the publish/pin flow, and the agent's slot-mutation tool set all exist to compose output for an audience that will never see it.

The user has named what they actually want: **an intelligent, enticing tool for their own consumption** — a room they want to walk back into, with two moods (occasional curation, mostly consumption) and the lightweight organizing structure of playlists. Not a publication.

This umbrella pivots Folio from *publication-shaped tool for one editor* to *consumption-shaped tool for one reader*. It drops the magazine mechanics, elevates playlists to the primary organizing concept, closes the taste-weight ranking loop that phases 1–2 left open, repurposes the editor agent as a curation companion, and rescopes the in-flight overnight job from "agent drafts tomorrow's issue" to "pipeline prepares tomorrow's room."

The taste substrate (phase-1) and taste lab (phase-2) survive intact — they were always the strongest bets. Everything specifically built to serve the *publication* framing (phase-3 slot surface, phase-4 brief) is either removed or reshaped.

## What Changes

This is an umbrella holding change. Concrete work is split into phases, each independently shippable. Each phase gets its own proposal / design / tasks when the prior phase is close to shipping — same discipline as `conversational-editor`.

1. **`playlists`** — new `playlists` + `playlist_items` tables, `/playlists` CRUD page, first-class playlist operations across the app. No UI to the issue system is touched yet. Ships standalone: playlists coexist with the existing magazine surface during transition.
2. **`taste-ranking-loop`** — `rankForHome()` reads `taste_clusters.weight` and cluster assignments to rank videos from the pool. New home rail "For right now" lands behind a feature flag; old issue-driven `/` remains default. This phase is where phase-1/2's investments finally pay out.
3. **`consumption-home`** — `/` flips to the consumption-first layout: "For right now" rail, "Continue" resumables, "Fresh since last visit", playlist entry points. The old issue-based `/` is retired (read-only archive for a burn-in week, then removed). Agent is re-pointed from slot-mutation to playlist + curation verbs.
4. **`magazine-teardown`** — drop `issues`, `issue_slots`, `morning_briefs` (if `overnight-brief` shipped), and retire `conversations`/`conversation_turns`' 1:1 binding to issues. Collapse `sections` into tags via one-time migration. Delete the code paths for compose/pick/publish/pin. One explicit backup step before the destructive migration.
5. **`overnight-enrichment`** — replaces the deleted `overnight-brief` change. Nightly job becomes pipeline maintenance (fetch + embed + enrich + recluster + precompute home pool) plus a one-liner digest row. No markdown brief, no skeleton draft, no agent turn scheduled in its sleep.
6. **`discovery`** — user-gated ways to bring content into the corpus that isn't already there. Two sub-mechanisms feeding one "Proposed imports" surface: (a) **description-graph** — nightly scan of saved-video descriptions + transcripts for YouTube links and `@handles`, scored against taste, surfaced as passive candidates; (b) **direct search** — new agent tool `search_youtube(query)` wrapping the YouTube Data API, explicitly user-initiated, produces the same kind of candidate rows. Nothing imports without a click. Same anti-algorithm stance: we follow editorial / creator-linked / user-queried trails, not YouTube's recommender.

## Capabilities

### New capabilities

- **playlists** — user-created, named, ordered, many-to-many collections of videos. Editable from `/playlists`, manipulable by the agent, optionally surfaced on `/`. Owned by phase 1.
- **home-ranking** — taste-weight-aware ranking function that produces the "For right now" rail. Reads `taste_clusters.weight`, `video_cluster_assignments`, freshness, consumption state. Owned by phase 2.
- **overnight-enrichment** — scheduled pipeline maintenance + short digest. Replaces the `overnight-brief` capability (which never fully shipped). Owned by phase 5.
- **discovery** — user-gated import of new content (channels + videos) originating outside the existing corpus. Two feeders: description-graph (passive, nightly) and direct-search (active, agent-initiated). One surface: "Proposed imports" on `/inbox`. Owned by phase 6.

### Modified capabilities

- **taste-profile** — `taste_clusters.weight` gains a defined semantic (multiplicative modulator on ranking) and a consumed call site. "Mute cluster today" ephemeral override added.
- **editorial-agent** → **curation-agent** (renamed). Tools swap: `assign_slot`/`swap_slots`/`clear_slot` out; `add_to_playlist`/`remove_from_playlist`/`reorder_playlist`/`create_playlist`/`triage_inbox`/`mute_cluster_today`/`resurface` in. House-style prompt rewritten to drop editor-in-chief framing. Conversations decouple from issues; bind to a day or stay stateless (TBD in phase 3 design).
- **home-view** — `/` becomes the consumption room described above. No issue reads, no cover/featured/briefs taxonomy.
- **editorial-workspace** → **deprecated, then deleted**. The slot board and its drag interactions survive only through phase 3's burn-in; phase 4 removes them.
- **library-view** / **inbox-view** / **player-view** — unchanged in essence. Minor browse-by-playlist additions in phase 1.

### Removed capabilities

- **editorial-workspace** (slot-based issue composition) — removed in phase 4.
- **issue-archive** / **magazine issue lifecycle** — removed in phase 4.
- **overnight-brief** — the in-flight change for this capability was deleted; the capability is redefined as `overnight-enrichment` in phase 5 of this umbrella.
- **sections** (1:1 channel→section as a distinct taxonomy layer) — collapsed into tags in phase 4.

## Relationship to the `conversational-editor` umbrella

That umbrella's phases 1–3 shipped and are archived. Its unshipped phases are:

- Phase 4 (`overnight-brief`, was drafted in `openspec/changes/overnight-brief/`) — **deleted**. The directory has been removed; phase 5 of this umbrella (`overnight-enrichment`) starts fresh. No code was written against the deleted change, so deletion is lossless.
- Phase 5 (`discovery-tools`, never proposed) — **revived as phase 6 (`discovery`)** of this umbrella. Expanded beyond the prior description-graph-only framing to include a direct-search tool as well. Same gating stance: nothing imports without an explicit click.

The `conversational-editor` umbrella's stance (`/` is chat-first; the agent acts while you sleep) is **explicitly retired**. Chat remains available but is no longer the primary interaction; the agent remains, but as companion, not editor; the nightly job remains, but as pipeline maintenance, not overnight drafting.

## Impact

- **Code removed (phase 4):** `src/lib/issue.ts` composition logic, `src/app/api/issues/*`, slot mutation helpers in `src/lib/issues.ts`, slot-board components under `src/components/issue/*` (if any), `src/app/section/[slug]/`, `/sections` management page, `compose/pick/publish/pin` paths.
- **Code added:** `src/lib/playlists.ts` (phase 1), `src/lib/home-ranking.ts` (phase 2), revised `src/lib/agent/tools.ts` tool set (phase 3), `src/lib/nightly/*` reshape (phase 5), `src/lib/discovery/*` + `search_youtube`/`propose_import` agent tools + `/inbox` "Proposed" rail (phase 6). Rough total addition: ~2,000 LOC across phases; net delta likely near-zero after phase-4 deletions.
- **Database:** phase 1 adds two tables (`playlists`, `playlist_items`). Phase 4 drops three (`issues`, `issue_slots`, `morning_briefs` if present) and reshapes two (`conversations`, `conversation_turns` lose FK to `issues`). Sections collapse: `channels.section_id` values migrated into `channel_tags` rows, column dropped, `sections` table dropped. Phase 5 adds one table (`nightly_runs`). Phase 6 adds one table (`discovery_candidates`) and one index table (`discovery_rejections` — dismissed candidates, to avoid re-proposing).
- **External services:** no new dependencies through phase 5. Phase 6 adds one: the **YouTube Data API v3** for the `search_youtube` tool. Uses an API key (no new OAuth scope). Existing free-tier quota is 10,000 units/day; a `search.list` call costs 100 units, so ~100 searches/day before hitting quota — plenty for a single user. Description-graph (6a) requires no new service — it parses text we already have.
- **Operational:** `just` verbs reviewed phase by phase. Phase 5 keeps the launchd agent (if phase-4 `overnight-brief` shipped) but rewires its script; otherwise installs fresh.
- **Cost:** essentially unchanged. Fewer tokens to Anthropic on nightly (no draft composition), but interactive-agent usage may shift as tool set changes.
- **Privacy posture:** unchanged through phase 5. Phase 6 adds a new outbound surface — YouTube Data API queries include the search string. The query is assembled locally (from the user's text or from cluster labels) and sent to Google; no personal data beyond the query itself leaves the machine. Description-graph is local-only. Documented in RUNBOOK's phase-6 section.
- **Reversibility:** each phase independently revertable until phase 4. Phase 4 is the one-way door (it deletes schema). Explicit `just backup-db` step required before its destructive migration. After phase 4, the magazine code + data are gone; restoring the publication framing would mean reinstating the archived `conversational-editor` changes from git.
- **User-visible downtime:** none required. Phase 3's flip can be a simple env-flag switch; phase 4's teardown is a single migration that runs in seconds on a personal DB.

## Success metric

This umbrella is done when:

1. Opening `/` feels like walking into a small, shaped room — 5–7 picks, a Continue rail, a Fresh counter, playlist entry points. No publishing ceremony visible anywhere.
2. Adjusting a cluster weight on `/taste` changes what shows up on `/` within one regenerate. The taste loop is observably closed.
3. The user's default interaction is *consumption* (click → play), with a clear, low-friction path into curation (triage, playlist editing, taste adjustment) when they want it.
4. The magazine vocabulary is absent from the UI, from `CLAUDE.md`, from `RUNBOOK.md`, from the active codebase. Past issues exist only in git history.
5. The nightly job runs silently and leaves a one-line digest when the user next visits. No markdown briefs, no auto-composed drafts.

The qualitative bar: the user opens Folio because they *want* to, not because they feel they ought to triage.
