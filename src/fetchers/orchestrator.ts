import { getDb } from '../lib/db';
import { nowUTC } from '../lib/time';
import type { Source } from '../lib/types';
import { getFetcherRegistry } from './registry';

export async function runOrchestrator(): Promise<void> {
  const db = getDb();
  const now = new Date();

  const sources = db
    .prepare(`SELECT * FROM sources WHERE enabled = 1`)
    .all() as Source[];

  const fetcherRegistry = getFetcherRegistry();
  console.log(`Found ${sources.length} enabled sources`);

  const upsertChannel = db.prepare(`
    INSERT INTO channels (id, name, first_seen_at, last_checked_at)
    VALUES (@id, @name, @first_seen_at, @last_checked_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      last_checked_at = excluded.last_checked_at
  `);

  const upsertVideo = db.prepare(`
    INSERT INTO videos (
      id, title, description, channel_id, duration_seconds, published_at,
      thumbnail_url, source_url, is_live_now, scheduled_start,
      discovered_at, last_checked_at, updated_at, first_seen_at, raw
    ) VALUES (
      @id, @title, @description, @channel_id, @duration_seconds, @published_at,
      @thumbnail_url, @source_url, @is_live_now, @scheduled_start,
      @discovered_at, @last_checked_at, @updated_at, @first_seen_at, @raw
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      channel_id = excluded.channel_id,
      duration_seconds = COALESCE(excluded.duration_seconds, videos.duration_seconds),
      published_at = COALESCE(excluded.published_at, videos.published_at),
      thumbnail_url = COALESCE(excluded.thumbnail_url, videos.thumbnail_url),
      is_live_now = excluded.is_live_now,
      scheduled_start = excluded.scheduled_start,
      last_checked_at = excluded.last_checked_at,
      updated_at = excluded.updated_at,
      raw = excluded.raw
  `);

  const insertConsumption = db.prepare(`
    INSERT OR IGNORE INTO consumption (video_id, status, status_changed_at)
    VALUES (?, 'inbox', ?)
  `);

  for (const source of sources) {
    if (source.last_fetched_at) {
      const lastFetched = new Date(source.last_fetched_at);
      const elapsed = (now.getTime() - lastFetched.getTime()) / 60_000;
      if (elapsed < source.min_interval_minutes) {
        console.log(
          `Skipping ${source.id} — fetched ${Math.round(elapsed)}m ago (interval: ${source.min_interval_minutes}m)`,
        );
        continue;
      }
    }

    const fetcher = fetcherRegistry[source.id];
    if (!fetcher) {
      console.log(`No fetcher registered for ${source.id}, skipping`);
      continue;
    }

    console.log(`Fetching ${source.id}...`);
    try {
      const videos = await fetcher.fetch();
      console.log(`  Got ${videos.length} videos`);

      const timestamp = nowUTC();

      const run = db.transaction(() => {
        for (const video of videos) {
          upsertChannel.run({
            id: video.channelId,
            name: video.channelName,
            first_seen_at: timestamp,
            last_checked_at: timestamp,
          });

          upsertVideo.run({
            id: video.videoId,
            title: video.title,
            description: video.description ?? null,
            channel_id: video.channelId,
            duration_seconds: video.durationSeconds ?? null,
            published_at: video.publishedAt,
            thumbnail_url: video.thumbnailUrl ?? null,
            source_url: `https://www.youtube.com/watch?v=${video.videoId}`,
            is_live_now: video.isLiveNow ? 1 : 0,
            scheduled_start: video.scheduledStart ?? null,
            discovered_at: timestamp,
            last_checked_at: timestamp,
            updated_at: timestamp,
            first_seen_at: timestamp,
            raw: JSON.stringify(video.raw),
          });

          insertConsumption.run(video.videoId, timestamp);
        }
      });

      run();

      db.prepare(
        `UPDATE sources SET last_fetched_at = ?, last_error = NULL WHERE id = ?`,
      ).run(timestamp, source.id);

      console.log(`  Upserted ${videos.length} videos for ${source.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Error fetching ${source.id}: ${message}`);
      db.prepare(
        `UPDATE sources SET last_fetched_at = ?, last_error = ? WHERE id = ?`,
      ).run(nowUTC(), message, source.id);
    }
  }

  console.log('Orchestrator run complete');
}
