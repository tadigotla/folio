import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDuration, relativeTime } from '../lib/time';
import type { VideoWithConsumption } from '../lib/consumption';

export function VideoCard({
  video,
  action,
  focused,
  rootRef,
}: {
  video: VideoWithConsumption;
  action?: ReactNode;
  focused?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
}) {
  const duration = formatDuration(video.duration_seconds);
  const published = video.published_at ? relativeTime(video.published_at) : null;
  const thumbnail =
    video.thumbnail_url ??
    `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;

  return (
    <div
      ref={rootRef}
      data-focused={focused ? 'true' : undefined}
      aria-current={focused ? 'true' : undefined}
      className="group flex flex-col rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent data-[focused=true]:ring-2 data-[focused=true]:ring-primary data-[focused=true]:ring-offset-2 data-[focused=true]:ring-offset-background"
    >
      <Link
        href={`/watch/${encodeURIComponent(video.id)}`}
        className="block"
      >
        <div className="relative mb-2 aspect-video w-full overflow-hidden rounded-md bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnails are served from i.ytimg.com and benefit from the browser cache rather than next/image's optimizer. */}
          <img
            src={thumbnail}
            alt={video.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {video.is_live_now === 1 && (
            <span className="absolute top-2 left-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
              LIVE
            </span>
          )}
          {duration && (
            <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
              {duration}
            </span>
          )}
          {video.status === 'in_progress' &&
            video.last_position_seconds !== null &&
            video.duration_seconds !== null &&
            video.duration_seconds > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                <div
                  className="h-full bg-red-600"
                  style={{
                    width: `${Math.min(
                      100,
                      (video.last_position_seconds / video.duration_seconds) * 100,
                    )}%`,
                  }}
                />
              </div>
            )}
        </div>

        <h3 className="mb-1 line-clamp-2 text-sm font-medium leading-tight group-hover:text-primary">
          {video.title}
        </h3>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{video.channel_name}</span>
          {published && (
            <>
              <span>&middot;</span>
              <span className="whitespace-nowrap">{published}</span>
            </>
          )}
        </div>
      </Link>

      {action && <div className="mt-3 flex gap-2">{action}</div>}
    </div>
  );
}
