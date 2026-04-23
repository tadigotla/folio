import { getDb } from './db';
import { nowUTC } from './time';
import type { ConsumptionStatus, Video } from './types';

export class PlaylistNotFoundError extends Error {
  constructor(playlistId: number) {
    super(`Playlist ${playlistId} not found`);
    this.name = 'PlaylistNotFoundError';
  }
}

export class VideoNotFoundError extends Error {
  constructor(videoId: string) {
    super(`Video ${videoId} not found`);
    this.name = 'VideoNotFoundError';
  }
}

export class DuplicateVideoInPlaylistError extends Error {
  constructor(playlistId: number, videoId: string) {
    super(`Video ${videoId} is already in playlist ${playlistId}`);
    this.name = 'DuplicateVideoInPlaylistError';
  }
}

export class InvalidPositionError extends Error {
  constructor(position: number) {
    super(`Invalid position: ${position}`);
    this.name = 'InvalidPositionError';
  }
}

export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  show_on_home: number;
  created_at: string;
  updated_at: string;
}

export interface PlaylistListRow extends Playlist {
  item_count: number;
  latest_thumbnail_urls: string[];
}

export interface PlaylistItemRow {
  video_id: string;
  position: number;
  added_at: string;
  video: Video;
  channel_name: string;
  consumption_status: ConsumptionStatus | null;
  last_position_seconds: number | null;
}

export interface PlaylistDetail {
  playlist: Playlist;
  items: PlaylistItemRow[];
}

export interface PlaylistMembership {
  id: number;
  name: string;
  item_count: number;
}

export interface HomePlaylistRow {
  id: number;
  name: string;
  description: string | null;
  updated_at: string;
  item_count: number;
}

function fetchPlaylist(id: number): Playlist | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT id, name, description, show_on_home, created_at, updated_at
           FROM playlists WHERE id = ?`,
      )
      .get(id) as Playlist | undefined) ?? null
  );
}

function requirePlaylist(id: number): Playlist {
  const row = fetchPlaylist(id);
  if (!row) throw new PlaylistNotFoundError(id);
  return row;
}

function requireVideo(videoId: string): void {
  const db = getDb();
  const row = db.prepare('SELECT 1 AS x FROM videos WHERE id = ?').get(videoId) as
    | { x: number }
    | undefined;
  if (!row) throw new VideoNotFoundError(videoId);
}

function touchPlaylist(playlistId: number, ts: string): void {
  const db = getDb();
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(ts, playlistId);
}

export function createPlaylist(input: {
  name: string;
  description?: string | null;
  show_on_home?: boolean | number;
}): Playlist {
  const trimmed = input.name?.trim();
  if (!trimmed) throw new Error('name is required');
  const db = getDb();
  const ts = nowUTC();
  const showOnHome =
    input.show_on_home === true || input.show_on_home === 1 ? 1 : 0;
  const description = input.description?.trim() || null;
  const info = db
    .prepare(
      `INSERT INTO playlists (name, description, show_on_home, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(trimmed, description, showOnHome, ts, ts);
  const id = Number(info.lastInsertRowid);
  return requirePlaylist(id);
}

export function renamePlaylist(
  id: number,
  patch: {
    name?: string;
    description?: string | null;
    show_on_home?: boolean | number;
  },
): Playlist {
  const db = getDb();
  return db.transaction(() => {
    const current = requirePlaylist(id);
    const next: Playlist = { ...current };
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new Error('name is required');
      next.name = trimmed;
    }
    if (patch.description !== undefined) {
      next.description = patch.description?.trim() || null;
    }
    if (patch.show_on_home !== undefined) {
      next.show_on_home =
        patch.show_on_home === true || patch.show_on_home === 1 ? 1 : 0;
    }
    const ts = nowUTC();
    db.prepare(
      `UPDATE playlists
          SET name = ?, description = ?, show_on_home = ?, updated_at = ?
        WHERE id = ?`,
    ).run(next.name, next.description, next.show_on_home, ts, id);
    return { ...next, updated_at: ts };
  })();
}

export const updatePlaylistMeta = renamePlaylist;

export function deletePlaylist(id: number): void {
  const db = getDb();
  db.transaction(() => {
    requirePlaylist(id);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  })();
}

