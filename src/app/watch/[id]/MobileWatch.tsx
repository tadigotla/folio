import Link from 'next/link';
import { DuotoneThumbnail } from '../../../components/DuotoneThumbnail';
import { Kicker } from '../../../components/ui/Kicker';
import { Rule } from '../../../components/ui/Rule';
import { ConsumptionAction } from '../../../components/ConsumptionAction';
import type { VideoWithConsumption } from '../../../lib/consumption';
import { formatDuration, relativeTime } from '../../../lib/time';

interface Props {
  video: VideoWithConsumption;
  nextId: string | null;
  prevId: string | null;
  next: VideoWithConsumption[];
}

export function MobileWatch({ video, nextId, prevId, next }: Props) {
  const duration = formatDuration(video.duration_seconds);
  const published = video.published_at ? relativeTime(video.published_at) : null;
  const thumb =
    video.thumbnail_url ?? `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`;
  const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-20">
      <header className="pt-5">
        <Kicker>Video</Kicker>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-[28px] font-medium leading-tight tracking-tight">
          {video.title}
        </h1>
        <div className="mt-2 italic text-sage text-sm">
          {video.channel_name}
          {duration ? ` · ${duration}` : ''}
          {published ? ` · ${published}` : ''}
        </div>
      </header>

      <a
        href={ytUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 block"
      >
        <div className="relative">
          <DuotoneThumbnail src={thumb} alt={video.title} aspect="16/9" priority />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-oxblood text-paper">
              <span className="ml-1 text-2xl leading-none">▶</span>
            </div>
          </div>
        </div>
      </a>

      <a
        href={ytUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center justify-center gap-2 bg-oxblood px-4 py-3 font-sans text-[12px] font-semibold uppercase tracking-[0.18em] text-paper"
      >
        ▶ Open in YouTube
      </a>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <ConsumptionAction videoId={video.id} next="saved" label="Save" />
        <ConsumptionAction
          videoId={video.id}
          next="archived"
          label="Archive"
          variant="secondary"
        />
        <ConsumptionAction
          videoId={video.id}
          next="dismissed"
          label="Dismiss"
          variant="ghost"
        />
      </div>

      {video.description && (
        <section className="mt-6">
          <p className="whitespace-pre-line font-[var(--font-serif-body)] text-sm text-ink-soft">
            {video.description}
          </p>
        </section>
      )}

      <Rule thick className="my-8" />

      <div className="flex items-center justify-between gap-3">
        {prevId ? (
          <Link
            href={`/watch/${encodeURIComponent(prevId)}`}
            className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink hover:text-oxblood"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {nextId ? (
          <Link
            href={`/watch/${encodeURIComponent(nextId)}`}
            className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-oxblood hover:text-ink"
          >
            Next →
          </Link>
        ) : (
          <span />
        )}
      </div>

      {next.length > 0 && (
        <section className="mt-8">
          <Kicker withRule>Next up</Kicker>
          <ul className="mt-4">
            {next.map((v) => {
              const d = formatDuration(v.duration_seconds);
              return (
                <li
                  key={v.id}
                  className="border-b"
                  style={{ borderColor: 'var(--color-rule)' }}
                >
                  <Link
                    href={`/watch/${encodeURIComponent(v.id)}`}
                    className="flex items-baseline gap-2 py-2"
                  >
                    <span className="flex-1 font-[var(--font-serif-body)] text-sm leading-snug">
                      {v.title}
                    </span>
                    {d && (
                      <span className="shrink-0 font-mono text-[10px] text-ink-soft">
                        {d}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
