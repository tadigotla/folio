import { describe, expect, it } from 'vitest';
import { setupInMemoryDb } from './setup';
import {
  IllegalTransitionError,
  recordProgress,
  setConsumptionStatus,
} from '../consumption';
import type { Consumption, ConsumptionStatus } from '../types';

const ctx = setupInMemoryDb();

const VIDEO_ID = 'vid_test_1';
const CHANNEL_ID = 'UC_test_chan';

function seedVideo(initialStatus: ConsumptionStatus = 'inbox'): void {
  const db = ctx.db();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO channels (id, name, handle, subscribed, first_seen_at, last_checked_at)
     VALUES (?, ?, NULL, 0, ?, ?)`,
  ).run(CHANNEL_ID, 'Test Channel', now, now);
  db.prepare(
    `INSERT INTO videos
       (id, title, description, channel_id, duration_seconds, published_at,
        thumbnail_url, source_url, is_live_now, scheduled_start,
        discovered_at, last_checked_at, updated_at, first_seen_at, raw)
     VALUES (?, ?, NULL, ?, 600, ?, NULL, ?, 0, NULL, ?, ?, ?, ?, NULL)`,
  ).run(
    VIDEO_ID,
    'Test Video',
    CHANNEL_ID,
    now,
    `https://youtu.be/${VIDEO_ID}`,
    now,
    now,
    now,
    now,
  );
  db.prepare(
    `INSERT INTO consumption (video_id, status, status_changed_at)
     VALUES (?, ?, ?)`,
  ).run(VIDEO_ID, initialStatus, now);
}

function readConsumption(): Consumption {
  const row = ctx
    .db()
    .prepare(`SELECT * FROM consumption WHERE video_id = ?`)
    .get(VIDEO_ID) as Consumption | undefined;
  if (!row) throw new Error('consumption row missing');
  return row;
}

const LEGAL: Array<[ConsumptionStatus, ConsumptionStatus]> = [
  ['inbox', 'saved'],
  ['inbox', 'dismissed'],
  ['saved', 'in_progress'],
  ['saved', 'archived'],
  ['saved', 'dismissed'],
  ['in_progress', 'archived'],
  ['in_progress', 'saved'],
  ['archived', 'saved'],
  ['archived', 'in_progress'],
  ['dismissed', 'inbox'],
];

const ALL_STATUSES: ConsumptionStatus[] = [
  'inbox',
  'saved',
  'in_progress',
  'archived',
  'dismissed',
];

describe('setConsumptionStatus', () => {
  for (const [from, to] of LEGAL) {
    it(`allows ${from} → ${to}`, () => {
      seedVideo(from);
      const result = setConsumptionStatus(VIDEO_ID, to);
      expect(result.status).toBe(to);
      expect(readConsumption().status).toBe(to);
    });
  }

  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (from === to) continue;
      const isLegal = LEGAL.some(([f, t]) => f === from && t === to);
      if (isLegal) continue;
      it(`rejects illegal ${from} → ${to} without mutating row`, () => {
        seedVideo(from);
        const before = readConsumption();
        expect(() => setConsumptionStatus(VIDEO_ID, to)).toThrow(
          IllegalTransitionError,
        );
        const after = readConsumption();
        expect(after.status).toBe(from);
        expect(after.status_changed_at).toBe(before.status_changed_at);
      });
    }
  }

  it('throws IllegalTransitionError when no consumption row exists', () => {
    expect(() => setConsumptionStatus('missing_id', 'saved')).toThrow(
      IllegalTransitionError,
    );
  });
});

describe('recordProgress', () => {
  it('start auto-promotes inbox → saved → in_progress atomically', () => {
    seedVideo('inbox');
    recordProgress({ videoId: VIDEO_ID, action: 'start' });
    expect(readConsumption().status).toBe('in_progress');
  });

  it('start promotes saved → in_progress', () => {
    seedVideo('saved');
    recordProgress({ videoId: VIDEO_ID, action: 'start' });
    expect(readConsumption().status).toBe('in_progress');
  });

  it('start promotes archived → in_progress', () => {
    seedVideo('archived');
    recordProgress({ videoId: VIDEO_ID, action: 'start' });
    expect(readConsumption().status).toBe('in_progress');
  });

  it('start no-ops on dismissed', () => {
    seedVideo('dismissed');
    recordProgress({ videoId: VIDEO_ID, action: 'start' });
    expect(readConsumption().status).toBe('dismissed');
  });

  it('tick writes last_position_seconds', () => {
    seedVideo('in_progress');
    recordProgress({ videoId: VIDEO_ID, action: 'tick', position: 42 });
    expect(readConsumption().last_position_seconds).toBe(42);
  });

  it('pause writes last_position_seconds', () => {
    seedVideo('in_progress');
    recordProgress({ videoId: VIDEO_ID, action: 'pause', position: 137 });
    expect(readConsumption().last_position_seconds).toBe(137);
  });

  it('end auto-archives in_progress and clears last_position_seconds', () => {
    seedVideo('in_progress');
    recordProgress({ videoId: VIDEO_ID, action: 'tick', position: 99 });
    expect(readConsumption().last_position_seconds).toBe(99);
    recordProgress({ videoId: VIDEO_ID, action: 'end' });
    const after = readConsumption();
    expect(after.status).toBe('archived');
    expect(after.last_position_seconds).toBeNull();
  });

  it('end is a no-op when status is not in_progress', () => {
    seedVideo('saved');
    recordProgress({ videoId: VIDEO_ID, action: 'end' });
    expect(readConsumption().status).toBe('saved');
  });
});
