import Link from 'next/link';
import { getDb } from '../../lib/db';
import { formatDuration, relativeTime } from '../../lib/time';
import { Kicker } from '../ui/Kicker';

interface Row {
  id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  last_position_seconds: number | null;
  channel_name: string | null;
}

function getContinueRows(): Row[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT v.id, v.title, v.thumbnail_url, v.duration_seconds, v.published_at,
              c.last_position_seconds,
              ch.name AS channel_name
         FROM consumption c
         JOIN videos v ON v.id = c.video_id
    LEFT JOIN channels ch ON ch.id = v.channel_id
        WHERE c.status = 'in_progress'
        ORDER BY COALESCE(c.last_viewed_at, c.status_changed_at) DESC
        LIMIT 4`,
    )
    .all() as Row[];
}

export function ContinueRail() {
  const rows = getContinueRows();
  if (rows.length === 0) return null;

  return (
    <section className="mt-10">
      <Kicker>Continue</Kicker>
      <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {rows.map((v) => {
          const thumbnail =
            v.thumbnail_url ??
            `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
          const duration = formatDuration(v.duration_seconds);
          const published = v.published_at ? relativeTime(v.published_at) : null;
          const progressPct =
            v.last_position_seconds !== null &&
            v.duration_seconds !== null &&
            v.duration_seconds > 0
              ? Math.min(100, (v.last_position_seconds / v.duration_seconds) * 100)
              : null;
          return (
            <li key={v.id}>
              <Link
                href={`/watch/${encodeURIComponent(v.id)}`}
                className="group flex flex-col"
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnail}
                    alt={v.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  {duration && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
                      {duration}
                    </span>
                  )}
                  {progressPct !== null && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                      <div
                        className="h-full bg-red-600"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                </div>
                <h3 className="mt-2 line-clamp-2 font-[var(--font-serif-display)] text-base italic leading-tight group-hover:text-oxblood">
                  {v.title}
                </h3>
                <div className="mt-1 flex items-center gap-1 font-sans text-[11px] text-ink-soft">
                  <span className="truncate">{v.channel_name ?? 'unknown'}</span>
                  {published && (
                    <>
                      <span>·</span>
                      <span className="whitespace-nowrap">{published}</span>
                    </>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
