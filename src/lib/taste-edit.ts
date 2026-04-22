import { getDb } from './db';
import { nowUTC } from './time';
import {
  bufferToFloats,
  getActiveEmbeddingConfig,
} from './embeddings';
import {
  cosineSim,
  meanCentroid,
  centroidToBlob,
  normalize,
  runKmeans,
  silhouetteScore,
  getDefaultClusterConfig,
} from './taste';

/** Validation failure — illegal cluster operation requested. Routes map to HTTP 422. */
export class IllegalEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalEditError';
  }
}

/** Optimistic-lock failure — the cluster row moved since the client read it. Routes map to HTTP 409. */
export class ConcurrentEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrentEditError';
  }
}

const WEIGHT_MIN = 0.0;
const WEIGHT_MAX = 3.0;

// --- Helpers --------------------------------------------------------------

interface ClusterRow {
  id: number;
  label: string | null;
  weight: number;
  centroid: Buffer;
  dim: number;
  retired_at: string | null;
  updated_at: string;
}

function loadCluster(id: number): ClusterRow {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, label, weight, centroid, dim, retired_at, updated_at
         FROM taste_clusters
        WHERE id = ?`
    )
    .get(id) as ClusterRow | undefined;
  if (!row) throw new IllegalEditError(`cluster ${id} not found`);
  return row;
}

function assertNotRetired(row: ClusterRow): void {
  if (row.retired_at !== null) {
    throw new IllegalEditError(`cluster ${row.id} is retired`);
  }
}

function assertExpectedUpdatedAt(row: ClusterRow, expected: string): void {
  if (row.updated_at !== expected) {
    throw new ConcurrentEditError(
      `cluster ${row.id} was modified concurrently (expected ${expected}, got ${row.updated_at})`
    );
  }
}

function loadEmbedding(videoId: string): Float32Array {
  const cfg = getActiveEmbeddingConfig();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT vec FROM video_embeddings
        WHERE video_id = ? AND provider = ? AND model = ?`
    )
    .get(videoId, cfg.provider, cfg.model) as { vec: Buffer } | undefined;
  if (!row) {
    throw new IllegalEditError(
      `video ${videoId} has no embedding under active provider/model`
    );
  }
  return normalize(bufferToFloats(row.vec));
}

