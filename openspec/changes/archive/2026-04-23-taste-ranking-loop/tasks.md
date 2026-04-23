## 1. Database

- [x] 1.1 Add migration `db/migrations/015_taste_cluster_mutes.sql` creating `taste_cluster_mutes(cluster_id INTEGER NOT NULL REFERENCES taste_clusters(id) ON DELETE CASCADE, muted_on TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(cluster_id, muted_on))`.
- [x] 1.2 Run `runMigrations()` via `npm run fetch` (or `tsx db/seed-sources.ts`) and verify the table exists in `events.db`.
- [x] 1.3 `just backup-db` before running the migration in case manual inspection is needed (optional but cheap).

## 2. Core ranking module

- [x] 2.1 Create `src/lib/home-ranking.ts` exporting `RankedCandidate` type and `rankForHome({ limit?, now? })` function.
- [x] 2.2 Implement the SQL query joining `consumption`, `videos`, `video_cluster_assignments`, `taste_clusters`, `taste_cluster_mutes` and filtering to `consumption.status IN ('inbox','saved','in_progress')`. Use `better-sqlite3` prepared statements.
- [x] 2.3 Implement `clusterWeight()` logic: clamp to `[0, 2]`, return `0.5` when no assignment or cluster is retired, return `0` when muted today.
- [x] 2.4 Implement `freshness()` as `exp(-ageDays / 14)`, with `ageDays` clamped to `>= 0` and fallback `0.5` when `published_at` is NULL. Derive `now` from `new Date()` by default and accept override via param for determinism.
- [x] 2.5 Implement `stateBoost()` as `{ inbox: 1.0, saved: 1.3, in_progress: 1.5 }`.
- [x] 2.6 Implement `fuzzyPenalty()` as `0.7` when `is_fuzzy = 1`, else `1.0`.
- [x] 2.7 Combine components multiplicatively, sort desc by score with `video_id` ascending tie-break, slice to `limit` (default 20).
- [x] 2.8 Add module-level constants `HOME_RANKING_HALF_LIFE_DAYS = 14`, `FUZZY_PENALTY = 0.7`, `UNKNOWN_CLUSTER_WEIGHT = 0.5`, `UNKNOWN_FRESHNESS = 0.5`. No env overrides.
- [x] 2.9 Derive "today (America/New_York)" via the project's `src/lib/time.ts` helpers; do not import `date-fns-tz` directly.

## 3. Mute-today plumbing

- [x] 3.1 Add `setMuteToday(clusterId: number): { muted: boolean }` in a new `src/lib/mutes.ts` (or appended to `taste-read.ts` if that feels cleaner — pick one and justify in the PR). The function SHALL verify the cluster exists and `retired_at IS NULL`, throw a typed `ClusterNotFoundError` otherwise.
- [x] 3.2 Implement the toggle inside `db.transaction(...)`: check for existing row on `(cluster_id, muted_on=today)`; if present DELETE and return `{ muted: false }`; else INSERT and return `{ muted: true }`. Do NOT touch `taste_clusters.updated_at`.
- [x] 3.3 Add `isMutedToday(clusterId: number): boolean` read helper for the UI.
- [x] 3.4 Add `getMutedClusterIdsToday(): Set<number>` batch helper used by `rankForHome` to avoid per-row lookups.

## 4. API routes

- [x] 4.1 Create `src/app/api/home/ranking/route.ts` with `GET` handler. Parse `limit` (integer, 1–100) and `debug` (boolean). Return `400` on malformed `limit`. Call `rankForHome({ limit })` and return `{ candidates: [...] }`. With `debug=1`, enrich each candidate with `{ clusterWeight, freshness, stateBoost, fuzzyPenalty, clusterId, clusterLabel }` — fetch the label via a single JOIN on `taste_clusters`.
- [x] 4.2 Create `src/app/api/taste/clusters/[id]/mute-today/route.ts` with `POST` handler. Parse `id` from dynamic segment (integer). Call `setMuteToday(id)`; map `ClusterNotFoundError` to `404`; return `200 { muted }` on success.
- [x] 4.3 Verify both routes compile against Next.js 16's params typing by consulting `node_modules/next/dist/docs/` before writing the handlers (per `AGENTS.md`).

