import Link from 'next/link';
import { Kicker } from '../ui/Kicker';
import { slug } from '../../lib/sections';

export interface DepartmentRow {
  id: number | null;
  name: string;
  inboxCount: number;
  topChannels: string[];
}

export function Departments({ rows }: { rows: DepartmentRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="py-10">
      <Kicker withRule>Departments</Kicker>
      <ul className="mt-6 divide-y" style={{ borderColor: 'var(--color-rule)' }}>
        {rows.map((r) => {
          const href = r.id === null ? '/section/unsorted' : `/section/${slug(r.name)}`;
          return (
            <li key={r.id ?? 'unsorted'} className="border-b" style={{ borderColor: 'var(--color-rule)' }}>
              <Link
                href={href}
                className="group flex items-baseline justify-between gap-6 py-4 hover:bg-rule/30"
              >
                <div className="flex-1">
                  <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-ink group-hover:text-oxblood">
                    {r.name}
                  </div>
                  {r.topChannels.length > 0 && (
                    <div className="mt-1 italic text-sage text-sm">
                      {r.topChannels.join(', ')}
                    </div>
                  )}
                </div>
                <div className="font-mono text-sm text-oxblood">
                  {r.inboxCount}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