function loadEmbeddingsForCluster(clusterId: number): {
  videoId: string;
  vec: Float32Array;
}[] {
  const cfg = getActiveEmbeddingConfig();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.video_id, e.vec
         FROM video_cluster_assignments a
         JOIN video_embeddings e ON e.video_id = a.video_id
        WHERE a.cluster_id = ?
          AND e.provider = ?
          AND e.model = ?`
    )
    .all(clusterId, cfg.provider, cfg.model) as { video_id: string; vec: Buffer }[];
  return rows.map((r) => ({
    videoId: r.video_id,
    vec: normalize(bufferToFloats(r.vec)),
  }));
}

function fuzzyFloor(): number {
  return getDefaultClusterConfig().fuzzyFloor;
}

// --- Mutations ------------------------------------------------------------

export interface EditMeta {
  expectedUpdatedAt: string;
}

export function setClusterFields(
  id: number,
  fields: { label?: string | null; weight?: number },
  meta: EditMeta
): string | null {
  const labelProvided = Object.prototype.hasOwnProperty.call(fields, 'label');
  const weightProvided = Object.prototype.hasOwnProperty.call(fields, 'weight');
  if (!labelProvided && !weightProvided) return null;

  if (weightProvided) {
    const w = fields.weight as number;
    if (!Number.isFinite(w) || w < WEIGHT_MIN || w > WEIGHT_MAX) {
      throw new IllegalEditError(
        `weight ${w} out of range [${WEIGHT_MIN}, ${WEIGHT_MAX}]`
      );
    }
  }

  const db = getDb();
  return db.transaction((): string => {
    const row = loadCluster(id);
    assertNotRetired(row);
    assertExpectedUpdatedAt(row, meta.expectedUpdatedAt);

    const newUpdatedAt = nowUTC();
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if (labelProvided) {
      const raw = fields.label;
      const trimmed = raw === null || raw === undefined ? null : raw.trim();
      const stored = trimmed && trimmed.length > 0 ? trimmed : null;
      sets.push('label = ?');
      args.push(stored);
    }
    if (weightProvided) {
      sets.push('weight = ?');
      args.push(fields.weight as number);
    }
    sets.push('updated_at = ?');
    args.push(newUpdatedAt);
    args.push(id);
    db.prepare(
      `UPDATE taste_clusters SET ${sets.join(', ')} WHERE id = ?`
    ).run(...args);
    return newUpdatedAt;
  })();
}

export function setClusterLabel(
  id: number,
  label: string | null,
  meta: EditMeta
): string | null {
  return setClusterFields(id, { label }, meta);
}

export function setClusterWeight(
  id: number,
  weight: number,
  meta: EditMeta
): string | null {
  return setClusterFields(id, { weight }, meta);
}

export function reassignVideo(
  videoId: string,
  newClusterId: number
): void {
  const db = getDb();
  db.transaction(() => {
    const target = loadCluster(newClusterId);
    if (target.retired_at !== null) {
      throw new IllegalEditError(`cannot reassign to retired cluster ${newClusterId}`);
    }
    const existing = db
      .prepare(`SELECT 1 FROM video_cluster_assignments WHERE video_id = ?`)
      .get(videoId) as { 1: number } | undefined;
    if (!existing) {
      throw new IllegalEditError(`video ${videoId} has no current assignment`);
    }
    const vec = loadEmbedding(videoId);
    const centroid = normalize(bufferToFloats(target.centroid));
    if (centroid.length !== vec.length) {
      throw new IllegalEditError(
        `dimension mismatch: video=${vec.length} cluster=${centroid.length}`
      );
    }
    const sim = cosineSim(vec, centroid);
    const isFuzzy = sim < fuzzyFloor() ? 1 : 0;
    db.prepare(
      `UPDATE video_cluster_assignments
          SET cluster_id = ?, similarity = ?, is_fuzzy = ?, assigned_at = ?
        WHERE video_id = ?`
    ).run(newClusterId, sim, isFuzzy, nowUTC(), videoId);
  })();
}

export function mergeClusters(
  sourceId: number,
  targetId: number,
  meta: EditMeta
): void {
  if (sourceId === targetId) {
    throw new IllegalEditError('cannot merge a cluster into itself');
  }
  const db = getDb();
  db.transaction(() => {
    const source = loadCluster(sourceId);
    const target = loadCluster(targetId);
    assertNotRetired(source);
    assertNotRetired(target);
    // Optimistic lock: check the target (the one that gets a new centroid).
    assertExpectedUpdatedAt(target, meta.expectedUpdatedAt);

    // Move assignments source → target.
    db.prepare(
      `UPDATE video_cluster_assignments
          SET cluster_id = ?, assigned_at = ?
        WHERE cluster_id = ?`
    ).run(targetId, nowUTC(), sourceId);

    // Recompute target centroid over the union of members.
    const all = loadEmbeddingsForCluster(targetId);
    if (all.length === 0) {
      throw new IllegalEditError(
        `merge produced an empty union — both clusters were empty`
      );
    }
    const newCentroid = meanCentroid(all.map((m) => m.vec));
    const buf = centroidToBlob(newCentroid);
    db.prepare(
      `UPDATE taste_clusters
          SET centroid = ?, dim = ?, updated_at = ?
        WHERE id = ?`
    ).run(buf, newCentroid.length, nowUTC(), targetId);

    // Recompute similarity + is_fuzzy for every member of the new target.
    const floor = fuzzyFloor();
    const updateAssign = db.prepare(
      `UPDATE video_cluster_assignments
          SET similarity = ?, is_fuzzy = ?
        WHERE video_id = ?`
    );
    for (const m of all) {
      const sim = cosineSim(m.vec, newCentroid);
      updateAssign.run(sim, sim < floor ? 1 : 0, m.videoId);
    }

    // Soft-retire the source.
    db.prepare(
      `UPDATE taste_clusters
          SET retired_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(nowUTC(), nowUTC(), sourceId);
  })();
}

