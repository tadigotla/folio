import Link from 'next/link';
import type { ReactNode } from 'react';
import { DuotoneThumbnail } from './DuotoneThumbnail';
import { formatDuration, relativeTime } from '../lib/time';
import type { VideoWithConsumption } from '../lib/consumption';

export function LibraryCard({
  video,
  action,
}: {
  video: VideoWithConsumption;
  action?: ReactNode;
}) {
  const duration = formatDuration(video.duration_seconds);
  const published = video.published_at ? relativeTime(video.published_at) : null;
  const thumb = video.thumbnail_url ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;

  const progressPct =
    video.status === 'in_progress' &&
    video.last_position_seconds !== null &&
    video.duration_seconds !== null &&
    video.duration_seconds > 0
      ? Math.min(100, (video.last_position_seconds / video.duration_seconds) * 100)
      : null;

  return (
    <div className="flex flex-col">
      <Link href={`/watch/${encodeURIComponent(video.id)}`} className="group block">
        <div className="relative">
          <DuotoneThumbnail src={thumb} alt={video.title} aspect="16/9" />
          {video.is_live_now === 1 && (
            <span className="absolute top-1.5 left-1.5 bg-oxblood px-1.5 py-0.5 font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-paper">
              Live
            </span>
          )}
          {duration && (
            <span className="absolute bottom-1.5 right-1.5 bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] text-paper">
              {duration}
            </span>
          )}
          {progressPct !== null && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-sage/60">
              <div
                className="h-full bg-oxblood"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
        <div className="mt-3 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {video.channel_name}
        </div>
        <h3 className="mt-1 font-[var(--font-serif-display)] text-lg leading-tight group-hover:text-oxblood">
          {video.title}
        </h3>
        <div className="mt-1 italic text-sage text-xs">{published}</div>
      </Link>
      {action && <div className="mt-3 flex gap-3">{action}</div>}
    </div>
  );
}
