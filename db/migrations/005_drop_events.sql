-- Final cleanup: drop pre-pivot tables and non-YouTube source rows.
-- Must run AFTER 004_backfill_from_events.sql has copied YT data into `videos`.

-- Drop child tables first to respect FK constraints.
DROP TABLE IF EXISTS picks;
DROP TABLE IF EXISTS watched;
DROP TABLE IF EXISTS events;

-- Remove source rows for fetchers that no longer exist.
DELETE FROM sources WHERE id IN (
  'launch_library_2',
  'cspan_rss',
  'thesportsdb',
  'nasa_ical',
  'explore_org'
);
