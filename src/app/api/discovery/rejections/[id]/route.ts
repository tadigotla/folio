import type { NextRequest } from 'next/server';
import { clearRejection } from '../../../../../lib/discovery/rejections';
import { RejectionNotFoundError } from '../../../../../lib/discovery/errors';

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const targetId = decodeURIComponent(raw);
  if (!targetId) {
    return Response.json(
      { error: 'invalid id', code: 'invalid_payload' },
      { status: 400 },
    );
  }
  try {
    clearRejection(targetId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof RejectionNotFoundError) {
      return Response.json(
        { error: err.message, code: 'rejection_not_found' },
        { status: 404 },
      );
    }
    throw err;
  }
}
