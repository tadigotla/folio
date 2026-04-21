import {
  OAuthRefreshError,
  getStoredToken,
  refreshAccessToken,
  upsertToken,
  type StoredToken,
} from './youtube-oauth';

const SUBSCRIPTIONS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/subscriptions';
const REFRESH_WINDOW_MS = 60 * 1000;

async function getFreshAccessToken(): Promise<string> {
  const stored = getStoredToken();
  if (!stored) throw new OAuthRefreshError('other', 'Not connected to YouTube');

  const expiresAt = new Date(stored.expires_at).getTime();
  if (expiresAt - Date.now() > REFRESH_WINDOW_MS) {
    return stored.access_token;
  }

  if (!stored.refresh_token) {
    throw new OAuthRefreshError('other', 'Access token expired and no refresh token on file');
  }

  const refreshed = await refreshAccessToken(stored.refresh_token);
  const next: StoredToken = upsertToken(refreshed);
  return next.access_token;
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

export interface SubscribedChannel {
  channelId: string;
  title: string;
}

export async function listSubscriptions(): Promise<SubscribedChannel[]> {
  const out: SubscribedChannel[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  do {
    const accessToken = await getFreshAccessToken();
    const url = new URL(SUBSCRIPTIONS_ENDPOINT);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`YouTube subscriptions.list failed: ${res.status} ${text}`);
    }
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
