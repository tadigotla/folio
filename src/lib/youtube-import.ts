import { getDb } from './db';
import { nowUTC } from './time';
import type { ConsumptionStatus, ProvenanceKind } from './types';
import {
  getChannelUploadsPlaylistId,
  listLikedVideos,
  listPlaylistItems,
  listSubscriptions,
  listUserPlaylists,
  type NormalizedYouTubeVideo,
  type UserPlaylist,
} from './youtube-api';

export class PlaylistNotFoundError extends Error {
  constructor(playlistId: string) {
    super(`Playlist not found: ${playlistId}`);
    this.name = 'PlaylistNotFoundError';
  }
}

export interface ImportCounts {
  videos_new: number;
  videos_updated: number;
  channels_new: number;
}

const WEIGHT_BY_KIND: Record<ProvenanceKind, number> = {
  like: 1.0,
  playlist: 0.7,
  subscription_upload: 0.3,
};

function videoSourceUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function openImportLog(kind: ProvenanceKind, sourceRef: string | null): number {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO import_log (kind, source_ref, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(kind, sourceRef, nowUTC());
  return Number(res.lastInsertRowid);
}

function closeImportLog(
  id: number,
  status: 'ok' | 'error',
  counts: ImportCounts,
  error: string | null,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE import_log
        SET finished_at = ?, status = ?,
            videos_new = ?, videos_updated = ?, channels_new = ?,
            error = ?
      WHERE id = ?`,
  ).run(
    nowUTC(),
    status,
    counts.videos_new,
    counts.videos_updated,
    counts.channels_new,
    error,
    id,
  );
}

function appendImportLogError(id: number, message: string): void {
  const db = getDb();
  const row = db
    .prepare(`SELECT error FROM import_log WHERE id = ?`)
    .get(id) as { error: string | null } | undefined;
  const prior = row?.error;
  const next = prior ? `${prior}\n${message}` : message;
  db.prepare(`UPDATE import_log SET error = ? WHERE id = ?`).run(next, id);
}

interface UpsertChannelResult {
  inserted: boolean;
}

function upsertChannel(v: NormalizedYouTubeVideo): UpsertChannelResult {
  const db = getDb();
  const now = nowUTC();
  const existing = db
    .prepare(`SELECT id FROM channels WHERE id = ?`)
    .get(v.channelId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE channels SET name = ?, last_checked_at = ? WHERE id = ?`,
    ).run(v.channelName || '', now, v.channelId);
    return { inserted: false };
  }

  db.prepare(
    `INSERT INTO channels (id, name, handle, subscribed, first_seen_at, last_checked_at, section_id)
     VALUES (?, ?, NULL, 0, ?, ?, NULL)`,
  ).run(v.channelId, v.channelName || '', now, now);
  return { inserted: true };
}

interface UpsertVideoResult {
  inserted: boolean;
}

function upsertVideo(
  v: NormalizedYouTubeVideo,
  defaultStatus: ConsumptionStatus,
): UpsertVideoResult {
  const db = getDb();
  const now = nowUTC();

  const existing = db
    .prepare(`SELECT id FROM videos WHERE id = ?`)
    .get(v.videoId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE videos
          SET title = ?, description = ?, thumbnail_url = ?,
              updated_at = ?, last_checked_at = ?
        WHERE id = ?`,
    ).run(
      v.title,
      v.description || null,
      v.thumbnailUrl ?? null,
      now,
      now,
      v.videoId,
    );
    return { inserted: false };
  }

  db.prepare(
    `INSERT INTO videos (
       id, title, description, channel_id, duration_seconds, published_at,
       thumbnail_url, source_url, is_live_now, scheduled_start,
       discovered_at, last_checked_at, updated_at, first_seen_at, raw
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, NULL)`,
  ).run(
    v.videoId,
    v.title,
    v.description || null,
    v.channelId,
    v.durationSeconds ?? null,
    v.publishedAt || null,
    v.thumbnailUrl ?? null,
    videoSourceUrl(v.videoId),
    now,
    now,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO consumption (video_id, status, status_changed_at)
     VALUES (?, ?, ?)`,
  ).run(v.videoId, defaultStatus, now);

  return { inserted: true };
}

