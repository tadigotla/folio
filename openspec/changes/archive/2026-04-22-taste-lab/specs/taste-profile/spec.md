## ADDED Requirements

### Requirement: `/taste` page lists active clusters

The application SHALL render a `/taste` route that displays every active cluster (one whose `taste_clusters.retired_at IS NULL`) in descending order of member count. Each cluster row SHALL show: cluster `id`, current `label` (or a "(unlabeled)" placeholder), `weight`, total member count, fuzzy-member count, and a preview strip of up to 8 representative member videos ordered by `video_cluster_assignments.similarity DESC`.

#### Scenario: Cluster with members and no label
- **GIVEN** a cluster with `label = NULL`, `weight = 1.0`, `retired_at = NULL`, and 42 members (of which 6 have `is_fuzzy = 1`)
- **WHEN** the user visits `/taste`
- **THEN** the page SHALL show a row for that cluster
- **AND** the label field SHALL display "(unlabeled)"
- **AND** the weight control SHALL show `1.0`
- **AND** the row SHALL show "42 members" and "6 fuzzy"
- **AND** the preview strip SHALL show up to 8 member videos ordered by similarity descending

#### Scenario: Retired clusters are not in the main list
- **GIVEN** a cluster with `retired_at` set to a past timestamp
- **WHEN** the user visits `/taste`
- **THEN** the cluster SHALL NOT appear in the active-cluster list
- **AND** the cluster SHALL appear in the "Retired" section with its most recent `label` and `retired_at` timestamp

#### Scenario: Empty but active clusters are hidden by default
- **GIVEN** a cluster with `retired_at = NULL` and zero rows in `video_cluster_assignments` referencing it
- **WHEN** the user visits `/taste`
- **THEN** the cluster SHALL NOT appear in the main list
- **AND** the cluster SHALL appear under an "Empty clusters" disclosure that is collapsed by default

### Requirement: Cluster label and weight are user-editable

The application SHALL allow the user to set a cluster's `label` (free-form text, trimmed; empty string stored as NULL) and `weight` (float in the closed range `[0.0, 3.0]`, step `0.1`). Edits SHALL persist to `taste_clusters` and update `updated_at`.

#### Scenario: User renames a cluster
- **WHEN** the user submits a new label "rigor over rhetoric" for cluster `id = 7`
- **THEN** `taste_clusters.label` for row `id = 7` SHALL equal `"rigor over rhetoric"`
- **AND** `taste_clusters.updated_at` SHALL equal the current UTC time

#### Scenario: User clears a label
- **GIVEN** cluster `id = 7` with `label = "old name"`
- **WHEN** the user submits an empty string as the label
- **THEN** `taste_clusters.label` for row `id = 7` SHALL be NULL

#### Scenario: Weight out of range is rejected
- **WHEN** the user submits a weight of `3.5` for any cluster
- **THEN** the API SHALL respond with HTTP 422
- **AND** `taste_clusters.weight` SHALL remain unchanged

#### Scenario: Label survives a cluster rebuild
- **GIVEN** cluster `id = 7` has label `"rigor over rhetoric"`
- **AND** phase-1's centroid-match logic matches a new-build cluster to this row above the ID-preservation threshold
- **WHEN** `just taste-cluster` is invoked
- **THEN** row `id = 7` in `taste_clusters` SHALL retain its label and weight
- **AND** row `id = 7`'s `centroid` SHALL be updated to the new-build centroid

### Requirement: Merging clusters absorbs source into target

The application SHALL support merging one or more source clusters into a target cluster via a single atomic operation. After a merge of source cluster `B` into target cluster `A`:

- Every `video_cluster_assignments` row with `cluster_id = B` SHALL be updated to `cluster_id = A`.
- `A.centroid` SHALL be recomputed as the L2-normalized mean of its new union of member embeddings.
- Each moved assignment's `similarity` SHALL be recomputed against the new `A.centroid`, and `is_fuzzy` SHALL be set per the phase-1 similarity floor.
- `A.updated_at` SHALL be set to the current UTC time.
- `B` SHALL be soft-retired: `B.retired_at` set to the current UTC time, `B.label` preserved.

All of the above SHALL occur in a single database transaction.

#### Scenario: Merge moves assignments and retires source
- **GIVEN** cluster `A` (id 3, label "craft tutorials", 50 members) and cluster `B` (id 11, label NULL, 8 members)
- **WHEN** the user merges `B` into `A`
- **THEN** `video_cluster_assignments` rows previously referencing cluster 11 SHALL now reference cluster 3
- **AND** cluster 3 SHALL have 58 members
- **AND** cluster 11 SHALL have `retired_at` set to the current UTC time
- **AND** cluster 11's `label` SHALL remain NULL (not mutated by merge)

#### Scenario: Merging a cluster into itself is rejected
- **WHEN** the user attempts to merge cluster `A` into cluster `A`
- **THEN** the API SHALL respond with HTTP 422
- **AND** no rows in `taste_clusters` or `video_cluster_assignments` SHALL be modified

### Requirement: Splitting a cluster partitions its members

The application SHALL support splitting a cluster into `k` sub-clusters (`k ≥ 2`, `k ≤ member count`). After a split of cluster `A` into `k` children:

- K-means is run on `A`'s current member embeddings.
- The first child SHALL reuse `A`'s `id` and inherit its prior `label` and `weight`.
- The remaining `k - 1` children SHALL be inserted as new rows with `label = NULL`, `weight = 1.0`, fresh `created_at`/`updated_at`.
- Every member video SHALL be reassigned to its nearest child centroid; each assignment's `similarity` and `is_fuzzy` SHALL be recomputed.
- The entire operation SHALL run in a single transaction.

