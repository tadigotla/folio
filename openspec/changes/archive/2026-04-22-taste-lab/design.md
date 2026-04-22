## Context

Phase 1 (`taste-substrate`) produced a cluster map the user cannot read. The rows in `taste_clusters` have auto-increment IDs, no labels, and a default weight of 1.0 across the board. `video_cluster_assignments` binds every corpus video to a cluster, but there is no surface to inspect which videos landed in which cluster, or to correct mistakes. The agent (phase 3) will read these tables — if the human never tends them first, the agent will cite "cluster 4" in its prose, which is noise dressed up as specificity.

This phase is small in volume (one page, one detail page, ~5 mutation endpoints) but carries the full weight of the umbrella's human-in-the-loop commitment. The design decisions below are the ones that matter: everything else is CRUD.

## Goals / Non-Goals

**Goals:**
- Make every cluster legible in a single glance — label, weight, size, representative members.
- Make labeling, weight-tuning, and assignment correction cheap single-click / single-drag operations.
- Preserve the phase-1 guarantee that cluster IDs (and therefore labels) survive rebuilds. No edit made here may be silently erased by a `taste-cluster` rerun.
- Keep the mutation surface narrow and auditable: one library module, one API route group, every mutation goes through a transaction.

**Non-Goals:**
- Wiring `weight` into pool ranking or agent prompts. That is phase 3's job; this phase writes the value, later phases read it.
- Cluster hierarchy or nested themes. Flat, per the umbrella.
- Undo history. A merge is final; split-back is a user-initiated operation, not an "undo" button.
- Bulk actions ("retire all clusters of size < 3"). One cluster at a time.
- Any mobile affordance. Desktop only.
- Auto-rebuild triggered by edits. Rebuild remains a manual `just taste-cluster`.

## Decisions

### Only `taste-edit.ts` may mutate cluster tables

Every label, weight, merge, split, retire, and reassignment flows through one module. Rationale:

- **Auditability.** If something clobbers a user-supplied label, there is exactly one file to inspect.
- **Transaction discipline.** Merge (which deletes N-1 rows, updates M assignments, and recomputes a centroid) is correct only as a single transaction. Centralizing forces this.
- **Invariant enforcement.** Phase 1's ID-preservation rule is load-bearing. `taste-edit.ts` is where we re-assert it (e.g., by refusing to delete a cluster that phase-1's centroid-match would want to inherit; soft-retire instead).

Alternative rejected: sprinkle mutations inline in API route handlers. Fast to write, impossible to reason about later.

### Merge is "absorb into target", not "create new"

When the user merges clusters A and B into A:
- Move every `video_cluster_assignments` row from `cluster_id = B` to `cluster_id = A`.
- Recompute A's centroid from the union of member embeddings (normalize after summing).
- Recompute each moved assignment's `similarity` against the new centroid; update `is_fuzzy` against the same floor constant the build script uses.
- Soft-retire B: `retired_at = now()`, label preserved.

Alternative considered: create a new cluster C with the union and retire both A and B. Rejected because it breaks label continuity — the user's existing "rigor-over-rhetoric" label on A would end up on a retired row, and the agent would cite a fresh, unlabeled cluster.

### Split uses K-means on the cluster's members only

When the user splits cluster A into k sub-clusters:
- Take A's current member embeddings.
- Run the same K-means implementation phase-1 uses (`src/lib/taste.ts` already exports it).
- Create k new `taste_clusters` rows: the first inherits A's `id` and label (rename suggested in UI, not forced); the remaining k-1 get fresh IDs.
- Reassign each member video to its new nearest centroid; recompute `similarity` and `is_fuzzy`.
- No soft-retire of A — it was reused as the first child.

Default `k = 2` in the dialog; the dialog shows a silhouette preview for `k ∈ [2, 5]` to guide the choice. The computation is sub-100ms for realistic cluster sizes; doing it client-side on preview is acceptable but server-side is fine too.

Alternative rejected: always create k fresh clusters, retire A. Same label-continuity problem as merge.

### Reassigning a single video never retires or creates a cluster

