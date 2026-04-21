import { getDb } from './db';
import { slugify } from './slug';
import { nowUTC } from './time';
import type { Tag } from './types';

export const slugTag = slugify;

export function listTags(): Tag[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, name, sort_order, created_at
         FROM tags
        ORDER BY sort_order ASC, name ASC`,
    )
    .all() as Tag[];
}

export function getTagBySlug(s: string): Tag | null {
  const tags = listTags();
  return tags.find((t) => slugTag(t.name) === s) ?? null;
}

export function getTagById(id: number): Tag | null {
  const db = getDb();
  return (
    (db
      .prepare('SELECT id, name, sort_order, created_at FROM tags WHERE id = ?')
      .get(id) as Tag | undefined) ?? null
  );
}

export class DuplicateTagError extends Error {
  constructor(name: string) {
    super(`Tag already exists: ${name}`);
    this.name = 'DuplicateTagError';
  }
}

export function createTag(name: string): Tag {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tag name is required');
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM tags WHERE name = ?')
    .get(trimmed) as { id: number } | undefined;
  if (existing) throw new DuplicateTagError(trimmed);
  const info = db
    .prepare('INSERT INTO tags (name, sort_order, created_at) VALUES (?, 0, ?)')
    .run(trimmed, nowUTC());
  return {
    id: Number(info.lastInsertRowid),
    name: trimmed,
    sort_order: 0,
    created_at: nowUTC(),
  };
}

export function renameTag(id: number, newName: string): Tag | null {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Tag name is required');
  const db = getDb();
  const conflict = db
    .prepare('SELECT id FROM tags WHERE name = ? AND id != ?')
    .get(trimmed, id) as { id: number } | undefined;
  if (conflict) throw new DuplicateTagError(trimmed);
  db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(trimmed, id);
  return getTagById(id);
}

export function deleteTag(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM channel_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  })();
}

export function setChannelTags(
  channelId: string,
  tagIds: number[],
): boolean {
  const db = getDb();
  const exists = db
    .prepare('SELECT 1 FROM channels WHERE id = ?')
    .get(channelId);
  if (!exists) return false;
  const dedup = Array.from(new Set(tagIds.filter((n) => Number.isInteger(n))));
  if (dedup.length > 0) {
    const placeholders = dedup.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`)
      .all(...dedup) as Array<{ id: number }>;
    if (rows.length !== dedup.length) {
      throw new Error('One or more tag ids are invalid');
    }
  }
  db.transaction(() => {
    db.prepare('DELETE FROM channel_tags WHERE channel_id = ?').run(channelId);
    const insert = db.prepare(
      'INSERT INTO channel_tags (channel_id, tag_id, created_at) VALUES (?, ?, ?)',
    );
    const now = nowUTC();
    for (const tagId of dedup) insert.run(channelId, tagId, now);
  })();
  return true;
}

export function getTagsForChannel(channelId: string): Tag[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.id, t.name, t.sort_order, t.created_at
         FROM tags t
         JOIN channel_tags ct ON ct.tag_id = t.id
        WHERE ct.channel_id = ?
        ORDER BY t.sort_order ASC, t.name ASC`,
    )
    .all(channelId) as Tag[];
}

export function getTagsByChannel(): Map<string, Tag[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ct.channel_id AS channel_id,
              t.id, t.name, t.sort_order, t.created_at
         FROM channel_tags ct
         JOIN tags t ON t.id = ct.tag_id
        ORDER BY t.sort_order ASC, t.name ASC`,
    )
    .all() as Array<Tag & { channel_id: string }>;
  const map = new Map<string, Tag[]>();
  for (const r of rows) {
    if (!map.has(r.channel_id)) map.set(r.channel_id, []);
    map.get(r.channel_id)!.push({
      id: r.id,
      name: r.name,
      sort_order: r.sort_order,
      created_at: r.created_at,
    });
  }
  return map;
}

export function getTagCounts(): Map<number, number> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ct.tag_id AS tag_id, COUNT(*) AS n
         FROM channel_tags ct
         JOIN videos v ON v.channel_id = ct.channel_id
         JOIN consumption c ON c.video_id = v.id
        WHERE c.status = 'inbox'
        GROUP BY ct.tag_id`,
    )
    .all() as Array<{ tag_id: number; n: number }>;
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.tag_id, r.n);
  return map;
}
