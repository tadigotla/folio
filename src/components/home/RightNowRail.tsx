import Link from 'next/link';
import { rankForHome } from '../../lib/home-ranking';
import { relativeTime, formatDuration } from '../../lib/time';
import { Kicker } from '../ui/Kicker';

export function RightNowRail() {
  const candidates = rankForHome({ limit: 10 });

  return (
    <section className="mt-10">
      <Kicker>For right now</Kicker>
      {candidates.length === 0 ? (
        <p className="mt-3 font-[var(--font-serif-display)] text-xl italic leading-snug text-ink-soft">
          Nothing to show here — try importing videos or{' '}
          <Link
            href="/taste"
            className="underline decoration-rule underline-offset-2 hover:text-ink"
          >
            adjusting taste weights
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {candidates.map((c) => {
            const v = c.video;
            const thumbnail =
              v.thumbnail_url ??
              `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
            const duration = formatDuration(v.duration_seconds);
            const published = v.published_at ? relativeTime(v.published_at) : null;
            return (
              <li key={v.id}>
                <Link
                  href={`/watch/${encodeURIComponent(v.id)}`}
                  className="group flex flex-col"
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnail}
                      alt={v.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {duration && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
                        {duration}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 line-clamp-2 font-[var(--font-serif-display)] text-base italic leading-tight group-hover:text-oxblood">
                    {v.title}
                  </h3>
                  <div className="mt-1 flex items-center gap-1 font-sans text-[11px] text-ink-soft">
                    <span className="truncate">
                      {v.channel_name ?? 'unknown'}
                    </span>
                    {published && (
                      <>
                        <span>·</span>
                        <span className="whitespace-nowrap">{published}</span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