export function addToPlaylist(
  playlistId: number,
  videoId: string,
  options?: { position?: number },
): { position: number } {
  const db = getDb();
  return db.transaction(() => {
    requirePlaylist(playlistId);
    requireVideo(videoId);

    const existing = db
      .prepare(
        `SELECT 1 AS x FROM playlist_items
          WHERE playlist_id = ? AND video_id = ?`,
      )
      .get(playlistId, videoId) as { x: number } | undefined;
    if (existing) {
      throw new DuplicateVideoInPlaylistError(playlistId, videoId);
    }

    const maxRow = db
      .prepare(
        `SELECT COALESCE(MAX(position), 0) AS max_pos
           FROM playlist_items WHERE playlist_id = ?`,
      )
      .get(playlistId) as { max_pos: number };
    const maxPos = maxRow.max_pos;

    let position: number;
    if (options?.position === undefined) {
      position = maxPos + 1;
    } else {
      const requested = Math.trunc(options.position);
      if (!Number.isFinite(requested) || requested < 1) {
        throw new InvalidPositionError(options.position);
      }
      position = Math.min(requested, maxPos + 1);
      if (position <= maxPos) {
        db.prepare(
          `UPDATE playlist_items SET position = position + 1
            WHERE playlist_id = ? AND position >= ?`,
        ).run(playlistId, position);
      }
    }

    const ts = nowUTC();
    db.prepare(
      `INSERT INTO playlist_items (playlist_id, video_id, position, added_at)
       VALUES (?, ?, ?, ?)`,
    ).run(playlistId, videoId, position, ts);
    touchPlaylist(playlistId, ts);
    return { position };
  })();
}

export function removeFromPlaylist(
  playlistId: number,
  videoId: string,
): void {
  const db = getDb();
  db.transaction(() => {
    requirePlaylist(playlistId);
    const result = db
      .prepare(
        `DELETE FROM playlist_items
          WHERE playlist_id = ? AND video_id = ?`,
      )
      .run(playlistId, videoId);
    if (result.changes > 0) {
      touchPlaylist(playlistId, nowUTC());
    }
  })();
}

