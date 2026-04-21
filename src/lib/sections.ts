import { getDb } from './db';
import { nowUTC } from './time';
import type { Section } from './types';

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function listSections(): Section[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, name, sort_order, created_at
         FROM sections
        ORDER BY sort_order ASC, name ASC`,
    )
    .all() as Section[];
}

export function getSectionBySlug(s: string): Section | null {
  const sections = listSections();
  return sections.find((sec) => slug(sec.name) === s) ?? null;
}

export function getSectionById(id: number): Section | null {
  const db = getDb();
  return (
    (db
      .prepare('SELECT id, name, sort_order, created_at FROM sections WHERE id = ?')
      .get(id) as Section | undefined) ?? null
  );
}

export class DuplicateSectionError extends Error {
  constructor(name: string) {
    super(`Section already exists: ${name}`);
    this.name = 'DuplicateSectionError';
  }
}

export function createSection(name: string): Section {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Section name is required');
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM sections WHERE name = ?')
    .get(trimmed) as { id: number } | undefined;
  if (existing) throw new DuplicateSectionError(trimmed);

  const info = db
    .prepare(
      `INSERT INTO sections (name, sort_order, created_at) VALUES (?, 0, ?)`,
    )
    .run(trimmed, nowUTC());
  return {
    id: Number(info.lastInsertRowid),
    name: trimmed,
    sort_order: 0,
    created_at: nowUTC(),
  };
}

export function renameSection(id: number, newName: string): Section | null {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Section name is required');
  const db = getDb();
  const conflict = db
    .prepare('SELECT id FROM sections WHERE name = ? AND id != ?')
    .get(trimmed, id) as { id: number } | undefined;
  if (conflict) throw new DuplicateSectionError(trimmed);
  db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(trimmed, id);
  return getSectionById(id);
}

export function deleteSection(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE channels SET section_id = NULL WHERE section_id = ?').run(id);
    db.prepare('DELETE FROM sections WHERE id = ?').run(id);
  })();
}

export function assignChannel(
  channelId: string,
  sectionId: number | null,
): boolean {
  const db = getDb();
  const exists = db
    .prepare('SELECT 1 FROM channels WHERE id = ?')
    .get(channelId);
  if (!exists) return false;
  if (sectionId !== null) {
    const sec = db
      .prepare('SELECT 1 FROM sections WHERE id = ?')
      .get(sectionId);
    if (!sec) throw new Error(`Section not found: ${sectionId}`);
  }
  db.prepare('UPDATE channels SET section_id = ? WHERE id = ?').run(
    sectionId,
    channelId,
  );
  return true;
}

export function getChannelsBySection(
  sectionId: number | null,
): Array<{ id: string; name: string }> {
  const db = getDb();
  if (sectionId === null) {
    return db
      .prepare(
        `SELECT id, name FROM channels WHERE section_id IS NULL ORDER BY name ASC`,
      )
      .all() as Array<{ id: string; name: string }>;
  }
  return db
    .prepare(
      `SELECT id, name FROM channels WHERE section_id = ? ORDER BY name ASC`,
    )
    .all(sectionId) as Array<{ id: string; name: string }>;
}
