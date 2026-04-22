import { getDb } from './db';
import {
  bufferToFloats,
  getActiveEmbeddingConfig,
  type ActiveEmbeddingConfig,
} from './embeddings';

// --- Config ---------------------------------------------------------------

export interface ClusterConfig {
  minClusterSize: number;  // default 6
  minSamples: number;      // default 3 — currently informational only
  fuzzyFloor: number;      // cosine sim below this → is_fuzzy=1, default 0.65
  idPreserveThreshold: number; // centroid cosine for ID reuse, default 0.85
  kMin: number;
  kMax: number;
  kmeansMaxIter: number;
  kmeansRestarts: number;
}

// fuzzyFloor calibrated empirically against OpenAI text-embedding-3-small: the
// "related content" band sits at 0.5–0.7, with cluster avg ~0.55. A floor of
// 0.45 leaves ~15–20% of the corpus flagged fuzzy (genuine outliers) rather
// than flagging "ordinary cluster members" as fuzzy.
const DEFAULTS: ClusterConfig = {
  minClusterSize: 6,
  minSamples: 3,
  fuzzyFloor: 0.45,
  idPreserveThreshold: 0.85,
  kMin: 5,
  kMax: 15,
  kmeansMaxIter: 50,
  kmeansRestarts: 3,
};

// --- Vector math ----------------------------------------------------------

function l2norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

export function normalize(v: Float32Array): Float32Array {
  const n = l2norm(v);
  if (n === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosineSim(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function cosineDistNormed(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSim(a, b);
}

function addInto(acc: Float32Array, v: Float32Array) {
  for (let i = 0; i < acc.length; i++) acc[i] += v[i];
}

function scaleInto(acc: Float32Array, s: number) {
  for (let i = 0; i < acc.length; i++) acc[i] *= s;
}

/**
 * Centroid of a set of unit-vector embeddings: mean then L2-normalize.
 * Used by both phase-1's clustering and phase-2's merge/split mutations
 * so they share the same notion of "centroid" verbatim.
 */
export function meanCentroid(points: Float32Array[]): Float32Array {
  if (points.length === 0) throw new Error('meanCentroid: empty point set');
  const dim = points[0].length;
  const acc = new Float32Array(dim);
  for (const p of points) addInto(acc, p);
  scaleInto(acc, 1 / points.length);
  return normalize(acc);
}

export function centroidToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function runKmeans(
  points: Float32Array[],
  k: number,
  opts: { maxIter?: number; restarts?: number; seed?: number } = {}
): { labels: number[]; centroids: Float32Array[]; inertia: number } {
  const maxIter = opts.maxIter ?? DEFAULTS.kmeansMaxIter;
  const restarts = opts.restarts ?? DEFAULTS.kmeansRestarts;
  const seedBase = opts.seed ?? 1337;
  let best: KMeansResult | null = null;
  for (let r = 0; r < restarts; r++) {
    const rng = makeRng(seedBase + r * 31);
    const result = kmeans(points, k, maxIter, rng);
    if (!best || result.inertia < best.inertia) best = result;
  }
  if (!best) throw new Error('runKmeans: no result produced');
  return best;
}

export function silhouetteScore(
  points: Float32Array[],
  labels: number[],
  k: number
): number {
  return silhouette(points, labels, k);
}

export function getDefaultClusterConfig(): ClusterConfig {
  return { ...DEFAULTS };
}

// --- K-means (cosine on unit vectors → same as squared-euclidean up to scale) ---

interface KMeansResult {
  labels: number[];
  centroids: Float32Array[];
  inertia: number;
}

function kmeans(
  points: Float32Array[],
  k: number,
  maxIter: number,
  rng: () => number
): KMeansResult {
  const n = points.length;
  const dim = points[0].length;

  // k-means++ init
  const centroids: Float32Array[] = [];
  centroids.push(new Float32Array(points[Math.floor(rng() * n)]));
  while (centroids.length < k) {
    const d2 = new Array(n).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const c of centroids) {
        const d = cosineDistNormed(points[i], c);
        if (d < best) best = d;
      }
      d2[i] = best * best;
      sum += d2[i];
    }
    if (sum === 0) {
      centroids.push(new Float32Array(points[Math.floor(rng() * n)]));
      continue;
    }
    let r = rng() * sum;
    let picked = 0;
    for (let i = 0; i < n; i++) {
      r -= d2[i];
      if (r <= 0) { picked = i; break; }
    }
    centroids.push(new Float32Array(points[picked]));
  }

  const labels = new Array(n).fill(-1);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    // assign
    for (let i = 0; i < n; i++) {
      let bestK = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const s = cosineSim(points[i], centroids[c]);
        if (s > bestSim) { bestSim = s; bestK = c; }
      }
      if (labels[i] !== bestK) { labels[i] = bestK; changed = true; }
    }
    // update
    const counts = new Array(k).fill(0);
    const sums: Float32Array[] = [];
    for (let c = 0; c < k; c++) sums.push(new Float32Array(dim));
    for (let i = 0; i < n; i++) {
      counts[labels[i]]++;
      addInto(sums[labels[i]], points[i]);
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // Re-seed an empty cluster on a random point.
        centroids[c] = new Float32Array(points[Math.floor(rng() * n)]);
      } else {
        scaleInto(sums[c], 1 / counts[c]);
        centroids[c] = normalize(sums[c]);
      }
    }
    if (!changed && iter > 0) break;
  }

  // inertia = sum of cosine distances to assigned centroid
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    inertia += cosineDistNormed(points[i], centroids[labels[i]]);
  }
  return { labels, centroids, inertia };
}

