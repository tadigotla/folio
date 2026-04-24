## Why

Two gaps remain after the magazine teardown. (1) Newly-imported videos arrive with no embedding, no enrichment, and no cluster assignment, so `rankForHome` quietly penalises them with `UNKNOWN_CLUSTER_WEIGHT = 0.5` until the operator remembers to run `just taste-build`; the most-recent content systematically loses to the older corpus. (2) The corpus only grows when the operator manually clicks Import; "fresh" depends on remembering to import, and the curation companion's snapshot is correspondingly stale by morning. A nightly local-only pass closes both. While the pipeline is already running, it can also do the passive half of the consumption-first umbrella's discovery work — scan saved videos' descriptions and transcripts for YouTube links and `@handles`, score the candidates against the active taste clusters, and stage them for a future "Proposed imports" surface.

## What Changes

- **NEW operational surface:** a single nightly job at default 03:00 America/New_York, installed opt-in via a launchd plist (`com.folio.nightly.plist`). Verbs `just nightly`, `just nightly-install`, `just nightly-uninstall`. The job runs locally — no Anthropic dependency, no new outbound services beyond what the existing import + embedding providers already use.
- Pipeline order (one process, sequential, each step incremental):
  1. `runMigrations()`
  2. OAuth import — likes + subscription uploads, reusing the same code paths as `/settings/youtube` (no new ingestion code).
  3. Fetch transcripts for newly-imported videos.
  4. Enrich (Ollama summary + topic tags) for newly-imported videos.
  5. Embed newly-imported videos under the active provider/model.
  6. Recluster incrementally; full rebuild only if drift exceeds a configurable threshold.
  7. Description-graph scan over `consumption.status IN ('saved','in_progress')` videos' descriptions + transcripts for YouTube links (`youtu.be/...`, `youtube.com/watch?v=...`, `/channel/UC...`, `/@handle`) and bare `@handles`. For each new candidate not already in the corpus and not on the rejection list, score it against the active taste clusters (cosine over the source video's embedding × the cluster's centroid; min-distance over the candidate's source signal). Insert into `discovery_candidates` with `status='proposed'`.
  8. Write one `nightly_runs` digest row.
- **NEW table `nightly_runs`** — `id`, `run_at`, `status` (`ok|failed|skipped`), `counts` (JSON: `{ imported, enriched, embedded, reclustered, candidates_proposed }`), `notes` (single-sentence operator-readable summary), `last_error`.
- **NEW tables `discovery_candidates` and `discovery_rejections`** — `discovery_candidates(id, kind ENUM video|channel, target_id TEXT, source_video_id TEXT, source_kind ENUM description_link|description_handle|transcript_link, title TEXT, channel_name TEXT, score REAL, score_breakdown TEXT JSON, proposed_at TEXT, status ENUM proposed|approved|dismissed, status_changed_at TEXT)`. `discovery_rejections(target_id TEXT PRIMARY KEY, kind TEXT, dismissed_at TEXT)` — every dismissal writes here so a re-scan does not re-propose. (No active read surface in this change; phase 6 owns the `/inbox` "Proposed" rail and the approve/dismiss endpoints. Phase 5 only writes the substrate.)
- **MODIFIED `/`:** add a small "since last visit" line above `RightNowRail` that reads the latest `nightly_runs.notes` + `counts`. No magazine vocabulary.
- **NEW env vars:** `NIGHTLY_HOUR` (default `3`), `DISCOVERY_FUZZY_FLOOR` (default `0.55`).
- **Drop steps explicitly:** the in-flight `overnight-brief` design's "precompute home pool" step (step 6) is OUT — `rankForHome` is a single SQL query running in single-digit ms; precompute would just add a stale-cache failure mode. The framing of nightly-fetch as "catches anything the 30-minute cron missed" is also OUT — there is no 30-minute cron post-OAuth-pivot; the nightly *is* the cron.
- **Operational invariant:** new `just` verbs and new env vars REQUIRE `justfile` and `RUNBOOK.md` updates in the same change. `_Last verified:_` date in `RUNBOOK.md` bumps to the apply date.

## Capabilities

### New Capabilities

- `overnight-maintenance`: codifies the nightly pipeline order, the `nightly_runs` digest contract, the launchd install/uninstall surface, the `since last visit` UI line, and the failure semantics (one step's failure does not abort later independent steps).
- `discovery`: codifies the `discovery_candidates` substrate — what gets proposed, how it gets scored, the rejection-list contract, and the explicit boundary that v1 has no active reader. Active discovery (the agent's `search_youtube` tool, the `/inbox` Proposed rail, the approve/dismiss endpoints) is out of scope and lands in a follow-on phase 6.

### Modified Capabilities

- `home-view`: minor — adds the "since last visit" line above `RightNowRail`. Source: `nightly_runs.notes` + `counts`. Renders nothing if no successful nightly run exists yet (so a user who never installs the launchd job gets no UI surprise).

## Impact

- **Code added (~700 LOC):** `db/migrations/017_overnight_maintenance.sql`, `src/lib/nightly/run.ts` (the orchestrator), `src/lib/nightly/digest.ts` (writes `nightly_runs`), `src/lib/discovery/description-graph.ts` (link/handle parser + URL canonicalizer), `src/lib/discovery/score.ts` (cosine scoring against active clusters), `src/lib/discovery/candidates.ts` (read/write `discovery_candidates` + `discovery_rejections` mutation path), `scripts/nightly.ts` (launchd entrypoint), `src/components/home/SinceLastVisit.tsx`. All consumption-side mutations stay through existing helpers.
- **Database:** one migration adding three tables, no schema changes to existing tables.
- **Operational:** one launchd plist (`ops/com.folio.nightly.plist`), three new `just` verbs (`nightly`, `nightly-install`, `nightly-uninstall`). `.env.example` gains two entries.
- **External services:** none new. Embedding/enrichment use the providers already configured. The YouTube Data API key required for active search is NOT introduced here; it lands with phase 6.
- **Privacy:** description-graph reads text already in the local DB; no new outbound surface. The nightly logs to `~/Library/Logs/folio-nightly.log` (gitignored, local).
- **Cost:** ~$0.01–$0.03 of OpenAI embeddings per nightly with default settings on a typical delta of <50 new videos. Ollama enrichment is local (free). Anthropic API is not touched.
- **Users (one):** the operator opts in by running `just nightly-install` once. Without it, the app behaves exactly as it does today and `/`'s "since last visit" line stays hidden.
- **Rollback:** `just nightly-uninstall` removes the plist; manually drop the three new tables to fully revert. The migration is destructive only of the new tables it creates — no existing data is touched.
