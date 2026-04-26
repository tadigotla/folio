import type { NextRequest } from 'next/server';
import { dismissCandidate } from '../../../../../../lib/discovery/dismiss';
import { CandidateNotFoundError } from '../../../../../../lib/discovery/errors';

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json(
      { error: 'invalid id', code: 'invalid_payload' },
      { status: 400 },
    );
  }
  try {
    dismissCandidate(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof CandidateNotFoundError) {
      return Response.json(
        { error: err.message, code: 'candidate_not_found' },
        { status: 404 },
      );
    }
    throw err;
  }
}
