import { getDb } from './db';

// --- Types ----------------------------------------------------------------

export interface ClusterPreviewVideo {
  videoId: string;
  title: string;
  channelName: string | null;
  thumbnailUrl: string | null;
  similarity: number;
  isFuzzy: boolean;
}

export interface ClusterSummary {
  id: number;
  label: string | null;
  weight: number;
  memberCount: number;
  fuzzyCount: number;
  preview: ClusterPreviewVideo[];
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
}

export interface ClusterListing {
  active: ClusterSummary[];
  empty: ClusterSummary[];
  retired: ClusterSummary[];
}

export type ClusterDetail = ClusterSummary;

export interface ClusterMember {
  videoId: string;
  title: string;
  channelName: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  similarity: number;
  isFuzzy: boolean;
  consumptionStatus: string | null;
}

export interface ClusterDriftReport {
  totalLikes: number;
  driftCount: number;
  threshold: number;
  visible: boolean;
}

// Drift threshold: per spec, 0.6 cosine. Likes below this fit the map poorly.
const DRIFT_SIMILARITY_FLOOR = 0.6;
// Hide the drift indicator below 30 likes — small N is dominated by noise.
const DRIFT_MIN_LIKES = 30;
const PREVIEW_LIMIT = 8;

// --- Internal helpers -----------------------------------------------------

interface ClusterRow {
  id: number;
  label: string | null;
  weight: number;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
  member_count: number;
  fuzzy_count: number;
}

function loadClusterRows(opts: { active: boolean }): ClusterRow[] {
  const db = getDb();
  const where = opts.active ? 'c.retired_at IS NULL' : 'c.retired_at IS NOT NULL';
  return db
    .prepare(
      `SELECT c.id, c.label, c.weight, c.created_at, c.updated_at, c.retired_at,
              COALESCE(a.member_count, 0) AS member_count,
              COALESCE(a.fuzzy_count, 0) AS fuzzy_count
         FROM taste_clusters c
         LEFT JOIN (
           SELECT cluster_id,
                  COUNT(*) AS member_count,
                  SUM(is_fuzzy) AS fuzzy_count
             FROM video_cluster_assignments
            GROUP BY cluster_id
         ) a ON a.cluster_id = c.id
        WHERE ${where}
        ORDER BY ${opts.active ? 'member_count DESC, c.id ASC' : 'c.retired_at DESC'}`
    )
    .all() as ClusterRow[];
}

interface PreviewRow {
  cluster_id: number;
  video_id: string;
  title: string;
  channel_name: string | null;
  thumbnail_url: string | null;
  similarity: number;
  is_fuzzy: number;
  rn: number;
}

function loadPreviews(clusterIds: number[]): Map<number, ClusterPreviewVideo[]> {
  const out = new Map<number, ClusterPreviewVideo[]>();
  if (clusterIds.length === 0) return out;
  const db = getDb();
  const placeholders = clusterIds.map(() => '?').join(',');
  // ROW_NUMBER over (cluster ordered by similarity desc) keeps it to one
  // query rather than N round-trips.
  const rows = db
    .prepare(
      `SELECT cluster_id, video_id, title, channel_name, thumbnail_url,
              similarity, is_fuzzy, rn
         FROM (
           SELECT a.cluster_id, a.video_id, v.title, c.name AS channel_name,
                  v.thumbnail_url, a.similarity, a.is_fuzzy,
                  ROW_NUMBER() OVER (
                    PARTITION BY a.cluster_id
                    ORDER BY a.similarity DESC
                  ) AS rn
             FROM video_cluster_assignments a
             JOIN videos v ON v.id = a.video_id
             LEFT JOIN channels c ON c.id = v.channel_id
            WHERE a.cluster_id IN (${placeholders})
         )
        WHERE rn <= ?`
    )
    .all(...clusterIds, PREVIEW_LIMIT) as PreviewRow[];
  for (const r of rows) {
    let bucket = out.get(r.cluster_id);
    if (!bucket) {
      bucket = [];
      out.set(r.cluster_id, bucket);
    }
    bucket.push({
      videoId: r.video_id,
      title: r.title,
      channelName: r.channel_name,
      thumbnailUrl: r.thumbnail_url,
      similarity: r.similarity,
      isFuzzy: r.is_fuzzy === 1,
    });
  }
  return out;
}

