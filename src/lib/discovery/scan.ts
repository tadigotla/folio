import { getDb } from '../db';
import { extractCandidates } from './description-graph';
import { scoreCandidate } from './score';
import { isAlreadyKnown, proposeCandidate } from './candidates';

const DEFAULT_FUZZY_FLOOR = 0.55;

function getFuzzyFloor(): number {
  const raw = process.env.DISCOVERY_FUZZY_FLOOR;
  if (!raw) return DEFAULT_FUZZY_FLOOR;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_FUZZY_FLOOR;
  return n;
}

interface SourceRow {
  id: string;
  description: string | null;
  transcript: string | null;
}

export interface ScanResult {
  proposed: number;
}

export function runDescriptionGraph(): ScanResult {
  const db = getDb();
  const floor = getFuzzyFloor();

  const rows = db
    .prepare(
      `SELECT v.id, v.description, t.text AS transcript
         FROM videos v
         JOIN consumption cons ON cons.video_id = v.id
         LEFT JOIN video_transcripts t ON t.video_id = v.id
        WHERE cons.status IN ('saved', 'in_progress')`,
    )
    .all() as SourceRow[];

  let proposed = 0;
  for (const row of rows) {
    const refs = extractCandidates({
      id: row.id,
      description: row.description,
      transcriptText: row.transcript,
    });
    if (refs.length === 0) continue;
    for (const ref of refs) {
      if (isAlreadyKnown(ref.targetId, ref.kind)) continue;
      const scored = scoreCandidate(row.id, ref);
      if (!scored) continue;
      if (scored.score < floor) continue;
      const out = proposeCandidate({
        kind: ref.kind,
        targetId: ref.targetId,
        sourceVideoId: row.id,
        sourceKind: ref.sourceKind,
        score: scored.score,
        breakdown: scored.breakdown,
      });
      if (out.inserted) proposed += 1;
    }
  }
  return { proposed };
}
