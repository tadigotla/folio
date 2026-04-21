import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import {
  exchangeCode,
  upsertToken,
  verifyState,
} from '../../../../../lib/youtube-oauth';

const STATE_COOKIE = 'youtube_oauth_state';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const error = params.get('error');
  const code = params.get('code');
  const state = params.get('state');

  const jar = await cookies();
  const cookieValue = jar.get(STATE_COOKIE)?.value;

  if (error === 'access_denied') {
    jar.delete(STATE_COOKIE);
    redirect('/settings/youtube?error=access_denied');
  }
  if (error) {
    jar.delete(STATE_COOKIE);
    redirect(`/settings/youtube?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return new Response('missing code or state', { status: 400 });
  }
  if (!verifyState(cookieValue, state)) {
    return new Response('state mismatch or expired', { status: 400 });
  }

  const tokens = await exchangeCode(code);
  upsertToken(tokens);
  jar.delete(STATE_COOKIE);

  redirect('/settings/youtube?connected=1');
}
