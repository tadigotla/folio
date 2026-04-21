import { getDb } from '../../lib/db';
import { listSections } from '../../lib/sections';
import { listTags, getTagsByChannel } from '../../lib/tags';
import { relativeTime } from '../../lib/time';
import { TopNav } from '../../components/issue/TopNav';
import { Rule } from '../../components/ui/Rule';
import { SectionsManager } from '../../components/SectionsManager';

export const dynamic = 'force-dynamic';

interface ChannelRow {
  id: string;
  name: string;
  handle: string | null;
  section_id: number | null;
  section_name: string | null;
  inbox_count: number;
  last_checked_at: string;
}

function loadChannels(): ChannelRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT ch.id,
              ch.name,
              ch.handle,
              ch.section_id,
              s.name AS section_name,
              ch.last_checked_at,
              COALESCE(
                (SELECT COUNT(*)
                   FROM videos v
                   JOIN consumption c ON c.video_id = v.id
                  WHERE v.channel_id = ch.id AND c.status = 'inbox'),
                0) AS inbox_count
         FROM channels ch
    LEFT JOIN sections s ON s.id = ch.section_id
        ORDER BY ch.name ASC`,
    )
    .all() as ChannelRow[];
}

interface RecentTitle {
  channel_id: string;
  id: string;
  title: string;
}

function loadRecentTitlesByChannel(): Map<string, RecentTitle[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT channel_id, id, title
         FROM (
           SELECT v.channel_id, v.id, v.title,
                  ROW_NUMBER() OVER (
                    PARTITION BY v.channel_id
                    ORDER BY v.published_at DESC, v.id ASC
                  ) AS rn
             FROM videos v
             JOIN consumption c ON c.video_id = v.id
            WHERE c.status = 'inbox'
         )
        WHERE rn <= 3`,
    )
    .all() as RecentTitle[];
  const map = new Map<string, RecentTitle[]>();
  for (const r of rows) {
    if (!map.has(r.channel_id)) map.set(r.channel_id, []);
    map.get(r.channel_id)!.push(r);
  }
  return map;
}

export default function SectionsPage() {
  const sections = listSections();
  const tags = listTags();
  const channels = loadChannels();
  const recentByChannel = loadRecentTitlesByChannel();
  const tagsByChannel = getTagsByChannel();

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <TopNav />
      <div className="mt-6">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
          Departments
        </div>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-4xl leading-tight">
          Assign channels to sections
        </h1>
        <p className="mt-2 italic text-sage">
          {channels.length} channel{channels.length === 1 ? '' : 's'} &middot;{' '}
          {sections.length} section{sections.length === 1 ? '' : 's'} &middot; press <kbd>j</kbd>/<kbd>k</kbd> to move, <kbd>1</kbd>&ndash;<kbd>9</kbd> to assign, <kbd>0</kbd> to clear
        </p>
      </div>

      <Rule thick className="my-6" />

      <SectionsManager
        channels={channels.map((c) => ({
          id: c.id,
          name: c.name,
          handle: c.handle,
          sectionId: c.section_id,
          sectionName: c.section_name,
          inboxCount: c.inbox_count,
          lastChecked: c.last_checked_at ? relativeTime(c.last_checked_at) : null,
          recent: (recentByChannel.get(c.id) ?? []).map((r) => ({
            id: r.id,
            title: r.title,
          })),
          tags: tagsByChannel.get(c.id) ?? [],
        }))}
        sections={sections}
        allTags={tags}
      />
    </div>
  );
}
