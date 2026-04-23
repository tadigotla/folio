import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDb } from '../../../lib/db';
import { getVideoById, type VideoWithConsumption } from '../../../lib/consumption';
import { formatDuration, relativeTime, toLocalDateTime } from '../../../lib/time';
import { Player } from '../../../components/Player';
import { TopNav } from '../../../components/TopNav';
import { Kicker } from '../../../components/ui/Kicker';
import { Rule } from '../../../components/ui/Rule';
import { NextPieceFooter } from '../../../components/watch/NextPieceFooter';
import { WatchKeyboard } from '../../../components/watch/WatchKeyboard';
import { isMobileUserAgent } from '../../../lib/device';
import { MobileWatch } from './MobileWatch';

export const dynamic = 'force-dynamic';

function loadNextInbox(excludeId: string, limit = 3): VideoWithConsumption[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT v.*,
              c.status, c.status_changed_at, c.last_viewed_at, c.last_position_seconds,
              ch.name AS channel_name
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
         JOIN channels ch   ON ch.id      = v.channel_id
        WHERE c.status = 'inbox' AND v.id != ?
        ORDER BY v.published_at DESC
        LIMIT ?`,
    )
    .all(excludeId, limit) as VideoWithConsumption[];
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const videoId = decodeURIComponent(id);
  const video = getVideoById(videoId);

  if (!video) notFound();

  const next = loadNextInbox(video.id, 3);
  const nextId = next[0]?.id ?? null;
  const prevId: string | null = null;

  const h = await headers();
  const ua = h.get('user-agent');
  if (isMobileUserAgent(ua)) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-4">
        <TopNav />
        <MobileWatch
          video={video}
          nextId={nextId}
          prevId={prevId}
          next={next}
        />
      </div>
    );
  }

  const duration = formatDuration(video.duration_seconds);
  const published = video.published_at ? relativeTime(video.published_at) : null;
  const publishedFull = video.published_at ? toLocalDateTime(video.published_at) : null;
  const posterSrc =
    video.thumbnail_url ?? `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <WatchKeyboard
        videoId={video.id}
        currentStatus={video.status}
        nextId={nextId}
        prevId={prevId}
      />

      <header className="mt-8">
        <Kicker>Video</Kicker>
        <h1 className="mt-3 font-[var(--font-serif-display)] text-4xl font-medium leading-[1.05] tracking-tight md:text-5xl">
          {video.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 italic text-sage">
          <span>{video.channel_name}</span>
          {duration && <><span>·</span><span>{duration}</span></>}
          {published && <><span>·</span><span title={publishedFull ?? undefined}>{published}</span></>}
        </div>
      </header>

      <div className="mt-6">
        <Player
          videoId={video.id}
          initialPosition={video.last_position_seconds ?? 0}
          posterSrc={posterSrc}
          posterAlt={video.title}
        />
      </div>

      {video.description && (
        <section className="mt-6">
          <p className="whitespace-pre-line font-[var(--font-serif-body)] text-ink-soft">
            {video.description}
          </p>
        </section>
      )}

      <Rule thick className="my-10" />

      <NextPieceFooter next={next} />
    </div>
  );
}
