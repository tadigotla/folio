import { getStoredToken, TokenRevokedError } from '../../../../../lib/youtube-oauth';
import { importSubscriptions } from '../../../../../lib/youtube-import';

const DEFAULT_LIMIT = 25;

function readLimit(): number {
  const raw = process.env.YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT;
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return parsed;
}

export async function POST() {
  if (!getStoredToken()) {
    return Response.json({ needs_reconnect: true }, { status: 409 });
  }
  try {
    const counts = await importSubscriptions(readLimit());
    return Response.json(counts, { status: 200 });
  } catch (err) {
    if (err instanceof TokenRevokedError) {
      return Response.json({ needs_reconnect: true }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
