import { getDb } from '../db';
import { nowUTC } from '../time';
import {
  fetchVideoMetadata,
  fetchChannelByIdOrHandle,
  type NormalizedYouTubeVideo,
} from '../youtube-api';
import {
  importVideos,
  upsertChannel,
  type ImportCounts,
} from '../youtube-import';
import { CandidateNotFoundError } from './errors';

export type ApproveResult =
  | { kind: 'video'; id: string }
  | { kind: 'channel'; id: string };

interface CandidateRow {
  id: number;
  kind: 'video' | 'channel';
  target_id: string;
}

export async function approveCandidate(
  candidateId: number,
): Promise<ApproveResult> {
  const db = getDb();
  const candidate = db
    .prepare(
      `SELECT id, kind, target_id FROM discovery_candidates WHERE id = ?`,
    )
    .get(candidateId) as CandidateRow | undefined;
  if (!candidate) throw new CandidateNotFoundError(candidateId);

  // Network I/O happens before the SQLite transaction opens. If the Data API
  // call fails, the candidate row stays `proposed` and the caller maps the
  // typed error to HTTP 502.
  if (candidate.kind === 'video') {
    const video = await fetchVideoMetadata(candidate.target_id);
    return finalizeVideo(candidate.id, video);
  }

  const channel = await fetchChannelByIdOrHandle(candidate.target_id);
  return finalizeChannel(candidate.id, channel.channelId, channel.title);
}

function finalizeVideo(
  candidateId: number,
  video: NormalizedYouTubeVideo,
): ApproveResult {
  const db = getDb();
  const now = nowUTC();
  const counts: ImportCounts = {
    videos_new: 0,
    videos_updated: 0,
    channels_new: 0,
  };

  const run = db.transaction(() => {
    importVideos([video], 'like', '', 'saved', counts);
    db.prepare(
      `UPDATE discovery_candidates
          SET status = 'approved', status_changed_at = ?
        WHERE id = ?`,
    ).run(now, candidateId);
    db.prepare(`DELETE FROM discovery_candidates WHERE id = ?`).run(
      candidateId,
    );
  });
  run();

  return { kind: 'video', id: video.videoId };
}

function finalizeChannel(
  candidateId: number,
  channelId: string,
  title: string,
): ApproveResult {
  const db = getDb();
  const now = nowUTC();

  const run = db.transaction(() => {
    upsertChannel({ channelId, channelName: title });
    db.prepare(
      `UPDATE discovery_candidates
          SET status = 'approved', status_changed_at = ?
        WHERE id = ?`,
    ).run(now, candidateId);
    db.prepare(`DELETE FROM discovery_candidates WHERE id = ?`).run(
      candidateId,
    );
  });
  run();

  return { kind: 'channel', id: channelId };
}
