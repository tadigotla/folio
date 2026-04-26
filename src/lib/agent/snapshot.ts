import type Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';
import { getClusterSummaries } from '../taste-read';
import { listPlaylists } from '../playlists';
import { getMutedClusterIdsToday } from '../mutes';
import { todayLocal } from '../time';
import { listProposedCandidates } from '../discovery/read';

/**
 * Builds the per-turn snapshot block for the curation companion: consumption
 * counts, fresh-arrival count, top taste clusters by weight, and the user's
 * playlists. Returned as a cache-controlled user message so the snapshot
 * itself is cached for the duration of a multi-turn tool loop.
 */
export function buildSnapshotBlock(): Anthropic.TextBlockParam {
  const db = getDb();
  const today = todayLocal();

  const consumption = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM consumption GROUP BY status`,
    )
    .all() as Array<{ status: string; n: number }>;
  const counts: Record<string, number> = Object.create(null);
  for (const r of consumption) counts[r.status] = r.n;

  const freshRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM consumption
        WHERE status = 'inbox' AND status_changed_at >= datetime('now', '-24 hours')`,
    )
    .get() as { n: number };

  const inProgress = db
    .prepare(
      `SELECT v.id, v.title, ch.name AS channel_name, c.last_position_seconds
         FROM consumption c
         JOIN videos v ON v.id = c.video_id
         JOIN channels ch ON ch.id = v.channel_id
        WHERE c.status = 'in_progress'
        ORDER BY COALESCE(c.last_viewed_at, c.status_changed_at) DESC
        LIMIT 5`,
    )
    .all() as Array<{
    id: string;
    title: string;
    channel_name: string;
    last_position_seconds: number | null;
  }>;

  const clusters = getClusterSummaries();
  const muted = getMutedClusterIdsToday();
  const playlists = listPlaylists();
  const proposedCandidatesCount = listProposedCandidates({ limit: 50 }).length;

  const lines: string[] = [];
  lines.push(`### Today (${today})`);
  lines.push(
    `Pool: ${counts['inbox'] ?? 0} inbox · ${counts['saved'] ?? 0} saved · ${counts['in_progress'] ?? 0} in-progress · ${counts['archived'] ?? 0} archived · ${counts['dismissed'] ?? 0} dismissed.`,
  );
  lines.push(
    `Fresh in the last 24h: ${freshRow.n} new inbox row${freshRow.n === 1 ? '' : 's'}.`,
  );
  lines.push(
    `Proposed imports awaiting approval on /inbox: ${proposedCandidatesCount}.`,
  );

  lines.push('');
  lines.push('### In progress');
  if (inProgress.length === 0) {
    lines.push('(nothing currently in progress)');
  } else {
    for (const v of inProgress) {
      const pos =
        v.last_position_seconds != null
          ? ` @ ${Math.floor(v.last_position_seconds)}s`
          : '';
      lines.push(`- ${v.id} · "${v.title}" — ${v.channel_name}${pos}`);
    }
  }

  lines.push('');
  lines.push('### Taste clusters (active, sorted by weight)');
  if (clusters.active.length === 0) {
    lines.push(
      'No active clusters. Run `just taste-build` to populate the map.',
    );
  } else {
    const sorted = [...clusters.active].sort((a, b) => b.weight - a.weight);
    for (const c of sorted) {
      const label = c.label ?? '(unlabeled)';
      const top = c.preview
        .slice(0, 3)
        .map((p) => `"${p.title}"`)
        .join(', ');
      const mutedTag = muted.has(c.id) ? ' · muted today' : '';
      lines.push(
        `- #${c.id} ${label} — weight ${c.weight.toFixed(1)}, ${c.memberCount} members${mutedTag}${top ? `; top: ${top}` : ''}`,
      );
    }
  }

  lines.push('');
  lines.push('### Playlists');
  if (playlists.length === 0) {
    lines.push('(no playlists yet)');
  } else {
    for (const p of playlists.slice(0, 10)) {
      lines.push(`- #${p.id} "${p.name}" — ${p.item_count} item${p.item_count === 1 ? '' : 's'}`);
    }
    if (playlists.length > 10) {
      lines.push(`… and ${playlists.length - 10} more.`);
    }
  }

  return {
    type: 'text',
    text: lines.join('\n'),
    cache_control: { type: 'ephemeral' },
  };
}
