import {
  forceRefresh,
  getAccessToken,
  TokenRevokedError,
} from './youtube-oauth';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface NormalizedYouTubeVideo {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelName: string;
  publishedAt: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
}

export interface SubscribedChannel {
  channelId: string;
  title: string;
}

export interface UserPlaylist {
  id: string;
  title: string;
  itemCount: number;
  thumbnailUrl: string | null;
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      videoOwnerChannelId?: string;
      videoOwnerChannelTitle?: string;
      channelId?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
      resourceId?: { videoId?: string };
    };
    contentDetails?: {
      videoId?: string;
      videoPublishedAt?: string;
    };
  }>;
  nextPageToken?: string;
}

interface SubscriptionListResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      resourceId?: { channelId?: string };
    };
  }>;
  nextPageToken?: string;
}

interface ChannelListResponse {
  items?: Array<{
    id?: string;
    contentDetails?: {
      relatedPlaylists?: { uploads?: string };
    };
  }>;
}

interface PlaylistListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    contentDetails?: {
      itemCount?: number;
    };
  }>;
  nextPageToken?: string;
}

export async function youtubeFetch(url: string): Promise<Response> {
  let accessToken = await getAccessToken();
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    try {
      accessToken = await forceRefresh();
    } catch (err) {
      if (err instanceof TokenRevokedError) throw err;
      throw err;
    }
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) {
      throw new TokenRevokedError('YouTube API returned 401 after refresh');
    }
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`YouTube API ${res.status}: ${text}`) as Error & {
      status?: number;
      body?: string;
    };
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res;
}

function pickThumb(
  thumbs: Record<string, { url?: string } | undefined> | undefined,
): string | undefined {
  if (!thumbs) return undefined;
  return (
    thumbs.maxres?.url ||
    thumbs.standard?.url ||
    thumbs.high?.url ||
    thumbs.medium?.url ||
    thumbs.default?.url ||
    undefined
  );
}

function mapPlaylistItem(
  item: NonNullable<PlaylistItemsResponse['items']>[number],
): NormalizedYouTubeVideo | null {
  const videoId =
    item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
  if (!videoId) return null;
  const snippet = item.snippet ?? {};
  const channelId =
    snippet.videoOwnerChannelId || snippet.channelId || '';
  if (!channelId) return null;
  const channelName =
    snippet.videoOwnerChannelTitle || snippet.channelTitle || '';
  const publishedAt =
    item.contentDetails?.videoPublishedAt || snippet.publishedAt || '';
  return {
    videoId,
    title: snippet.title ?? '',
    description: snippet.description ?? '',
    channelId,
    channelName,
    publishedAt,
    thumbnailUrl: pickThumb(snippet.thumbnails),
  };
}

async function paginatePlaylistItems(
  playlistId: string,
  options: { limit?: number } = {},
): Promise<NormalizedYouTubeVideo[]> {
  const out: NormalizedYouTubeVideo[] = [];
  const limit = options.limit;
  let pageToken: string | undefined;

  do {
    const url = new URL(`${API_BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await youtubeFetch(url.toString());
    const body = (await res.json()) as PlaylistItemsResponse;

    for (const item of body.items ?? []) {
      const mapped = mapPlaylistItem(item);
      if (!mapped) continue;
      out.push(mapped);
      if (limit !== undefined && out.length >= limit) {
        return out;
      }
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return out;
}

export async function listLikedVideos(): Promise<NormalizedYouTubeVideo[]> {
  return paginatePlaylistItems('LL');
}

export async function listPlaylistItems(
  playlistId: string,
  options: { limit?: number } = {},
): Promise<NormalizedYouTubeVideo[]> {
  return paginatePlaylistItems(playlistId, options);
}

export async function listSubscriptions(): Promise<SubscribedChannel[]> {
  const out: SubscribedChannel[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  do {
    const url = new URL(`${API_BASE}/subscriptions`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await youtubeFetch(url.toString());
    const body = (await res.json()) as SubscriptionListResponse;

    for (const item of body.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      const title = item.snippet?.title ?? '';
      if (!channelId || seen.has(channelId)) continue;
      seen.add(channelId);
      out.push({ channelId, title });
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return out;
}

export async function getChannelUploadsPlaylistId(
  channelId: string,
): Promise<string | null> {
  const url = new URL(`${API_BASE}/channels`);
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('id', channelId);
  const res = await youtubeFetch(url.toString());
  const body = (await res.json()) as ChannelListResponse;
  return body.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
}

export async function listUserPlaylists(): Promise<UserPlaylist[]> {
  const out: UserPlaylist[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${API_BASE}/playlists`);
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await youtubeFetch(url.toString());
    const body = (await res.json()) as PlaylistListResponse;

    for (const item of body.items ?? []) {
      if (!item.id) continue;
      out.push({
        id: item.id,
        title: item.snippet?.title ?? '',
        itemCount: item.contentDetails?.itemCount ?? 0,
        thumbnailUrl: pickThumb(item.snippet?.thumbnails) ?? null,
      });
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return out;
}
