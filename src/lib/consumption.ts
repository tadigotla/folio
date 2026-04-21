import { getDb } from './db';
import { nowUTC } from './time';
import type { ConsumptionStatus, Video, Consumption } from './types';

export class IllegalTransitionError extends Error {
  constructor(from: ConsumptionStatus | 'missing', to: ConsumptionStatus) {
    super(`Illegal consumption transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

const LEGAL_TRANSITIONS: Record<ConsumptionStatus, ConsumptionStatus[]> = {
  inbox: ['saved', 'dismissed'],
  saved: ['in_progress', 'archived', 'dismissed'],
  in_progress: ['archived', 'saved'],
  archived: ['saved', 'in_progress'],
  dismissed: ['inbox'],
};

export type ProgressAction = 'start' | 'tick' | 'pause' | 'end';

function updatePosition(videoId: string, position: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE consumption
        SET last_position_seconds = ?, last_viewed_at = ?
      WHERE video_id = ?`,
  ).run(Math.max(0, Math.floor(position)), nowUTC(), videoId);
}

function clearPosition(videoId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE consumption
        SET last_position_seconds = NULL
      WHERE video_id = ?`,
  ).run(videoId);
}

function touchLastViewedAt(videoId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE consumption
        SET last_viewed_at = ?
      WHERE video_id = ?`,
  ).run(nowUTC(), videoId);
}

export function recordProgress({
  videoId,
  action,
  position,
}: {
  videoId: string;
  action: ProgressAction;
  position?: number;
}): void {
  const db = getDb();
  const current = db
    .prepare('SELECT * FROM consumption WHERE video_id = ?')
    .get(videoId) as Consumption | undefined;

  if (!current) return;

  db.transaction(() => {
    switch (action) {
      case 'start':
        if (current.status === 'dismissed') return;
        if (current.status === 'inbox') {
          setConsumptionStatus(videoId, 'saved');
          setConsumptionStatus(videoId, 'in_progress');
        } else if (
          current.status === 'saved' ||
          current.status === 'archived'
        ) {
          setConsumptionStatus(videoId, 'in_progress');
        }
        touchLastViewedAt(videoId);
        break;
      case 'tick':
      case 'pause':
        if (current.status === 'dismissed') return;
        if (typeof position === 'number') updatePosition(videoId, position);
        else touchLastViewedAt(videoId);
        break;
      case 'end':
        if (current.status === 'in_progress') {
          setConsumptionStatus(videoId, 'archived');
          clearPosition(videoId);
        }
        break;
    }
  })();
}

export function setConsumptionStatus(
  videoId: string,
  nextStatus: ConsumptionStatus,
): Consumption {
  const db = getDb();
  const current = db
    .prepare('SELECT * FROM consumption WHERE video_id = ?')
    .get(videoId) as Consumption | undefined;

  if (!current) {
    throw new IllegalTransitionError('missing', nextStatus);
  }

  const allowed = LEGAL_TRANSITIONS[current.status];
  if (!allowed.includes(nextStatus)) {
    throw new IllegalTransitionError(current.status, nextStatus);
  }

  const timestamp = nowUTC();
  db.prepare(
    `UPDATE consumption
        SET status = ?, status_changed_at = ?
      WHERE video_id = ?`,
  ).run(nextStatus, timestamp, videoId);

  return {
    ...current,
    status: nextStatus,
    status_changed_at: timestamp,
  };
}

export type VideoWithConsumption = Video & {
  channel_name: string;
  status: ConsumptionStatus;
  status_changed_at: string;
  last_viewed_at: string | null;
  last_position_seconds: number | null;
};

export type VideoWithSection = VideoWithConsumption & {
  section_id: number | null;
  section_name: string | null;
};

const SELECT_VIDEO_WITH_CONSUMPTION = `
  SELECT v.*,
         c.status, c.status_changed_at, c.last_viewed_at, c.last_position_seconds,
         ch.name AS channel_name
    FROM videos v
    JOIN consumption c ON c.video_id = v.id
    JOIN channels ch   ON ch.id      = v.channel_id
`;

export function getInboxVideos(): VideoWithConsumption[] {
  const db = getDb();
  return db
    .prepare(
      `${SELECT_VIDEO_WITH_CONSUMPTION}
        WHERE c.status = 'inbox'
        ORDER BY v.discovered_at DESC`,
    )
    .all() as VideoWithConsumption[];
}

export function getInboxVideosWithSection(): VideoWithSection[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT v.*,
              c.status, c.status_changed_at, c.last_viewed_at, c.last_position_seconds,
              ch.name AS channel_name,
              ch.section_id AS section_id,
              s.name AS section_name
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
         JOIN channels ch   ON ch.id      = v.channel_id
    LEFT JOIN sections s ON s.id = ch.section_id
        WHERE c.status = 'inbox'
        ORDER BY v.discovered_at DESC`,
    )
    .all() as VideoWithSection[];
}

export function getLibraryVideos(): {
  saved: VideoWithConsumption[];
  inProgress: VideoWithConsumption[];
  archived: VideoWithConsumption[];
} {
  const db = getDb();
  const rows = db
    .prepare(
      `${SELECT_VIDEO_WITH_CONSUMPTION}
        WHERE c.status IN ('saved', 'in_progress', 'archived')
        ORDER BY c.status_changed_at DESC`,
    )
    .all() as VideoWithConsumption[];

  const inProgress = rows
    .filter((r) => r.status === 'in_progress')
    .sort((a, b) => {
      const aKey = a.last_viewed_at ?? a.status_changed_at;
      const bKey = b.last_viewed_at ?? b.status_changed_at;
      return bKey.localeCompare(aKey);
    });

  return {
    saved: rows.filter((r) => r.status === 'saved'),
    inProgress,
    archived: rows.filter((r) => r.status === 'archived'),
  };
}

export function getArchivedVideos(): VideoWithConsumption[] {
  const db = getDb();
  return db
    .prepare(
      `${SELECT_VIDEO_WITH_CONSUMPTION}
        WHERE c.status = 'archived'
        ORDER BY c.status_changed_at DESC`,
    )
    .all() as VideoWithConsumption[];
}

export function getVideoById(id: string): VideoWithConsumption | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `${SELECT_VIDEO_WITH_CONSUMPTION}
          WHERE v.id = ?`,
      )
      .get(id) as VideoWithConsumption | undefined) ?? null
  );
}

export function getLiveNowVideos(): VideoWithConsumption[] {
  const db = getDb();
  return db
    .prepare(
      `${SELECT_VIDEO_WITH_CONSUMPTION}
        WHERE v.is_live_now = 1
        ORDER BY v.published_at DESC`,
    )
    .all() as VideoWithConsumption[];
}

export function getConsumptionCounts(): Record<ConsumptionStatus, number> {
  const db = getDb();
  const rows = db
    .prepare('SELECT status, COUNT(*) AS n FROM consumption GROUP BY status')
    .all() as Array<{ status: ConsumptionStatus; n: number }>;

  const counts: Record<ConsumptionStatus, number> = {
    inbox: 0,
    saved: 0,
    in_progress: 0,
    archived: 0,
    dismissed: 0,
  };
  for (const row of rows) counts[row.status] = row.n;
  return counts;
}
