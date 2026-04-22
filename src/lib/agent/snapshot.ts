import type Anthropic from '@anthropic-ai/sdk';
import { getIssueSlots, getInboxPool, getIssueById } from '../issues';
import { getClusterSummaries } from '../taste-read';
import { formatDuration } from '../time';

/**
 * Builds the per-turn snapshot block: current draft state, inbox digest,
 * taste-cluster summary. Returned as a cache-controlled user message so the
 * snapshot itself is cached for the duration of a multi-turn tool loop.
 */
export function buildSnapshotBlock(issueId: number): Anthropic.TextBlockParam {
  const issue = getIssueById(issueId);
  const slots = getIssueSlots(issueId);
  const pool = getInboxPool(issueId);
  const clusters = getClusterSummaries();

  const lines: string[] = [];
  lines.push('### Current draft');
  lines.push(
    `Issue ${issueId}${issue?.title ? ` — "${issue.title}"` : ''} — ${slots.length} of 14 slots filled.`,
  );

  const cover = slots.find(
    (s) => s.slot_kind === 'cover' && s.slot_index === 0,
  );
  lines.push(
    `Cover: ${cover ? `"${cover.title}" — ${cover.channel_name}` : '(empty)'}`,
  );

  const featured = [0, 1, 2].map((i) =>
    slots.find((s) => s.slot_kind === 'featured' && s.slot_index === i),
  );
  lines.push('Featured:');
  featured.forEach((s, i) => {
    lines.push(
      `  [${i}] ${s ? `"${s.title}" — ${s.channel_name}` : '(empty)'}`,
    );
  });

  const briefs = Array.from({ length: 10 }, (_, i) =>
    slots.find((s) => s.slot_kind === 'brief' && s.slot_index === i),
  );
  lines.push('Briefs:');
  briefs.forEach((s, i) => {
    lines.push(
      `  [${i}] ${s ? `"${s.title}" — ${s.channel_name}` : '(empty)'}`,
    );
  });

  lines.push('');
  lines.push('### Pool digest');
  lines.push(
    `${pool.length} video${pool.length === 1 ? '' : 's'} available in the inbox + saved pool (not yet placed on this issue).`,
  );
  // Sample — the agent should not rely on this list, use search_pool / rank_by_theme.
  const sample = pool.slice(0, 8);
  for (const p of sample) {
    const dur = formatDuration(p.duration_seconds);
    lines.push(
      `- ${p.id} · "${p.title}" — ${p.channel_name}${dur ? ` (${dur})` : ''}`,
    );
  }
  if (pool.length > sample.length) {
    lines.push(`… and ${pool.length - sample.length} more.`);
  }

  lines.push('');
  lines.push('### Taste clusters (active)');
  if (clusters.active.length === 0) {
    lines.push(
      'No active clusters. Run `just taste-build` to populate the map.',
    );
  } else {
    for (const c of clusters.active) {
      const label = c.label ?? '(unlabeled)';
      const top = c.preview
        .slice(0, 3)
        .map((p) => `"${p.title}"`)
        .join(', ');
      lines.push(
        `- #${c.id} ${label} — weight ${c.weight.toFixed(1)}, ${c.memberCount} members${top ? `; top: ${top}` : ''}`,
      );
    }
  }

  return {
    type: 'text',
    text: lines.join('\n'),
    cache_control: { type: 'ephemeral' },
  };
}
