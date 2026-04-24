import Link from 'next/link';
import { getDb } from '../lib/db';
import { getStoredToken } from '../lib/youtube-oauth';
import { TopNav } from '../components/TopNav';
import { Kicker } from '../components/ui/Kicker';
import { RightNowRail } from '../components/home/RightNowRail';
import { ContinueRail } from '../components/home/ContinueRail';
import { ShelfRail } from '../components/home/ShelfRail';
import { SinceLastVisit } from '../components/home/SinceLastVisit';

export const dynamic = 'force-dynamic';

function getCorpusSize(): { videos: number; channels: number } {
  const db = getDb();
  const v = db.prepare(`SELECT COUNT(*) AS n FROM videos`).get() as { n: number };
  const c = db.prepare(`SELECT COUNT(*) AS n FROM channels`).get() as { n: number };
  return { videos: v.n, channels: c.n };
}

const FOOTER_LINKS: Array<{ href: string; label: string }> = [
  { href: '/library', label: 'Library' },
  { href: '/playlists', label: 'Playlists' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/taste', label: 'Taste' },
  { href: '/settings/youtube', label: 'Settings' },
];

export default async function Home() {
  const connected = !!getStoredToken();
  const { videos } = connected ? getCorpusSize() : { videos: 0 };
  const hasCorpus = connected && videos > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      {!connected && (
        <section className="mt-12">
          <Kicker>Get started</Kicker>
          <p className="mt-3 font-[var(--font-serif-display)] text-2xl italic leading-snug text-ink-soft">
            Connect YouTube to get started.
          </p>
          <Link
            href="/settings/youtube"
            className="mt-6 inline-block bg-oxblood px-4 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-ink"
          >
            Go to settings
          </Link>
        </section>
      )}

      {connected && videos === 0 && (
        <section className="mt-12">
          <Kicker>Next step</Kicker>
          <p className="mt-3 font-[var(--font-serif-display)] text-2xl italic leading-snug text-ink-soft">
            Import your library to start watching.
          </p>
          <Link
            href="/settings/youtube"
            className="mt-6 inline-block bg-oxblood px-4 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-ink"
          >
            Import from YouTube
          </Link>
        </section>
      )}

      {hasCorpus && (
        <>
          <SinceLastVisit />
          <RightNowRail />
          <ContinueRail />
          <ShelfRail />
          <footer className="mt-16 flex flex-wrap items-center gap-3 border-t border-rule/60 pt-6">
            {FOOTER_LINKS.map((l, i) => (
              <span key={l.href} className="flex items-center gap-3">
                <Link
                  href={l.href}
                  className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-soft hover:text-ink"
                >
                  {l.label}
                </Link>
                {i < FOOTER_LINKS.length - 1 && (
                  <span className="h-2.5 w-px bg-sage/60" aria-hidden="true" />
                )}
              </span>
            ))}
          </footer>
        </>
      )}
    </div>
  );
}