function rowToSummary(r: ClusterRow, preview: ClusterPreviewVideo[]): ClusterSummary {
  return {
    id: r.id,
    label: r.label,
    weight: r.weight,
    memberCount: r.member_count,
    fuzzyCount: r.fuzzy_count,
    preview,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    retiredAt: r.retired_at,
  };
}

// --- Public API -----------------------------------------------------------

/**
 * Returns all clusters split into three buckets:
 *   - active: retired_at IS NULL AND has at least one assignment
 *   - empty: retired_at IS NULL AND has zero assignments (hidden by default)
 *   - retired: retired_at IS NOT NULL
 *
 * Active clusters are sorted by member count desc; retired by retire-time desc.
 */
export function getClusterSummaries(): ClusterListing {
  const activeRows = loadClusterRows({ active: true });
  const retiredRows = loadClusterRows({ active: false });

  const populated = activeRows.filter((r) => r.member_count > 0);
  const empty = activeRows.filter((r) => r.member_count === 0);

  const previewIds = populated.map((r) => r.id);
  const previewById = loadPreviews(previewIds);

  return {
    active: populated.map((r) => rowToSummary(r, previewById.get(r.id) ?? [])),
    empty: empty.map((r) => rowToSummary(r, [])),
    retired: retiredRows.map((r) => rowToSummary(r, [])),
  };
}

export function getClusterDetail(id: number): ClusterDetail | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT c.id, c.label, c.weight, c.created_at, c.updated_at, c.retired_at,
              COALESCE(a.member_count, 0) AS member_count,
              COALESCE(a.fuzzy_count, 0) AS fuzzy_count
         FROM taste_clusters c
         LEFT JOIN (
           SELECT cluster_id,
                  COUNT(*) AS member_count,
                  SUM(is_fuzzy) AS fuzzy_count
             FROM video_cluster_assignments
            WHERE cluster_id = ?
            GROUP BY cluster_id
         ) a ON a.cluster_id = c.id
        WHERE c.id = ?`
    )
    .get(id, id) as ClusterRow | undefined;
  if (!row) return null;
  const preview = loadPreviews([id]).get(id) ?? [];
  return rowToSummary(row, preview);
}

interface MemberRow {
  video_id: string;
  title: string;
  channel_name: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  similarity: number;
  is_fuzzy: number;
  consumption_status: string | null;
}

export function getClusterMembers(
  id: number,
  opts: { limit?: number; offset?: number } = {}
): ClusterMember[] {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.video_id, v.title, c.name AS channel_name, v.thumbnail_url,
              v.published_at, v.duration_seconds,
              a.similarity, a.is_fuzzy,
              cons.status AS consumption_status
         FROM video_cluster_assignments a
         JOIN videos v ON v.id = a.video_id
         LEFT JOIN channels c ON c.id = v.channel_id
         LEFT JOIN consumption cons ON cons.video_id = a.video_id
        WHERE a.cluster_id = ?
        ORDER BY a.similarity DESC, v.published_at DESC NULLS LAST
        LIMIT ? OFFSET ?`
    )
    .all(id, limit, offset) as MemberRow[];
  return rows.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    channelName: r.channel_name,
    thumbnailUrl: r.thumbnail_url,
    publishedAt: r.published_at,
    durationSeconds: r.duration_seconds,
    similarity: r.similarity,
    isFuzzy: r.is_fuzzy === 1,
    consumptionStatus: r.consumption_status,
  }));
}

/**
 * Drift = liked videos (consumption.status IN saved/in_progress/archived)
 * whose current cluster-assignment similarity falls below DRIFT_SIMILARITY_FLOOR.
 * Hidden under DRIFT_MIN_LIKES — at small N a single misfit dominates the count.
 */
export function getClusterDrift(): ClusterDriftReport {
  const db = getDb();
  const totals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('saved','in_progress','archived') THEN 1 ELSE 0 END) AS likes
         FROM consumption`
    )
    .get() as { likes: number | null };
  const totalLikes = totals.likes ?? 0;

  const drift = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM consumption cons
         JOIN video_cluster_assignments a ON a.video_id = cons.video_id
        WHERE cons.status IN ('saved','in_progress','archived')
          AND a.similarity < ?`
    )
    .get(DRIFT_SIMILARITY_FLOOR) as { n: number };

  return {
    totalLikes,
    driftCount: drift.n,
    threshold: DRIFT_SIMILARITY_FLOOR,
    visible: totalLikes >= DRIFT_MIN_LIKES,
  };
}
