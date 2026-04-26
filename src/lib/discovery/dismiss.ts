import { getDb } from '../db';
import { nowUTC } from '../time';
import { CandidateNotFoundError } from './errors';

interface CandidateRow {
  id: number;
  kind: 'video' | 'channel';
  target_id: string;
}

export function dismissCandidate(candidateId: number): void {
  const db = getDb();
  const now = nowUTC();

  const run = db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT id, kind, target_id FROM discovery_candidates WHERE id = ?`,
      )
      .get(candidateId) as CandidateRow | undefined;
    if (!candidate) throw new CandidateNotFoundError(candidateId);

    db.prepare(
      `INSERT OR IGNORE INTO discovery_rejections
         (target_id, kind, dismissed_at)
       VALUES (?, ?, ?)`,
    ).run(candidate.target_id, candidate.kind, now);

    db.prepare(
      `UPDATE discovery_candidates
          SET status = 'dismissed', status_changed_at = ?
        WHERE id = ?`,
    ).run(now, candidateId);

    db.prepare(`DELETE FROM discovery_candidates WHERE id = ?`).run(
      candidateId,
    );
  });
  run();
}
