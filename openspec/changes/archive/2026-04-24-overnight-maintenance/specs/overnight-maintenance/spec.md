## ADDED Requirements

### Requirement: Nightly pipeline runs sequentially as a single process

The system SHALL provide a nightly job entrypoint at `scripts/nightly.ts` that, when invoked, runs the following steps in order, in a single process, with no parallelism between steps:

1. `runMigrations()`
2. OAuth import (likes + subscription uploads), invoking the same library functions that back `/api/youtube/import/likes` and `/api/youtube/import/subscriptions`.
3. Fetch transcripts for videos imported during step 2 (or backfilled — videos that have no `video_transcripts` row).
4. Enrich (Ollama summary + topic tags) for videos with no `video_enrichment` row.
5. Embed videos with no `video_embeddings` row under the active `(provider, model)`.
6. Recluster — incremental update by default; full rebuild only if max centroid drift exceeds `RECLUSTER_REBUILD_DRIFT` (default `0.20`).
7. Description-graph scan (see `discovery` capability).
8. Write one `nightly_runs` row.

Each step SHALL be wrapped in a try/catch. A step failure SHALL be recorded in `nightly_runs.counts` and `nightly_runs.last_error` but SHALL NOT abort the run; subsequent independent steps continue.

#### Scenario: All steps succeed

- **GIVEN** Ollama is running and the YouTube OAuth token is valid
- **WHEN** `tsx scripts/nightly.ts` is invoked
- **THEN** every step from `runMigrations` through description-graph SHALL execute
- **AND** exactly one `nightly_runs` row SHALL be inserted with `status = 'ok'`
- **AND** `last_error` SHALL be `NULL`

#### Scenario: One step fails, others continue

- **GIVEN** Ollama is unreachable but the YouTube OAuth token is valid
- **WHEN** `tsx scripts/nightly.ts` is invoked
- **THEN** step 4 (enrich) SHALL throw and the error SHALL be captured in `nightly_runs.last_error`
- **AND** step 5 (embed) SHALL still run on whatever has stored enrichment from prior runs
- **AND** step 7 (description-graph) SHALL still run
- **AND** the inserted `nightly_runs` row SHALL have `status = 'failed'` because at least one step threw

#### Scenario: No OAuth token at all

- **GIVEN** no `oauth_tokens` row exists for `provider = 'youtube'`
- **WHEN** `tsx scripts/nightly.ts` is invoked
- **THEN** step 2 SHALL exit early with a "no token" status
- **AND** `runMigrations` SHALL still have run
- **AND** the inserted `nightly_runs` row SHALL have `status = 'skipped'` and `notes = 'no youtube token; reconnect on /settings/youtube'`

### Requirement: Nightly digest persisted as one row per run

The system SHALL persist exactly one row per nightly invocation in `nightly_runs(id, run_at, status, counts, notes, last_error)`. `status` SHALL be one of `'ok' | 'failed' | 'skipped'` (CHECK-enforced). `counts` SHALL be a JSON blob with at minimum the keys `imported`, `enriched`, `embedded`, `reclustered`, `candidates_proposed`. `notes` SHALL be a single sentence ≤ 140 characters in plain English summarising the run. `last_error` SHALL be `NULL` when no step threw, otherwise the `Error.message` of the first thrown step.

#### Scenario: Counts JSON shape

- **WHEN** a successful nightly imports 12 new videos, enriches 8, embeds 15, runs an incremental recluster, and stages 5 candidates
- **THEN** `counts` SHALL parse to `{ "imported": 12, "enriched": 8, "embedded": 15, "reclustered": "incremental", "candidates_proposed": 5 }`

#### Scenario: Notes sentence is short and operator-readable

- **WHEN** the same successful nightly writes its row
- **THEN** `notes` SHALL be a single sentence ≤ 140 characters, e.g. `"+12 imported, +8 enriched, +15 embedded, recluster: incremental, +5 candidates."`

### Requirement: launchd install + uninstall verbs

The system SHALL provide three `just` verbs:

