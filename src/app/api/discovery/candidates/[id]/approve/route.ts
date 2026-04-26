import type { NextRequest } from 'next/server';
import { approveCandidate } from '../../../../../../lib/discovery/approve';
import { CandidateNotFoundError } from '../../../../../../lib/discovery/errors';
import {
  YouTubeApiKeyMissingError,
  YouTubeDataApiError,
} from '../../../../../../lib/youtube-api';

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
    const result = await approveCandidate(id);
    return Response.json(result);
  } catch (err) {
    if (err instanceof CandidateNotFoundError) {
      return Response.json(
        { error: err.message, code: 'candidate_not_found' },
        { status: 404 },
      );
    }
    if (err instanceof YouTubeApiKeyMissingError) {
      return Response.json(
        {
          error:
            'YOUTUBE_API_KEY not set. See RUNBOOK "Discovery (active)" for setup.',
          code: 'youtube_api_key_missing',
        },
        { status: 412 },
      );
    }
    if (err instanceof YouTubeDataApiError) {
      return Response.json(
        {
          error: err.message,
          code: 'youtube_data_api_error',
          upstreamStatus: err.status,
        },
        { status: 502 },
      );
    }
    throw err;
  }
}
