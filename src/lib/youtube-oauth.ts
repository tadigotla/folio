import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { nowUTC } from './time';

export const REDIRECT_URI = 'http://localhost:6060/api/youtube/oauth/callback';
export const EXPECTED_PORT = '6060';
export const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REFRESH_WINDOW_MS = 60 * 1000;

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

export class TokenRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenRevokedError';
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

export async function exchangeCode(code: string): Promise<TokenResponse> {
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

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const clientId = requireEnv('YOUTUBE_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('YOUTUBE_OAUTH_CLIENT_SECRET');

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    let payload: { error?: string } = {};
    try {
      payload = JSON.parse(text);
    } catch {}
    if (payload.error === 'invalid_grant') {
      throw new TokenRevokedError(`Refresh rejected: ${text}`);
    }
    throw new Error(`Refresh failed: ${res.status} ${text}`);
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

export function disconnect(): void {
  const db = getDb();
  db.prepare(`DELETE FROM oauth_tokens WHERE provider = 'youtube'`).run();
}

export async function getAccessToken(): Promise<string> {
  const stored = getStoredToken();
  if (!stored) throw new TokenRevokedError('Not connected to YouTube');

  const expiresAt = new Date(stored.expires_at).getTime();
  if (expiresAt - Date.now() > REFRESH_WINDOW_MS) {
    return stored.access_token;
  }

  if (!stored.refresh_token) {
    throw new TokenRevokedError('Access token expired and no refresh token on file');
  }

  const refreshed = await refreshAccessToken(stored.refresh_token);
  const next = upsertToken(refreshed);
  return next.access_token;
}

export async function forceRefresh(): Promise<string> {
  const stored = getStoredToken();
  if (!stored || !stored.refresh_token) {
    throw new TokenRevokedError('No refresh token on file');
  }
  const refreshed = await refreshAccessToken(stored.refresh_token);
  const next = upsertToken(refreshed);
  return next.access_token;
}

function getOrCreateStateSecret(): string {
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM app_secrets WHERE key = 'oauth_state'`)
    .get() as { value: string } | undefined;
  if (row) return row.value;

  const secret = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO app_secrets (key, value, created_at) VALUES ('oauth_state', ?, ?)
     ON CONFLICT(key) DO NOTHING`,
  ).run(secret, nowUTC());
  const final = db
    .prepare(`SELECT value FROM app_secrets WHERE key = 'oauth_state'`)
    .get() as { value: string };
  return final.value;
}

export function signState(state: string, expiryUnix: number): string {
  const secret = getOrCreateStateSecret();
  const mac = createHmac('sha256', secret)
    .update(`${state}.${expiryUnix}`)
    .digest('hex');
  return `${state}.${expiryUnix}.${mac}`;
}

export function verifyState(cookieValue: string | undefined, providedState: string): boolean {
  if (!cookieValue) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;
  const [state, expiryStr, mac] = parts;
  if (state !== providedState) return false;
  const expiryUnix = Number(expiryStr);
  if (!Number.isFinite(expiryUnix)) return false;
  if (Date.now() / 1000 > expiryUnix) return false;

  const expected = createHmac('sha256', getOrCreateStateSecret())
    .update(`${state}.${expiryUnix}`)
    .digest('hex');
  const a = Buffer.from(mac, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function assertExpectedPort(): void {
  const port = process.env.PORT ?? EXPECTED_PORT;
  if (port !== EXPECTED_PORT) {
    throw new Error(
      `OAuth redirect URI is hardcoded to port ${EXPECTED_PORT} but the app is running on port ${port}. ` +
        `See RUNBOOK.md § YouTube OAuth for how to update Google Cloud Console if you change ports.`,
    );
  }
}
