import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { buildAuthorizeUrl } from '../../../../../lib/youtube-oauth';

const STATE_COOKIE = 'youtube_oauth_state';

export async function GET() {
  if (!process.env.YOUTUBE_OAUTH_CLIENT_ID) {
    return new Response(
      `YOUTUBE_OAUTH_CLIENT_ID is not set. See RUNBOOK.md § "YouTube OAuth" for setup.`,
      { status: 500, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  const state = randomBytes(32).toString('hex');
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  return Response.redirect(buildAuthorizeUrl(state), 302);
}
