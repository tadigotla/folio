import { formatInTimeZone } from 'date-fns-tz';
import { getDb } from './db';
import { nowUTC, TZ } from './time';
import type { Issue, Video } from './types';

type IssueRow = {
  id: number;
  created_at: string;
  cover_video_id: string | null;
  featured_video_ids: string;
  pinned_cover_video_id: string | null;
};

function rowToIssue(row: IssueRow): Issue {
  let featured: string[] = [];
  try {
    const parsed = JSON.parse(row.featured_video_ids);
    if (Array.isArray(parsed)) featured = parsed.filter((v) => typeof v === 'string');
  } catch {}
  return {
    id: row.id,
    created_at: row.created_at,
    cover_video_id: row.cover_video_id,
    featured_video_ids: featured,
    pinned_cover_video_id: row.pinned_cover_video_id,
  };
}

export function getLatestIssue(): Issue | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, created_at, cover_video_id, featured_video_ids, pinned_cover_video_id
         FROM issues
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get() as IssueRow | undefined;
  return row ? rowToIssue(row) : null;
}

function localDateKey(utcIso: string): string {
  return formatInTimeZone(utcIso, TZ, 'yyyy-MM-dd');
}

export function isIssueCurrentForToday(issue: Issue): boolean {
  return localDateKey(issue.created_at) === localDateKey(nowUTC());
}

type ScoredVideo = {
  id: string;
  channel_id: string;
  duration_seconds: number | null;
  published_at: string | null;
  affinity: number;
  score: number;
};

export function scoreVideoForCover(
  video: {
    duration_seconds: number | null;
    published_at: string | null;
  },
  affinity: number,
): number {
  const now = Date.now();
  const publishedMs = video.published_at ? new Date(video.published_at).getTime() : now;
  const hoursSince = Math.max(0, (now - publishedMs) / 3_600_000);
  const recency = 1 / (hoursSince + 1);
  const dur = video.duration_seconds ?? 0;
  const depth = Math.log(Math.max(0, dur) + 60) / Math.log(3600);
  return (affinity + 1) * recency * depth;
}

interface InboxVideoRow {
  id: string;
  channel_id: string;
  duration_seconds: number | null;
  published_at: string | null;
  section_id: number | null;
}

function loadInboxVideos(): InboxVideoRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT v.id, v.channel_id, v.duration_seconds, v.published_at, ch.section_id
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
         JOIN channels ch   ON ch.id      = v.channel_id
        WHERE c.status = 'inbox'`,
    )
    .all() as InboxVideoRow[];
}

function loadChannelAffinity(): Map<string, number> {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT v.channel_id AS channel_id, COUNT(*) AS n
         FROM consumption c
         JOIN videos v ON v.id = c.video_id
        WHERE c.status IN ('saved', 'in_progress', 'archived')
          AND c.status_changed_at >= ?
        GROUP BY v.channel_id`,
    )
    .all(since) as Array<{ channel_id: string; n: number }>;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.channel_id, row.n);
  return map;
}

function scoreAll(
  rows: InboxVideoRow[],
  affinity: Map<string, number>,
): ScoredVideo[] {
  return rows.map((r) => ({
    id: r.id,
    channel_id: r.channel_id,
    duration_seconds: r.duration_seconds,
    published_at: r.published_at,
    affinity: affinity.get(r.channel_id) ?? 0,
    score: scoreVideoForCover(r, affinity.get(r.channel_id) ?? 0),
  }));
}

function tieBreakCmp(a: ScoredVideo, b: ScoredVideo): number {
  if (b.score !== a.score) return b.score - a.score;
  const aPub = a.published_at ? new Date(a.published_at).getTime() : 0;
  const bPub = b.published_at ? new Date(b.published_at).getTime() : 0;
  if (bPub !== aPub) return bPub - aPub;
  return a.id.localeCompare(b.id);
}

function pickCover(scored: ScoredVideo[]): string | null {
  if (scored.length === 0) return null;
  const sorted = [...scored].sort(tieBreakCmp);
  return sorted[0].id;
}

export function pickFeatured(
  inboxRows: InboxVideoRow[],
  affinity: Map<string, number>,
  coverId: string | null,
): string[] {
  const filtered = inboxRows.filter((r) => r.id !== coverId);
  const scored = scoreAll(filtered, affinity);

  const bySection = new Map<number, ScoredVideo[]>();
  for (const v of scored) {
    if (v.channel_id) {
      const row = filtered.find((r) => r.id === v.id);
      const sid = row?.section_id ?? null;
      if (sid !== null) {
        if (!bySection.has(sid)) bySection.set(sid, []);
        bySection.get(sid)!.push(v);
      }
    }
  }

  const sectionCounts = Array.from(bySection.entries())
    .map(([sid, vids]) => ({ sid, count: vids.length }))
    .sort((a, b) => b.count - a.count);

  const featured: string[] = [];
  const used = new Set<string>();

  for (const { sid } of sectionCounts.slice(0, 3)) {
    const vids = [...(bySection.get(sid) ?? [])].sort(tieBreakCmp);
    const top = vids.find((v) => !used.has(v.id));
    if (top) {
      featured.push(top.id);
      used.add(top.id);
    }
  }

  if (featured.length < 3) {
    const globalSorted = [...scored].sort(tieBreakCmp);
    for (const v of globalSorted) {
      if (featured.length >= 3) break;
      if (!used.has(v.id)) {
        featured.push(v.id);
        used.add(v.id);
      }
    }
  }

  return featured;
}

