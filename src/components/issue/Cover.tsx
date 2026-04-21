import Link from 'next/link';
import { DuotoneThumbnail } from '../DuotoneThumbnail';
import { Kicker } from '../ui/Kicker';
import { formatDuration, relativeTime } from '../../lib/time';
import type { IssueVideo } from '../../lib/issue';
import { PinCoverAction } from './PinCoverAction';

interface Props {
  cover: IssueVideo | null;
  pinned: boolean;
}

export function Cover({ cover, pinned }: Props) {
  if (!cover) {
    return (
      <section className="py-16 text-center">
        <div className="font-[var(--font-serif-display)] text-3xl italic text-ink-soft">
          Inbox zero. Nothing new today.
        </div>
      </section>
    );
  }

  const thumb = cover.thumbnail_url ?? `https://i.ytimg.com/vi/${cover.id}/maxresdefault.jpg`;
  const duration = formatDuration(cover.duration_seconds);
  const published = cover.published_at ? relativeTime(cover.published_at) : null;
  const kickerLabel = cover.section_name
    ? cover.section_name.toUpperCase()
    : 'UNSORTED';

  return (
    <section className="py-10">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Kicker withRule>
            {kickerLabel} {pinned ? ' · Pinned' : ' · Cover story'}
          </Kicker>
        </div>
        {pinned && <PinCoverAction videoId={null} pinned label="Unpin cover" />}
      </div>
      <Link href={`/watch/${encodeURIComponent(cover.id)}`} className="group block">
        <h2 className="mt-5 font-[var(--font-serif-display)] text-5xl font-medium leading-[1.05] tracking-tight md:text-6xl group-hover:text-oxblood">
          {cover.title}
        </h2>
        <div className="mt-4 italic text-sage">
          {cover.channel_name}
          {duration ? ` · ${duration}` : ''}
          {published ? ` · ${published}` : ''}
        </div>
        <div className="mt-6">
          <DuotoneThumbnail
            src={thumb}
            alt={cover.title}
            aspect="16/9"
            priority
          />
        </div>
      </Link>
    </section>
  );
}
