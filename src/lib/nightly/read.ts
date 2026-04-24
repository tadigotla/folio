import { getDb } from '../db';
import type { NightlyCounts } from './run';

const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;

interface Row {
  run_at: string;
  status: string;
  counts: string | null;
  notes: string | null;
}

export interface LatestDigest {
  notes: string;
  counts: NightlyCounts;
  runAt: string;
}

export function getLatestDigest(now: Date = new Date()): LatestDigest | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT run_at, status, counts, notes
         FROM nightly_runs
        ORDER BY run_at DESC
        LIMIT 1`,
    )
    .get() as Row | undefined;
  if (!row) return null;
  if (row.status !== 'ok') return null;
  if (!row.notes) return null;

  const runAtMs = Date.parse(row.run_at);
  if (!Number.isFinite(runAtMs)) return null;
  if (now.getTime() - runAtMs > THIRTY_SIX_HOURS_MS) return null;

  let counts: NightlyCounts;
  try {
    counts = JSON.parse(row.counts ?? '{}') as NightlyCounts;
  } catch {
    return null;
  }

  return {
    notes: row.notes,
    counts,
    runAt: row.run_at,
  };
}
