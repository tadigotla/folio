import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPlaylist } from '../../../lib/playlists';
import { TopNav } from '../../../components/TopNav';
import { Rule } from '../../../components/ui/Rule';
import { PlaylistHeader } from '../../../components/playlist/PlaylistHeader';
import { PlaylistItems } from '../../../components/playlist/PlaylistItems';

export const dynamic = 'force-dynamic';

export default async function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const detail = getPlaylist(id);
  if (!detail) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <div className="mt-8">
        <Link
          href="/playlists"
          className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft hover:text-oxblood"
        >
          ← All playlists
        </Link>
      </div>

      <PlaylistHeader playlist={detail.playlist} />

      <Rule thick className="mt-6" />

      <PlaylistItems playlistId={id} items={detail.items} />
    </div>
  );
}
