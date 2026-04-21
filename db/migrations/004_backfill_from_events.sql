-- Backfill the new schema from the old one.
-- The old events.raw for YouTube entries has shape
--   { videoId, title, published, channelName }
-- so channel identity must be reconstructed by matching channelName against
-- each source's config.channels list (which does carry the YouTube channel ID).
-- Names that cannot be matched fall back to a `legacy-<name>` placeholder row.

-- 1) Seed `channels` from every YouTube source's config.
INSERT OR IGNORE INTO channels (id, name, first_seen_at, last_checked_at)
SELECT
  json_extract(ch.value, '$.id')   AS id,
  json_extract(ch.value, '$.name') AS name,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM sources s,
     json_each(json_extract(s.config, '$.channels')) ch
WHERE s.kind = 'youtube_channel';

-- 2) For any channelName that appears in events.raw but not in channels,
--    create a `legacy-<name>` placeholder so every video can be attached
--    to a channel row. Later fetches will insert the real UC row and the
--    video will keep referencing the legacy one until re-ingested.
INSERT OR IGNORE INTO channels (id, name, first_seen_at, last_checked_at)
SELECT
  'legacy-' || json_extract(e.raw, '$.channelName'),
  json_extract(e.raw, '$.channelName'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM events e
WHERE e.source_id LIKE 'youtube_%'
  AND json_extract(e.raw, '$.channelName') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM channels c
    WHERE c.name = json_extract(e.raw, '$.channelName')
  );

-- 3) Copy YouTube-sourced `events` rows into `videos`.
--    Deduplicate by most-recent `updated_at`: INSERT OR REPLACE means the last
--    row inserted wins, so we order ASC to make the freshest row land last.
INSERT OR REPLACE INTO videos (
  id,
  title,
  description,
  channel_id,
  duration_seconds,
  published_at,
  thumbnail_url,
  source_url,
  is_live_now,
  scheduled_start,
  discovered_at,
  last_checked_at,
  updated_at,
  first_seen_at,
  raw
)
SELECT
  json_extract(e.raw, '$.videoId')                                  AS id,
  e.title,
  NULL                                                              AS description,
  COALESCE(c.id, 'legacy-' || json_extract(e.raw, '$.channelName')) AS channel_id,
  NULL                                                              AS duration_seconds,
  e.starts_at                                                       AS published_at,
  e.thumbnail_url,
  e.source_url,
  0                                                                 AS is_live_now,
  NULL                                                              AS scheduled_start,
  e.first_seen_at                                                   AS discovered_at,
  e.last_checked_at,
  e.updated_at,
  e.first_seen_at,
  e.raw
FROM events e
LEFT JOIN channels c ON c.name = json_extract(e.raw, '$.channelName')
WHERE e.source_id LIKE 'youtube_%'
  AND json_extract(e.raw, '$.videoId') IS NOT NULL
ORDER BY e.updated_at ASC;

-- 4) Create consumption rows for every migrated video, defaulting to inbox.
INSERT OR IGNORE INTO consumption (video_id, status, status_changed_at)
SELECT id, 'inbox', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM videos;

-- 5) Promote anything in the old `watched` table to status = 'archived'.
--    The old watched.event_id was `${source_id}:${videoId}`; strip the prefix.
UPDATE consumption
   SET status = 'archived',
       last_viewed_at = (SELECT watched_at FROM watched w WHERE substr(w.event_id, instr(w.event_id, ':') + 1) = consumption.video_id LIMIT 1),
       status_changed_at = (SELECT watched_at FROM watched w WHERE substr(w.event_id, instr(w.event_id, ':') + 1) = consumption.video_id LIMIT 1)
 WHERE video_id IN (
    SELECT substr(event_id, instr(event_id, ':') + 1) FROM watched
 );
