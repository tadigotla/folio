import Link from 'next/link';
import type { ReactNode } from 'react';
import { DuotoneThumbnail } from './DuotoneThumbnail';
import { SectionChip } from './SectionChip';
import { formatDuration, relativeTime } from '../lib/time';
import { slugify } from '../lib/slug';
import type { VideoWithConsumption } from '../lib/consumption';
import type { Section, Tag } from '../lib/types';

interface Props {
  video: VideoWithConsumption & {
    channel_id: string;
    section_id: number | null;
    section_name: string | null;
    tags?: Tag[];
  };
  sections: Section[];
  action?: ReactNode;
  focused?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
}

export function InboxCard({
  video,
  sections,
  action,
  focused,
  rootRef,
}: Props) {
  const duration = formatDuration(video.duration_seconds);
  const published = video.published_at ? relativeTime(video.published_at) : null;
  const thumb = video.thumbnail_url ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;

  return (
    <div
      ref={rootRef}
      data-focused={focused ? 'true' : undefined}
      className="relative flex gap-5 py-5 data-[focused=true]:bg-rule/40"
    >
      {focused && (
        <div
          aria-hidden="true"
          className="absolute left-0 top-5 bottom-5 w-0.5 bg-oxblood"
        />
      )}
      <Link
        href={`/watch/${encodeURIComponent(video.id)}`}
        className="shrink-0 w-[200px]"
      >
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
        </div>
      </Link>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            {video.channel_name}
          </span>
          <SectionChip
            channelId={video.channel_id}
            currentSectionId={video.section_id}
            currentSectionName={video.section_name}
            sections={sections}
          />
        </div>
        <Link
          href={`/watch/${encodeURIComponent(video.id)}`}
          className="group mt-1 block"
        >
          <h3 className="font-[var(--font-serif-display)] text-xl leading-tight group-hover:text-oxblood">
            {video.title}
          </h3>
        </Link>
        <div className="mt-2 italic text-sage text-sm">
          {published}
        </div>
        {video.tags && video.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {video.tags.map((t) => (
              <Link
                key={t.id}
                href={`/tag/${slugify(t.name)}`}
                className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-sage hover:text-oxblood"
              >
                #{t.name}
              </Link>
            ))}
          </div>
        )}
        {action && <div className="mt-3 flex gap-3">{action}</div>}
      </div>
    </div>
  );
}
