## Intent

Build the two data artifacts — per-video embeddings and a per-user cluster map — that every later phase of the conversational-editor umbrella depends on. No UI. Pure data plane.

## Decisions

### Why per-video embeddings rather than per-channel

Tempting to embed channels (563 of them, cheaper). But the agent will need to reason about *specific videos* — "the one where he talks about cast iron metallurgy" — not *channel averages*. Per-video is the right grain. Cost is trivial (< $0.50 full rebuild).

### What text to embed

For each video: `title\n\n<channel name>\n\n<description (truncated to ~800 chars)>\n\n<transcript summary if present>`.

The transcript *summary* (from the enrichment step) gets embedded, not the raw transcript. Two reasons:
- Raw transcripts are too long and noisy; embedding them dilutes title/description signal.
- The summary is a human-readable 50-word gist we also need for the agent's context anyway. Computing it once and embedding it is free reuse.

### Clustering algorithm

Default HDBSCAN with `min_cluster_size=6`, `min_samples=3`. Rationale:
- Density-based clustering discovers arbitrary-shaped themes and handles "noise" points gracefully (they become the `fuzzy` bucket).
- User has 558 likes, so K-means's cluster-count brittleness is real; HDBSCAN finds the natural number.
- Fallback to K-means with `k` chosen by silhouette if HDBSCAN returns a degenerate result (single cluster covering everything).

We embed using the like-set *only* for cluster discovery. Every non-like video is then assigned to the nearest cluster by cosine similarity. Below a similarity floor (default 0.65) the video is tagged `fuzzy`. The floor is configurable.

### Preserving cluster IDs across rebuilds

If the user has labeled "cluster 3" as "rigor over rhetoric" and we rebuild, we must not shuffle cluster IDs and lose that label. On rebuild:

1. Run HDBSCAN on the new like-set.
2. For each new cluster, compute centroid.
3. For each old cluster, compute cosine to each new centroid.
4. Greedy assignment: old cluster IDs inherit to the nearest new cluster above a match threshold (default 0.85).
5. Unmatched new clusters get new IDs; unmatched old clusters are retired (label preserved in `taste_clusters` with `retired_at` set, so history is recoverable).

This is deliberate engineering. Without it, the user would lose labor every time they imported new likes.

### Why Ollama for enrichment, not Anthropic

Cost arithmetic for 5,665 videos × ~200 input tokens × ~100 output tokens (one call each):
- Anthropic Sonnet 4.6 @ $3/$15 per MTok → ~$12 per full rebuild.
- Local Gemma on user's machine → $0.
- Quality difference for a 50-word summary + 3 tags is negligible.

The quality-critical path is the interactive agent (phase 3). There we pay for Sonnet/Opus. Here we don't.

### Why split `video_enrichment` from `videos`

Two tables because:
- Enrichment is regenerable from source; putting it in `videos` would couple import and enrichment lifecycles.
- We may want multiple enrichment generations (e.g., different models, A/B). A `(video_id, model, run_at)` keyed table supports that.

### Why split `video_transcripts` from `videos`

Size. A transcript can be 50KB+; 5,000 of them bloats the main table and hurts query plans. Separate table with `video_id` FK keeps `videos` lean.

### Incremental by default

Every script has a `--force` flag but defaults to processing only rows missing the target artifact. On a daily-ish cadence the user runs `just taste-build` and it touches only the ~50 new imports.

### Cluster re-computation cadence

Clustering is cheap (seconds). Re-cluster on every `taste-build`, unconditionally. The cluster-ID-preservation logic makes this safe. No separate "slow" path needed.

## Schema sketch

```sql
CREATE TABLE video_embeddings (
  video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,          -- 'openai' | 'bge-local'
  model      TEXT NOT NULL,          -- e.g. 'text-embedding-3-small'
  dim        INTEGER NOT NULL,
  vec        BLOB NOT NULL,          -- float32[dim], length = dim*4
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, provider, model)
);

CREATE TABLE video_enrichment (
  video_id    TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,         -- e.g. 'gemma3:4b'
  summary     TEXT NOT NULL,         -- ~50 words
  topic_tags  TEXT NOT NULL,         -- JSON array of 3 strings
  created_at  TEXT NOT NULL,
  run_at      TEXT NOT NULL
);

CREATE TABLE video_transcripts (
  video_id       TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  source         TEXT NOT NULL,      -- 'youtube-captions' | 'whisper-local'
  language       TEXT NOT NULL,
  text           TEXT NOT NULL,
  fetched_at     TEXT NOT NULL
);

CREATE TABLE taste_clusters (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  label           TEXT,              -- null = unlabeled
  weight          REAL NOT NULL DEFAULT 1.0,
  centroid        BLOB NOT NULL,     -- float32[dim]
  dim             INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  retired_at      TEXT               -- null if active
);

CREATE TABLE video_cluster_assignments (
  video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  cluster_id  INTEGER NOT NULL REFERENCES taste_clusters(id) ON DELETE CASCADE,
  similarity  REAL NOT NULL,
  is_fuzzy    INTEGER NOT NULL DEFAULT 0,   -- 1 if below similarity floor
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (video_id)
);

CREATE INDEX idx_video_cluster_cluster ON video_cluster_assignments(cluster_id);
```

## Risks

- **Transcript availability.** Not every video has auto-captions. For those, embedding falls back to title + description only. Acceptable; the `fuzzy` bucket absorbs the lower-signal cases.
- **Ollama not installed.** Enrichment fails hard with a clear error pointing at the runbook. We do not fall back to cloud — that would silently burn money. User fixes install, re-runs.
- **HDBSCAN degenerate cluster.** On a corpus with weak structure, everything collapses to one cluster or noise. The K-means fallback handles this; documented in the runbook.
- **Embedding drift across model versions.** If the user later switches from `text-embedding-3-small` to another model, old embeddings are incomparable. The `(provider, model)` key in `video_embeddings` lets us store multiple generations side-by-side; queries that compare embeddings must filter to the active model. A follow-on can add a migration verb.
- **First-run cost surprise.** Even at $0.30 it's worth naming in the runbook so the user doesn't get a surprise bill. Also worth naming Ollama's time cost (tens of minutes for enrichment depending on model / machine).

## Non-decisions (deliberately deferred)

- Vector index (sqlite-vec, faiss). At 5,665 vectors, brute-force cosine in memory is sub-100ms. Adding a vector store is premature optimization; revisit if the corpus 10×'s.
- Provider auto-failover. Explicit config only in phase 1. If the user wants local, they set `EMBEDDING_PROVIDER=bge-local`.
- Fine-tuning the enrichment prompt. First pass uses a simple prompt; iteration happens once we see real output in `/taste`.
- Cluster hierarchy (themes containing sub-themes). Flat for phase 1. User-driven merges in phase 2 provide a pragmatic substitute.
