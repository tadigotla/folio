import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getConversationTurnsForDate,
  turnsToRendered,
} from '../../../../../lib/agent/turns';

export const dynamic = 'force-dynamic';

const ScopeDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must match YYYY-MM-DD')
  .refine(
    (s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()),
    'invalid calendar date',
  );

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ date: string }> },
) {
  const { date } = await ctx.params;
  const parsed = ScopeDate.safeParse(date);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'validation',
          message: parsed.error.issues
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; '),
          details: parsed.error.issues,
        },
      },
      { status: 400 },
    );
  }
  const turns = getConversationTurnsForDate(parsed.data);
  return Response.json({ turns: turnsToRendered(turns) }, { status: 200 });
}
