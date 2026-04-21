import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import {
  exchangeCodeForTokens,
  upsertToken,
} from '../../../../../lib/youtube-oauth';
import { recordSyncError, syncSubscriptions } from '../../../../../lib/subscription-sync';

const STATE_COOKIE = 'youtube_oauth_state';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const error = params.get('error');
  const code = params.get('code');
  const state = params.get('state');

  const jar = await cookies();
  const cookieState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (error === 'access_denied') {
    redirect('/settings/youtube?error=access_denied');
  }
  if (error) {
    redirect(`/settings/youtube?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return new Response('missing code or state', { status: 400 });
  }
  if (!cookieState || cookieState !== state) {
    return new Response('state mismatch', { status: 400 });
  }

  const tokens = await exchangeCodeForTokens(code);
  upsertToken(tokens);

  try {
    await syncSubscriptions();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordSyncError(message);
    console.error(`Initial subscription sync failed: ${message}`);
  }

  redirect('/settings/youtube?connected=1');
}
