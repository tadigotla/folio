import { getDb } from '../db';
import { nowUTC } from '../time';
import type { NightlyResult } from './run';

export function writeDigest(result: NightlyResult): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO nightly_runs
         (run_at, status, counts, notes, last_error)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      nowUTC(),
      result.status,
      JSON.stringify(result.counts),
      result.notes,
      result.lastError,
    );
  return Number(info.lastInsertRowid);
}
