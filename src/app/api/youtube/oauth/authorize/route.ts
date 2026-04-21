import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import {
  assertExpectedPort,
  buildAuthorizeUrl,
  signState,
} from '../../../../../lib/youtube-oauth';

const STATE_COOKIE = 'youtube_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function GET() {
  if (!process.env.YOUTUBE_OAUTH_CLIENT_ID) {
    return new Response(
      `YOUTUBE_OAUTH_CLIENT_ID is not set. See RUNBOOK.md § "YouTube OAuth" for setup.`,
      { status: 500, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  try {
    assertExpectedPort();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const state = randomBytes(32).toString('hex');
  const expiry = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const signed = signState(state, expiry);

  const jar = await cookies();
  jar.set(STATE_COOKIE, signed, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_SECONDS,
  });

  return Response.redirect(buildAuthorizeUrl(state), 302);
}
