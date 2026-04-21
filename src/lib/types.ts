export interface Channel {
  id: string;
  name: string;
  handle: string | null;
  subscribed: number;
  first_seen_at: string;
  last_checked_at: string;
  section_id: number | null;
}

export interface Section {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
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

export type IssueStatus = 'draft' | 'published';

export interface Issue {
  id: number;
  status: IssueStatus;
  title: string | null;
  created_at: string;
  published_at: string | null;
}

export type SlotKind = 'cover' | 'featured' | 'brief';

export interface IssueSlot {
  issue_id: number;
  slot_kind: SlotKind;
  slot_index: number;
  video_id: string;
  assigned_at: string;
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
