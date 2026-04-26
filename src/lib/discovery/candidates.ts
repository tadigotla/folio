import { getDb } from '../db';
import { nowUTC } from '../time';
import type {
  CandidateKind,
  CandidateSourceKind,
} from './description-graph';
import type { ScoreBreakdown } from './score';

export type CandidateBreakdown =
  | ScoreBreakdown
  | { source: 'active_search' }
  | Record<string, unknown>;

export interface ProposeInput {
  kind: CandidateKind;
  targetId: string;
  sourceVideoId: string | null;
  sourceKind: CandidateSourceKind;
  score: number;
  breakdown: CandidateBreakdown;
  title?: string | null;
  channelName?: string | null;
}

export function isAlreadyKnown(
  targetId: string,
  kind: CandidateKind,
): boolean {
  const db = getDb();
  if (kind === 'video') {
    const v = db
      .prepare(`SELECT 1 FROM videos WHERE id = ?`)
      .get(targetId);
    if (v) return true;
  } else {
    // kind === 'channel' — targetId may be `UC...` or `@handle`. We only know
    // channels by id in the schema, so a handle is always "unknown here" at
    // the channels table level; callers should still skip handles that
    // resolve to a known channel, but without a resolver we compare ids.
    const c = db
      .prepare(`SELECT 1 FROM channels WHERE id = ?`)
      .get(targetId);
    if (c) return true;
  }
  const rej = db
    .prepare(`SELECT 1 FROM discovery_rejections WHERE target_id = ?`)
    .get(targetId);
  if (rej) return true;
  const prop = db
    .prepare(
      `SELECT 1 FROM discovery_candidates
        WHERE target_id = ? AND status = 'proposed'`,
    )
    .get(targetId);
  if (prop) return true;
  return false;
}

export function proposeCandidate(input: ProposeInput): {
  inserted: boolean;
  id: number | null;
} {
  const db = getDb();
  const now = nowUTC();
  const run = db.transaction(() => {
    // Active-search candidates carry sourceVideoId = NULL. Their dedup is
    // handled by `isAlreadyKnown` upstream (which checks both rejections and
    // any in-flight `proposed` row for the same target). Skip the in-table
    // dedup query entirely for that case so SQL NULL semantics don't bite.
    if (input.sourceVideoId !== null) {
      const existing = db
        .prepare(
          `SELECT id FROM discovery_candidates
            WHERE target_id = ?
              AND source_video_id = ?
              AND source_kind = ?`,
        )
        .get(input.targetId, input.sourceVideoId, input.sourceKind) as
        | { id: number }
        | undefined;
      if (existing) return { inserted: false, id: existing.id };
    }

    const info = db
      .prepare(
        `INSERT INTO discovery_candidates
           (kind, target_id, source_video_id, source_kind,
            title, channel_name, score, score_breakdown,
            proposed_at, status, status_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`,
      )
      .run(
        input.kind,
        input.targetId,
        input.sourceVideoId,
        input.sourceKind,
        input.title ?? null,
        input.channelName ?? null,
        input.score,
        JSON.stringify(input.breakdown),
        now,
        now,
      );
    return { inserted: true, id: Number(info.lastInsertRowid) };
  });
  return run();
}
