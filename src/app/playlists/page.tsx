import Link from 'next/link';
import { listPlaylists } from '../../lib/playlists';
import { relativeTime } from '../../lib/time';
import { TopNav } from '../../components/TopNav';
import { Rule } from '../../components/ui/Rule';
import { CreatePlaylistButton } from '../../components/playlist/CreatePlaylistButton';

export const dynamic = 'force-dynamic';

function ThumbMosaic({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-rule/40">
        <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-sage">
          empty
        </span>
      </div>
    );
  }
  if (urls.length === 1) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- YouTube thumbs from i.ytimg.com.
      <img
        src={urls[0]}
        alt=""
        className="aspect-video w-full object-cover"
        loading="lazy"
      />
    );
  }
  const grid =
    urls.length === 2
      ? 'grid-cols-2 grid-rows-1'
      : urls.length === 3
        ? 'grid-cols-2 grid-rows-2'
        : 'grid-cols-2 grid-rows-2';
  return (
    <div
      className={`grid aspect-video w-full gap-px bg-rule/40 ${grid}`}
    >
      {urls.slice(0, 4).map((url, i) => (
        <div
          key={i}
          className={`overflow-hidden ${
            urls.length === 3 && i === 0 ? 'row-span-2' : ''
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbs from i.ytimg.com. */}
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ))}
    </div>
  );
}

export default function PlaylistsPage() {
  const playlists = listPlaylists();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-8 flex items-end justify-between gap-4">
        <div>
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
            Collections
          </div>
          <h1 className="mt-2 font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
            Playlists
          </h1>
        </div>
        <CreatePlaylistButton />
      </header>

      <Rule thick className="mt-8" />

      {playlists.length === 0 ? (
        <p className="mt-10 italic text-sage">
          No playlists yet. Make one — group videos by mood, project, or session.
        </p>
      ) : (
        <ul className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {playlists.map((p) => (
            <li key={p.id}>
              <Link
                href={`/playlists/${p.id}`}
                className="group block"
              >
                <ThumbMosaic urls={p.latest_thumbnail_urls} />
                <h2 className="mt-3 font-[var(--font-serif-display)] text-xl leading-tight group-hover:text-oxblood">
                  {p.name}
                </h2>
                {p.description && (
                  <p className="mt-1 line-clamp-2 font-[var(--font-serif-body)] text-sm text-ink-soft">
                    {p.description}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-sage">
                  <span>{p.item_count} {p.item_count === 1 ? 'item' : 'items'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="italic font-normal normal-case tracking-normal">
                    updated {relativeTime(p.updated_at)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