export function reorderPlaylist(
  playlistId: number,
  videoId: string,
  newPosition: number,
): { position: number } {
  const db = getDb();
  return db.transaction(() => {
    requirePlaylist(playlistId);
    const requested = Math.trunc(newPosition);
    if (!Number.isFinite(requested)) {
      throw new InvalidPositionError(newPosition);
    }
    const currentRow = db
      .prepare(
        `SELECT position FROM playlist_items
          WHERE playlist_id = ? AND video_id = ?`,
      )
      .get(playlistId, videoId) as { position: number } | undefined;
    if (!currentRow) {
      throw new VideoNotFoundError(videoId);
    }
    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?`,
      )
      .get(playlistId) as { n: number };
    const total = countRow.n;
    const clamped = Math.max(1, Math.min(requested, total));
    const current = currentRow.position;
    if (clamped === current) {
      return { position: current };
    }

    if (clamped < current) {
      db.prepare(
        `UPDATE playlist_items SET position = position + 1
          WHERE playlist_id = ? AND position >= ? AND position < ?`,
      ).run(playlistId, clamped, current);
    } else {
      db.prepare(
        `UPDATE playlist_items SET position = position - 1
          WHERE playlist_id = ? AND position > ? AND position <= ?`,
      ).run(playlistId, current, clamped);
    }
    db.prepare(
      `UPDATE playlist_items SET position = ?
        WHERE playlist_id = ? AND video_id = ?`,
    ).run(clamped, playlistId, videoId);

    touchPlaylist(playlistId, nowUTC());
    return { position: clamped };
  })();
}

const THUMB_FALLBACK = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

export function listPlaylists(): PlaylistListRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.description, p.show_on_home,
              p.created_at, p.updated_at,
              COALESCE(c.item_count, 0) AS item_count
         FROM playlists p
    LEFT JOIN (
           SELECT playlist_id, COUNT(*) AS item_count
             FROM playlist_items GROUP BY playlist_id
         ) c ON c.playlist_id = p.id
        ORDER BY p.updated_at DESC`,
    )
    .all() as Array<Playlist & { item_count: number }>;

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const thumbRows = db
    .prepare(
      `SELECT pi.playlist_id, v.id AS video_id, v.thumbnail_url, pi.added_at
         FROM playlist_items pi
         JOIN videos v ON v.id = pi.video_id
        WHERE pi.playlist_id IN (${placeholders})
        ORDER BY pi.added_at DESC`,
    )
    .all(...ids) as Array<{
    playlist_id: number;
    video_id: string;
    thumbnail_url: string | null;
    added_at: string;
  }>;

  const thumbsByPlaylist = new Map<number, string[]>();
  for (const t of thumbRows) {
    const arr = thumbsByPlaylist.get(t.playlist_id) ?? [];
    if (arr.length < 4) {
      arr.push(t.thumbnail_url ?? THUMB_FALLBACK(t.video_id));
      thumbsByPlaylist.set(t.playlist_id, arr);
    }
  }

  return rows.map((r) => ({
    ...r,
    latest_thumbnail_urls: thumbsByPlaylist.get(r.id) ?? [],
  }));
}

export function getPlaylist(id: number): PlaylistDetail | null {
  const playlist = fetchPlaylist(id);
  if (!playlist) return null;
  const db = getDb();
  const items = db
    .prepare(
      `SELECT pi.video_id, pi.position, pi.added_at,
              v.id AS v_id, v.title AS v_title, v.description AS v_description,
              v.channel_id AS v_channel_id, v.duration_seconds AS v_duration_seconds,
              v.published_at AS v_published_at, v.thumbnail_url AS v_thumbnail_url,
              v.source_url AS v_source_url, v.is_live_now AS v_is_live_now,
              v.scheduled_start AS v_scheduled_start, v.discovered_at AS v_discovered_at,
              v.last_checked_at AS v_last_checked_at, v.updated_at AS v_updated_at,
              v.first_seen_at AS v_first_seen_at, v.raw AS v_raw,
              ch.name AS channel_name,
              c.status AS consumption_status,
              c.last_position_seconds AS last_position_seconds
         FROM playlist_items pi
         JOIN videos v ON v.id = pi.video_id
         JOIN channels ch ON ch.id = v.channel_id
    LEFT JOIN consumption c ON c.video_id = v.id
        WHERE pi.playlist_id = ?
        ORDER BY pi.position ASC`,
    )
    .all(id) as Array<{
    video_id: string;
    position: number;
    added_at: string;
    v_id: string;
    v_title: string;
    v_description: string | null;
    v_channel_id: string;
    v_duration_seconds: number | null;
    v_published_at: string | null;
    v_thumbnail_url: string | null;
    v_source_url: string;
    v_is_live_now: number;
    v_scheduled_start: string | null;
    v_discovered_at: string;
    v_last_checked_at: string;
    v_updated_at: string;
    v_first_seen_at: string;
    v_raw: string | null;
    channel_name: string;
    consumption_status: ConsumptionStatus | null;
    last_position_seconds: number | null;
  }>;

  return {
    playlist,
    items: items.map((row) => ({
      video_id: row.video_id,
      position: row.position,
      added_at: row.added_at,
      video: {
        id: row.v_id,
        title: row.v_title,
        description: row.v_description,
        channel_id: row.v_channel_id,
        duration_seconds: row.v_duration_seconds,
        published_at: row.v_published_at,
        thumbnail_url: row.v_thumbnail_url,
        source_url: row.v_source_url,
        is_live_now: row.v_is_live_now,
        scheduled_start: row.v_scheduled_start,
        discovered_at: row.v_discovered_at,
        last_checked_at: row.v_last_checked_at,
        updated_at: row.v_updated_at,
        first_seen_at: row.v_first_seen_at,
        raw: row.v_raw,
      },
      channel_name: row.channel_name,
      consumption_status: row.consumption_status,
      last_position_seconds: row.last_position_seconds,
    })),
  };
}

export function listHomePlaylists(): HomePlaylistRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.id, p.name, p.description, p.updated_at,
              (SELECT COUNT(*) FROM playlist_items pi
                WHERE pi.playlist_id = p.id) AS item_count
         FROM playlists p
        WHERE p.show_on_home = 1
        ORDER BY p.updated_at DESC`,
    )
    .all() as HomePlaylistRow[];
}

export function getPlaylistsForVideo(videoId: string): PlaylistMembership[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.id, p.name,
              (SELECT COUNT(*) FROM playlist_items pi2
                WHERE pi2.playlist_id = p.id) AS item_count
         FROM playlists p
         JOIN playlist_items pi ON pi.playlist_id = p.id
        WHERE pi.video_id = ?
        ORDER BY p.name ASC`,
    )
    .all(videoId) as PlaylistMembership[];
}

export function getPlaylistsForVideos(
  videoIds: string[],
): Map<string, PlaylistMembership[]> {
  const result = new Map<string, PlaylistMembership[]>();
  if (videoIds.length === 0) return result;
  const db = getDb();
  const placeholders = videoIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT pi.video_id, p.id, p.name,
              (SELECT COUNT(*) FROM playlist_items pi2
                WHERE pi2.playlist_id = p.id) AS item_count
         FROM playlist_items pi
         JOIN playlists p ON p.id = pi.playlist_id
        WHERE pi.video_id IN (${placeholders})
        ORDER BY p.name ASC`,
    )
    .all(...videoIds) as Array<
    PlaylistMembership & { video_id: string }
  >;
  for (const row of rows) {
    const arr = result.get(row.video_id) ?? [];
    arr.push({ id: row.id, name: row.name, item_count: row.item_count });
    result.set(row.video_id, arr);
  }
  return result;
}
