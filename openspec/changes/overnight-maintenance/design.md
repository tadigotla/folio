## Context

The `consumption-first` umbrella's phases 1–4 shipped on 2026-04-23. The
magazine teardown completed cleanly: `/` is the consumption rail stack,
`/chat` is the curation companion, `rankForHome` reads
`taste_clusters.weight`, and the per-day `conversations` substrate is
warm. Two structural costs remain unaddressed.

First, ingestion is **strictly manual**. The OAuth pivot retired the
30-minute RSS cron; today the only paths into the corpus are the three
buttons on `/settings/youtube`. The operator (one user) imports when
they remember to. New likes added via the YouTube app on a phone never
appear in Folio until the operator opens the laptop and clicks Import.

Second, the **taste substrate is also strictly manual**. `just
taste-build` is incremental and cheap, but it has to be invoked. Until
it is, every newly-imported video is unembedded → has no row in
`video_cluster_assignments` → falls to `UNKNOWN_CLUSTER_WEIGHT = 0.5`
in `rankForHome`. The freshest content systematically loses to the
older corpus. This is a quiet bug, not a loud one — the rail still
renders, it just ranks the wrong things.

Phase 5 of the umbrella was originally drafted as `overnight-brief`
(a markdown brief + a skeleton draft of "tomorrow's issue"). The
magazine teardown obsoleted both artifacts. The umbrella's phase-5
description rescoped this as `overnight-enrichment` (just maintenance).
This change adopts that rescope **and** absorbs the umbrella's
phase-6a (description-graph), since the description-graph is itself a
nightly local-only pass over text already in the DB. Folding it in
here means the candidate substrate materializes the same night the
new content lands; phase 6 then shrinks to active discovery only
(`search_youtube` agent tool + `/inbox` Proposed rail + approve/dismiss).

The user is the sole operator. Failure of the nightly job must
degrade quietly — the app stays fully functional with stale data.

## Goals / Non-Goals

**Goals:**

- Run a single, sequential, local-only nightly pipeline on launchd at a
  configurable hour (default 03:00 America/New_York). One process, one
  log file, one digest row. Idempotent: re-running mid-day does not
  duplicate state.
- Close the unembedded-video penalty: by morning, every video imported
  the prior night is fully enriched, embedded, and assigned to a
  cluster.
- Bring new content in without an operator click: the nightly OAuth
  import is the primary path now.
- Stage discovery candidates from the description graph so phase 6's
  active surfaces have something to read on day one.
- Surface a one-line "since last visit" digest on `/` so the operator
  knows the nightly actually did something.
- Preserve the operational invariant: `justfile` and `RUNBOOK.md` ship
  with the new verbs and env vars in the same change.

**Non-Goals:**

- No active discovery surface in this change. `/inbox` does not gain
  a Proposed rail; no `approve` / `dismiss` API routes exist;
  `search_youtube` is not added to the agent's tool set. All of that
  is phase 6.
- No precompute of `rankForHome`. The query is fast and reading from a
  precomputed cache adds a stale-data failure mode without measurable
  upside.
