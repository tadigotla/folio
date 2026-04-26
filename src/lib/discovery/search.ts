import {
  dataApiGet,
  YouTubeApiKeyMissingError,
  YouTubeDataApiError,
} from '../youtube-api';

export { YouTubeApiKeyMissingError, YouTubeDataApiError };

export interface SearchResult {
  kind: 'video' | 'channel';
  target_id: string;
  title: string;
  channel_name: string | null;
}

interface SearchListResponse {
  items?: Array<{
    id?: { kind?: string; videoId?: string; channelId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
    };
  }>;
}

export async function searchYoutube(input: {
  query: string;
  channelId?: string;
  maxResults?: number;
}): Promise<SearchResult[]> {
  const requested = input.maxResults ?? 10;
  const clamped = Math.max(1, Math.min(25, Math.floor(requested)));

  const params: Record<string, string> = {
    part: 'snippet',
    type: 'video,channel',
    q: input.query,
    maxResults: String(clamped),
  };
  if (input.channelId) params.channelId = input.channelId;

  const body = await dataApiGet<SearchListResponse>('search', params);
  const out: SearchResult[] = [];
  for (const item of body.items ?? []) {
    const idKind = item.id?.kind;
    const snippet = item.snippet ?? {};
    if (idKind === 'youtube#video' && item.id?.videoId) {
      out.push({
        kind: 'video',
        target_id: item.id.videoId,
        title: snippet.title ?? '',
        channel_name: snippet.channelTitle ?? null,
      });
    } else if (idKind === 'youtube#channel' && item.id?.channelId) {
      out.push({
        kind: 'channel',
        target_id: item.id.channelId,
        title: snippet.title ?? '',
        channel_name: snippet.channelTitle ?? null,
      });
    }
  }
  return out;
}
