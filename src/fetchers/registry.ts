import type { Fetcher } from '../lib/types';
import { getDb } from '../lib/db';
import {
  youtubeCultureFetcher,
  youtubePhilosophyFetcher,
  youtubeSpaceFetcher,
  youtubeNewsFetcher,
  youtubeNatureFetcher,
  createYouTubeChannelFetcher,
} from './youtube-channel';

const staticRegistry: Record<string, Fetcher> = {
  youtube_culture: youtubeCultureFetcher,
  youtube_philosophy: youtubePhilosophyFetcher,
  youtube_space: youtubeSpaceFetcher,
  youtube_news: youtubeNewsFetcher,
  youtube_nature: youtubeNatureFetcher,
};

export function getFetcherRegistry(): Record<string, Fetcher> {
  const registry = { ...staticRegistry };

  // Dynamically register user-added YouTube channel sources
  const db = getDb();
  const userSources = db
    .prepare(
      `SELECT id FROM sources WHERE kind = 'youtube_channel' AND id LIKE '%_user' AND enabled = 1`,
    )
    .all() as Array<{ id: string }>;

  for (const source of userSources) {
    if (!registry[source.id]) {
      registry[source.id] = createYouTubeChannelFetcher(source.id);
    }
  }

  return registry;
}

export const fetcherRegistry = staticRegistry;
