import {
  recordSyncError,
  syncSubscriptions,
} from '../../../../../lib/subscription-sync';
import {
  OAuthRefreshError,
  getStoredToken,
} from '../../../../../lib/youtube-oauth';

export async function POST() {
  if (!getStoredToken()) {
    return Response.json(
      { error: 'not_connected', message: 'Connect YouTube first' },
      { status: 409 },
    );
  }

  try {
    const result = await syncSubscriptions();
    return Response.json(result);
  } catch (err) {
    if (err instanceof OAuthRefreshError) {
      recordSyncError(err.message);
      return Response.json(
        { error: err.code, message: err.message },
        { status: 401 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    recordSyncError(message);
    return Response.json({ error: 'sync_failed', message }, { status: 500 });
  }
}