- `just nightly` — runs the pipeline once, on demand. Equivalent to `tsx scripts/nightly.ts`.
- `just nightly-install` — generates a `~/Library/LaunchAgents/com.folio.nightly.plist` with `WorkingDirectory` and `ProgramArguments` templated against the current repo path, then `launchctl load`s it. The plist's `StartCalendarInterval` SHALL fire at hour `NIGHTLY_HOUR` (default `3`), minute `0`. Stdout/stderr SHALL redirect to `~/Library/Logs/folio-nightly.log`.
- `just nightly-uninstall` — `launchctl unload`s the plist (if loaded) and deletes it.

`just nightly-install` SHALL be idempotent — a second invocation rewrites the plist with the current repo path and reloads launchd.

#### Scenario: Install templates current path

- **GIVEN** the repo is at `/Users/adigo/code/2026/folio`
- **WHEN** `just nightly-install` is invoked from that directory
- **THEN** the resulting plist's `WorkingDirectory` SHALL be `/Users/adigo/code/2026/folio`
- **AND** `launchctl list` SHALL include an entry whose label is `com.folio.nightly`

#### Scenario: Uninstall is safe to run twice

- **GIVEN** the plist is not loaded
- **WHEN** `just nightly-uninstall` is invoked
- **THEN** the verb SHALL exit 0 with a "nothing to uninstall" note and SHALL NOT error

#### Scenario: Re-install picks up a moved repo

- **GIVEN** the plist was installed when the repo lived at path A, then the repo was moved to path B
- **WHEN** `just nightly-install` is invoked from path B
- **THEN** the rewritten plist SHALL reflect path B
- **AND** subsequent nightly runs SHALL execute from path B

### Requirement: Recluster is incremental unless drift exceeds threshold

Step 6 of the nightly pipeline SHALL update `video_cluster_assignments` only for videos with a new `video_embeddings` row inserted in the same nightly run, and SHALL recompute centroids only for clusters that gained or lost members. The system SHALL compute the maximum centroid cosine drift across affected clusters; if it exceeds `RECLUSTER_REBUILD_DRIFT` (default `0.20`), a full rebuild SHALL run that night and `counts.reclustered` SHALL be `"full"`. Otherwise `counts.reclustered` SHALL be `"incremental"`.

#### Scenario: Small delta keeps incremental

- **GIVEN** the nightly embedded 5 new videos and the resulting maximum centroid drift across affected clusters is 0.07
- **WHEN** step 6 runs
- **THEN** `counts.reclustered` SHALL be `"incremental"`
- **AND** no full rebuild SHALL run

#### Scenario: Large delta triggers full rebuild

- **GIVEN** the nightly embedded 200 new videos and the resulting maximum centroid drift is 0.31
- **WHEN** step 6 runs
- **THEN** `counts.reclustered` SHALL be `"full"`
- **AND** the existing cluster-id-preservation logic (cosine ≥ 0.85 inheritance, retire-on-no-match) SHALL apply

### Requirement: No nightly precompute of the home rail

The nightly job SHALL NOT cache or materialize the `rankForHome` output. `/`'s `RightNowRail` SHALL continue to call `rankForHome` at request time on every render.

#### Scenario: Home rail reads live

- **WHEN** the operator visits `/` immediately after a nightly run
- **THEN** `RightNowRail` SHALL execute `rankForHome` against live SQLite state
- **AND** no row in any new table SHALL be read for the rail's score-ordered candidate list

### Requirement: Nightly pipeline has no Anthropic dependency

The nightly job SHALL NOT call the Anthropic API. The job SHALL succeed in an environment where `ANTHROPIC_API_KEY` is unset; the curation companion's behaviour SHALL be unaffected by the nightly's success or failure.

#### Scenario: ANTHROPIC_API_KEY absent

- **GIVEN** `ANTHROPIC_API_KEY` is not set in the environment
- **WHEN** `tsx scripts/nightly.ts` runs
- **THEN** every step SHALL execute (subject to its own external dependencies)
- **AND** no Anthropic SDK call SHALL be made
- **AND** the `nightly_runs` row SHALL be written normally
