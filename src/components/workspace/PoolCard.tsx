'use client';

import type { DragEvent } from 'react';
import { DuotoneThumbnail } from '../DuotoneThumbnail';
import { formatDuration } from '../../lib/time';
import { setDragPayload } from './useDragPayload';
import type { PoolVideo } from '../../lib/issues';

interface Props {
  video: PoolVideo;
  onDismissed: (videoId: string) => void;
}

function weightBorder(weight: number | null): string {
  if (weight == null) return 'border-l-rule';
  if (weight >= 1.0) return 'border-l-oxblood';
  if (weight >= 0.7) return 'border-l-sage';
  return 'border-l-ink-soft/40';
}

export function PoolCard({ video, onDismissed }: Props) {
  const duration = formatDuration(video.duration_seconds);
  const thumb =
    video.thumbnail_url ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;

  function onDragStart(e: DragEvent<HTMLDivElement>) {
    setDragPayload(e, { from: 'pool', videoId: video.id });
  }

  async function dismiss() {
    try {
      const res = await fetch('/api/consumption', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: video.id, next: 'dismissed' }),
      });
      if (res.ok || res.status === 204) {
        onDismissed(video.id);
      }
    } catch {
      // ignore; dismiss is best-effort
    }
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`group flex cursor-grab gap-3 border-l-2 ${weightBorder(video.signal_weight)} bg-paper px-3 py-2 hover:bg-rule/40 active:cursor-grabbing`}
    >
      <div className="w-[96px] shrink-0">
        <DuotoneThumbnail src={thumb} alt={video.title} aspect="16/9" />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="line-clamp-2 font-[var(--font-serif-display)] text-sm leading-snug">
          {video.title}
        </h4>
        <div className="mt-1 flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.14em] text-ink-soft">
          <span className="truncate">{video.channel_name}</span>
          {duration && (
            <>
              <span>&middot;</span>
              <span className="font-mono">{duration}</span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        title="Dismiss"
        className="opacity-0 transition-opacity group-hover:opacity-100 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft hover:text-oxblood"
      >
        Dismiss
      </button>
    </div>
  );
}
