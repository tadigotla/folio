import type { NextRequest } from 'next/server';
import {
  getConversationTurnsForDate,
  isScopeDate,
  turnsToRendered,
} from '../../../../../lib/agent/turns';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ date: string }> },
) {
  const { date } = await ctx.params;
  if (!isScopeDate(date)) {
    return Response.json({ error: 'invalid_date' }, { status: 400 });
  }
  const turns = getConversationTurnsForDate(date);
  return Response.json({ turns: turnsToRendered(turns) }, { status: 200 });
}
