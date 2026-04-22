## Why

Phase 1 of the [conversational-editor](../conversational-editor/) umbrella. Every later phase — the `/taste` lab, the conversational `/` page, the overnight brief, the agent's discovery tools — depends on two data artifacts that don't exist today:

1. A **per-video embedding** that lets us compare videos by meaning, not just metadata.
2. A **taste cluster map** derived from the user's Likes, with each video in the corpus assigned to a cluster so the agent can talk about "your craft-tutorial theme" rather than raw video IDs.

This change builds both, with no user-visible UI. It is pure data-plane work — when it lands, `/` looks identical. When later phases land on top of it, everything becomes possible.

It also sets the provider pattern the umbrella commits to: **cloud for interactive quality, local for bulk cost**. Batch video enrichment (per-video 50-word summary + topic tags) runs locally through Ollama; embeddings default to OpenAI's `text-embedding-3-small` but the pipeline is provider-indirected so a local BGE-M3 fallback is a config flip away.

## What Changes

- **NEW migration `012_taste_substrate.sql`** — adds `video_embeddings`, `video_enrichment`, `taste_clusters`, `video_cluster_assignments`. All additive. No changes to `videos`, `consumption`, `issues`, or `issue_slots`.
- **NEW `src/lib/embeddings.ts`** — provider-indirected embedding client. Interface: `embed(texts: string[]): Promise<number[][]>`. Implementations: `openai-text-embedding-3-small` (default), `bge-m3-local` via Ollama endpoint. Writes to `video_embeddings` with `(video_id, provider, model, vec)`.
- **NEW `src/lib/enrichment.ts`** — Ollama-backed batch enrichment. For a given list of video IDs, fetches title + description (and transcript when cheap), runs Gemma (or user-configured local model) with a fixed prompt to produce `{ summary: string (~50 words), topic_tags: string[] (3 items) }`, writes `video_enrichment`. Idempotent; skips already-enriched rows unless forced.
- **NEW `src/lib/transcripts.ts`** — `youtube-transcript-api` wrapper. Fetches auto-captions for a given video ID; writes a `videos.transcript_fetched_at` timestamp and the transcript text to a separate `video_transcripts` table (BLOB or TEXT). Skips on 404. Whisper-local fallback is documented as out-of-scope for this phase.
- **NEW `src/lib/taste.ts`** — clusters the like-set embeddings (default: HDBSCAN with conservative min_cluster_size, falling back to K-means if silhouette is poor). Assigns every video in the corpus to its nearest cluster by cosine, with a similarity floor below which the video is flagged `fuzzy`. Writes `taste_clusters` + `video_cluster_assignments`. Re-runnable; on re-run, cluster IDs are preserved by centroid-match to prior clusters (avoids shuffling labels that will later be user-edited).
- **NEW CLI scripts** invocable via `tsx`:
  - `scripts/taste/fetch-transcripts.ts` — fetch transcripts for videos missing them.
  - `scripts/taste/enrich.ts` — run enrichment for videos missing it.
  - `scripts/taste/embed.ts` — compute embeddings for videos missing them.
  - `scripts/taste/cluster.ts` — rebuild the cluster map from current likes.
  - `scripts/taste/build-all.ts` — runs the four above in order.
- **NEW `justfile` verbs**:
  - `taste-build` — invokes `build-all.ts`.
  - `taste-cluster` — invokes `cluster.ts` only (cheap re-run).
- **NEW env vars** in `.env.example`:
  - `OPENAI_API_KEY` (optional; required only if `EMBEDDING_PROVIDER=openai`).
  - `EMBEDDING_PROVIDER` (`openai` | `bge-local`, default `openai`).
  - `OLLAMA_HOST` (default `http://localhost:11434`).
  - `OLLAMA_ENRICHMENT_MODEL` (default `gemma3:4b` or whatever the user has).
- **MODIFIED `RUNBOOK.md`** — new section "Taste substrate" covering: what each script does, how to run them end-to-end, how to re-cluster after importing new likes, what to do if an Ollama model isn't installed, expected cost (first build ≈ $0.30 at current OpenAI pricing for 5,665 videos), and how to switch to the local fallback.
- **MODIFIED `CLAUDE.md`** — new "Taste substrate" paragraph under Architecture.

## Capabilities

### New capabilities

- **taste-profile** — computed per-video embeddings, per-user cluster map with cluster assignments for every video. This phase lays the substrate; the `taste-lab` phase exposes it for human editing; the `editorial-agent` phase consumes it.

### Modified capabilities

- **video-library** — gains companion tables (`video_embeddings`, `video_enrichment`, `video_transcripts`, `taste_clusters`, `video_cluster_assignments`). The core `videos` table shape is unchanged.

## Impact

- **Code added:** five new lib files, five new CLI scripts, one migration. ~1,500 LOC estimate.
- **Database:** one additive migration. Disk growth: embeddings at 1536 floats × 4 bytes × 5,665 videos ≈ 35 MB. Transcripts variable but typically < 50 MB aggregate. Total < 100 MB added.
- **External services:**
  - OpenAI (optional, default): `text-embedding-3-small` at $0.02/1M tokens. Full rebuild ≈ $0.30.
  - Ollama (local, required for enrichment): user provides model. No network cost.
  - `youtube-transcript-api` (free, no key).
- **Operational:** first run is `just taste-build` — may take 30–60 min depending on Ollama speed and transcript availability. Subsequent runs are incremental and fast. No new scheduled jobs yet (that arrives with `overnight-brief`).
- **Reversibility:** entirely. The migration is additive; rolling back is `DROP TABLE` on the four new tables. Nothing else depends on them in this phase.
- **Out of scope (deferred):**
  - Any UI surface. `/taste` is the next change.
  - Agent integration. Arrives in phase 3.
  - Whisper-local transcript fetch for videos without auto-captions. Optional later addition.
  - Provider auto-failover (if OpenAI is down, fall back to local). Phase 1 is explicit-config only.
  - Cluster hierarchy (sub-themes inside themes). Flat clusters only.
