export type SourceKind = 'youtube_channel';

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  enabled: number;
  min_interval_minutes: number;
  last_fetched_at: string | null;
  next_fetch_after: string | null;
  last_error: string | null;
}

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

export interface Issue {
  id: number;
  created_at: string;
  cover_video_id: string | null;
  featured_video_ids: string[];
  pinned_cover_video_id: string | null;
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

export interface NormalizedVideo {
  videoId: string;
  title: string;
  description?: string;
  channelId: string;
  channelName: string;
  publishedAt: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  isLiveNow: boolean;
  scheduledStart?: string;
  raw: unknown;
}

export interface Fetcher {
  sourceId: string;
  fetch(): Promise<NormalizedVideo[]>;
}
