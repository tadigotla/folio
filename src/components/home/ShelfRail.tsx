import Link from 'next/link';
import { listHomePlaylists } from '../../lib/playlists';
import { Kicker } from '../ui/Kicker';

export function ShelfRail() {
  const rows = listHomePlaylists();
  if (rows.length === 0) return null;

  return (
    <section className="mt-10">
      <Kicker>On the shelf</Kicker>
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/playlists/${p.id}`}
              className="group flex flex-col rounded-md border border-rule/60 bg-paper p-4 hover:border-oxblood"
            >
              <h3 className="font-[var(--font-serif-display)] text-xl italic leading-tight group-hover:text-oxblood">
                {p.name}
              </h3>
              {p.description && (
                <p className="mt-1 line-clamp-2 font-sans text-xs text-ink-soft">
                  {p.description}
                </p>
              )}
              <div className="mt-2 font-sans text-[11px] uppercase tracking-[0.16em] text-ink-soft">
                {p.item_count} {p.item_count === 1 ? 'item' : 'items'}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
