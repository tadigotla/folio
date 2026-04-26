import type { TurnContentBlock, TurnRole } from '../../lib/types';

export interface RenderedTurn {
  id: number;
  role: TurnRole;
  blocks: TurnContentBlock[];
  createdAt: string;
}

export interface PendingTurn {
  pendingId: string;
  role: 'assistant' | 'tool';
  blocks: TurnContentBlock[];
  traces: ToolTrace[];
}

export type ToolEnvelope =
  | { ok: true; result: unknown }
  | {
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };

export interface ToolTrace {
  tool_use_id: string;
  name: string;
  args: Record<string, unknown>;
  result?: ToolEnvelope;
}
