import { getDb, runMigrations } from '../src/lib/db';

runMigrations();

const db = getDb();

// YouTube RSS sources. Each source polls a list of channels at
// min_interval_minutes cadence. Since the pivot to a video library, the
// non-YouTube fetchers (Launch Library, C-SPAN, NASA iCal, TheSportsDB,
// Explore.org) have been removed; only YouTube channel sources remain.
const sources = [
  {
    id: 'youtube_space',
    name: 'Space YouTube Channels',
    kind: 'youtube_channel',
    config: JSON.stringify({
      channels: [
        { id: 'UCtI0Hodo5o5dUb67FeUjDeA', name: 'SpaceX' },
        { id: 'UC6uKrU_WqJ1R2HMTY3LIx5Q', name: 'Everyday Astronaut' },
        { id: 'UCLA_DiR1FfKNvjuUpBHmylQ', name: 'NASA' },
      ],
      rss_base: 'https://www.youtube.com/feeds/videos.xml?channel_id=',
    }),
    min_interval_minutes: 30,
  },
  {
    id: 'youtube_news',
    name: 'News YouTube Channels',
    kind: 'youtube_channel',
    config: JSON.stringify({
      channels: [
        { id: 'UC6ZFN9Tx6xh-skXCuRHCDpQ', name: 'PBS NewsHour' },
        { id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', name: 'Al Jazeera English' },
        { id: 'UCknLrEdhRCp1aegoMqRaCZg', name: 'DW News' },
        { id: 'UChqUTb7kYRX8-EiaN3XFrSQ', name: 'Reuters' },
        { id: 'UC16niRr50-MSBwiO3YDb3RA', name: 'BBC News' },
        { id: 'UCJnS2EsPfv46u1JR8cnD0NA', name: 'NPR' },
      ],
      rss_base: 'https://www.youtube.com/feeds/videos.xml?channel_id=',
    }),
    min_interval_minutes: 30,
  },
  {
    id: 'youtube_nature',
    name: 'Nature YouTube Channels',
    kind: 'youtube_channel',
    config: JSON.stringify({
      channels: [
        { id: 'UCwmZiChSryoWQCZMIQezgTg', name: 'BBC Earth' },
        { id: 'UCpVm7bg6pXKo1Pr6k5kxG9A', name: 'National Geographic' },
      ],
      rss_base: 'https://www.youtube.com/feeds/videos.xml?channel_id=',
    }),
    min_interval_minutes: 30,
  },
  {
    id: 'youtube_culture',
    name: 'Culture YouTube Channels',
    kind: 'youtube_channel',
    config: JSON.stringify({
      channels: [
        { id: 'UC4eYXhJI4-7wSWc8UNRwD4A', name: 'NPR Tiny Desk' },
        { id: 'UC3I2GFN_F8WudD_2jUZbojA', name: 'KEXP' },
        { id: 'UCGBpxWJr9FNOcFYA5GkKrMg', name: 'Boiler Room' },
        { id: 'UC2Qw1dzXDBAZPwS7zm37g8g', name: 'COLORS' },
        { id: 'UCRLZb8PpI9N7COmYqHiDH7A', name: 'Sofar Sounds' },
      ],
      rss_base: 'https://www.youtube.com/feeds/videos.xml?channel_id=',
    }),
    min_interval_minutes: 30,
  },
  {
    id: 'youtube_philosophy',
    name: 'Philosophy YouTube Channels',
    kind: 'youtube_channel',
    config: JSON.stringify({
      channels: [
        { id: 'UCNAxrHudMfdzNi6NxruKPLw', name: 'Sam Harris' },
        { id: 'UCxXWjjtATq3OM545gMh9PUg', name: 'Rupert Spira' },
        { id: 'UCzWwWbbKHg4aodl0S35R6XA', name: 'Hoover Institution' },
        { id: 'UCl9StMQ79LtEvlrskzjoYbQ', name: 'Closer To Truth' },
        { id: 'UCSHZKyawb77ixDdsGog4iWA', name: 'Lex Fridman' },
        { id: 'UCsooa4yRKGN_zEE8iknghZA', name: 'TED-Ed' },
        { id: 'UCYO_jab_esuFRV4b17AJtAw', name: '3Blue1Brown' },
        { id: 'UC7IcJI8PUf5Z3zKxnZvTBog', name: 'The School of Life' },
        { id: 'UCLXo7UDZvByw2ixzpQCufnA', name: 'Waking Up' },
        { id: 'UCiRiQGCHGjDLT9FQXFW0I3A', name: 'Academy of Ideas' },
      ],
      rss_base: 'https://www.youtube.com/feeds/videos.xml?channel_id=',
    }),
    min_interval_minutes: 30,
  },
];

const stmt = db.prepare(`
  INSERT INTO sources (id, name, kind, config, enabled, min_interval_minutes)
  VALUES (@id, @name, @kind, @config, 1, @min_interval_minutes)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    kind = excluded.kind,
    config = excluded.config,
    min_interval_minutes = excluded.min_interval_minutes
`);

const insertAll = db.transaction(() => {
  for (const source of sources) {
    stmt.run(source);
  }
});

insertAll();

console.log(`Seeded ${sources.length} sources.`);

const rows = db.prepare('SELECT id, name, min_interval_minutes FROM sources').all();
console.table(rows);
