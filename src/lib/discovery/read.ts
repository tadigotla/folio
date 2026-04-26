import { getDb } from '../db';

export interface CandidateRow {
  id: number;
  kind: 'video' | 'channel';
  target_id: string;
  source_video_id: string | null;
  source_video_title: string | null;
  source_kind: 'description_link' | 'description_handle' | 'transcript_link';
  title: string | null;
  channel_name: string | null;
  score: number;
  proposed_at: string;
}

export interface RejectionRow {
  target_id: string;
  kind: string;
  dismissed_at: string;
}

export function listProposedCandidates(
  options: { limit?: number } = {},
): CandidateRow[] {
  const requested = options.limit ?? 20;
  const limit = Math.max(1, Math.min(50, Math.floor(requested)));

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT dc.id, dc.kind, dc.target_id, dc.source_video_id,
              v.title AS source_video_title,
              dc.source_kind, dc.title, dc.channel_name,
              dc.score, dc.proposed_at
         FROM discovery_candidates dc
    LEFT JOIN videos v ON v.id = dc.source_video_id
        WHERE dc.status = 'proposed'
        ORDER BY dc.score DESC, dc.proposed_at DESC
        LIMIT ?`,
    )
    .all(limit) as CandidateRow[];

  return rows;
}

export function listRejections(): RejectionRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT target_id, kind, dismissed_at
         FROM discovery_rejections
        ORDER BY dismissed_at DESC`,
    )
    .all() as RejectionRow[];
}
