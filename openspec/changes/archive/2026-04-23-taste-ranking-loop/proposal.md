## Why

Phases 1 and 2 of the `conversational-editor` umbrella built a taste substrate and a taste lab: the user can now cluster their like-set, label clusters, and adjust a `weight` column per cluster. But `taste_clusters.weight` is a column with no reader. Nothing in the app changes when the user turns a cluster up or down. The promise of the taste lab — "adjust the map, see the room change" — is not kept, and the phase-1/2 investment (embeddings, enrichment, clustering, editing) sits load-bearing but un-paid-off.

This phase closes that loop. It introduces the first code path that consumes cluster weights to rank videos, and puts that ranking in front of the user as a **"For right now"** rail on `/`. It is the first phase of the `consumption-first` umbrella where the user observably experiences consequences of their taste edits.

## What Changes

- **New ranking function `rankForHome()`** in `src/lib/home-ranking.ts`. Given the user's consumption-state-filtered pool, it produces an ordered list of ~20 candidate video IDs scored by `clusterWeight × freshness × stateBoost × fuzzyPenalty`, with small deterministic tie-breaking on `video_id`.
- **New `/api/home/ranking` endpoint** returning the top N video IDs + their score breakdown for debugging. Read-only; used by the new rail and by a dev panel.
- **New "For right now" rail** on `/` (home-page component), rendered **behind `NEXT_PUBLIC_HOME_RANKING=1`** feature flag. When the flag is off, `/` renders unchanged (issue-driven). When on, the rail renders **above** the existing issue-driven content; the old layout stays in place for side-by-side comparison during the burn-in.
- **New `taste_cluster_mutes` table** (ephemeral, per-day) so the user can mute a cluster for "today" without editing its weight. `muted_today(clusterId)` returns true when a row exists for `clusterId` with `muted_on = today` (America/New_York). Mutes auto-clear because the query filters by date — no sweeper job.
- **`weight` column semantics defined** — multiplicative modulator in `[0, 2]` on the per-cluster score contribution, with `0` meaning "effectively muted" and `1.0` being the neutral default. Prior to this change, `weight` was stored but undefined; this change pins the contract and makes it observable.
- **Small addition to `/taste`**: a "Mute today" button per cluster on `/taste` and `/taste/[clusterId]`, wired to a new `POST /api/taste/clusters/[id]/mute-today` route. The button is idempotent (re-clicking un-mutes).
- **No removals.** Nothing in the issue pipeline, the slot board, or the agent is touched. This phase is additive and reversible by flipping the flag off.

## Capabilities

### New Capabilities

- `home-ranking` — the taste-weight-aware ranking function, its consumption-state and freshness inputs, the API route that exposes it, and the home-page rail that renders its output behind a feature flag.
- `taste-profile` — the defined semantics of `taste_clusters.weight` as a ranking modulator, plus the per-day ephemeral "mute today" override. Captures the first-class reader of the weight column that phase-2 of `conversational-editor` left open.

### Modified Capabilities

<!-- None. `home-view` is untouched at the spec level: the rail lands behind a
     flag that defaults off. When phase 3 (`consumption-home`) flips the home
     layout it will carry its own `home-view` delta. -->

## Impact

- **Code added:** `src/lib/home-ranking.ts` (~200 LOC), `src/app/api/home/ranking/route.ts`, `src/app/api/taste/clusters/[id]/mute-today/route.ts`, one new React component for the rail, a "Mute today" button addition to the taste lab. Total ~400 LOC.
- **Database:** one new migration `015_taste_cluster_mutes.sql` adding `taste_cluster_mutes(cluster_id, muted_on, created_at)` with a composite PK on `(cluster_id, muted_on)`. No changes to `taste_clusters` schema — the `weight` column already exists from migration `012`.
- **External services:** none. No new API calls, no new cost. Ranking runs on already-embedded data.
- **Performance:** `rankForHome()` reads at most a few thousand rows (assignments + weights + consumption state) per call and sorts in memory. Target < 50 ms at p95 on the personal-scale corpus. No caching layer in this phase.
- **Feature flag:** `NEXT_PUBLIC_HOME_RANKING` env var, default off. Documented in `RUNBOOK.md` under a new "Home ranking rail" section. The `justfile` gains no new verbs — the feature is data-driven and has no job.
- **Reversibility:** flipping `NEXT_PUBLIC_HOME_RANKING` off hides the rail. The mute-today table is orphan-tolerant (rows go stale and are filtered by date). The migration is additive and can be reverted by dropping the one table. This phase is fully reversible until phase 3 begins reading `rankForHome()` as the primary home signal.
- **Interaction with taste lab:** `/taste` edits that touch `weight` continue to use the existing optimistic-lock path in `src/lib/taste-edit.ts` and bump `taste_clusters.updated_at` — `rankForHome()` re-reads on each call, so a weight change observably shifts the rail on next page load (success metric #2 of the umbrella).
- **Relationship to `conversational-editor` phase 2:** this phase is the first reader of work that phase committed. It does not re-open phase-2 decisions (cluster-ID preservation, fuzzy floor, editing rules); it only consumes their outputs.
