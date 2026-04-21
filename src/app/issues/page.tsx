import Link from 'next/link';
import { getDb } from '../../lib/db';
import { getPublishedIssues } from '../../lib/issues';
import { toLocalDateTime } from '../../lib/time';
import { TopNav } from '../../components/issue/TopNav';
import { DuotoneThumbnail } from '../../components/DuotoneThumbnail';
import { Rule } from '../../components/ui/Rule';
import { Kicker } from '../../components/ui/Kicker';

export const dynamic = 'force-dynamic';

interface IssueSummary {
  id: number;
  title: string | null;
  published_at: string;
  cover_video_id: string | null;
  cover_thumbnail: string | null;
  cover_title: string | null;
  slot_count: number;
}

function getIssueSummaries(): IssueSummary[] {
  const db = getDb();
  const issues = getPublishedIssues();
  if (issues.length === 0) return [];

  const coverStmt = db.prepare(
    `SELECT s.video_id, v.title, v.thumbnail_url
       FROM issue_slots s
       JOIN videos v ON v.id = s.video_id
      WHERE s.issue_id = ? AND s.slot_kind = 'cover' AND s.slot_index = 0`,
  );
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM issue_slots WHERE issue_id = ?`,
  );

  return issues
    .filter((i) => !!i.published_at)
    .map((i) => {
      const cover = coverStmt.get(i.id) as
        | { video_id: string; title: string; thumbnail_url: string | null }
        | undefined;
      const { n } = countStmt.get(i.id) as { n: number };
      return {
        id: i.id,
        title: i.title,
        published_at: i.published_at!,
        cover_video_id: cover?.video_id ?? null,
        cover_thumbnail:
          cover?.thumbnail_url ??
          (cover?.video_id
            ? `https://i.ytimg.com/vi/${cover.video_id}/hqdefault.jpg`
            : null),
        cover_title: cover?.title ?? null,
        slot_count: n,
      };
    });
}

export default function IssuesIndex() {
  const issues = getIssueSummaries();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-12">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
          Archive
        </div>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
          Issues
        </h1>
        <p className="mt-2 italic text-ink-soft">
          {issues.length} published {issues.length === 1 ? 'issue' : 'issues'}.
        </p>
      </header>

      <Rule thick className="my-10" />

      {issues.length === 0 ? (
        <section>
          <Kicker>No issues yet</Kicker>
          <p className="mt-3 font-[var(--font-serif-display)] text-2xl italic leading-snug text-ink-soft">
            You haven’t published an issue yet. Compose your first one.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block bg-oxblood px-4 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-ink"
          >
            Back to workspace
          </Link>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {issues.map((i) => (
            <Link
              key={i.id}
              href={`/issues/${i.id}`}
              className="group block"
            >
              <div className="relative">
                {i.cover_thumbnail ? (
                  <DuotoneThumbnail
                    src={i.cover_thumbnail}
                    alt={i.cover_title ?? 'Issue cover'}
                    aspect="16/9"
                  />
                ) : (
                  <div className="flex aspect-[16/9] items-center justify-center border border-rule bg-paper/60 font-sans text-[10px] uppercase tracking-[0.16em] text-ink-soft">
                    No cover
                  </div>
                )}
              </div>
              <div className="mt-3">
                <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-oxblood">
                  {toLocalDateTime(i.published_at)}
                </div>
                <h2 className="mt-1 font-[var(--font-serif-display)] text-2xl italic leading-tight group-hover:text-oxblood">
                  {i.title ?? `Issue #${i.id}`}
                </h2>
                <div className="mt-1 font-sans text-[10px] uppercase tracking-[0.14em] text-ink-soft">
                  {i.slot_count} of 14 slots
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
