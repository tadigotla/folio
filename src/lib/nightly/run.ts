import { runMigrations, getDb } from '../db';
import {
  importLikes,
  importSubscriptions,
} from '../youtube-import';
import { getStoredToken } from '../youtube-oauth';
import {
  fetchTranscript,
  hasTranscript,
  sleep,
  storeTranscript,
} from '../transcripts';
import {
  enrichOne,
  getOllamaConfig,
  listVideosMissingEnrichment,
  storeEnrichment,
} from '../enrichment';
import {
  buildEmbedInputText,
  embed,
  getActiveEmbeddingConfig,
  listVideosMissingEmbedding,
  openaiBatchSize,
  localBatchSize,
  storeEmbedding,
  bufferToFloats,
} from '../embeddings';
import {
  centroidToBlob,
  cosineSim,
  meanCentroid,
  normalize,
  rebuildClusters,
} from '../taste';
import { runDescriptionGraph } from '../discovery/scan';
import { nowUTC } from '../time';

export interface NightlyCounts {
  imported: number;
  enriched: number;
  embedded: number;
  reclustered: 'incremental' | 'full';
  candidates_proposed: number;
  steps: Record<string, { ok: boolean; error?: string }>;
}

export interface NightlyResult {
  status: 'ok' | 'failed' | 'skipped';
  counts: NightlyCounts;
  notes: string;
  lastError: string | null;
}

const SUBSCRIPTION_LIMIT_DEFAULT = 25;
const RECLUSTER_DRIFT_DEFAULT = 0.20;

function getReclusterDriftThreshold(): number {
  const raw = process.env.RECLUSTER_REBUILD_DRIFT;
  if (!raw) return RECLUSTER_DRIFT_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? n : RECLUSTER_DRIFT_DEFAULT;
}

function getSubscriptionLimit(): number {
  const raw = process.env.YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT;
  if (!raw) return SUBSCRIPTION_LIMIT_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : SUBSCRIPTION_LIMIT_DEFAULT;
}

function newCounts(): NightlyCounts {
  return {
    imported: 0,
    enriched: 0,
    embedded: 0,
    reclustered: 'incremental',
    candidates_proposed: 0,
    steps: {},
  };
}

function recordStep(
  counts: NightlyCounts,
  name: string,
  err: unknown,
): string {
  const message = err instanceof Error ? err.message : String(err);
  counts.steps[name] = { ok: false, error: message };
  return message;
}

async function stepImport(
  counts: NightlyCounts,
): Promise<void> {
  const likes = await importLikes();
  counts.imported += likes.videos_new;
  const subs = await importSubscriptions(getSubscriptionLimit());
  counts.imported += subs.videos_new;
  counts.steps.import = { ok: true };
}

async function stepTranscripts(counts: NightlyCounts): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.id FROM videos v
         LEFT JOIN video_transcripts t ON t.video_id = v.id
        WHERE t.video_id IS NULL
        ORDER BY v.first_seen_at DESC`,
    )
    .all() as { id: string }[];
  let fetched = 0;
  for (const { id } of rows) {
    if (hasTranscript(id)) continue;
    const t = await fetchTranscript(id);
    if (t) {
      storeTranscript(id, t);
      fetched += 1;
    }
    await sleep(250 + Math.floor(Math.random() * 250));
  }
  void fetched;
  counts.steps.transcripts = { ok: true };
}

async function stepEnrich(counts: NightlyCounts): Promise<void> {
  const { model } = getOllamaConfig();
  const pending = listVideosMissingEnrichment();
  let ok = 0;
  for (const row of pending) {
    const result = await enrichOne({
      videoId: row.id,
      title: row.title,
      channel: row.channel,
      description: row.description,
      transcript: row.transcript,
    });
    if (result) {
      storeEnrichment(row.id, model, result);
      ok += 1;
    }
  }
  counts.enriched = ok;
  counts.steps.enrich = { ok: true };
}

async function stepEmbed(counts: NightlyCounts): Promise<string[]> {
  const cfg = getActiveEmbeddingConfig();
  const pending = listVideosMissingEmbedding(cfg);
  if (pending.length === 0) {
    counts.steps.embed = { ok: true };
    return [];
  }
  const batchSize = cfg.provider === 'openai' ? openaiBatchSize() : localBatchSize();
  const newlyEmbeddedIds: string[] = [];
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const inputs = batch.map(buildEmbedInputText);
    const vecs = await embed(inputs, cfg);
    for (let j = 0; j < batch.length; j++) {
      storeEmbedding(batch[j].id, cfg.provider, cfg.model, vecs[j]);
      newlyEmbeddedIds.push(batch[j].id);
    }
  }
  counts.embedded = newlyEmbeddedIds.length;
  counts.steps.embed = { ok: true };
  return newlyEmbeddedIds;
}

interface ActiveCluster {
  id: number;
  centroid: Float32Array;
  dim: number;
}

function loadActiveClusters(): ActiveCluster[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, centroid, dim FROM taste_clusters WHERE retired_at IS NULL`,
    )
    .all() as { id: number; centroid: Buffer; dim: number }[];
  return rows.map((r) => ({
    id: r.id,
    centroid: normalize(bufferToFloats(r.centroid)),
    dim: r.dim,
  }));
}

