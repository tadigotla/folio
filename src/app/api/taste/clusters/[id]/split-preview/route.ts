import type { NextRequest } from 'next/server';
import { previewSplit } from '../../../../../../lib/taste-edit';
import { mapEditError, parseClusterId } from '../../../_helpers';

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseClusterId(raw);
  if (id == null) {
    return Response.json({ error: 'invalid cluster id' }, { status: 400 });
  }

  const url = new URL(request.url);
  const ksParam = url.searchParams.get('k');
  let ks: number[];
  if (ksParam) {
    const parsed = ksParam
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 2 && n <= 10);
    if (parsed.length === 0) {
      return Response.json({ error: 'invalid k' }, { status: 400 });
    }
    ks = parsed;
  } else {
    ks = [2, 3, 4, 5];
  }

  try {
    const previews = previewSplit(id, ks);
    return Response.json({ previews }, { status: 200 });
  } catch (err) {
    const mapped = mapEditError(err);
    if (mapped) return mapped;
    throw err;
  }
}
