import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDb } from '../../../lib/db';
import { getVideoById } from '../../../lib/consumption';
import { formatDuration, relativeTime, toLocalDateTime } from '../../../lib/time';
import {
  getIssueOrder,
  getOrPublishTodaysIssue,
  loadIssueVideos,
  pickBriefs,
  effectiveCoverId,
  type IssueVideo,
} from '../../../lib/issue';
import { Player } from '../../../components/Player';
import { TopNav } from '../../../components/issue/TopNav';
import { Kicker } from '../../../components/ui/Kicker';
import { Rule } from '../../../components/ui/Rule';
import { SectionChip } from '../../../components/SectionChip';
import { listSections } from '../../../lib/sections';
import { NextPieceFooter } from '../../../components/watch/NextPieceFooter';
import { WatchKeyboard } from '../../../components/watch/WatchKeyboard';
import { isMobileUserAgent } from '../../../lib/device';
import { MobileWatch } from './MobileWatch';

export const dynamic = 'force-dynamic';

interface Row {
  section_id: number | null;
  section_name: string | null;
}

function getSectionForVideo(videoId: string): Row {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT ch.section_id AS section_id, s.name AS section_name
         FROM videos v
         JOIN channels ch ON ch.id = v.channel_id
    LEFT JOIN sections s ON s.id = ch.section_id
        WHERE v.id = ?`,
    )
    .get(videoId) as Row | undefined;
  return row ?? { section_id: null, section_name: null };
}

function loadNextInSection(
  sectionId: number | null,
  excludeId: string,
  limit = 3,
): IssueVideo[] {
  const db = getDb();
  const rows =
    sectionId === null
      ? (db
          .prepare(
            `SELECT v.*, ch.name AS channel_name, ch.section_id AS section_id, NULL AS section_name
               FROM videos v
               JOIN consumption c ON c.video_id = v.id
               JOIN channels ch   ON ch.id      = v.channel_id
              WHERE c.status = 'inbox' AND ch.section_id IS NULL AND v.id != ?
              ORDER BY v.published_at DESC
              LIMIT ?`,
          )
          .all(excludeId, limit) as IssueVideo[])
      : (db
          .prepare(
            `SELECT v.*, ch.name AS channel_name, ch.section_id AS section_id, s.name AS section_name
               FROM videos v
               JOIN consumption c ON c.video_id = v.id
               JOIN channels ch   ON ch.id      = v.channel_id
          LEFT JOIN sections s ON s.id = ch.section_id
              WHERE c.status = 'inbox' AND ch.section_id = ? AND v.id != ?
              ORDER BY v.published_at DESC
              LIMIT ?`,
          )
          .all(sectionId, excludeId, limit) as IssueVideo[]);
  return rows;
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

  const section = getSectionForVideo(video.id);
  const sections = listSections();
  const issue = getOrPublishTodaysIssue();
  const order = getIssueOrder(issue);
  const currentIdx = order.indexOf(video.id);
  const nextId = currentIdx >= 0 && currentIdx < order.length - 1 ? order[currentIdx + 1] : null;
  const prevId = currentIdx > 0 ? order[currentIdx - 1] : null;

  const nextInSection = loadNextInSection(section.section_id, video.id, 3);

  const h = await headers();
  const ua = h.get('user-agent');
  if (isMobileUserAgent(ua)) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-4">
        <TopNav />
        <MobileWatch
          video={video}
          sectionId={section.section_id}
          sectionName={section.section_name}
          sections={sections}
          nextId={nextId}
          prevId={prevId}
          nextInSection={nextInSection}
        />
      </div>
    );
  }

  const coverId = effectiveCoverId(issue);
  const alsoIds: string[] = [];
  if (coverId && coverId !== video.id) alsoIds.push(coverId);
  for (const id of issue.featured_video_ids) {
    if (id !== video.id && !alsoIds.includes(id)) alsoIds.push(id);
  }
  const briefExclude = new Set([video.id, ...alsoIds]);
  const briefs = pickBriefs(briefExclude, 3);
  for (const id of briefs) {
    if (!alsoIds.includes(id)) alsoIds.push(id);
  }
  const alsoMap = loadIssueVideos(alsoIds);
  const alsoVideos = alsoIds
    .map((id) => alsoMap.get(id))
    .filter((v): v is IssueVideo => !!v);

  const duration = formatDuration(video.duration_seconds);
  const published = video.published_at ? relativeTime(video.published_at) : null;
  const publishedFull = video.published_at ? toLocalDateTime(video.published_at) : null;
  const kickerLabel = section.section_name
    ? `${section.section_name.toUpperCase()} · Video`
    : 'UNSORTED · Video';
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
        <Kicker>{kickerLabel}</Kicker>
        <h1 className="mt-3 font-[var(--font-serif-display)] text-4xl font-medium leading-[1.05] tracking-tight md:text-5xl">
          {video.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 italic text-sage">
          <span>{video.channel_name}</span>
          {duration && <><span>·</span><span>{duration}</span></>}
          {published && <><span>·</span><span title={publishedFull ?? undefined}>{published}</span></>}
          <span>·</span>
          <SectionChip
            channelId={video.channel_id}
            currentSectionId={section.section_id}
            currentSectionName={section.section_name}
            sections={sections}
          />
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

      <NextPieceFooter
        sectionName={section.section_name}
        nextInSection={nextInSection}
        alsoInIssue={alsoVideos}
      />
    </div>
  );
}
