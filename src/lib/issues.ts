import { getDb } from './db';
import { nowUTC } from './time';
import { setConsumptionStatus } from './consumption';
import type { Issue, IssueSlot, SlotKind, ConsumptionStatus } from './types';

export class DraftAlreadyExistsError extends Error {
  draftId: number;
  constructor(draftId: number) {
    super(`A draft already exists (id=${draftId})`);
    this.name = 'DraftAlreadyExistsError';
    this.draftId = draftId;
  }
}

export class IssueFrozenError extends Error {
  constructor(issueId: number) {
    super(`Issue ${issueId} is published and cannot be modified`);
    this.name = 'IssueFrozenError';
  }
}

export class SlotOccupiedError extends Error {
  constructor(kind: SlotKind, index: number) {
    super(`Slot ${kind}[${index}] is occupied`);
    this.name = 'SlotOccupiedError';
  }
}

export class VideoAlreadyOnIssueError extends Error {
  constructor(videoId: string, issueId: number) {
    super(`Video ${videoId} is already on issue ${issueId}`);
    this.name = 'VideoAlreadyOnIssueError';
  }
}

export class InvalidSlotError extends Error {
  constructor(kind: string, index: number) {
    super(`Invalid slot ${kind}[${index}]`);
    this.name = 'InvalidSlotError';
  }
}

export class IssueNotFoundError extends Error {
  constructor(issueId: number) {
    super(`Issue ${issueId} not found`);
    this.name = 'IssueNotFoundError';
  }
}

export interface SlotVideo {
  slot_kind: SlotKind;
  slot_index: number;
  assigned_at: string;
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  channel_id: string;
  channel_name: string;
}

export interface PoolVideo {
  id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  channel_id: string;
  channel_name: string;
  status: ConsumptionStatus;
  status_changed_at: string;
  signal_weight: number | null;
}

function validateSlot(kind: SlotKind, index: number): boolean {
  if (kind === 'cover') return index === 0;
  if (kind === 'featured') return index >= 0 && index <= 2;
  if (kind === 'brief') return index >= 0 && index <= 9;
  return false;
}

function assertSlot(kind: SlotKind, index: number): void {
  if (!validateSlot(kind, index)) throw new InvalidSlotError(kind, index);
}

function requireDraft(issueId: number): Issue {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM issues WHERE id = ?')
    .get(issueId) as Issue | undefined;
  if (!row) throw new IssueNotFoundError(issueId);
  if (row.status !== 'draft') throw new IssueFrozenError(issueId);
  return row;
}

export function createDraftIssue(): Issue {
  const db = getDb();
  try {
    const result = db
      .prepare(`INSERT INTO issues (status, created_at) VALUES ('draft', ?)`)
      .run(nowUTC());
    const id = Number(result.lastInsertRowid);
    return db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as Issue;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      code === 'SQLITE_CONSTRAINT'
    ) {
      const draft = getDraftIssue();
      if (draft) throw new DraftAlreadyExistsError(draft.id);
    }
    throw err;
  }
}

export function getDraftIssue(): Issue | null {
  const db = getDb();
  return (
    (db
      .prepare(`SELECT * FROM issues WHERE status = 'draft' LIMIT 1`)
      .get() as Issue | undefined) ?? null
  );
}

export function getPublishedIssues(): Issue[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM issues WHERE status = 'published' ORDER BY published_at DESC`,
    )
    .all() as Issue[];
}

export function getIssueById(id: number): Issue | null {
  const db = getDb();
  return (
    (db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as Issue | undefined) ??
    null
  );
}

const SLOT_KIND_ORDER = `CASE slot_kind WHEN 'cover' THEN 0 WHEN 'featured' THEN 1 ELSE 2 END`;

export function getIssueSlots(issueId: number): SlotVideo[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.slot_kind, s.slot_index, s.assigned_at, s.video_id,
              v.title, v.thumbnail_url, v.duration_seconds, v.channel_id,
              ch.name AS channel_name
         FROM issue_slots s
         JOIN videos v     ON v.id  = s.video_id
         JOIN channels ch  ON ch.id = v.channel_id
        WHERE s.issue_id = ?
        ORDER BY ${SLOT_KIND_ORDER}, s.slot_index`,
    )
    .all(issueId) as SlotVideo[];
}

export function getInboxPool(issueId: number): PoolVideo[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT v.id, v.title, v.thumbnail_url, v.duration_seconds, v.published_at,
              v.channel_id, ch.name AS channel_name,
              c.status, c.status_changed_at,
              p.signal_weight
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
         JOIN channels ch   ON ch.id      = v.channel_id
    LEFT JOIN (
           SELECT video_id, MAX(signal_weight) AS signal_weight
             FROM video_provenance
            GROUP BY video_id
         ) p ON p.video_id = v.id
        WHERE c.status IN ('inbox', 'saved')
          AND NOT EXISTS (
            SELECT 1 FROM issue_slots s
             WHERE s.issue_id = ? AND s.video_id = v.id
          )
        ORDER BY c.status_changed_at DESC`,
    )
    .all(issueId) as PoolVideo[];
}

function getSlotRow(
  issueId: number,
  kind: SlotKind,
  index: number,
): IssueSlot | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT * FROM issue_slots
          WHERE issue_id = ? AND slot_kind = ? AND slot_index = ?`,
      )
      .get(issueId, kind, index) as IssueSlot | undefined) ?? null
  );
}