function loadClusterMembers(clusterId: number): Float32Array[] {
  const db = getDb();
  const cfg = getActiveEmbeddingConfig();
  const rows = db
    .prepare(
      `SELECT e.vec FROM video_cluster_assignments a
         JOIN video_embeddings e ON e.video_id = a.video_id
        WHERE a.cluster_id = ?
          AND e.provider = ?
          AND e.model = ?`,
    )
    .all(clusterId, cfg.provider, cfg.model) as { vec: Buffer }[];
  return rows.map((r) => normalize(bufferToFloats(r.vec)));
}

async function stepRecluster(
  counts: NightlyCounts,
  newlyEmbeddedIds: string[],
): Promise<void> {
  const db = getDb();
  const cfg = getActiveEmbeddingConfig();
  const threshold = getReclusterDriftThreshold();

  // No new embeddings → nothing to incrementally assign. Incremental no-op.
  if (newlyEmbeddedIds.length === 0) {
    counts.reclustered = 'incremental';
    counts.steps.recluster = { ok: true };
    return;
  }

  const active = loadActiveClusters();
  if (active.length === 0) {
    // No active clusters at all but there are embeddings → bootstrap via full
    // rebuild. If the like-set is too small, rebuildClusters() throws and the
    // outer try/catch records the step failure.
    await rebuildClusters();
    counts.reclustered = 'full';
    counts.steps.recluster = { ok: true };
    return;
  }

  // Fetch the new embeddings; assign each to its nearest active cluster.
  const placeholders = newlyEmbeddedIds.map(() => '?').join(',');
  const newRows = db
    .prepare(
      `SELECT video_id, vec FROM video_embeddings
        WHERE provider = ? AND model = ? AND video_id IN (${placeholders})`,
    )
    .all(cfg.provider, cfg.model, ...newlyEmbeddedIds) as {
    video_id: string;
    vec: Buffer;
  }[];

  const oldCentroids = new Map<number, Float32Array>();
  for (const c of active) oldCentroids.set(c.id, c.centroid);

  const affected = new Set<number>();
  const assignNow = nowUTC();
  const assignTx = db.transaction(() => {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO video_cluster_assignments
         (video_id, cluster_id, similarity, is_fuzzy, assigned_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const fuzzyFloor = 0.45;
    for (const r of newRows) {
      const v = normalize(bufferToFloats(r.vec));
      let bestSim = -Infinity;
      let bestId = active[0].id;
      for (const c of active) {
        if (c.centroid.length !== v.length) continue;
        const s = cosineSim(v, c.centroid);
        if (s > bestSim) {
          bestSim = s;
          bestId = c.id;
        }
      }
      const isFuzzy = bestSim < fuzzyFloor ? 1 : 0;
      stmt.run(r.video_id, bestId, bestSim, isFuzzy, assignNow);
      affected.add(bestId);
    }
  });
  assignTx();

  // Recompute centroids for affected clusters; measure drift.
  let maxDrift = 0;
  const newCentroids = new Map<number, Float32Array>();
  for (const cid of affected) {
    const members = loadClusterMembers(cid);
    if (members.length === 0) continue;
    const next = meanCentroid(members);
    newCentroids.set(cid, next);
    const prev = oldCentroids.get(cid);
    if (!prev || prev.length !== next.length) continue;
    const sim = cosineSim(prev, next);
    const drift = Math.max(0, 1 - sim);
    if (drift > maxDrift) maxDrift = drift;
  }

  if (maxDrift > threshold) {
    await rebuildClusters();
    counts.reclustered = 'full';
    counts.steps.recluster = { ok: true };
    return;
  }

  // Persist the updated centroids for the affected clusters.
  const now = nowUTC();
  const persistTx = db.transaction(() => {
    const upd = db.prepare(
      `UPDATE taste_clusters SET centroid = ?, updated_at = ? WHERE id = ?`,
    );
    for (const [cid, vec] of newCentroids) {
      upd.run(centroidToBlob(vec), now, cid);
    }
  });
  persistTx();

  counts.reclustered = 'incremental';
  counts.steps.recluster = { ok: true };
}

function stepDescriptionGraph(counts: NightlyCounts): void {
  const { proposed } = runDescriptionGraph();
  counts.candidates_proposed = proposed;
  counts.steps.descriptionGraph = { ok: true };
}

export async function runNightly(): Promise<NightlyResult> {
  const counts = newCounts();
  let lastError: string | null = null;
  let anyFailed = false;

  // Step 1 — migrations (fatal if this fails).
  try {
    runMigrations();
    counts.steps.migrations = { ok: true };
  } catch (err) {
    const msg = recordStep(counts, 'migrations', err);
    return {
      status: 'failed',
      counts,
      notes: `migrations failed: ${msg}`.slice(0, 140),
      lastError: msg,
    };
  }

  // Step 2 — OAuth import. No token → skip the whole run (after migrations).
  if (!getStoredToken()) {
    counts.steps.import = { ok: false, error: 'no token' };
    return {
      status: 'skipped',
      counts,
      notes: 'no youtube token; reconnect on /settings/youtube',
      lastError: null,
    };
  }
  try {
    await stepImport(counts);
  } catch (err) {
    const msg = recordStep(counts, 'import', err);
    anyFailed = true;
    if (!lastError) lastError = msg;
  }

  try {
    await stepTranscripts(counts);
  } catch (err) {
    const msg = recordStep(counts, 'transcripts', err);
    anyFailed = true;
    if (!lastError) lastError = msg;
  }

  try {
    await stepEnrich(counts);
  } catch (err) {
    const msg = recordStep(counts, 'enrich', err);
    anyFailed = true;
    if (!lastError) lastError = msg;
  }

  let newlyEmbeddedIds: string[] = [];
  try {
    newlyEmbeddedIds = await stepEmbed(counts);
  } catch (err) {
    const msg = recordStep(counts, 'embed', err);
    anyFailed = true;
    if (!lastError) lastError = msg;
  }

  try {
    await stepRecluster(counts, newlyEmbeddedIds);
  } catch (err) {
    const msg = recordStep(counts, 'recluster', err);
    anyFailed = true;
    if (!lastError) lastError = msg;
  }

  try {
    stepDescriptionGraph(counts);
  } catch (err) {
    const msg = recordStep(counts, 'descriptionGraph', err);
    anyFailed = true;
    if (!lastError) lastError = msg;
  }

  return {
    status: anyFailed ? 'failed' : 'ok',
    counts,
    notes: buildNotes(counts, anyFailed),
    lastError,
  };
}

function firstFailedStep(counts: NightlyCounts): string | null {
  for (const [name, meta] of Object.entries(counts.steps)) {
    if (!meta.ok) return name;
  }
  return null;
}

export function buildNotes(
  counts: NightlyCounts,
  anyFailed: boolean,
): string {
  const parts: string[] = [
    `+${counts.imported} imported`,
    `+${counts.enriched} enriched`,
    `+${counts.embedded} embedded`,
    `recluster: ${counts.reclustered}`,
    `+${counts.candidates_proposed} candidates`,
  ];
  let sentence = parts.join(', ') + '.';
  if (anyFailed) {
    const stepName = firstFailedStep(counts);
    if (stepName) sentence = `${sentence} step: ${stepName}.`;
  }
  if (sentence.length > 140) sentence = sentence.slice(0, 137) + '...';
  return sentence;
}
