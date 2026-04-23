export interface Channel {
  id: string;
  name: string;
  handle: string | null;
  subscribed: number;
  first_seen_at: string;
  last_checked_at: string;
}

export interface Tag {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Video {
  id: string;
  title: string;
  description: string | null;
  channel_id: string;
  duration_seconds: number | null;
  published_at: string | null;
  thumbnail_url: string | null;
  source_url: string;
  is_live_now: number;
  scheduled_start: string | null;
  discovered_at: string;
  last_checked_at: string;
  updated_at: string;
  first_seen_at: string;
  raw: string | null;
}

export type ConsumptionStatus =
  | 'inbox'
  | 'saved'
  | 'in_progress'
  | 'archived'
  | 'dismissed';

export interface Consumption {
  video_id: string;
  status: ConsumptionStatus;
  last_viewed_at: string | null;
  status_changed_at: string;
  last_position_seconds: number | null;
}

export type ProvenanceKind = 'like' | 'subscription_upload' | 'playlist';

export interface VideoProvenance {
  video_id: string;
  source_kind: ProvenanceKind;
  source_ref: string;
  imported_at: string;
  signal_weight: number;
}

export type ImportStatus = 'running' | 'ok' | 'error';

export interface ImportLog {
  id: number;
  kind: ProvenanceKind;
  source_ref: string | null;
  started_at: string;
  finished_at: string | null;
  status: ImportStatus;
  videos_new: number;
  videos_updated: number;
  channels_new: number;
  error: string | null;
}

export interface VideoEmbedding {
  video_id: string;
  provider: string;
  model: string;
  dim: number;
  vec: Buffer;
  created_at: string;
}

export interface VideoEnrichment {
  video_id: string;
  model: string;
  summary: string;
  topic_tags: string;
  created_at: string;
  run_at: string;
}

export interface VideoTranscript {
  video_id: string;
  source: 'youtube-captions' | 'whisper-local';
  language: string;
  text: string;
  fetched_at: string;
}

export interface TasteCluster {
  id: number;
  label: string | null;
  weight: number;
  centroid: Buffer;
  dim: number;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}

export interface VideoClusterAssignment {
  video_id: string;
  cluster_id: number;
  similarity: number;
  is_fuzzy: number;
  assigned_at: string;
}

export type TurnRole = 'user' | 'assistant' | 'tool';

export interface Conversation {
  id: number;
  scope_date: string;
  created_at: string;
}

// Stored JSON-verbatim inside `conversation_turns.content`. These block shapes
// match the Anthropic Messages API so a turn row round-trips into a
// `MessageParam` without a schema translation.
export type TurnContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface ConversationTurn {
  id: number;
  conversation_id: number;
  role: TurnRole;
  content: TurnContentBlock[];
  tokens_input: number | null;
  tokens_output: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  created_at: string;
}