function writeProvenance(
  videoId: string,
  kind: ProvenanceKind,
  sourceRef: string,
  weight: number,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO video_provenance (video_id, source_kind, source_ref, imported_at, signal_weight)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(video_id, source_kind, source_ref) DO UPDATE SET
       imported_at = excluded.imported_at,
       signal_weight = excluded.signal_weight`,
  ).run(videoId, kind, sourceRef, nowUTC(), weight);
}

function importVideos(
  videos: NormalizedYouTubeVideo[],
  kind: ProvenanceKind,
  sourceRef: string,
  defaultStatus: ConsumptionStatus,
  counts: ImportCounts,
): void {
  const db = getDb();
  const weight = WEIGHT_BY_KIND[kind];
  const run = db.transaction((batch: NormalizedYouTubeVideo[]) => {
    for (const v of batch) {
      const ch = upsertChannel(v);
      if (ch.inserted) counts.channels_new += 1;
      const vid = upsertVideo(v, defaultStatus);
      if (vid.inserted) counts.videos_new += 1;
      else counts.videos_updated += 1;
      writeProvenance(v.videoId, kind, sourceRef, weight);
    }
  });
  run(videos);
}

export async function importLikes(): Promise<ImportCounts> {
  const logId = openImportLog('like', null);
  const counts: ImportCounts = {
    videos_new: 0,
    videos_updated: 0,
    channels_new: 0,
  };
  try {
    const videos = await listLikedVideos();
    importVideos(videos, 'like', '', 'saved', counts);
    closeImportLog(logId, 'ok', counts, null);
    return counts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    closeImportLog(logId, 'error', counts, message);
    throw err;
  }
}

export async function importSubscriptions(
  limit: number,
): Promise<ImportCounts> {
  const logId = openImportLog('subscription_upload', null);
  const counts: ImportCounts = {
    videos_new: 0,
    videos_updated: 0,
    channels_new: 0,
  };
  try {
    const channels = await listSubscriptions();
    for (const channel of channels) {
      try {
        const uploadsId = await getChannelUploadsPlaylistId(channel.channelId);
        if (!uploadsId) continue;
        const videos = await listPlaylistItems(uploadsId, { limit });
        importVideos(videos, 'subscription_upload', '', 'inbox', counts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendImportLogError(
          logId,
          `channel ${channel.channelId} (${channel.title}): ${message}`,
        );
      }
    }
    closeImportLog(logId, 'ok', counts, null);
    return counts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    closeImportLog(logId, 'error', counts, message);
    throw err;
  }
}

export async function listPlaylists(): Promise<UserPlaylist[]> {
  return listUserPlaylists();
}

export async function importPlaylist(
  playlistId: string,
): Promise<ImportCounts> {
  const logId = openImportLog('playlist', playlistId);
  const counts: ImportCounts = {
    videos_new: 0,
    videos_updated: 0,
    channels_new: 0,
  };
  try {
    let videos: NormalizedYouTubeVideo[];
    try {
      videos = await listPlaylistItems(playlistId);
    } catch (err) {
      const maybe = err as { status?: number };
      if (maybe && maybe.status === 404) {
        throw new PlaylistNotFoundError(playlistId);
      }
      throw err;
    }
    importVideos(videos, 'playlist', playlistId, 'saved', counts);
    closeImportLog(logId, 'ok', counts, null);
    return counts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    closeImportLog(logId, 'error', counts, message);
    throw err;
  }
}

export interface LastImportByKind {
  like: string | null;
  subscription_upload: string | null;
  playlist: string | null;
}

export function getLastImports(): LastImportByKind {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT kind, MAX(finished_at) AS finished_at
         FROM import_log
        WHERE status = 'ok'
        GROUP BY kind`,
    )
    .all() as Array<{ kind: ProvenanceKind; finished_at: string | null }>;
  const out: LastImportByKind = {
    like: null,
    subscription_upload: null,
    playlist: null,
  };
  for (const row of rows) out[row.kind] = row.finished_at;
  return out;
}

export function getLastPlaylistImports(): Map<string, string> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT source_ref, MAX(finished_at) AS finished_at
         FROM import_log
        WHERE status = 'ok' AND kind = 'playlist' AND source_ref IS NOT NULL
        GROUP BY source_ref`,
    )
    .all() as Array<{ source_ref: string; finished_at: string }>;
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.source_ref, row.finished_at);
  return out;
}
