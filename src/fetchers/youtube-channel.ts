import type { Fetcher, NormalizedVideo, Source } from '../lib/types';
import { getDb } from '../lib/db';

interface ChannelConfig {
  id: string;
  name: string;
}

interface YouTubeSourceConfig {
  channels: ChannelConfig[];
  rss_base: string;
}

interface AtomEntry {
  videoId: string;
  channelId: string;
  title: string;
  published: string;
  channelName: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseAtomFeed(xml: string): AtomEntry[] {
  const feedChannelIdMatch = xml.match(/<yt:channelId>([^<]+)<\/yt:channelId>/);
  const feedTitleMatch = xml.match(/<title>([^<]+)<\/title>/);
  const feedChannelId = feedChannelIdMatch?.[1] ?? '';
  const channelName = decodeEntities(feedTitleMatch?.[1] ?? 'Unknown');

  const entries: AtomEntry[] = [];
  const entryBlocks = xml.split('<entry>').slice(1);

  for (const block of entryBlocks) {
    const videoIdMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const entryChannelIdMatch = block.match(/<yt:channelId>([^<]+)<\/yt:channelId>/);
    const titleMatch = block.match(/<title>([^<]+)<\/title>/);
    const publishedMatch = block.match(/<published>([^<]+)<\/published>/);

    if (!videoIdMatch || !titleMatch) continue;

    entries.push({
      videoId: videoIdMatch[1],
      channelId: entryChannelIdMatch?.[1] ?? feedChannelId,
      title: decodeEntities(titleMatch[1]),
      published: publishedMatch?.[1] ?? new Date().toISOString(),
      channelName,
    });
  }

  return entries;
}

export function createYouTubeChannelFetcher(sourceId: string): Fetcher {
  return {
    sourceId,

    async fetch(): Promise<NormalizedVideo[]> {
      const db = getDb();
      const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as Source;
      const config: YouTubeSourceConfig = JSON.parse(source.config as unknown as string);
      const allVideos: NormalizedVideo[] = [];

      for (const channel of config.channels) {
        const feedUrl = `${config.rss_base}${channel.id}`;
        try {
          const res = await fetch(feedUrl);
          if (!res.ok) {
            console.warn(`  YouTube RSS for ${channel.name} returned ${res.status}, skipping`);
            continue;
          }

          const xml = await res.text();
          const entries = parseAtomFeed(xml);

          for (const entry of entries) {
            allVideos.push({
              videoId: entry.videoId,
              title: entry.title,
              channelId: entry.channelId || channel.id,
              channelName: entry.channelName,
              publishedAt: entry.published,
              isLiveNow: false,
              raw: entry,
            });
          }
        } catch (err) {
          console.warn(`  Failed to fetch RSS for ${channel.name}: ${err instanceof Error ? err.message : err}`);
        }
      }

      return allVideos;
    },
  };
}

export const youtubeCultureFetcher = createYouTubeChannelFetcher('youtube_culture');
export const youtubePhilosophyFetcher = createYouTubeChannelFetcher('youtube_philosophy');
export const youtubeSpaceFetcher = createYouTubeChannelFetcher('youtube_space');
export const youtubeNewsFetcher = createYouTubeChannelFetcher('youtube_news');
export const youtubeNatureFetcher = createYouTubeChannelFetcher('youtube_nature');
