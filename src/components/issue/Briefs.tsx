import Link from 'next/link';
import { Kicker } from '../ui/Kicker';
import { formatDuration } from '../../lib/time';
import type { IssueVideo } from '../../lib/issue';
import { PinCoverAction } from './PinCoverAction';

export function Briefs({ videos }: { videos: IssueVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <section className="py-10">
      <Kicker withRule>Briefs</Kicker>
      <ul className="mt-6 divide-y" style={{ borderColor: 'var(--color-rule)' }}>
        {videos.map((v) => {
          const duration = formatDuration(v.duration_seconds);
          return (
            <li
              key={v.id}
              className="group relative border-b"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              <Link
                href={`/watch/${encodeURIComponent(v.id)}`}
                className="flex items-baseline gap-3 py-2"
              >
                <span className="text-oxblood">•</span>
                <span className="shrink-0 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-sage">
                  {(v.section_name ?? 'UNSORTED').toUpperCase()}
                </span>
                <span className="font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  {v.channel_name}
                </span>
                <span className="flex-1 truncate font-[var(--font-serif-body)] text-base group-hover:text-oxblood">
                  {v.title}
                </span>
                {duration && (
                  <span className="shrink-0 font-mono text-xs text-ink-soft">
                    {duration}
                  </span>
                )}
              </Link>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 bg-paper pl-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <PinCoverAction videoId={v.id} label="↑ Cover" />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