- No agent-driven nightly ("agent picks tomorrow's videos while you
  sleep"). Anthropic is not in the nightly's critical path; the
  curation companion remains strictly user-initiated through `/chat`.
- No replacement of the `/settings/youtube` buttons. Manual import
  remains the on-demand path; nightly is the by-default path.
- No retention policy for `nightly_runs`, `discovery_candidates`, or
  `discovery_rejections`. Single-user app; rows accumulate slowly.
  A future change can add prune verbs if needed.
- No second cron, no background worker, no Docker. Single launchd
  agent installed under `~/Library/LaunchAgents/`.

## Decisions

### 1. Single sequential pipeline; per-step failures recorded but not aborting

**Decision.** `src/lib/nightly/run.ts` runs the seven steps in order:
`runMigrations` → OAuth import → transcripts → enrich → embed →
recluster → description-graph. Each step is wrapped in a try/catch;
failure is logged into a per-step entry inside the `nightly_runs.counts`
JSON and recorded on `nightly_runs.last_error`, but **does not abort
the run**. The job's overall `status` is `ok` if all steps succeeded,
`failed` if at least one step threw, `skipped` if (e.g.) no token row
exists at all.

**Why not** abort on first failure? Because the steps are independent.
A transient YouTube API hiccup in step 2 should not block step 4
(enrichment of videos imported on prior nights). Recording the error
and pressing on yields more useful state than halting and leaving the
operator with nothing.

**Why not** parallelise? Because each step naturally consumes the
output of the prior. Embed-after-enrich keeps the LLM-generated tags in
the embedded payload. Sequential is also easier to reason about in a
log file; for one user there's no throughput pressure to justify the
complexity.

### 2. OAuth import is the primary fetch path, not a backstop

**Decision.** The nightly's step 2 calls the same library functions that
back the `/settings/youtube` buttons (`importLikes`, `importSubscriptions`).
No new ingestion code. The intentional framing in the nightly's log /
digest is **"this is the cron"** — not "this catches anything the
30-minute cron missed." There is no 30-minute cron anymore.

**Why?** The umbrella's original phase-5 design predates the OAuth
pivot; that line was stale by the time it was written and survived
into the umbrella by accident.

### 3. Recluster is incremental by default; full rebuild gated on drift

**Decision.** Step 6 calls a thin wrapper over the existing
`scripts/taste/cluster.ts` logic that recomputes assignments only for
videos with new embeddings, recomputes the affected centroids, and
checks the maximum centroid drift against the existing
cluster-id-preservation threshold (cosine 0.85). If max drift exceeds
the configured `RECLUSTER_REBUILD_DRIFT` (default 0.20), trigger a
full rebuild that night. Otherwise, just update.

**Why not** always full-rebuild? Because that's seconds of CPU on a
multi-thousand-video corpus and triggers cluster-id matching every
night, which is more potential drift than the assignment quality
gains.

**Why a drift trigger at all?** Because if the user's likes have
shifted enough, the existing clusters genuinely need re-fitting and
incremental updates won't catch it. A drift gate is cheaper to compute
than a full rebuild and gives us the rebuild-when-needed property.

### 4. Description-graph runs over saved + in_progress only

**Decision.** Step 7 scans descriptions + transcripts for videos whose
`consumption.status IN ('saved', 'in_progress')`. Inbox and archived
are excluded. Inbox is excluded because pre-triage signal is too noisy
(the user hasn't endorsed it yet). Archived is excluded because the
user's already moved past it; mining it for new content felt
backwards.

**Why not** include all videos? Because the value signal is weakest
on inbox + archived. We'd 10× the candidate volume to get marginally
more leads.

### 5. Candidate scoring: source-affinity × cluster-cosine

**Decision.** For each parsed link/handle:

1. The **source video** has a known cluster (or is unclustered). That
   gives a "what taste neighborhood proposed this" signal.
2. We score the candidate against every active cluster centroid: take
   the source video's embedding (since we don't yet have the
   candidate's), compute cosine to each cluster centroid, and pick
   the max. This is a proxy — we're using the source as a stand-in
   for the candidate's taste fit, on the bet that linked content
   tends to share taste with the linker.
3. Final score = `clusterCosine × clusterWeight × sourceFreshness`.
   Stored as `score`; full breakdown in `score_breakdown` JSON for
   auditability. Below `DISCOVERY_FUZZY_FLOOR` (default 0.55), the
   candidate is dropped (not even inserted) — same fuzziness floor
   posture as the cluster assignment code uses for `is_fuzzy`.

**Why this proxy?** Because the candidate isn't in our embedding store
yet. Fetching its description/transcript via OAuth would itself be a
nightly-on-nightly task. The source-stand-in gets us 80% of the signal
for 0% of the per-candidate cost. Candidates that survive triage and
get approved (phase 6) become real corpus videos and get their own
embedding on the next nightly.

### 6. Rejection list is permanent; approval drains the candidate row

**Decision.** When phase-6 ships approve/dismiss endpoints, dismiss
writes a row into `discovery_rejections` (UNIQUE on `target_id`) and
deletes the candidate row. Approve creates the
`videos`/`channels`/`consumption` rows via the existing import path,
then deletes the candidate row. The description-graph scan in this
change checks `discovery_rejections` before inserting and skips
already-rejected target_ids forever.

**Why permanent rejection?** Because re-proposing a dismissed candidate
night after night is the kind of low-key annoyance that erodes trust in
the surface. A "clear rejections" verb in phase 6 lets the operator
reset the list when their taste shifts.

### 7. Digest is one row per run, one sentence operator-readable

**Decision.** `nightly_runs.notes` is at most one short English
sentence assembled from the counts: e.g.
`"+12 imported, +8 enriched, +15 embedded, recluster: incremental, +5 candidates."`
The full structured numbers live in `counts` JSON. The home rail's
"since last visit" line renders `notes` directly, with no further
formatting.

**Why a sentence and not a structured chip set?** Because this is a
single-user tool and a sentence is the lowest-friction UI surface that
still tells the operator something happened. Structured chips would be
more componentry to maintain for the same information value.

### 8. launchd, not cron, not in-process scheduler

**Decision.** Install a `LaunchAgent` plist at
`~/Library/LaunchAgents/com.folio.nightly.plist` invoking
`tsx scripts/nightly.ts`. macOS-only — matches the project's stated
platform (RUNBOOK already says local macOS only).

**Why launchd over cron?** Because launchd handles wake-from-sleep
naturally (`StartCalendarInterval`) — if the laptop was asleep at
03:00, launchd fires the job when the laptop wakes. Cron would just
miss the slot. Launchd also gives us free log redirection.

**Why not** an in-process scheduler inside the dev server? Because the
dev server is foreground and not running overnight. The whole point is
"works while you sleep without you keeping the dev server up."

### 9. "Since last visit" line on `/`

**Decision.** A small `<SinceLastVisit />` server component renders
above `RightNowRail` when (a) the latest `nightly_runs` row exists and
has `status = 'ok'` and (b) the row's `run_at` is within the last 36
hours (so a stale digest from a week ago doesn't mislead). Otherwise
renders nothing (no DOM at all — same posture as `ContinueRail` /
`ShelfRail` empty states).

**Why 36 hours not 24?** Because if the operator opens the app at
07:00 the morning after a 03:00 run, the digest is ~4 hours old. If
they don't open it again until two days later at 06:00, the digest is
~51 hours old and meaningless. 36 covers the typical late-evening-then-
next-morning gap.

**Why "since last visit" not "overnight" or "yesterday"?** Because the
phrase decouples the surface from the literal-time framing — it'll read
correctly whether the user opens the app at 07:00 or 19:00.

### 10. Migration semantics: net-additive, three new tables

**Decision.** `db/migrations/017_overnight_maintenance.sql` adds
`nightly_runs`, `discovery_candidates`, `discovery_rejections` and
nothing else. No existing tables are touched. The migration is one
`BEGIN/COMMIT`; rollback is `DROP TABLE` the three.

**Why one migration not three?** Because the three are designed
together and only meaningful in concert. Splitting would force
intermediate states in `_migrations` history with no value.

## Risks / Trade-offs

- **[Risk] launchd doesn't fire because the operator never installed
  it.** The nightly is opt-in, by design — but if the operator forgets
  to run `just nightly-install`, none of the value materialises.
  **Mitigation:** RUNBOOK's "Quick start" gains a one-liner pointing at
  the install verb. The "since last visit" line stays hidden until the
  first successful run, so absence is at least visible.

- **[Risk] OAuth token refresh fails overnight.** The token row's
  refresh path runs lazily on each API call; if Google revoked it, the
  nightly's step 2 throws and step 2 records the failure. Steps 3–7
  still run on the existing corpus.
  **Mitigation:** the `/settings/youtube` page already shows a
  "Reconnect YouTube" banner when the OAuth state is stale. Operator
  reconnects manually; the next nightly resumes.

- **[Risk] Ollama is offline at 03:00.** Step 4 (enrichment) throws.
  The error is recorded; embedding still runs on whatever has stored
  enrichment from prior runs; un-enriched videos accumulate.
  **Mitigation:** the digest line on `/` includes the failure note,
  e.g. `"... enrich: ollama unreachable"`. RUNBOOK's existing Ollama
  troubleshooting note covers the recovery path.

- **[Risk] Embedding provider quota / cost spike.** A user importing
  thousands of likes on day-N will trigger a large embedding pass on
  night-N+1. With OpenAI default at $0.02 / 1M tokens and ~200 tokens
  per video, the worst-case nightly is still under $1.
  **Mitigation:** the existing `EMBEDDING_PROVIDER=bge-local` switch
  lets the operator move embedding to Ollama with no cloud cost. No
  new env var or rate-limit needed in this change.

- **[Risk] description-graph generates spam candidates from one
  link-heavy creator.** A single saved video describing 30 referenced
  channels produces 30 candidates in one night.
  **Mitigation:** the `DISCOVERY_FUZZY_FLOOR` (default 0.55) drops
  low-similarity candidates pre-insert. Phase 6's eventual rail will
  also page / sort.

- **[Risk] launchd plist drifts from the binary path.** If the
  operator moves the repo, the plist's `WorkingDirectory` /
  `ProgramArguments` go stale.
  **Mitigation:** `just nightly-install` regenerates the plist from
  the current `pwd` each time. Document the "if you move the repo,
  re-run install" caveat in RUNBOOK.

- **[Trade-off] No retention / pruning.** `nightly_runs` accumulates
  one row per night; in 5 years that's ~1800 rows. Negligible.
  `discovery_candidates` could grow faster but is pruned by approve
  and by the rejection list. `discovery_rejections` only grows.
  Accepted; revisit if the candidate volume gets uncomfortable.

- **[Trade-off] `discovery_candidates` is written but not read in this
  change.** The substrate materializes with no UI to expose it.
  Accepted because phase 6 is a separate change with its own review;
  splitting reduces blast radius.

- **[Trade-off] Source-stand-in scoring is a proxy, not a true
  candidate-similarity score.** A linked video may have nothing in
  common with the linker's taste cluster.
  Accepted: the alternative requires fetching the candidate's
  metadata/description before scoring, which itself needs YouTube Data
  API access (= phase 6 dependency we explicitly want to defer). The
  `score_breakdown` JSON makes the proxy explicit and auditable; phase
  6 can re-score on approve if needed.

## Migration Plan

1. **Pre-flight**
   - `just backup-db` (the migration is additive but the invariant
     stands).
   - Confirm Ollama is reachable and the configured enrichment model is
     pulled (existing RUNBOOK setup section).
   - Confirm `OPENAI_API_KEY` (or `EMBEDDING_PROVIDER=bge-local`) is
     set.

2. **Code + migration land in one PR**
   - `db/migrations/017_overnight_maintenance.sql`.
   - `src/lib/nightly/*`, `src/lib/discovery/*`, `scripts/nightly.ts`.
   - `src/components/home/SinceLastVisit.tsx`; `src/app/page.tsx` mounts
     it above `RightNowRail`.
   - `ops/com.folio.nightly.plist` template.
   - `justfile` adds `nightly`, `nightly-install`, `nightly-uninstall`.
   - `.env.example` adds `NIGHTLY_HOUR`, `DISCOVERY_FUZZY_FLOOR`.
   - `RUNBOOK.md` adds an "Overnight maintenance" section + bumps
     `_Last verified:_`.

3. **Apply**
   - `npm run dev` triggers the migration; verify three new tables
     exist.
   - `just nightly` runs the pipeline once on demand. Inspect
     `nightly_runs` for one row; inspect `discovery_candidates` for
     reasonable rows.
   - `just nightly-install` writes the plist + `launchctl load`s it.
     Verify `launchctl list | grep folio.nightly` shows the agent.

4. **Verification (next morning)**
   - `nightly_runs` has a row from ~03:00 with `status = 'ok'`.
   - `/`'s "since last visit" line renders the digest sentence.
   - `~/Library/Logs/folio-nightly.log` shows the run.

5. **Rollback**
   - `just nightly-uninstall` (`launchctl unload` + delete plist).
   - `git revert` the change.
   - Manually `DROP TABLE` the three tables and remove the
     `_migrations` row for `017` if you want a fully clean schema.

## Open Questions

- **Should the launchd plist live in-repo (`ops/`) or be generated
  fresh each install?** Lean: in-repo template + `just nightly-install`
  templates the absolute path at install time. Trade-off captured in
  decision 7.
- **Should `nightly_runs.last_error` store the full stack or just the
  message?** Lean: one-line message in the column; full stack in the
  log file. Easier to read in `sqlite3 events.db ...` queries.
- **Should the digest sentence be capped at a length?** Lean: yes,
  ~140 chars, so the rail line never wraps awkwardly.
- **Does the description-graph also pick up channel handles inside
  comments / pinned comment text?** Out of v1 — comments aren't in the
  corpus today. Revisit if phase 6 wants more candidate volume.
