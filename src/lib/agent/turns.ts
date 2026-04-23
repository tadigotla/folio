import { getDb } from '../db';
import { nowUTC, todayLocal } from '../time';
import type {
  Conversation,
  ConversationTurn,
  TurnContentBlock,
  TurnRole,
} from '../types';

export class InvalidScopeDateError extends Error {
  scopeDate: string;
  constructor(scopeDate: string) {
    super(`Invalid scope_date: ${scopeDate}`);
    this.name = 'InvalidScopeDateError';
    this.scopeDate = scopeDate;
  }
}

interface ConversationRow {
  id: number;
  scope_date: string;
  created_at: string;
}

interface TurnRow {
  id: number;
  conversation_id: number;
  role: TurnRole;
  content: string;
  tokens_input: number | null;
  tokens_output: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  created_at: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isScopeDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function rowToTurn(row: TurnRow): ConversationTurn {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: JSON.parse(row.content) as TurnContentBlock[],
    tokens_input: row.tokens_input,
    tokens_output: row.tokens_output,
    cache_read_input_tokens: row.cache_read_input_tokens,
    cache_creation_input_tokens: row.cache_creation_input_tokens,
    created_at: row.created_at,
  };
}

/**
 * Returns today's conversation row in America/New_York, creating it if missing.
 */
export function getOrCreateConversationForToday(): Conversation {
  return getOrCreateConversationForDate(todayLocal());
}

export function getOrCreateConversationForDate(scopeDate: string): Conversation {
  if (!isScopeDate(scopeDate)) throw new InvalidScopeDateError(scopeDate);
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM conversations WHERE scope_date = ?')
    .get(scopeDate) as ConversationRow | undefined;
  if (existing) return existing;

  const ts = nowUTC();
  const info = db
    .prepare(
      'INSERT INTO conversations (scope_date, created_at) VALUES (?, ?)',
    )
    .run(scopeDate, ts);
  return {
    id: Number(info.lastInsertRowid),
    scope_date: scopeDate,
    created_at: ts,
  };
}

export function getConversationByDate(scopeDate: string): Conversation | null {
  if (!isScopeDate(scopeDate)) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM conversations WHERE scope_date = ?')
    .get(scopeDate) as ConversationRow | undefined;
  return row ?? null;
}

export function getConversationTurnsForDate(
  scopeDate: string,
): ConversationTurn[] {
  const conv = getConversationByDate(scopeDate);
  if (!conv) return [];
  return getConversationTurnsByConversationId(conv.id);
}

export function getConversationTurnsByConversationId(
  conversationId: number,
): ConversationTurn[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM conversation_turns
        WHERE conversation_id = ?
        ORDER BY id ASC`,
    )
    .all(conversationId) as TurnRow[];
  return rows.map(rowToTurn);
}

export interface TurnUsage {
  tokens_input?: number | null;
  tokens_output?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/**
 * Appends a turn to the conversation. The conversation row is required to
 * exist; per-day uniqueness is enforced by the schema's UNIQUE on scope_date.
 */
export function appendTurn(
  conversationId: number,
  role: TurnRole,
  content: TurnContentBlock[],
  usage?: TurnUsage,
): ConversationTurn {
  const db = getDb();
  return db.transaction((): ConversationTurn => {
    const conv = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(conversationId) as ConversationRow | undefined;
    if (!conv) throw new Error(`conversation ${conversationId} missing`);

    const ts = nowUTC();
    const info = db
      .prepare(
        `INSERT INTO conversation_turns
           (conversation_id, role, content,
            tokens_input, tokens_output,
            cache_read_input_tokens, cache_creation_input_tokens,
            created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversationId,
        role,
        JSON.stringify(content),
        usage?.tokens_input ?? null,
        usage?.tokens_output ?? null,
        usage?.cache_read_input_tokens ?? null,
        usage?.cache_creation_input_tokens ?? null,
        ts,
      );
    return {
      id: Number(info.lastInsertRowid),
      conversation_id: conversationId,
      role,
      content,
      tokens_input: usage?.tokens_input ?? null,
      tokens_output: usage?.tokens_output ?? null,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
      created_at: ts,
    };
  })();
}

export interface SdkMessage {
  role: 'user' | 'assistant';
  content: TurnContentBlock[];
}

export function turnsToMessages(turns: ConversationTurn[]): SdkMessage[] {
  const out: SdkMessage[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      out.push({ role: 'user', content: t.content });
    } else if (t.role === 'assistant') {
      out.push({ role: 'assistant', content: t.content });
    } else {
      out.push({ role: 'user', content: t.content });
    }
  }
  return out;
}

export interface RenderedTurn {
  id: number;
  role: TurnRole;
  blocks: TurnContentBlock[];
  createdAt: string;
}

export function turnsToRendered(turns: ConversationTurn[]): RenderedTurn[] {
  return turns.map((t) => ({
    id: t.id,
    role: t.role,
    blocks: t.content,
    createdAt: t.created_at,
  }));
}
