## ADDED Requirements

### Requirement: `taste_clusters.weight` has a defined ranking semantic
The `weight REAL` column on `taste_clusters` (created by migration `012_taste_substrate.sql`) SHALL have the following defined semantic: it is a multiplicative modulator on the cluster's contribution to per-video ranking scores, consumed by `rankForHome()` (see `home-ranking` capability). `weight = 1.0` is the neutral default. `weight = 0` effectively mutes the cluster (videos assigned to it score `0` in ranking). `weight = 2` approximately doubles the cluster's contribution relative to neutral. Readers SHALL clamp weight to `[0, 2]`; values outside that range SHALL be treated as their nearest bound.

The `/taste` editor SHALL continue to accept arbitrary numeric weights (it is governed by `src/lib/taste-edit.ts` and its existing optimistic-lock contract) — validation at the write path is out of scope for this phase. A `weight` edit SHALL cause `taste_clusters.updated_at` to advance, triggering the existing concurrent-edit protection in `taste-edit.ts`.

#### Scenario: Neutral weight is the default
- **WHEN** a new cluster is created by `rebuildClusters()`
- **THEN** its `weight` SHALL default to `1.0` (existing migration contract)

#### Scenario: Zero weight mutes the cluster for ranking
- **WHEN** a cluster's `weight = 0` and a ranker reads it
- **THEN** every video assigned to that cluster SHALL contribute `0` to its final ranking score via `clusterWeight`

#### Scenario: Weight is clamped at read
- **WHEN** a ranker reads a cluster with `weight = 5`
- **THEN** the effective `clusterWeight` SHALL be `2`

### Requirement: Ephemeral per-day "mute today" override
The system SHALL support muting a cluster for a single local calendar day (America/New_York) without editing its persistent `weight`. A new table `taste_cluster_mutes(cluster_id INTEGER NOT NULL REFERENCES taste_clusters(id) ON DELETE CASCADE, muted_on TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(cluster_id, muted_on))` SHALL store the overrides. The `muted_on` column SHALL hold `YYYY-MM-DD` derived from `America/New_York` local date.

A cluster SHALL be considered "muted today" iff a row exists in `taste_cluster_mutes` with the cluster's id and `muted_on = today(America/New_York)`. The mute SHALL auto-expire when the local day changes — no sweeper job is required, because queries SHALL filter by today's date.

Toggling mute-today SHALL be idempotent: inserting when a row already exists SHALL be a no-op (`INSERT OR IGNORE`); deleting when no row exists SHALL be a no-op.

#### Scenario: Muting today zeros clusterWeight for ranking
- **WHEN** a row exists in `taste_cluster_mutes` for cluster `C` with `muted_on = today`
- **AND** `rankForHome()` is called today
- **THEN** every video assigned to cluster `C` SHALL have `clusterWeight = 0` regardless of `taste_clusters.weight`

#### Scenario: Mute auto-clears at local midnight
- **WHEN** a row exists in `taste_cluster_mutes` for cluster `C` with `muted_on = 2026-04-23`
- **AND** `rankForHome()` is called on `2026-04-24` (America/New_York)
- **THEN** the stale row SHALL NOT affect scoring
- **AND** no sweeper job SHALL be required to remove the stale row

#### Scenario: Muting while already muted is idempotent
- **WHEN** the user triggers "Mute today" on cluster `C` twice in the same day
- **THEN** the second call SHALL succeed and leave exactly one row in `taste_cluster_mutes` for that `(cluster_id, muted_on)` pair

#### Scenario: Un-muting removes the row
- **WHEN** the user triggers "Mute today" on a cluster that is already muted today
- **THEN** the row SHALL be deleted from `taste_cluster_mutes`
- **AND** subsequent calls to `rankForHome()` SHALL no longer zero `clusterWeight` for that cluster's videos

### Requirement: Mute-today API route
The system SHALL expose `POST /api/taste/clusters/[id]/mute-today` that toggles the mute-today state for the given cluster. The response SHALL be `200` with body `{ muted: boolean }` indicating the new state after toggling. If the cluster does not exist or is retired, the response SHALL be `404`.

The route SHALL use `better-sqlite3` transactions to ensure toggle atomicity. The route SHALL NOT advance `taste_clusters.updated_at` (mutes are orthogonal to the cluster's optimistic-lock contract).

#### Scenario: Toggle to muted
- **WHEN** client POSTs to `/api/taste/clusters/42/mute-today` and no mute row exists for today
- **THEN** a row SHALL be inserted and response SHALL be `200 { "muted": true }`

#### Scenario: Toggle to un-muted
- **WHEN** client POSTs to `/api/taste/clusters/42/mute-today` and a mute row exists for today
- **THEN** the row SHALL be deleted and response SHALL be `200 { "muted": false }`

#### Scenario: Unknown cluster
- **WHEN** client POSTs to `/api/taste/clusters/9999/mute-today` and no such cluster exists
- **THEN** response SHALL be `404`

#### Scenario: Retired cluster
- **WHEN** client POSTs to `/api/taste/clusters/42/mute-today` and the cluster's `retired_at IS NOT NULL`
- **THEN** response SHALL be `404`

#### Scenario: Mute does not bump cluster updated_at
- **WHEN** a mute toggle succeeds against cluster `C`
- **THEN** `taste_clusters.updated_at` for `C` SHALL be unchanged

### Requirement: "Mute today" control on `/taste` and `/taste/[clusterId]`
The taste lab SHALL render a "Mute today" button on both `/taste` (per-cluster row) and `/taste/[clusterId]` (cluster detail). The button SHALL call `POST /api/taste/clusters/[id]/mute-today` and SHALL reflect the current muted-today state (on/off) after the response resolves. The button SHALL render unconditionally — it is a property of the cluster, not of the home-ranking feature flag.

#### Scenario: Button reflects initial state
- **WHEN** the user loads `/taste` and cluster `C` is muted today
- **THEN** the "Mute today" button for `C` SHALL render in its "muted" visual state

#### Scenario: Button toggles state
- **WHEN** the user clicks "Mute today" on a cluster that is not muted
- **THEN** the API SHALL be called
- **AND** on success the button SHALL switch to its "muted" state without a full page reload
