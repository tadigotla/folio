import { getDb } from '../db';
import {
  bufferToFloats,
  getActiveEmbeddingConfig,
} from '../embeddings';
import { cosineSim, normalize } from '../taste';
import type { ParsedRef } from './description-graph';

const HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 2;

export interface ScoreBreakdown {
  clusterCosine: number;
  clusterId: number;
  clusterWeight: number;
  sourceFreshness: number;
  sourceVideoId: string;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
}

interface ActiveClusterRow {
  id: number;
  weight: number;
  centroid: Buffer;
  dim: number;
}

interface EmbeddingRow {
  vec: Buffer;
}

interface VideoRow {
  published_at: string | null;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function freshnessFor(publishedAt: string | null, now: Date): number {
  if (!publishedAt) return 0.5;
  const ts = Date.parse(publishedAt);
  if (!Number.isFinite(ts)) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - ts) / MS_PER_DAY);
  return Math.max(0, Math.exp(-ageDays / HALF_LIFE_DAYS));
}

function loadSourceEmbedding(sourceVideoId: string): Float32Array | null {
  const db = getDb();
  const cfg = getActiveEmbeddingConfig();
  const row = db
    .prepare(
      `SELECT vec FROM video_embeddings
        WHERE video_id = ? AND provider = ? AND model = ?`,
    )
    .get(sourceVideoId, cfg.provider, cfg.model) as EmbeddingRow | undefined;
  if (!row) return null;
  return normalize(bufferToFloats(row.vec));
}

function loadActiveClusters(): {
  id: number;
  weight: number;
  centroid: Float32Array;
}[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, weight, centroid, dim
         FROM taste_clusters
        WHERE retired_at IS NULL`,
    )
    .all() as ActiveClusterRow[];
  return rows.map((r) => ({
    id: r.id,
    weight: r.weight,
    centroid: normalize(bufferToFloats(r.centroid)),
  }));
}

export function scoreCandidate(
  sourceVideoId: string,
  _candidate: ParsedRef,
  now: Date = new Date(),
): ScoreResult | null {
  const sourceVec = loadSourceEmbedding(sourceVideoId);
  if (!sourceVec) return null;
  const clusters = loadActiveClusters();
  if (clusters.length === 0) return null;

  let bestSim = -Infinity;
  let bestIdx = 0;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (c.centroid.length !== sourceVec.length) continue;
    const s = cosineSim(sourceVec, c.centroid);
    if (s > bestSim) {
      bestSim = s;
      bestIdx = i;
    }
  }
  if (!Number.isFinite(bestSim)) return null;

  const winner = clusters[bestIdx];
  const clusterWeight = clamp(winner.weight, WEIGHT_MIN, WEIGHT_MAX);

  const db = getDb();
  const srcRow = db
    .prepare(`SELECT published_at FROM videos WHERE id = ?`)
    .get(sourceVideoId) as VideoRow | undefined;
  const sourceFreshness = freshnessFor(srcRow?.published_at ?? null, now);

  const clusterCosine = bestSim;
  const score = clusterCosine * clusterWeight * sourceFreshness;

  return {
    score,
    breakdown: {
      clusterCosine,
      clusterId: winner.id,
      clusterWeight,
      sourceFreshness,
      sourceVideoId,
    },
  };
}
