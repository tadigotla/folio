import { getDb } from '../db';
import { nowUTC } from '../time';
import type {
  Conversation,
  ConversationTurn,
  Issue,
  TurnContentBlock,
  TurnRole,
} from '../types';

export class ConversationFrozenError extends Error {
  issueId: number;
  constructor(issueId: number) {
    super(`Conversation for issue ${issueId} is frozen (issue is published)`);
    this.name = 'ConversationFrozenError';
    this.issueId = issueId;
  }
}

export class IssueMissingError extends Error {
  issueId: number;
  constructor(issueId: number) {
    super(`Issue ${issueId} does not exist`);
    this.name = 'IssueMissingError';
    this.issueId = issueId;
  }
}

interface ConversationRow {
  id: number;
  issue_id: number;
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
 * Ensures a conversation row exists for this draft issue and returns it.
 * Throws ConversationFrozenError if the issue is published, IssueMissingError
 * if the issue row is absent.
 */
export function getOrCreateConversation(issueId: number): Conversation {
  const db = getDb();
  const issue = db
    .prepare('SELECT * FROM issues WHERE id = ?')
    .get(issueId) as Issue | undefined;
  if (!issue) throw new IssueMissingError(issueId);
  if (issue.status === 'published') throw new ConversationFrozenError(issueId);

  const existing = db
    .prepare('SELECT * FROM conversations WHERE issue_id = ?')
    .get(issueId) as ConversationRow | undefined;
  if (existing) return existing;

  const ts = nowUTC();
  const info = db
    .prepare('INSERT INTO conversations (issue_id, created_at) VALUES (?, ?)')
    .run(issueId, ts);
  return {
    id: Number(info.lastInsertRowid),
    issue_id: issueId,
    created_at: ts,
  };
}

export function getConversationByIssue(issueId: number): Conversation | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM conversations WHERE issue_id = ?')
    .get(issueId) as ConversationRow | undefined;
  return row ?? null;
}

export function getConversationTurns(issueId: number): ConversationTurn[] {
  const db = getDb();
  const conv = db
    .prepare('SELECT * FROM conversations WHERE issue_id = ?')
    .get(issueId) as ConversationRow | undefined;
  if (!conv) return [];
  const rows = db
    .prepare(
      `SELECT * FROM conversation_turns
        WHERE conversation_id = ?
        ORDER BY id ASC`,
    )
    .all(conv.id) as TurnRow[];
  return rows.map(rowToTurn);
}

export interface TurnUsage {
  tokens_input?: number | null;
  tokens_output?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/**
 * Appends a turn to the conversation. Re-checks the issue status inside the
 * same transaction so a concurrent publish cannot slip a turn past the freeze.
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
    const issue = db
      .prepare('SELECT status FROM issues WHERE id = ?')
      .get(conv.issue_id) as { status: string } | undefined;
    if (!issue) throw new IssueMissingError(conv.issue_id);
    if (issue.status === 'published') {
      throw new ConversationFrozenError(conv.issue_id);
    }

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

/**
 * Collapse a turn list into the SDK's `MessageParam[]` shape. Tool turns (role
 * = 'tool' in the DB) are emitted as `user` messages whose content is the
 * tool_result blocks — the Anthropic API convention for feeding tool output
 * back to the model.
 */
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
      // tool turn -> user message with tool_result blocks
      out.push({ role: 'user', content: t.content });
    }
  }
  return out;
}

/**
 * Client-shaped turn for the renderer. Separate from the DB row so the
 * renderer does not need to know about token columns or JSON serialization.
 */
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