function silhouette(points: Float32Array[], labels: number[], k: number): number {
  const n = points.length;
  if (k < 2) return -1;
  const byCluster: number[][] = [];
  for (let c = 0; c < k; c++) byCluster.push([]);
  for (let i = 0; i < n; i++) byCluster[labels[i]].push(i);

  // Sample to keep runtime bounded.
  const sampleSize = Math.min(n, 200);
  const stride = Math.max(1, Math.floor(n / sampleSize));
  let total = 0;
  let count = 0;
  for (let i = 0; i < n; i += stride) {
    const own = byCluster[labels[i]];
    if (own.length <= 1) continue;
    let a = 0;
    for (const j of own) if (j !== i) a += cosineDistNormed(points[i], points[j]);
    a /= own.length - 1;
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === labels[i] || byCluster[c].length === 0) continue;
      let mean = 0;
      for (const j of byCluster[c]) mean += cosineDistNormed(points[i], points[j]);
      mean /= byCluster[c].length;
      if (mean < b) b = mean;
    }
    if (b === Infinity) continue;
    const s = (b - a) / Math.max(a, b);
    total += s;
    count++;
  }
  return count === 0 ? -1 : total / count;
}

function makeRng(seed: number): () => number {
  // xorshift32
  let s = seed | 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

// --- DB access ------------------------------------------------------------

interface LikeEmbRow {
  video_id: string;
  vec: Buffer;
  dim: number;
}

function loadLikeSetEmbeddings(cfg: ActiveEmbeddingConfig): { ids: string[]; points: Float32Array[] } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT emb.video_id, emb.vec, emb.dim
         FROM video_embeddings emb
         JOIN video_provenance p ON p.video_id = emb.video_id
        WHERE p.source_kind = 'like'
          AND emb.provider = ?
          AND emb.model = ?`
    )
    .all(cfg.provider, cfg.model) as LikeEmbRow[];
  return {
    ids: rows.map((r) => r.video_id),
    points: rows.map((r) => normalize(bufferToFloats(r.vec))),
  };
}

function loadAllEmbeddings(cfg: ActiveEmbeddingConfig): { ids: string[]; points: Float32Array[] } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT emb.video_id, emb.vec, emb.dim
         FROM video_embeddings emb
        WHERE emb.provider = ?
          AND emb.model = ?`
    )
    .all(cfg.provider, cfg.model) as LikeEmbRow[];
  return {
    ids: rows.map((r) => r.video_id),
    points: rows.map((r) => normalize(bufferToFloats(r.vec))),
  };
}

