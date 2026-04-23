import Link from 'next/link';
import { KeyboardHelp } from './KeyboardHelp';

const LINKS: Array<{ href: string; label: string }> = [
  { href: '/library', label: 'Library' },
  { href: '/playlists', label: 'Playlists' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/taste', label: '★ Taste' },
  { href: '/settings/youtube', label: 'Settings' },
];

export function TopNav() {
  return (
    <nav className="flex items-center justify-between gap-3">
      <Link
        href="/"
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-ink hover:text-oxblood"
      >
        Folio
      </Link>
      <div className="flex items-center gap-3">
        {LINKS.map((l, i) => (
          <span key={l.href} className="flex items-center gap-3">
            <Link
              href={l.href}
              className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft hover:text-ink"
            >
              {l.label}
            </Link>
            {i < LINKS.length - 1 && (
              <span className="h-2.5 w-px bg-sage/60" aria-hidden="true" />
            )}
          </span>
        ))}
        <span className="h-2.5 w-px bg-sage/60" aria-hidden="true" />
        <KeyboardHelp />
      </div>
    </nav>
  );
}
