## Why

Phase 2 of the [conversational-editor](../conversational-editor/) umbrella. Phase 1 (`taste-substrate`) populated `taste_clusters` and `video_cluster_assignments` — the data is there, but it is unreadable by the human who has to feed the agent. Clusters have auto-increment IDs, not names. Weights are all `1.0`. Membership is a query nobody has written. Until the user can **see and tend** the cluster map, later phases (the agent, the overnight brief, discovery) are flying blind — they would cite "cluster 4" to the user, which is worse than useless.

This change introduces the first user-visible surface in the umbrella: `/taste`. It is a gardening tool, not an analytics dashboard. The user labels clusters, tunes their weights, merges mistakes, splits over-broad buckets, and retires clusters that aren't themes at all. Those edits are what make the agent's prose specific ("your *rigor-over-rhetoric* cluster has 3 unheard candidates") rather than robotic.

Nothing here is automatable: a cluster's meaning is a human judgment call. The goal of `/taste` is to make that judgment call **cheap** — a label is one text field, a merge is one drag, a weight is one slider.

## What Changes

- **NEW route `/taste`** — server component page. Lists all active clusters, sorted by member count descending. Each cluster row shows: cluster ID, label (editable), weight (slider 0.0–3.0), member count, "fuzzy member" count, and a preview strip of up to 8 representative videos (highest cosine to centroid). Empty clusters are collapsed; retired clusters surfaced in a separate "Retired" section.
- **NEW route `/taste/[clusterId]`** — detail page for a single cluster. Full member list with per-video cosine similarity, ability to move a video to another cluster (reassign), and cluster-level actions: merge into another cluster, split this cluster (via K-means on its members with user-chosen k), retire.
- **NEW `src/lib/taste-edit.ts`** — the mutation layer. Functions: `setClusterLabel(id, label)`, `setClusterWeight(id, weight)`, `mergeClusters(sourceIds, targetId)`, `splitCluster(id, k)`, `retireCluster(id)`, `reassignVideo(videoId, newClusterId, options?)`. Each mutation updates `taste_clusters.updated_at`. Merge and split recompute centroids. Reassign sets `similarity` to the new pair's cosine and `is_fuzzy` per the same floor used at build time. All operations wrapped in single transactions.
- **NEW API routes** under `src/app/api/taste/`:
  - `POST /api/taste/clusters/[id]` — body `{ label?, weight? }`, updates fields.
  - `POST /api/taste/clusters/[id]/merge` — body `{ into: number }`.
  - `POST /api/taste/clusters/[id]/split` — body `{ k: number }`.
  - `POST /api/taste/clusters/[id]/retire` — no body.
  - `POST /api/taste/assignments/[videoId]` — body `{ clusterId: number }`.
  - Success: 204. Illegal op (e.g. merging a cluster into itself): 422.
- **NEW `src/lib/taste-read.ts`** (or extension of existing `taste.ts`) — the read layer: `getClusterSummaries()`, `getClusterDetail(id)`, `getClusterMembers(id, { limit, offset })`, `getClusterDrift()` (count of likes whose assignment similarity is below a secondary "stale" threshold; surfaces the "your taste may have drifted" signal).
- **NEW cluster-drift indicator** — small masthead badge on `/taste` showing last build time and drift count. Clicking it links to the runbook's "rebuild" section. No auto-run.
- **NEW `src/components/taste/`** — client islands: `ClusterCard`, `ClusterLabelInput`, `WeightSlider`, `MergeDialog`, `SplitDialog`, `ReassignPopover`. shadcn primitives only.
- **NEW nav entry** — the masthead link to `/taste` (a "★ taste" badge referenced in the umbrella's design sketch). Rendered in `src/app/layout.tsx` or the existing nav component.
- **MODIFIED `RUNBOOK.md`** — new "Taste lab" section covering: when to rebuild (after importing many new likes), how weights propagate (they don't yet — that's phase 3; documented here so users understand the weight slider is *prospective*), how labels survive rebuilds (ID preservation from phase 1), and how to retire a bad cluster.
- **MODIFIED `CLAUDE.md`** — new "Taste lab" paragraph under Architecture, pointing at `src/lib/taste-edit.ts` as the only legal mutation path.

## Capabilities

### New capabilities

- **taste-profile** — extended from phase 1. This phase adds the *editable* surface: cluster labels, weights, merges, splits, retires, and manual reassignments. Phase 1 produced the cluster map; this phase lets the human tend it.

### Modified capabilities

- None. `video-library`, `editorial-workspace`, `home-view` are unchanged.

## Impact

- **Code added:** one route (with a child), one mutation lib, one read-helper module, one API route group (~5 endpoints), ~6 client components. Estimated ~1,200 LOC.
- **Database:** zero schema changes. All mutations happen on existing phase-1 tables (`taste_clusters`, `video_cluster_assignments`). The retire/merge/split operations use existing columns (`retired_at`, `label`, `weight`, `centroid`).
- **External services:** none. All work happens in-process. No new env vars.
- **Operational:** no new scheduled jobs. `just taste-cluster` remains the rebuild verb; no new verbs needed.
- **Reversibility:** label/weight edits are trivially reversible. Merge + split are irreversible in the forward direction but the historical cluster rows are kept (with `retired_at` set) so the audit trail survives; a follow-on "undo" is plausible but not in scope.
- **Prospective weight semantics:** the `weight` column is written by this phase but *read* by nothing yet. That's deliberate — phase 3 (the agent) is where weights affect pool ranking and prompt emphasis. Documented in the runbook so users understand what weight they're setting against.
- **Out of scope (deferred):**
  - Weight → pool-ranking wiring (phase 3).
  - Cluster hierarchy / sub-themes (umbrella non-goal).
  - Undo history (follow-on).
  - Bulk operations (e.g., "retire all clusters with fewer than 3 likes"). Single-cluster operations are enough to start.
  - Mobile layout. `/taste` is desktop-first.
