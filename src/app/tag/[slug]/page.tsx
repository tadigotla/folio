import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '../../../lib/db';
import { getTagBySlug } from '../../../lib/tags';
import { formatDuration, relativeTime } from '../../../lib/time';
import { TopNav } from '../../../components/issue/TopNav';
import { DuotoneThumbnail } from '../../../components/DuotoneThumbnail';
import { Kicker } from '../../../components/ui/Kicker';
import { Rule } from '../../../components/ui/Rule';

export const dynamic = 'force-dynamic';

interface TagVideo {
  id: string;
  title: string;
  duration_seconds: number | null;
  published_at: string | null;
  thumbnail_url: string | null;
  channel_name: string;
}

function loadTagVideos(tagId: number): TagVideo[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT v.id, v.title, v.duration_seconds, v.published_at, v.thumbnail_url,
              ch.name AS channel_name
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
         JOIN channels ch   ON ch.id      = v.channel_id
         JOIN channel_tags ct ON ct.channel_id = ch.id
        WHERE c.status = 'inbox' AND ct.tag_id = ?
        ORDER BY v.published_at DESC`,
    )
    .all(tagId) as TagVideo[];
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);

  const tag = getTagBySlug(slug);
  if (!tag) notFound();

  const videos = loadTagVideos(tag.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>
      <header className="mt-8">
        <Kicker>Tag</Kicker>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
          #{tag.name}
        </h1>
        <p className="mt-2 italic text-sage">
          {videos.length} inbox piece{videos.length === 1 ? '' : 's'}
        </p>
      </header>

      <Rule thick className="my-8" />

      {videos.length === 0 ? (
        <p className="italic text-ink-soft py-16 text-center">
          No inbox videos tagged with this yet.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--color-rule)' }}>
          {videos.map((v) => {
            const thumb = v.thumbnail_url ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
            const duration = formatDuration(v.duration_seconds);
            const published = v.published_at ? relativeTime(v.published_at) : null;
            return (
              <li
                key={v.id}
                className="border-b"
                style={{ borderColor: 'var(--color-rule)' }}
              >
                <Link
                  href={`/watch/${encodeURIComponent(v.id)}`}
                  className="group grid grid-cols-[160px_1fr] gap-5 py-5"
                >
                  <DuotoneThumbnail src={thumb} alt={v.title} aspect="16/9" />
                  <div>
                    <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-sage">
                      {v.channel_name}
                    </div>
                    <h2 className="mt-1 font-[var(--font-serif-display)] text-2xl leading-tight group-hover:text-oxblood">
                      {v.title}
                    </h2>
                    <div className="mt-2 italic text-sage text-sm">
                      {duration ? `${duration}` : ''}
                      {duration && published ? ' · ' : ''}
                      {published}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
