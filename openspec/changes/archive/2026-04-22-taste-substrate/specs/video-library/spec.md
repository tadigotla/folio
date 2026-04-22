## ADDED Requirement: Per-video embeddings are stored alongside the corpus

The application SHALL maintain a `video_embeddings` table with one row per (video_id, provider, model) triple. Embeddings SHALL be recomputable from the current enrichment + metadata, and the table SHALL be the single source of truth for semantic queries in later phases (agent ranking, cluster assignment).

#### Scenario: Adding a new video produces an embedding on next build
- **GIVEN** a new video has been imported (e.g. from a subscription-upload refresh)
- **AND** `just taste-build` is invoked
- **WHEN** the embed step runs
- **THEN** a `video_embeddings` row SHALL exist for that video under the configured provider + model
- **AND** re-running `just taste-build` without new videos SHALL NOT re-compute any existing embedding

#### Scenario: Switching embedding providers preserves prior generations
- **GIVEN** embeddings exist under `provider='openai'`
- **WHEN** `EMBEDDING_PROVIDER=bge-local` is set and `just taste-build` is invoked
- **THEN** new rows SHALL be written with the new `(provider, model)` key
- **AND** the original OpenAI-generated rows SHALL remain untouched
- **AND** queries that compare embeddings SHALL filter to a single `(provider, model)` pair

## ADDED Requirement: Local enrichment produces per-video summaries and tags

The application SHALL maintain a `video_enrichment` table where each row holds a human-readable ~50-word summary plus a JSON array of three topic tags for the video. Enrichment SHALL be produced by a locally-run Ollama model (no cloud inference) to keep bulk-processing cost at zero.

#### Scenario: A fresh build enriches every corpus video
- **GIVEN** an empty `video_enrichment` table
- **WHEN** `just taste-build` runs to completion against a corpus of N videos
- **THEN** `video_enrichment` SHALL contain approximately N rows (allowing for videos missing both title and description, which are skipped)
- **AND** each row's `summary` SHALL be non-empty
- **AND** each row's `topic_tags` SHALL parse as a JSON array of three strings

#### Scenario: Ollama unavailable fails cleanly
- **GIVEN** no Ollama server is reachable at `OLLAMA_HOST`
- **WHEN** `scripts/taste/enrich.ts` is invoked
- **THEN** the script SHALL exit non-zero
- **AND** the error message SHALL reference the runbook's "Taste substrate" section
- **AND** no partial enrichment rows SHALL be written

## ADDED Requirement: Transcript fetch is opportunistic

The application SHALL attempt to fetch YouTube auto-captions for each corpus video via a free public endpoint and store them in a `video_transcripts` table. Videos without captions SHALL proceed through enrichment and embedding on title + description alone.

#### Scenario: A video with auto-captions gets a transcript row
- **GIVEN** a video has English auto-captions available on YouTube
- **WHEN** the transcript-fetch step runs
- **THEN** a `video_transcripts` row SHALL be written with `source='youtube-captions'`
- **AND** the row's `text` field SHALL be non-empty

#### Scenario: A video without captions is skipped without error
- **GIVEN** a video has no captions
- **WHEN** the transcript-fetch step runs
- **THEN** no `video_transcripts` row SHALL be written for that video
- **AND** the script SHALL continue processing subsequent videos without error

## ADDED Requirement: Taste clusters are computed from the like-set

The application SHALL maintain a `taste_clusters` table whose active rows describe the shape of the user's taste, computed from the embeddings of videos whose `video_provenance.source_kind = 'like'`. Each cluster has a centroid, an optional user-provided label, a weight (default 1.0), and timestamps.

#### Scenario: Clustering runs produce between 5 and 15 clusters for ~500 likes
- **GIVEN** the user has 500–600 liked videos with embeddings
- **WHEN** `just taste-cluster` is invoked
- **THEN** `taste_clusters` SHALL contain between 5 and 15 active (non-retired) rows
- **AND** each active cluster SHALL have at least `min_cluster_size` assigned videos (default 6)
- **AND** any cluster failing that threshold SHALL NOT exist; its videos SHALL instead be marked `is_fuzzy=1` against their nearest surviving cluster

#### Scenario: Cluster IDs persist across rebuilds
- **GIVEN** a cluster with ID 3 exists and has user-assigned label "rigor over rhetoric"
- **AND** the user imports 10 new likes that do not substantively shift cluster 3's centroid
- **WHEN** `just taste-cluster` is re-run
- **THEN** the cluster whose centroid best matches cluster 3's former centroid (cosine ≥ 0.85) SHALL retain ID 3
- **AND** its label "rigor over rhetoric" SHALL be unchanged

#### Scenario: A retired cluster is marked, not deleted
- **GIVEN** a cluster with ID 5 and a user label exists
- **AND** after a rebuild no new cluster matches it within the similarity threshold
- **WHEN** `just taste-cluster` completes
- **THEN** the row with ID 5 SHALL have `retired_at` set to the run timestamp
- **AND** the row's `label` SHALL be preserved (for history and potential resurrection)

## ADDED Requirement: Every corpus video is assigned to a cluster or marked fuzzy

The application SHALL maintain a `video_cluster_assignments` table with exactly one row per video, linking it to the active cluster whose centroid is closest by cosine similarity. Videos whose similarity to the nearest cluster falls below a configurable floor (default 0.65) SHALL carry `is_fuzzy=1` so downstream consumers can treat them differently.

#### Scenario: Every corpus video has an assignment row after build
- **GIVEN** a corpus of N videos with embeddings
- **WHEN** `just taste-cluster` completes
- **THEN** `video_cluster_assignments` SHALL contain N rows
- **AND** every row SHALL reference an active (non-retired) cluster

#### Scenario: Low-similarity assignments are marked fuzzy
- **GIVEN** a video whose highest cosine to any active cluster centroid is 0.58
- **WHEN** assignment runs
- **THEN** its row SHALL have `is_fuzzy=1`
- **AND** its `similarity` field SHALL be 0.58