Moving one video to a different cluster:
- Updates that row in `video_cluster_assignments`.
- Recomputes `similarity` against the destination centroid.
- Does **not** recompute centroids (one video's move is centroid-noise).
- Does **not** retire the source even if it empties — an empty cluster just gets hidden in the UI (see below) but remains in `taste_clusters` so it can receive members on the next build.

Rationale: reassignment is a tiny correction, not a structural change. Recomputing centroids per click makes the cluster map unstable and makes successive reassignments behave strangely.

### Empty active clusters are hidden, not retired

A cluster with zero members (after a reassignment or a rebuild that simply didn't match it) stays `retired_at = NULL` in the DB but is hidden from the `/taste` top list. Why not retire automatically?

- Retired clusters are excluded from phase-1's centroid-match on the next rebuild. A transient-empty active cluster can still re-acquire members naturally.
- Auto-retire introduces a race where a user reassigns the last member and the UI disappears the cluster they were editing.

The UI shows empty-active clusters in a small "empty clusters" disclosure so they are not invisible; the user can manually retire them if they wish.

### Weights are 0.0 – 3.0, float, with 0.1 step

Range rationale:
- `0.0` = "ignore this theme" (lets the user effectively hide a cluster without retiring).
- `1.0` = neutral baseline.
- `3.0` = strong emphasis. Past 3× the agent's downstream emphasis-math gets perverse; no reason to allow it.

Step of 0.1 is judged fine-grained enough for a judgment tool. Integer-only felt too coarse; two decimals felt too precious.

### Representative members are top-N by cosine to centroid

For the cluster card preview strip (8 thumbnails) and any "tell me about this cluster" prose, we pick the top members by `similarity DESC`. Cheap (already stored), legible, stable across rebuilds modulo centroid drift.

Alternative considered: sample randomly across the cluster. Rejected because it buries strong exemplars and makes the preview unhelpfully noisy.

### Drift indicator definition

"Drift" = count of **liked** videos (consumption.status IN ('saved','in_progress','archived') ∧ last_viewed_at IS NOT NULL) whose current assignment `similarity < 0.6` — i.e., likes that the cluster map fits poorly. We do not count inbox videos (they haven't been endorsed by the user) or dismissed videos (they don't represent taste).

Rationale: drift is a signal to rebuild, and rebuilds derive from the like-set. Counting fuzzy non-likes conflates "corpus is noisy" with "taste map is stale".

### Mutation API is server-only; no optimistic client updates

Every mutation issues a fresh server fetch on success. No local reducer mirroring DB state. Rationale:

- Cluster edits are low-frequency (a user session might make 20, not 200).
- The source of truth is a SQLite table we can query in microseconds from an RSC. Mirroring it in client state is duplication without benefit.
- The cases where optimistic UI would matter (merge, split) are also the cases where server-side recomputation changes numbers (centroids, similarities) the user cares about seeing correctly. Optimistic UI would lie.

### Transactions and concurrency

All mutations use `better-sqlite3` `prepare().run()` inside `db.transaction(() => ...)()`. Concurrent `/taste` sessions are not a real scenario (single-user app), but the orchestrator cron could in principle rebuild mid-edit. Cheap defense: `taste.ts` rebuild acquires an advisory marker (a row in a single-row `taste_build_state` table or simply a file lock), and edit endpoints check for "rebuild in progress" and 409 if so. For phase 2 we'll take the lightweight approach — read the `updated_at` of the latest-touched cluster row and reject if it changed since the edit began (optimistic locking). Simpler than a lock table.

## Risks / Trade-offs

- **A merge that the user regrets** → no undo. Mitigation: soft-retire preserves the old label and centroid; a follow-on could expose "revive retired cluster" as a recovery path. For phase 2, the merge dialog has a confirm step with a one-sentence preview ("Merge 'cluster 7' (12 members) into 'rigor-over-rhetoric' (54 members)?").

- **Split with wrong k** → produces silly sub-clusters. Mitigation: the split dialog shows the silhouette preview and the size distribution at each k; the user picks with evidence. If the split is bad, the user can immediately merge back — it's the same operation in reverse.

- **Rebuild mid-edit** → optimistic lock rejects the edit with 409. Mitigation: the UI catches 409 and prompts "cluster map was rebuilt; reload". Annoying but safe.

- **Weight slider gives false signal** → user sets a weight expecting it to affect *something now*, but nothing reads it until phase 3. Mitigation: the runbook + a small inline note on `/taste` ("weights take effect when the editor agent lands in phase 3") make this explicit.

- **Drift indicator is noisy on small like-sets** → with only a few likes, one misfit dominates the count. Mitigation: hide the indicator below a minimum like-set size (say, 30). At <30 likes the map is provisional anyway.

- **Retired clusters accumulate forever** → database grows with history nobody reads. Mitigation: none needed at expected scale (clusters are O(20), retires are O(dozens) over a year). Revisit if we ever cross O(1000).

- **Cluster size skew** → one mega-cluster with 2000 members and 19 with <10. Mitigation: not a phase-2 problem to solve. The split tool exists for exactly this case; the user decides when to wield it. We do, however, sort clusters by member count descending so the problem is visible.

## Migration Plan

No schema migration. All changes are additive at the code layer.

Rollout:
1. Ship the read layer + `/taste` page with no mutations (view-only).
2. Add label + weight edits; validate they survive rebuild.
3. Add reassignment (lowest-risk mutation).
4. Add merge + split + retire behind the same transaction discipline.
5. Add drift indicator + runbook section.

Rollback: deleting the route and the API handlers is sufficient. No data model changes to reverse.

## Open Questions

- **Preview strip shape:** 8 thumbnails in a horizontal strip, or a 2×4 grid? Build-time choice; the design survives either.
- **Retire confirmation UX:** modal vs inline "are you sure?" button. Lean inline; modals feel ceremonial for a reversible (via revive) action.
- **Where does the cluster-drift badge live?** On `/taste` only, or also on `/`? `/taste` only in phase 2 — the homepage is about to be torn up in phase 3 anyway.
- **Empty-active cluster surfacing:** a disclosure at the bottom of the list, or a toggle ("show empty clusters") in the header? Pick at build time.
