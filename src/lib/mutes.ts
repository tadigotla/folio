import { getDb } from './db';
import { nowUTC, todayLocal } from './time';

export class ClusterNotFoundError extends Error {
  constructor(clusterId: number) {
    super(`cluster ${clusterId} not found or retired`);
    this.name = 'ClusterNotFoundError';
  }
}

interface ClusterExistsRow {
  id: number;
  retired_at: string | null;
}

/**
 * Toggle the "muted today" state for a cluster. Idempotent: a second call
 * within the same America/New_York local day un-mutes the cluster. Does NOT
 * advance `taste_clusters.updated_at` — mutes are orthogonal to the cluster
 * optimistic-lock contract.
 */
export function setMuteToday(clusterId: number): { muted: boolean } {
  const db = getDb();
  return db.transaction((): { muted: boolean } => {
    const row = db
      .prepare(`SELECT id, retired_at FROM taste_clusters WHERE id = ?`)
      .get(clusterId) as ClusterExistsRow | undefined;
    if (!row || row.retired_at !== null) {
      throw new ClusterNotFoundError(clusterId);
    }
    const today = todayLocal();
    const existing = db
      .prepare(
        `SELECT 1 FROM taste_cluster_mutes
          WHERE cluster_id = ? AND muted_on = ?`,
      )
      .get(clusterId, today) as { 1: number } | undefined;
    if (existing) {
      db.prepare(
        `DELETE FROM taste_cluster_mutes
          WHERE cluster_id = ? AND muted_on = ?`,
      ).run(clusterId, today);
      return { muted: false };
    }
    db.prepare(
      `INSERT INTO taste_cluster_mutes (cluster_id, muted_on, created_at)
       VALUES (?, ?, ?)`,
    ).run(clusterId, today, nowUTC());
    return { muted: true };
  })();
}

export function isMutedToday(clusterId: number): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 FROM taste_cluster_mutes
        WHERE cluster_id = ? AND muted_on = ?`,
    )
    .get(clusterId, todayLocal()) as { 1: number } | undefined;
  return !!row;
}

export function getMutedClusterIdsToday(): Set<number> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT cluster_id FROM taste_cluster_mutes WHERE muted_on = ?`,
    )
    .all(todayLocal()) as { cluster_id: number }[];
  return new Set(rows.map((r) => r.cluster_id));
}