export function pickBriefs(excludeIds: Set<string>, limit = 10): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.id, v.duration_seconds
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
        WHERE c.status = 'inbox'
        ORDER BY CASE WHEN v.duration_seconds IS NULL THEN 1 ELSE 0 END ASC,
                 v.duration_seconds ASC,
                 v.id ASC`,
    )
    .all() as Array<{ id: string; duration_seconds: number | null }>;
  const out: string[] = [];
  for (const r of rows) {
    if (excludeIds.has(r.id)) continue;
    out.push(r.id);
    if (out.length >= limit) break;
  }
  return out;
}

export function composeIssue(): {
  cover_video_id: string | null;
  featured_video_ids: string[];
} {
  const rows = loadInboxVideos();
  const affinity = loadChannelAffinity();
  const scored = scoreAll(rows, affinity);
  const cover = pickCover(scored);
  const featured = pickFeatured(rows, affinity, cover);
  return { cover_video_id: cover, featured_video_ids: featured };
}

export function publishIssue(): Issue {
  const composition = composeIssue();
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO issues (created_at, cover_video_id, featured_video_ids, pinned_cover_video_id)
       VALUES (?, ?, ?, NULL)`,
    )
    .run(
      nowUTC(),
      composition.cover_video_id,
      JSON.stringify(composition.featured_video_ids),
    );
  const row = db
    .prepare(
      `SELECT id, created_at, cover_video_id, featured_video_ids, pinned_cover_video_id
         FROM issues WHERE id = ?`,
    )
    .get(Number(info.lastInsertRowid)) as IssueRow;
  return rowToIssue(row);
}

export function getOrPublishTodaysIssue(): Issue {
  const latest = getLatestIssue();
  if (latest && isIssueCurrentForToday(latest)) return latest;
  return publishIssue();
}

export function setCoverPin(videoId: string | null): Issue | null {
  const latest = getLatestIssue();
  if (!latest) return null;
  const db = getDb();
  db.prepare('UPDATE issues SET pinned_cover_video_id = ? WHERE id = ?').run(
    videoId,
    latest.id,
  );
  return { ...latest, pinned_cover_video_id: videoId };
}

export function effectiveCoverId(issue: Issue): string | null {
  if (!issue.pinned_cover_video_id) return issue.cover_video_id;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT c.status AS status
         FROM consumption c
        WHERE c.video_id = ?`,
    )
    .get(issue.pinned_cover_video_id) as { status: string } | undefined;
  if (row && row.status === 'inbox') return issue.pinned_cover_video_id;
  return issue.cover_video_id;
}

export type IssueVideo = Video & {
  channel_name: string;
  section_id: number | null;
  section_name: string | null;
};

export function getIssueOrder(issue: Issue): string[] {
  const order: string[] = [];
  const used = new Set<string>();
  const push = (id: string | null | undefined) => {
    if (!id || used.has(id)) return;
    order.push(id);
    used.add(id);
  };
  const coverId = effectiveCoverId(issue);
  push(coverId);
  for (const id of issue.featured_video_ids) push(id);
  const briefs = pickBriefs(new Set(order), 10);
  for (const id of briefs) push(id);

  const db = getDb();
  const sectionRows = db
    .prepare(
      `SELECT DISTINCT ch.section_id
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
         JOIN channels ch   ON ch.id      = v.channel_id
        WHERE c.status = 'inbox' AND ch.section_id IS NOT NULL`,
    )
    .all() as Array<{ section_id: number }>;

  for (const { section_id } of sectionRows) {
    const vids = db
      .prepare(
        `SELECT v.id
           FROM videos v
           JOIN consumption c ON c.video_id = v.id
           JOIN channels ch   ON ch.id      = v.channel_id
          WHERE c.status = 'inbox' AND ch.section_id = ?
          ORDER BY v.published_at DESC`,
      )
      .all(section_id) as Array<{ id: string }>;
    for (const row of vids) push(row.id);
  }

  const unsorted = db
    .prepare(
      `SELECT v.id
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
         JOIN channels ch   ON ch.id      = v.channel_id
        WHERE c.status = 'inbox' AND ch.section_id IS NULL
        ORDER BY v.published_at DESC`,
    )
    .all() as Array<{ id: string }>;
  for (const row of unsorted) push(row.id);

  return order;
}

export function loadIssueVideos(ids: string[]): Map<string, IssueVideo> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT v.*,
              ch.name AS channel_name,
              ch.section_id AS section_id,
              s.name AS section_name
         FROM videos v
         JOIN channels ch ON ch.id = v.channel_id
    LEFT JOIN sections s ON s.id = ch.section_id
        WHERE v.id IN (${placeholders})`,
    )
    .all(...ids) as IssueVideo[];
  const map = new Map<string, IssueVideo>();
  for (const r of rows) map.set(r.id, r);
  return map;
}
