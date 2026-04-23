## Context

Phase 1 of the `conversational-editor` umbrella built `video_embeddings`, `video_cluster_assignments`, and `taste_clusters` (with a `weight REAL NOT NULL DEFAULT 1.0` column). Phase 2 added `/taste` to edit labels, weights, and memberships, routing every mutation through `src/lib/taste-edit.ts` inside a transaction with optimistic-lock on `updated_at`. **No code reads `taste_clusters.weight`** yet. The taste lab is write-only relative to the app's user-visible behavior.

Meanwhile the home page `/` is driven by the magazine-issue pipeline (`src/lib/issues.ts` / `issue.ts` helpers and the `issues` + `issue_slots` tables). That pipeline uses its own per-video scoring (`scoreVideoForCover` — affinity × recency × depth) and is scheduled for removal in phase 4 (`magazine-teardown`) of the `consumption-first` umbrella. The ranking function introduced here is the replacement signal, but it must coexist with the magazine pipeline during phases 2–3 without interfering.

The pool is modest by any standard: a personal corpus of 1–10k videos, of which typically ≤2k are inbox/saved. `video_cluster_assignments` has exactly one row per embedded video (ON DELETE CASCADE from both parents). Every video has at most one active cluster assignment at any time. Embeddings and clusters are rebuilt out-of-band by `just taste-build` / `just taste-cluster`; this phase reads only.

Stakeholders: solo user. Environment: `npm run dev` on port 6060, SQLite file `events.db` at repo root, App Router RSC pages. No test runner.

## Goals / Non-Goals

**Goals:**
- Produce a deterministic, fast, taste-weight-aware ranking for `/` that makes `taste_clusters.weight` observable for the first time.
- Land behind a feature flag so the old issue-driven `/` remains the default and side-by-side comparison is possible during burn-in.
- Define the `weight` column's semantic in one place (`home-ranking` spec) so future readers (agent, nightly precompute) inherit it without ambiguity.
- Give the user a per-day "Mute today" override on `/taste` that does not touch `weight` and decays automatically by date.
- Stay additive and fully reversible by flipping the flag off and dropping one new table.

