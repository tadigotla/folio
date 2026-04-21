import { getDb } from './db';

export const REDIRECT_URI = 'http://localhost:6060/api/youtube/oauth/callback';
export const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

export interface StoredToken {
  provider: 'youtube';
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope: string | null;
  updated_at: string;
}

export class OAuthRefreshError extends Error {
  readonly code: 'invalid_grant' | 'network' | 'other';
  constructor(code: 'invalid_grant' | 'network' | 'other', message: string) {
    super(message);
    this.name = 'OAuthRefreshError';
    this.code = code;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} — see RUNBOOK.md § YouTube OAuth`);
  return value;
}

export function buildAuthorizeUrl(state: string): string {
  const clientId = requireEnv('YOUTUBE_OAUTH_CLIENT_ID');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientId = requireEnv('YOUTUBE_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('YOUTUBE_OAUTH_CLIENT_SECRET');

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  let clientId: string;
  let clientSecret: string;
  try {
    clientId = requireEnv('YOUTUBE_OAUTH_CLIENT_ID');
    clientSecret = requireEnv('YOUTUBE_OAUTH_CLIENT_SECRET');
  } catch (err) {
    throw new OAuthRefreshError('other', err instanceof Error ? err.message : String(err));
  }

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    throw new OAuthRefreshError('network', err instanceof Error ? err.message : String(err));
  }

  if (!res.ok) {
    const text = await res.text();
    let payload: { error?: string } = {};
    try {
      payload = JSON.parse(text);
    } catch {}
    if (payload.error === 'invalid_grant') {
      throw new OAuthRefreshError('invalid_grant', `Refresh rejected: ${text}`);
    }
    throw new OAuthRefreshError('other', `Refresh failed: ${res.status} ${text}`);
  }

  return (await res.json()) as TokenResponse;
}

export function getStoredToken(): StoredToken | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT provider, access_token, refresh_token, expires_at, scope, updated_at
              FROM oauth_tokens WHERE provider = 'youtube'`)
    .get() as StoredToken | undefined;
  if (!row || !row.access_token) return null;
  return row;
}

export function upsertToken(tokens: TokenResponse): StoredToken {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + tokens.expires_in * 1000).toISOString();
  const updatedAt = now.toISOString();

  const existing = getStoredToken();
  const refreshToken = tokens.refresh_token ?? existing?.refresh_token ?? null;

  db.prepare(`
    INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, scope, updated_at)
    VALUES ('youtube', @access_token, @refresh_token, @expires_at, @scope, @updated_at)
    ON CONFLICT(provider) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run({
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    scope: tokens.scope,
    updated_at: updatedAt,
  });

  return {
    provider: 'youtube',
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    scope: tokens.scope,
    updated_at: updatedAt,
  };
}

export function deleteStoredToken(): void {
  const db = getDb();
  db.prepare(`DELETE FROM oauth_tokens WHERE provider = 'youtube'`).run();
}
