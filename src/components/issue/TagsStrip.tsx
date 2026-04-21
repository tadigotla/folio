import Link from 'next/link';
import { Kicker } from '../ui/Kicker';
import { slugify } from '../../lib/slug';

export interface TagRow {
  id: number;
  name: string;
  inboxCount: number;
}

export function TagsStrip({ rows }: { rows: TagRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="py-10">
      <Kicker withRule>Tags</Kicker>
      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/tag/${slugify(r.name)}`}
            className="group flex items-baseline gap-1.5"
          >
            <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-sage group-hover:text-oxblood">
              #{r.name}
            </span>
            <span className="font-mono text-[11px] text-ink-soft">{r.inboxCount}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
