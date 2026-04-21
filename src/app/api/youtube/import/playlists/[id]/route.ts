import { getStoredToken, TokenRevokedError } from '../../../../../../lib/youtube-oauth';
import {
  importPlaylist,
  PlaylistNotFoundError,
} from '../../../../../../lib/youtube-import';

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!getStoredToken()) {
    return Response.json({ needs_reconnect: true }, { status: 409 });
  }
  const { id } = await ctx.params;
  try {
    const counts = await importPlaylist(id);
    return Response.json(counts, { status: 200 });
  } catch (err) {
    if (err instanceof PlaylistNotFoundError) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (err instanceof TokenRevokedError) {
      return Response.json({ needs_reconnect: true }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