function videoIsOnIssue(issueId: number, videoId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 AS x FROM issue_slots WHERE issue_id = ? AND video_id = ?`,
    )
    .get(issueId, videoId) as { x: number } | undefined;
  return !!row;
}

function autoSaveIfInbox(videoId: string): void {
  const db = getDb();
  const row = db
    .prepare(`SELECT status FROM consumption WHERE video_id = ?`)
    .get(videoId) as { status: ConsumptionStatus } | undefined;
  if (row?.status === 'inbox') {
    setConsumptionStatus(videoId, 'saved');
  }
}

export function assignSlot(
  issueId: number,
  videoId: string,
  kind: SlotKind,
  index: number,
): void {
  assertSlot(kind, index);
  const db = getDb();
  db.transaction(() => {
    requireDraft(issueId);
    if (getSlotRow(issueId, kind, index)) {
      throw new SlotOccupiedError(kind, index);
    }
    if (videoIsOnIssue(issueId, videoId)) {
      throw new VideoAlreadyOnIssueError(videoId, issueId);
    }
    db.prepare(
      `INSERT INTO issue_slots
         (issue_id, slot_kind, slot_index, video_id, assigned_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(issueId, kind, index, videoId, nowUTC());
    autoSaveIfInbox(videoId);
  })();
}

export type SwapFrom =
  | { kind: SlotKind; index: number }
  | { pool: string };

export function swapSlots(
  issueId: number,
  from: SwapFrom,
  to: { kind: SlotKind; index: number },
): void {
  assertSlot(to.kind, to.index);
  if ('kind' in from) assertSlot(from.kind, from.index);

  const db = getDb();
  db.transaction(() => {
    requireDraft(issueId);
    const toRow = getSlotRow(issueId, to.kind, to.index);
    if (!toRow) {
      throw new Error(`Target slot ${to.kind}[${to.index}] is empty; use assign`);
    }

    if ('kind' in from) {
      const fromRow = getSlotRow(issueId, from.kind, from.index);
      if (!fromRow) {
        throw new Error(
          `Source slot ${from.kind}[${from.index}] is empty`,
        );
      }
      if (fromRow.video_id === toRow.video_id) return;
      const ts = nowUTC();
      // Delete-then-insert to avoid briefly colliding on the
      // (issue_id, video_id) unique index during the swap.
      db.prepare(
        `DELETE FROM issue_slots
          WHERE issue_id = ? AND slot_kind = ? AND slot_index = ?`,
      ).run(issueId, from.kind, from.index);
      db.prepare(
        `DELETE FROM issue_slots
          WHERE issue_id = ? AND slot_kind = ? AND slot_index = ?`,
      ).run(issueId, to.kind, to.index);
      db.prepare(
        `INSERT INTO issue_slots
           (issue_id, slot_kind, slot_index, video_id, assigned_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(issueId, from.kind, from.index, toRow.video_id, ts);
      db.prepare(
        `INSERT INTO issue_slots
           (issue_id, slot_kind, slot_index, video_id, assigned_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(issueId, to.kind, to.index, fromRow.video_id, ts);
      return;
    }

    const poolVideoId = from.pool;
    if (poolVideoId === toRow.video_id) return;
    if (videoIsOnIssue(issueId, poolVideoId)) {
      throw new VideoAlreadyOnIssueError(poolVideoId, issueId);
    }
    db.prepare(
      `UPDATE issue_slots SET video_id = ?, assigned_at = ?
        WHERE issue_id = ? AND slot_kind = ? AND slot_index = ?`,
    ).run(poolVideoId, nowUTC(), issueId, to.kind, to.index);
    autoSaveIfInbox(poolVideoId);
  })();
}

export function clearSlot(
  issueId: number,
  kind: SlotKind,
  index: number,
): void {
  assertSlot(kind, index);
  const db = getDb();
  db.transaction(() => {
    requireDraft(issueId);
    db.prepare(
      `DELETE FROM issue_slots
        WHERE issue_id = ? AND slot_kind = ? AND slot_index = ?`,
    ).run(issueId, kind, index);
  })();
}

export class IssueAlreadyPublishedError extends Error {
  constructor(issueId: number) {
    super(`Issue ${issueId} is already published`);
    this.name = 'IssueAlreadyPublishedError';
  }
}

export function publishIssue(issueId: number): Issue {
  const db = getDb();
  return db.transaction(() => {
    const current = db
      .prepare('SELECT * FROM issues WHERE id = ?')
      .get(issueId) as Issue | undefined;
    if (!current) throw new IssueNotFoundError(issueId);
    if (current.status === 'published') {
      throw new IssueAlreadyPublishedError(issueId);
    }
    const ts = nowUTC();
    db.prepare(
      `UPDATE issues SET status = 'published', published_at = ? WHERE id = ?`,
    ).run(ts, issueId);
    return db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId) as Issue;
  })();
}

export function discardDraft(issueId: number): void {
  const db = getDb();
  db.transaction(() => {
    requireDraft(issueId);
    db.prepare('DELETE FROM issues WHERE id = ?').run(issueId);
  })();
}

export function updateIssueTitle(issueId: number, title: string | null): Issue {
  const db = getDb();
  return db.transaction(() => {
    const current = db
      .prepare('SELECT * FROM issues WHERE id = ?')
      .get(issueId) as Issue | undefined;
    if (!current) throw new IssueNotFoundError(issueId);
    if (current.status !== 'draft') throw new IssueFrozenError(issueId);
    const trimmed = title && title.trim().length > 0 ? title.trim() : null;
    db.prepare('UPDATE issues SET title = ? WHERE id = ?').run(trimmed, issueId);
    return { ...current, title: trimmed };
  })();
}
