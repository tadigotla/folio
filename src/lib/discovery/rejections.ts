import { getDb } from '../db';
import { RejectionNotFoundError } from './errors';

export function clearRejection(targetId: string): void {
  const db = getDb();
  const info = db
    .prepare(`DELETE FROM discovery_rejections WHERE target_id = ?`)
    .run(targetId);
  if (info.changes === 0) throw new RejectionNotFoundError(targetId);
}

export function clearAllRejections(): { deleted: number } {
  const db = getDb();
  const info = db.prepare(`DELETE FROM discovery_rejections`).run();
  return { deleted: info.changes };
}
