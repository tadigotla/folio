import { getStoredToken, TokenRevokedError } from '../../../../../lib/youtube-oauth';
import { listPlaylists } from '../../../../../lib/youtube-import';

export async function GET() {
  if (!getStoredToken()) {
    return Response.json({ needs_reconnect: true }, { status: 409 });
  }
  try {
    const playlists = await listPlaylists();
    return Response.json({ playlists }, { status: 200 });
  } catch (err) {
    if (err instanceof TokenRevokedError) {
      return Response.json({ needs_reconnect: true }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
