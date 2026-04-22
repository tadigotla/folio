import type { TurnContentBlock, TurnRole } from '../../lib/types';

export interface RenderedTurn {
  id: number;
  role: TurnRole;
  blocks: TurnContentBlock[];
  createdAt: string;
}

/**
 * In-flight assistant turn: exists in the UI before the server persists it.
 * After `done` we replace any trailing pending turn with the persisted one
 * (refetched) on the next hydration — or keep the pending turn if we don't
 * refetch, since the block contents are identical.
 */
export interface PendingTurn {
  pendingId: string;
  role: 'assistant' | 'tool';
  blocks: TurnContentBlock[];
  traces: ToolTrace[];
}

export interface ToolTrace {
  tool_use_id: string;
  name: string;
  args: Record<string, unknown>;
  result?: {
    ok: boolean;
    summary: string;
  };
}
