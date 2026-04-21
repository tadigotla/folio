import { getDb } from '../lib/db';
import { getLiveNowVideos } from '../lib/consumption';
import {
  effectiveCoverId,
  getOrPublishTodaysIssue,
  loadIssueVideos,
  pickBriefs,
} from '../lib/issue';
import { TopNav } from '../components/issue/TopNav';
import { Masthead } from '../components/issue/Masthead';
import { Cover } from '../components/issue/Cover';
import { Featured } from '../components/issue/Featured';
import {
  Departments,
  type DepartmentRow,
} from '../components/issue/Departments';
import { Briefs } from '../components/issue/Briefs';
import { TagsStrip, type TagRow } from '../components/issue/TagsStrip';
import { Rule } from '../components/ui/Rule';
import { listTags, getTagCounts } from '../lib/tags';

export const dynamic = 'force-dynamic';

function loadDepartments(): DepartmentRow[] {
  const db = getDb();
  const sectionRows = db
    .prepare(
      `SELECT s.id, s.name,
              COALESCE(
                (SELECT COUNT(*)
                   FROM videos v
                   JOIN consumption c ON c.video_id = v.id
                   JOIN channels ch   ON ch.id      = v.channel_id
                  WHERE ch.section_id = s.id AND c.status = 'inbox'), 0)
                AS inbox_count
         FROM sections s
        ORDER BY s.sort_order ASC, s.name ASC`,
    )
    .all() as Array<{ id: number; name: string; inbox_count: number }>;

  const unsorted = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM videos v
         JOIN consumption c ON c.video_id = v.id
         JOIN channels ch   ON ch.id      = v.channel_id
        WHERE ch.section_id IS NULL AND c.status = 'inbox'`,
    )
    .get() as { n: number };

  const sorted = [...sectionRows]
    .sort((a, b) => b.inbox_count - a.inbox_count)
    .slice(0, 6);

  const rows: DepartmentRow[] = sorted.map((r) => {
    const channels = db
      .prepare(
        `SELECT ch.name
           FROM channels ch
          WHERE ch.section_id = ?
          ORDER BY ch.last_checked_at DESC
          LIMIT 3`,
      )
      .all(r.id) as Array<{ name: string }>;
    return {
      id: r.id,
      name: r.name,
      inboxCount: r.inbox_count,
      topChannels: channels.map((c) => c.name),
    };
  });

  if (unsorted.n > 0) {
    rows.push({
      id: null,
      name: 'Unsorted',
      inboxCount: unsorted.n,
      topChannels: [],
    });
  }

  return rows;
}

export default function Home() {
  const issue = getOrPublishTodaysIssue();
  const liveNow = getLiveNowVideos();
  const coverId = effectiveCoverId(issue);
  const featuredIds = issue.featured_video_ids;
  const usedIds = new Set<string>();
  if (coverId) usedIds.add(coverId);
  for (const id of featuredIds) usedIds.add(id);

  const briefIds = pickBriefs(usedIds, 10);
  const allIds = [
    ...(coverId ? [coverId] : []),
    ...featuredIds,
    ...briefIds,
  ];
  const videoMap = loadIssueVideos(allIds);

  const cover = coverId ? videoMap.get(coverId) ?? null : null;
  const featured = featuredIds
    .map((id) => videoMap.get(id))
    .filter((v): v is NonNullable<typeof v> => !!v);
  const briefs = briefIds
    .map((id) => videoMap.get(id))
    .filter((v): v is NonNullable<typeof v> => !!v);

  const departments = loadDepartments();
  const pinned = !!(issue.pinned_cover_video_id && coverId === issue.pinned_cover_video_id);

  const tagCounts = getTagCounts();
  const tagRows: TagRow[] = listTags()
    .map((t) => ({ id: t.id, name: t.name, inboxCount: tagCounts.get(t.id) ?? 0 }))
    .filter((r) => r.inboxCount > 0)
    .sort((a, b) => b.inboxCount - a.inboxCount);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>
      <Masthead
        issueNumber={issue.id}
        issueDate={issue.created_at}
        liveVideos={liveNow}
      />
      <Rule thick className="mt-6" />
      <Cover cover={cover} pinned={pinned} />
      {cover && (
        <>
          <Rule thick />
          <Featured videos={featured} />
        </>
      )}
      <Rule thick />
      <Departments rows={departments} />
      {tagRows.length > 0 && (
        <>
          <Rule thick />
          <TagsStrip rows={tagRows} />
        </>
      )}
      {briefs.length > 0 && (
        <>
          <Rule thick />
          <Briefs videos={briefs} />
        </>
      )}
    </div>
  );
}
