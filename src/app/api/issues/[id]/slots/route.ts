import type { NextRequest } from 'next/server';
import {
  assignSlot,
  clearSlot,
  swapSlots,
  getIssueSlots,
  getInboxPool,
  getIssueById,
  InvalidSlotError,
  IssueFrozenError,
  IssueNotFoundError,
  SlotOccupiedError,
  VideoAlreadyOnIssueError,
  type SwapFrom,
} from '../../../../../lib/issues';
import type { SlotKind } from '../../../../../lib/types';

const VALID_KINDS: SlotKind[] = ['cover', 'featured', 'brief'];

function invalid(): Response {
  return Response.json({ error: 'invalid_payload' }, { status: 400 });
}

function isSlotKind(v: unknown): v is SlotKind {
  return typeof v === 'string' && VALID_KINDS.includes(v as SlotKind);
}

function parseIssueId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const issueId = parseIssueId(rawId);
  if (issueId == null) return invalid();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const action = payload.action;

  try {
    if (action === 'assign') {
      const { videoId, kind, index } = payload;
      if (
        typeof videoId !== 'string' ||
        !videoId ||
        !isSlotKind(kind) ||
        typeof index !== 'number' ||
        !Number.isInteger(index)
      ) {
        return invalid();
      }
      assignSlot(issueId, videoId, kind, index);
    } else if (action === 'clear') {
      const { kind, index } = payload;
      if (!isSlotKind(kind) || typeof index !== 'number' || !Number.isInteger(index)) {
        return invalid();
      }
      clearSlot(issueId, kind, index);
    } else if (action === 'swap') {
      const { from, to } = payload;
      if (!from || typeof from !== 'object' || !to || typeof to !== 'object') {
        return invalid();
      }
      const t = to as Record<string, unknown>;
      if (!isSlotKind(t.kind) || typeof t.index !== 'number' || !Number.isInteger(t.index)) {
        return invalid();
      }
      const f = from as Record<string, unknown>;
      let swapFrom: SwapFrom;
      if (typeof f.pool === 'string' && f.pool) {
        swapFrom = { pool: f.pool };
      } else if (isSlotKind(f.kind) && typeof f.index === 'number' && Number.isInteger(f.index)) {
        swapFrom = { kind: f.kind, index: f.index };
      } else {
        return invalid();
      }
      swapSlots(issueId, swapFrom, { kind: t.kind, index: t.index });
    } else {
      return invalid();
    }
  } catch (err) {
    if (err instanceof InvalidSlotError) {
      return Response.json({ error: 'invalid_slot' }, { status: 400 });
    }
    if (err instanceof IssueFrozenError) {
      return Response.json({ error: 'issue_frozen' }, { status: 409 });
    }
    if (err instanceof IssueNotFoundError) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (err instanceof SlotOccupiedError) {
      return Response.json({ error: 'slot_occupied' }, { status: 409 });
    }
    if (err instanceof VideoAlreadyOnIssueError) {
      return Response.json(
        { error: 'video_already_on_issue' },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }

  const issue = getIssueById(issueId);
  const slots = getIssueSlots(issueId);
  const pool = getInboxPool(issueId);
  return Response.json({ issue, slots, pool }, { status: 200 });
}
