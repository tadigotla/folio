import { getDb } from './db';
import { nowUTC } from './time';
import { listSubscriptions } from './youtube-api';

export interface SyncResult {
  imported: number;
  reenabled: number;
  disabled: number;
}

const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const META_SOURCE_ID = 'youtube_subscriptions_meta';

function userSourceId(channelId: string): string {
  return `youtube_channel_${channelId}_user`;
}

interface ExistingRow {
  id: string;
  enabled: number;
}

export async function syncSubscriptions(): Promise<SyncResult> {
  const channels = await listSubscriptions();
  const db = getDb();
  const timestamp = nowUTC();

  const upsertSource = db.prepare(`
    INSERT INTO sources (id, name, kind, config, enabled, min_interval_minutes)
    VALUES (@id, @name, 'youtube_channel', @config, 1, 30)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      config = excluded.config,
      enabled = 1
  `);

  const selectExisting = db.prepare(`
    SELECT id, enabled FROM sources WHERE id LIKE 'youtube_channel_%_user'
  `);

  const disableRow = db.prepare(`UPDATE sources SET enabled = 0 WHERE id = ?`);

  let imported = 0;
  let reenabled = 0;
  let disabled = 0;

  const run = db.transaction(() => {
    const existing = selectExisting.all() as ExistingRow[];
    const existingById = new Map(existing.map((r) => [r.id, r]));

    const subscribedIds = new Set<string>();

    for (const channel of channels) {
      const id = userSourceId(channel.channelId);
      subscribedIds.add(id);
      const prior = existingById.get(id);
      const config = JSON.stringify({
        channels: [{ id: channel.channelId, name: channel.title }],
        rss_base: RSS_BASE,
      });
      upsertSource.run({ id, name: channel.title, config });
      if (!prior) imported += 1;
      else if (prior.enabled === 0) reenabled += 1;
    }

    for (const row of existing) {
      if (subscribedIds.has(row.id)) continue;
      if (row.enabled === 1) {
        disableRow.run(row.id);
        disabled += 1;
      }
    }
  });

  try {
    run();
  } catch (err) {
    recordSyncError(err instanceof Error ? err.message : String(err));
    throw err;
  }

  recordSyncSuccess(timestamp);
  return { imported, reenabled, disabled };
}

export function recordSyncSuccess(timestamp: string = nowUTC()): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sources (id, name, kind, config, enabled, min_interval_minutes, last_fetched_at, last_error)
    VALUES (@id, 'YouTube Subscription Sync', 'youtube_channel', '{}', 0, 30, @ts, NULL)
    ON CONFLICT(id) DO UPDATE SET
      last_fetched_at = excluded.last_fetched_at,
      last_error = NULL
  `).run({ id: META_SOURCE_ID, ts: timestamp });
}

export function recordSyncError(message: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sources (id, name, kind, config, enabled, min_interval_minutes, last_error)
    VALUES (@id, 'YouTube Subscription Sync', 'youtube_channel', '{}', 0, 30, @err)
    ON CONFLICT(id) DO UPDATE SET
      last_error = excluded.last_error
  `).run({ id: META_SOURCE_ID, err: message });
}

export interface SyncMeta {
  last_fetched_at: string | null;
  last_error: string | null;
}

export function getSyncMeta(): SyncMeta | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT last_fetched_at, last_error FROM sources WHERE id = ?`)
    .get(META_SOURCE_ID) as SyncMeta | undefined;
  return row ?? null;
}

export interface UserSourceCounts {
  enabled: number;
  disabled: number;
}

export function getUserSourceCounts(): UserSourceCounts {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE enabled = 1) AS enabled,
      COUNT(*) FILTER (WHERE enabled = 0) AS disabled
    FROM sources
    WHERE id LIKE 'youtube_channel_%_user'
  `).get() as UserSourceCounts | undefined;
  return row ?? { enabled: 0, disabled: 0 };
}