## 5. Home page rail

- [x] 5.1 Create `src/components/home/RightNowRail.tsx` — an RSC that calls `rankForHome({ limit: 10 })` and renders video cards (reuse `VideoCard` if its props align; otherwise a thin local card). Each card links to `/watch/[id]` and renders title, channel name, and `relativeTime(published_at)`.
- [x] 5.2 Handle the empty state: if the result is `[]`, render an inline message "Nothing to show here — try importing videos or adjusting taste weights" with a link to `/taste`.
- [x] 5.3 In `src/app/page.tsx`, gate the rail on `process.env.NEXT_PUBLIC_HOME_RANKING === '1'`. When the flag is on, render `<RightNowRail />` above the existing content block. When off, render the page unchanged.
- [x] 5.4 Verify by visiting `/` with flag off (unchanged), then flag on (rail appears above existing content).

## 6. Taste lab integration

- [x] 6.1 Add a `MuteTodayButton` client component in `src/components/taste/` that accepts `{ clusterId, initiallyMuted }` and calls `POST /api/taste/clusters/[id]/mute-today` on click, updating local state from the response.
- [x] 6.2 Wire `MuteTodayButton` into the cluster row on `/taste` list page. Fetch the muted-today state via `getMutedClusterIdsToday()` batch helper to avoid N+1.
- [x] 6.3 Wire `MuteTodayButton` into `/taste/[clusterId]` detail page header next to the existing label/weight controls.
- [x] 6.4 Render the button unconditionally — it is not gated by `NEXT_PUBLIC_HOME_RANKING`.

## 7. Documentation

- [x] 7.1 Add a "Home ranking rail" subsection to `RUNBOOK.md` covering the `NEXT_PUBLIC_HOME_RANKING` flag, the mute-today behavior, the half-life constant, and the debug API (`/api/home/ranking?debug=1`). Update the `Last verified` date.
- [x] 7.2 Add a short "Home ranking (phase 2 of consumption-first)" section to `CLAUDE.md`'s architecture list, following the pattern of the existing "Taste substrate" and "Taste lab" sections. Keep it to one paragraph — point at `src/lib/home-ranking.ts` as the single legal read path and at `src/lib/mutes.ts` for the toggle.
- [x] 7.3 `justfile` review: no new verbs needed, but confirm none of `dev`/`status`/`logs` need adjustment. Note in the PR.

## 8. Manual verification

These are user-driven browser checks; leaving open for human confirmation.
Automated checks run so far: `npm run lint` and `npx tsc --noEmit` are
clean; a `tsx` smoke invocation of `rankForHome({ limit: 5 })` returned 5
scored candidates against the live `events.db`, and `setMuteToday`
round-tripped (insert → delete) with `ClusterNotFoundError` firing on
unknown IDs.

- [x] 8.1 With flag off, `/` renders identically to pre-change. Capture a before/after screenshot.
- [x] 8.2 With flag on, set `NEXT_PUBLIC_HOME_RANKING=1` in `.env.local`, reload `/`, confirm rail renders above existing content.
- [x] 8.3 Edit a cluster's `weight` to `0` via `/taste`; reload `/`; confirm videos in that cluster drop off the rail.
- [x] 8.4 Click "Mute today" on a cluster with non-zero weight; reload `/`; confirm the same behavior. Click it again; reload; confirm videos return.
- [x] 8.5 Hit `GET /api/home/ranking?debug=1` in the browser; confirm breakdown JSON renders and multipliers match expectation on a spot-checked video.
- [x] 8.6 With flag on and an empty inbox pool, confirm the empty-state message and the link to `/taste`.
- [x] 8.7 Confirm the "For right now" rail does NOT render, and the page does NOT crash, if the taste substrate has not been built yet (no `video_cluster_assignments` rows) — every candidate gets `clusterWeight = 0.5` and the rail renders based on freshness + state alone.
