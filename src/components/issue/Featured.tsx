import Link from 'next/link';
import { DuotoneThumbnail } from '../DuotoneThumbnail';
import { Kicker } from '../ui/Kicker';
import { formatDuration, relativeTime } from '../../lib/time';
import type { IssueVideo } from '../../lib/issue';
import { PinCoverAction } from './PinCoverAction';

interface Props {
  videos: IssueVideo[];
}

export function Featured({ videos }: Props) {
  if (videos.length === 0) return null;
  return (
    <section className="py-10">
      <Kicker withRule>Featured</Kicker>
      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-3">
        {videos.map((v) => {
          const thumb = v.thumbnail_url ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
          const duration = formatDuration(v.duration_seconds);
          const published = v.published_at ? relativeTime(v.published_at) : null;
          return (
            <div key={v.id} className="group relative">
              <Link
                href={`/watch/${encodeURIComponent(v.id)}`}
                className="block"
              >
                <DuotoneThumbnail src={thumb} alt={v.title} aspect="16/9" />
                <div className="mt-3 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-oxblood">
                  {(v.section_name ?? 'Unsorted').toUpperCase()}
                </div>
                <h3 className="mt-1 font-[var(--font-serif-display)] text-xl leading-tight group-hover:text-oxblood">
                  {v.title}
                </h3>
                <div className="mt-1 italic text-sage text-sm">
                  {v.channel_name}
                  {duration ? ` · ${duration}` : ''}
                  {published ? ` · ${published}` : ''}
                </div>
              </Link>
              <div className="mt-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <PinCoverAction videoId={v.id} label="↑ Make cover" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
