import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { getDb } from '../../../../../lib/db';
import { deleteStoredToken } from '../../../../../lib/youtube-oauth';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const disableSources = form.get('disable_sources') === 'true';

  deleteStoredToken();

  if (disableSources) {
    const db = getDb();
    db.prepare(
      `UPDATE sources SET enabled = 0 WHERE id LIKE 'youtube_channel_%_user'`,
    ).run();
  }

  redirect('/settings/youtube');
}
