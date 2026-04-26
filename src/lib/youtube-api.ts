import {
  forceRefresh,
  getAccessToken,
  TokenRevokedError,
} from './youtube-oauth';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export class YouTubeApiKeyMissingError extends Error {
  constructor() {
    super('YOUTUBE_API_KEY is not set');
    this.name = 'YouTubeApiKeyMissingError';
  }
}

export class YouTubeDataApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`YouTube Data API ${status}: ${body.slice(0, 240)}`);
    this.name = 'YouTubeDataApiError';
    this.status = status;
    this.body = body;
  }
}

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

// --- Key-based Data API helpers ------------------------------------------
//
// Used by the active-discovery surfaces (search_youtube tool + approve flow).
// These endpoints accept a key= query param instead of an OAuth bearer token,
// so they bypass the OAuth refresh flow above.

const DATA_API_TIMEOUT_MS = 10_000;

export async function dataApiGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new YouTubeApiKeyMissingError();

  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DATA_API_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text();
      throw new YouTubeDataApiError(res.status, body);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const ISO_DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

function parseIso8601Duration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = ISO_DURATION_RE.exec(s);
  if (!m) return undefined;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const mins = Number(m[3] ?? 0);
  const secs = Number(m[4] ?? 0);
  return days * 86400 + hours * 3600 + mins * 60 + secs;
}

interface VideoListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      channelId?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    contentDetails?: { duration?: string };
  }>;
}

export async function fetchVideoMetadata(
  videoId: string,
): Promise<NormalizedYouTubeVideo> {
  const body = await dataApiGet<VideoListResponse>('videos', {
    part: 'snippet,contentDetails',
    id: videoId,
  });
  const item = body.items?.[0];
  if (!item) {
    throw new YouTubeDataApiError(404, `video not found: ${videoId}`);
  }
  const snippet = item.snippet ?? {};
  const channelId = snippet.channelId ?? '';
  if (!channelId) {
    throw new YouTubeDataApiError(
      502,
      `video ${videoId} returned no channelId`,
    );
  }
  return {
    videoId,
    title: snippet.title ?? '',
    description: snippet.description ?? '',
    channelId,
    channelName: snippet.channelTitle ?? '',
    publishedAt: snippet.publishedAt ?? '',
    durationSeconds: parseIso8601Duration(item.contentDetails?.duration),
    thumbnailUrl: pickThumb(snippet.thumbnails),
  };
}

interface ChannelListResponseFull {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
  }>;
}

export interface NormalizedChannelLookup {
  channelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
}

export async function fetchChannelByIdOrHandle(
  idOrHandle: string,
): Promise<NormalizedChannelLookup> {
  const params: Record<string, string> = { part: 'snippet' };
  if (idOrHandle.startsWith('@')) {
    params.forHandle = idOrHandle;
  } else {
    params.id = idOrHandle;
  }
  const body = await dataApiGet<ChannelListResponseFull>('channels', params);
  const item = body.items?.[0];
  if (!item || !item.id) {
    throw new YouTubeDataApiError(404, `channel not found: ${idOrHandle}`);
  }
  const snippet = item.snippet ?? {};
  const customUrl = snippet.customUrl ?? null;
  const handle = customUrl && customUrl.startsWith('@') ? customUrl : null;
  return {
    channelId: item.id,
    title: snippet.title ?? '',
    handle,
    thumbnailUrl: pickThumb(snippet.thumbnails) ?? null,
  };
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