#### Scenario: Split into k=2
- **GIVEN** cluster `A` (id 5, label "ethics", 30 members)
- **WHEN** the user splits `A` with `k = 2`
- **THEN** row 5 in `taste_clusters` SHALL retain its label "ethics"
- **AND** one new row SHALL exist in `taste_clusters` with `label = NULL` and `weight = 1.0`
- **AND** every one of the original 30 members SHALL have a `video_cluster_assignments` row pointing at either cluster 5 or the new child
- **AND** the sum of the two children's member counts SHALL equal 30

#### Scenario: Split with invalid k is rejected
- **WHEN** the user submits a split of cluster `A` with `k = 1`
- **THEN** the API SHALL respond with HTTP 422

#### Scenario: Split with k larger than member count is rejected
- **GIVEN** cluster `A` has 4 members
- **WHEN** the user submits a split with `k = 5`
- **THEN** the API SHALL respond with HTTP 422

### Requirement: Retiring a cluster soft-deletes it

The application SHALL support explicit retirement of a cluster. Retirement SHALL set `retired_at` to the current UTC time and preserve `label`, `weight`, and `centroid`. Retirement SHALL NOT delete rows from `video_cluster_assignments`; on the next `just taste-cluster` run those videos will be assigned to a new nearest active cluster.

#### Scenario: Retire hides the cluster without data loss
- **GIVEN** cluster `id = 7` with `retired_at = NULL`, 20 members, label "misc"
- **WHEN** the user retires cluster 7
- **THEN** row 7 in `taste_clusters` SHALL have `retired_at` set to the current UTC time
- **AND** the 20 rows in `video_cluster_assignments` SHALL remain unchanged
- **AND** row 7 SHALL appear in `/taste`'s "Retired" section
- **AND** row 7 SHALL NOT appear in the active-cluster list

#### Scenario: Retired cluster is excluded from next rebuild's ID preservation
- **GIVEN** cluster `id = 7` has `retired_at` set
- **WHEN** `just taste-cluster` runs
- **THEN** no new-build cluster SHALL inherit id 7
- **AND** row 7 SHALL remain in `taste_clusters` unchanged

### Requirement: Reassigning a single video updates its assignment row only

The application SHALL allow the user to move a single video to a different cluster. Reassignment SHALL update that video's row in `video_cluster_assignments` to the new `cluster_id`, recompute `similarity` against the new cluster's current `centroid`, set `is_fuzzy` per the phase-1 floor, and set `assigned_at` to the current UTC time. Reassignment SHALL NOT recompute any cluster's centroid, SHALL NOT modify any other assignment row, and SHALL NOT retire any cluster (even one that is emptied).

#### Scenario: Video reassigned to another active cluster
- **GIVEN** video `v1` is assigned to cluster 3 with `similarity = 0.72`
- **WHEN** the user reassigns `v1` to cluster 5
- **THEN** `video_cluster_assignments` for `v1` SHALL have `cluster_id = 5`
- **AND** `similarity` SHALL equal the cosine similarity between `v1`'s embedding and cluster 5's current centroid
- **AND** cluster 3's centroid and cluster 5's centroid SHALL be unchanged

#### Scenario: Reassigning to a retired cluster is rejected
- **WHEN** the user attempts to reassign a video to a cluster whose `retired_at IS NOT NULL`
- **THEN** the API SHALL respond with HTTP 422

### Requirement: Drift indicator reports likes that poorly fit the current map

The application SHALL expose a "taste drift" count on `/taste`: the number of liked videos (i.e. videos whose `consumption.status` is one of `saved`, `in_progress`, or `archived`) whose current `video_cluster_assignments.similarity` is below `0.6`. The indicator SHALL NOT count inbox or dismissed videos. The indicator SHALL be hidden when the total liked-video count is below 30.

#### Scenario: Drift count reflects only likes with low similarity
- **GIVEN** the corpus contains 120 liked videos
- **AND** 17 of those likes have `video_cluster_assignments.similarity < 0.6`
- **AND** 40 inbox videos also have `similarity < 0.6`
- **WHEN** the user visits `/taste`
- **THEN** the drift indicator SHALL read "17"

#### Scenario: Drift indicator hidden on a small like-set
- **GIVEN** the corpus contains 12 liked videos
- **WHEN** the user visits `/taste`
- **THEN** the drift indicator SHALL NOT be rendered

### Requirement: Mutations route through a single edit module and are transactional

The application SHALL implement every cluster-map mutation (label set, weight set, merge, split, retire, reassign) in a single module `src/lib/taste-edit.ts`. Each mutation SHALL run inside a single database transaction and SHALL be rejected with HTTP 422 on any illegal operation (e.g. merge-into-self, weight out of range, retired-cluster target). No route handler outside `src/app/api/taste/` SHALL mutate `taste_clusters` or `video_cluster_assignments`.

#### Scenario: Partial failure rolls back
- **GIVEN** a merge is initiated between clusters 3 and 11
- **WHEN** an error is thrown during centroid recomputation
- **THEN** `video_cluster_assignments` SHALL contain the same rows with the same `cluster_id` values as before the merge was attempted
- **AND** `taste_clusters` for rows 3 and 11 SHALL be unchanged
- **AND** the API SHALL respond with HTTP 500

#### Scenario: Optimistic lock rejects edits racing a rebuild
- **GIVEN** the user opened `/taste` and read cluster 3 with `updated_at = T1`
- **AND** a rebuild ran and updated cluster 3 to `updated_at = T2`
- **WHEN** the user submits a label edit for cluster 3 referencing `updated_at = T1`
- **THEN** the API SHALL respond with HTTP 409
- **AND** `taste_clusters` row 3 SHALL be unchanged