export function splitCluster(
  id: number,
  k: number,
  meta: EditMeta
): { childIds: number[] } {
  if (!Number.isInteger(k) || k < 2) {
    throw new IllegalEditError(`split k must be an integer >= 2 (got ${k})`);
  }
  const db = getDb();
  let childIds: number[] = [];
  db.transaction(() => {
    const row = loadCluster(id);
    assertNotRetired(row);
    assertExpectedUpdatedAt(row, meta.expectedUpdatedAt);

    const members = loadEmbeddingsForCluster(id);
    if (k > members.length) {
      throw new IllegalEditError(
        `split k=${k} exceeds member count ${members.length}`
      );
    }

    const points = members.map((m) => m.vec);
    const { labels, centroids } = runKmeans(points, k, { seed: 1337 + id });

    // First child reuses A's id (and inherits its label + weight).
    const firstCentroid = centroids[0];
    const firstBuf = centroidToBlob(firstCentroid);
    db.prepare(
      `UPDATE taste_clusters
          SET centroid = ?, dim = ?, updated_at = ?
        WHERE id = ?`
    ).run(firstBuf, firstCentroid.length, nowUTC(), id);
    const ids: number[] = [id];

    // Insert k-1 fresh children with NULL label and 1.0 weight.
    const insertStmt = db.prepare(
      `INSERT INTO taste_clusters
         (label, weight, centroid, dim, created_at, updated_at)
       VALUES (NULL, 1.0, ?, ?, ?, ?)`
    );
    for (let c = 1; c < k; c++) {
      const buf = centroidToBlob(centroids[c]);
      const info = insertStmt.run(buf, centroids[c].length, nowUTC(), nowUTC());
      ids.push(Number(info.lastInsertRowid));
    }

    // Reassign every member to its new (child) cluster.
    const floor = fuzzyFloor();
    const updateAssign = db.prepare(
      `UPDATE video_cluster_assignments
          SET cluster_id = ?, similarity = ?, is_fuzzy = ?, assigned_at = ?
        WHERE video_id = ?`
    );
    const now = nowUTC();
    for (let i = 0; i < members.length; i++) {
      const childIdx = labels[i];
      const sim = cosineSim(members[i].vec, centroids[childIdx]);
      updateAssign.run(
        ids[childIdx],
        sim,
        sim < floor ? 1 : 0,
        now,
        members[i].videoId
      );
    }
    childIds = ids;
  })();
  return { childIds };
}

export function retireCluster(id: number, meta: EditMeta): void {
  const db = getDb();
  db.transaction(() => {
    const row = loadCluster(id);
    if (row.retired_at !== null) {
      throw new IllegalEditError(`cluster ${id} is already retired`);
    }
    assertExpectedUpdatedAt(row, meta.expectedUpdatedAt);
    const now = nowUTC();
    db.prepare(
      `UPDATE taste_clusters
          SET retired_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(now, now, id);
  })();
}

// --- Split preview --------------------------------------------------------

export interface SplitPreviewEntry {
  k: number;
  sizes: number[];
  silhouette: number;
}

export function previewSplit(id: number, ks: number[]): SplitPreviewEntry[] {
  const row = loadCluster(id);
  if (row.retired_at !== null) {
    throw new IllegalEditError(`cluster ${id} is retired`);
  }
  const members = loadEmbeddingsForCluster(id);
  const points = members.map((m) => m.vec);
  const out: SplitPreviewEntry[] = [];
  for (const k of ks) {
    if (!Number.isInteger(k) || k < 2 || k > members.length) continue;
    const { labels } = runKmeans(points, k, { seed: 1337 + id });
    const sizes = new Array(k).fill(0);
    for (const l of labels) sizes[l]++;
    const sil = silhouetteScore(points, labels, k);
    out.push({ k, sizes, silhouette: sil });
  }
  return out;
}