**Non-Goals:**
- No precomputation, caching layer, or materialized rail. Ranking is computed on each `/` render (it's cheap enough at this scale and stays fresh relative to weight/mute edits). Phase 5 (`overnight-enrichment`) may later precompute; this phase does not.
- No per-video overrides ("never show me this again", "more like this"). Out of scope — those are phase-3 signals.
- No changes to the issue pipeline, slot board, agent tool set, or `/taste` mutation contracts. This phase does not touch `taste-edit.ts`.
- No changes to how clusters are built or re-labeled. `rebuildClusters()` stays unchanged.
- No A/B framework, analytics, or ranking-quality metrics. A single user with a feature flag is the "test".
- No personalization beyond cluster weights + freshness + consumption state. No collaborative signals (there are no other users).

## Decisions

### 1. Scoring formula: `weight × freshness × stateBoost × fuzzyPenalty`, linear

**Decision.** Per-video score is:

```
score = clusterWeight(v) * freshness(v) * stateBoost(v) * fuzzyPenalty(v)
```

Where:
- `clusterWeight(v)` — `taste_clusters.weight` for the video's assigned cluster, clamped to `[0, 2]`. If the cluster is muted today, `clusterWeight = 0`. If the video has no cluster assignment (no embedding), `clusterWeight = 0.5` (treated as neutral-but-unknown, not zero — so completely-unembedded videos are not starved).
- `freshness(v)` — exponential decay on days since `videos.published_at`: `exp(-age_days / HALF_LIFE_DAYS)`. `HALF_LIFE_DAYS = 14`. Videos with null `published_at` get `freshness = 0.5`.
- `stateBoost(v)` — `1.0` for `inbox`, `1.3` for `saved` (explicitly kept but not started), `1.5` for `in_progress` (we want resumables to surface), `0.0` for `archived` and `dismissed` (filtered out before scoring, but the multiplier is defined for clarity).
- `fuzzyPenalty(v)` — `0.7` if `video_cluster_assignments.is_fuzzy = 1`, else `1.0`. Fuzzy members are the "barely fit" tail; damp them, don't drop them.

Final output is the top N sorted by score desc with deterministic tie-break on `video_id` asc. Default `N = 20`.

**Why.** Multiplicative keeps all signals' dynamic range predictable and makes `weight = 0` an exact mute. Linear/additive was considered and rejected — zero-weight clusters would still leak via freshness alone, defeating "mute". Half-life of 14 days was chosen by eye: the personal corpus mostly churns in 1–3 weeks and the user wants recency without starving durable long-form. `HALF_LIFE_DAYS` is a module-level constant, not env-configurable — if it's wrong we change code.

**Alternatives considered:**
- **Rank fusion (RRF) across weight, freshness, state** — overkill at this scale, harder to reason about when a single weight knob fails to move the rail.
- **Softmax over clusters then multiply by freshness** — smoother but encodes a preference for "stay within one cluster" that isn't justified; the user's taste is multi-modal.
- **Dropping fuzzy members entirely** — tried mentally; too aggressive, the fuzzy band includes genuine outliers the user likes.

### 2. Filter consumption state before scoring

**Decision.** The candidate pool is `consumption.status IN ('inbox', 'saved', 'in_progress')`. `archived` and `dismissed` are excluded at the SQL level.

**Why.** Ranking a dismissed video to zero via `stateBoost = 0` would still burn CPU and produces a bunch of zero-scored rows at the bottom of the sort. Filtering upstream is faster and clearer. A video that was dismissed and then the user re-opened it (valid transition: `dismissed → inbox`) is automatically back in the pool — no special handling.

### 3. Mutes are stored, not computed

**Decision.** Add `taste_cluster_mutes(cluster_id INTEGER, muted_on TEXT, created_at TEXT, PRIMARY KEY(cluster_id, muted_on))`. A cluster is "muted today" iff a row exists with `muted_on = today(America/New_York)`. No sweeper job — stale rows are harmless (the query filters by date) and the table will accumulate at most ~clusters × days-of-use rows in its lifetime, which is trivial.

**Why.** The alternative — a `muted_until TIMESTAMP` column on `taste_clusters` — conflates ephemeral signal with durable state and requires a decision about TZ semantics on every read. Keeping mutes in a separate table preserves the `taste_clusters` optimistic-lock contract (mute doesn't bump `updated_at`) and makes "un-mute" trivial (delete the row). Composite PK makes the toggle idempotent: `INSERT OR IGNORE` to mute, `DELETE` to un-mute.

**Date handling.** `muted_on` is a `YYYY-MM-DD` string in `America/New_York` derived via `src/lib/time.ts` (per the project invariant that every date conversion goes through that module). Stored as text because SQLite has no DATE type and comparing text dates works correctly lexicographically.

### 4. Expose as a module, RSC helper, and JSON route — in that order

**Decision.** Core logic lives in `src/lib/home-ranking.ts` exporting `rankForHome({ limit?, now? })` returning `RankedCandidate[]`. Two callers:

- The home-page RSC (`src/app/page.tsx`) calls it directly when `NEXT_PUBLIC_HOME_RANKING=1`.
- `GET /api/home/ranking?limit=20&debug=1` is a thin adapter returning `{ candidates: RankedCandidate[] }`. With `debug=1`, each candidate includes `{ videoId, score, clusterWeight, freshness, stateBoost, fuzzyPenalty, clusterId, clusterLabel }`. Without, it returns just `{ videoId, score }`.

**Why.** RSC reads SQLite directly (per CLAUDE.md — no API layer between pages and DB); the route exists for a dev-mode inspection panel and for future non-RSC callers (phase-3 agent tools). Exposing both from day one keeps the contract symmetric.

### 5. Feature flag is env-gated, read at render time

**Decision.** `process.env.NEXT_PUBLIC_HOME_RANKING === '1'` on the server. No runtime toggle, no cookie, no query-string override. Flag off → `/` renders unchanged. Flag on → the rail renders **above** the existing issue-driven content block.

**Why.** The user is one person on one machine; a build-time flag is sufficient. `NEXT_PUBLIC_` prefix means the flag is readable in client components too (the "Mute today" button on `/taste` has no reason to be rendered if the rail is off, though strictly it works regardless).

### 6. No caching, no memoization

**Decision.** Each `/` render runs the query. Each `/api/home/ranking` call runs the query.

**Why.** Measured cost at 2k candidates is well under the 50ms budget with `better-sqlite3` prepared statements and in-memory sort. Caching introduces invalidation complexity (weight edits, mute toggles, new consumption transitions) that is not worth the time this phase exists. Phase 5 precomputes for the nightly path.

### 7. `weight` semantics: clamp, don't validate at edit time

**Decision.** `home-ranking` clamps `clusterWeight` to `[0, 2]` at read time. `taste-edit.ts` is unchanged — if it wrote a weight outside that range (currently it allows any number), ranking would silently clamp. A follow-up change can tighten the write path if we see weights drift.

**Why.** This phase must not modify the phase-2 edit contract. Clamping at read time is safe and observable; validation at write time belongs to a different change. We accept that `weight = 3` and `weight = 2` produce the same ranking output.

## Risks / Trade-offs

- **[Flag-off is the default, so the loop is un-closed for most of the phase's life]** → The umbrella requires the loop to be observably closed (success metric #2). Mitigation: the final task of this change flips `NEXT_PUBLIC_HOME_RANKING=1` in `.env.local` and updates `RUNBOOK.md` to call out the default. Phase 3 makes the flag permanent and removes the conditional.
- **[Fuzzy penalty of 0.7 might over-surface or under-surface fuzzy members]** → This is untunable without feedback. Mitigation: include the breakdown in the debug API so the user can see which fuzzy videos bubbled up; adjust the constant in a follow-up if a pattern emerges.
- **[Stale clusters (retired or orphaned) could leak into ranking]** → Guarded by joining `taste_clusters ON retired_at IS NULL`. If `video_cluster_assignments` points at a retired cluster (possible between a cluster retirement and the next `rebuildClusters`), those videos' `clusterWeight` drops to 0.5 (no active cluster match). Mitigation: document the transient behavior; a rebuild restores correctness.
- **[A weight of 0 on a cluster the user also has set as "mute today" is double-zeroed]** → Harmless (0 × 0 = 0). Not a bug; noted so it isn't rediscovered as one.
- **[RSC reads from SQLite on every `/` hit could contend with `rebuildClusters` transactions]** → `better-sqlite3` with WAL mode handles readers-during-writer fine (that's the point of WAL). No mitigation needed beyond what's already in `src/lib/db.ts`.
- **[The magazine pipeline's `scoreVideoForCover` and this phase's `rankForHome` now both score the inbox with different formulas]** → They coexist during phases 2–3 and `scoreVideoForCover` is deleted in phase 4. During the overlap the two scoring functions can disagree; that is acceptable because they serve different rails. Not a risk to mitigate — a fact to remember when debugging.
- **[Mute table grows unboundedly over years of use]** → At ~10 clusters × 365 days = 3650 rows/year, this is noise. If it matters in ten years, a one-line `DELETE FROM taste_cluster_mutes WHERE muted_on < date('now', '-30 days')` in the nightly job is trivial. Not adding it now.

## Migration Plan

1. Add migration `015_taste_cluster_mutes.sql` — additive, takes milliseconds on a personal DB.
2. Ship the module + routes + rail behind the flag (default off). No behavior change observable yet.
3. Flip `NEXT_PUBLIC_HOME_RANKING=1` in `.env.local` for the dev machine. Verify rail renders, weights move the rail, mute-today zeros out a cluster for the day.
4. Leave flag on for a day of normal use; watch for surprises in what surfaces. Tune `HALF_LIFE_DAYS` or `fuzzyPenalty` constants in-place if needed (no schema churn).
5. Phase 3 picks up with the flag-on state as the new baseline and begins the `consumption-home` rework.

**Rollback:** flip the flag off, revert the env edit. Drop `taste_cluster_mutes` if needed. No forward-incompatible changes were made.

## Open Questions

- **Should in-progress videos be capped to a maximum count at the top of the rail?** Leaning no — if the user has many in-progress videos that's a signal they want them surfaced. If it feels noisy, a cap belongs in phase 3's "Continue" rail which is a distinct surface.
- **Should `freshness` use `videos.published_at` or `consumption.status_changed_at`?** Chose `published_at` because "what's new in the world" is what the user mostly cares about; "what I engaged with recently" is a different rail (Continue) that phase 3 introduces. Noted so this doesn't get re-litigated.
- **Does the debug API need auth?** No — Folio is a single-user local app. But we should avoid logging the breakdown to stdout to keep the dev console readable.