interface OldClusterRow {
  id: number;
  label: string | null;
  centroid: Buffer;
  dim: number;
}

function loadActiveClusters(): { id: number; label: string | null; centroid: Float32Array }[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, label, centroid, dim
         FROM taste_clusters
        WHERE retired_at IS NULL`
    )
    .all() as OldClusterRow[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    centroid: normalize(bufferToFloats(r.centroid)),
  }));
}

function centroidToBuffer(v: Float32Array): Buffer {
  return centroidToBlob(v);
}

// --- Core: cluster & assign -----------------------------------------------

export interface ClusterRunStats {
  likeCount: number;
  clusterCount: number;
  perCluster: { id: number; size: number; label: string | null }[];
  assignedCount: number;
  fuzzyCount: number;
}

function chooseK(
  points: Float32Array[],
  cfg: ClusterConfig
): { labels: number[]; centroids: Float32Array[]; k: number; score: number } {
  const maxK = Math.min(cfg.kMax, Math.floor(points.length / cfg.minClusterSize));
  const minK = Math.max(cfg.kMin, 2);
  let best: { labels: number[]; centroids: Float32Array[]; k: number; score: number } | null = null;
  for (let k = minK; k <= maxK; k++) {
    let runBest: KMeansResult | null = null;
    for (let r = 0; r < cfg.kmeansRestarts; r++) {
      const rng = makeRng(1337 + k * 31 + r);
      const result = kmeans(points, k, cfg.kmeansMaxIter, rng);
      if (!runBest || result.inertia < runBest.inertia) runBest = result;
    }
    if (!runBest) continue;
    const score = silhouette(points, runBest.labels, k);
    if (!best || score > best.score) {
      best = { labels: runBest.labels, centroids: runBest.centroids, k, score };
    }
  }
  if (!best) throw new Error('chooseK: no valid k produced a clustering');
  return best;
}

export async function rebuildClusters(
  overrides: Partial<ClusterConfig> = {}
): Promise<ClusterRunStats> {
  const cfg: ClusterConfig = { ...DEFAULTS, ...overrides };
  const embCfg = getActiveEmbeddingConfig();
  const db = getDb();

  const { ids: likeIds, points: likePoints } = loadLikeSetEmbeddings(embCfg);
  if (likePoints.length < cfg.minClusterSize * cfg.kMin) {
    throw new Error(
      `Not enough liked videos with embeddings to cluster. Got ${likePoints.length}, need at least ${cfg.minClusterSize * cfg.kMin}. Import your likes and run \`just taste-build\` first.`
    );
  }

  // 1. Cluster the like-set.
  const chosen = chooseK(likePoints, cfg);
  const { labels, centroids } = chosen;
  const k = chosen.k;

  // 2. Enforce min_cluster_size by dissolving undersized clusters. Their
  //    members will be absorbed via the general assignment pass below
  //    (potentially marked fuzzy).
  const sizes = new Array(k).fill(0);
  for (const l of labels) sizes[l]++;
  const keep: number[] = [];
  for (let c = 0; c < k; c++) if (sizes[c] >= cfg.minClusterSize) keep.push(c);
  if (keep.length === 0) {
    throw new Error(
      `Clustering produced no cluster meeting min_cluster_size=${cfg.minClusterSize}. Corpus may be too sparse or homogeneous.`
    );
  }
  const keptCentroids = keep.map((c) => centroids[c]);

  // 3. Preserve old cluster IDs by greedy centroid matching (cosine ≥ threshold).
  const oldClusters = loadActiveClusters();
  const newCount = keptCentroids.length;
  const assignedOldIdForNew: (number | null)[] = new Array(newCount).fill(null);
  const matchedOldIds = new Set<number>();

  const pairs: { newIdx: number; oldId: number; sim: number }[] = [];
  for (let i = 0; i < newCount; i++) {
    for (const old of oldClusters) {
      if (old.centroid.length !== keptCentroids[i].length) continue;
      const sim = cosineSim(keptCentroids[i], old.centroid);
      if (sim >= cfg.idPreserveThreshold) {
        pairs.push({ newIdx: i, oldId: old.id, sim });
      }
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);
  for (const p of pairs) {
    if (assignedOldIdForNew[p.newIdx] !== null) continue;
    if (matchedOldIds.has(p.oldId)) continue;
    assignedOldIdForNew[p.newIdx] = p.oldId;
    matchedOldIds.add(p.oldId);
  }

  const now = new Date().toISOString();

  // 4. Write everything transactionally.
  const { ids: allIds, points: allPts } = loadAllEmbeddings(embCfg);
  const txResult = db.transaction((): { finalIds: number[]; assignedCount: number; fuzzyCount: number } => {
    // Retire unmatched old clusters (preserve row + label).
    const retireStmt = db.prepare(
      `UPDATE taste_clusters SET retired_at = ? WHERE id = ? AND retired_at IS NULL`
    );
    for (const old of oldClusters) {
      if (!matchedOldIds.has(old.id)) retireStmt.run(now, old.id);
    }

    // Upsert: update matched, insert unmatched → produces final cluster IDs.
    const updateStmt = db.prepare(
      `UPDATE taste_clusters
          SET centroid = ?, dim = ?, updated_at = ?, retired_at = NULL
        WHERE id = ?`
    );
    const insertStmt = db.prepare(
      `INSERT INTO taste_clusters
         (label, weight, centroid, dim, created_at, updated_at)
       VALUES (NULL, 1.0, ?, ?, ?, ?)`
    );
    const ids: number[] = new Array(newCount);
    for (let i = 0; i < newCount; i++) {
      const c = keptCentroids[i];
      const buf = centroidToBuffer(c);
      const dim = c.length;
      const reuseId = assignedOldIdForNew[i];
      if (reuseId !== null) {
        updateStmt.run(buf, dim, now, reuseId);
        ids[i] = reuseId;
      } else {
        const info = insertStmt.run(buf, dim, now, now);
        ids[i] = Number(info.lastInsertRowid);
      }
    }

    // Assign every embedded video to its nearest active cluster.
    db.prepare('DELETE FROM video_cluster_assignments').run();
    const assignStmt = db.prepare(
      `INSERT INTO video_cluster_assignments
         (video_id, cluster_id, similarity, is_fuzzy, assigned_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    let fuzzy = 0;
    for (let i = 0; i < allIds.length; i++) {
      const p = allPts[i];
      let bestSim = -Infinity;
      let bestIdx = 0;
      for (let c = 0; c < keptCentroids.length; c++) {
        const s = cosineSim(p, keptCentroids[c]);
        if (s > bestSim) { bestSim = s; bestIdx = c; }
      }
      const isFuzzy = bestSim < cfg.fuzzyFloor ? 1 : 0;
      if (isFuzzy) fuzzy++;
      assignStmt.run(allIds[i], ids[bestIdx], bestSim, isFuzzy, now);
    }

    return { finalIds: ids, assignedCount: allIds.length, fuzzyCount: fuzzy };
  })();
  const { finalIds, assignedCount, fuzzyCount } = txResult;

  const perCluster = finalIds.map((id) => {
    const size = db
      .prepare('SELECT COUNT(*) AS n FROM video_cluster_assignments WHERE cluster_id = ?')
      .get(id) as { n: number };
    const label = (db
      .prepare('SELECT label FROM taste_clusters WHERE id = ?')
      .get(id) as { label: string | null }).label;
    return { id, size: size.n, label };
  });

  return {
    likeCount: likeIds.length,
    clusterCount: finalIds.length,
    perCluster,
    assignedCount,
    fuzzyCount,
  };
}
