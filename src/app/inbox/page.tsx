import { getInboxVideos } from '../../lib/consumption';
import { getPlaylistsForVideos } from '../../lib/playlists';
import { LibraryCard } from '../../components/LibraryCard';
import { ConsumptionAction } from '../../components/ConsumptionAction';
import { TopNav } from '../../components/TopNav';
import { Kicker } from '../../components/ui/Kicker';
import { Rule } from '../../components/ui/Rule';
import { ProposedRail } from '../../components/discovery/ProposedRail';

export const dynamic = 'force-dynamic';

export default function InboxPage() {
  const videos = getInboxVideos();
  const playlistsByVideo = getPlaylistsForVideos(videos.map((v) => v.id));

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-8">
        <Kicker>Fresh arrivals</Kicker>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
          Inbox
        </h1>
        <p className="mt-2 italic text-sage">
          {videos.length} awaiting triage
        </p>
      </header>

      <ProposedRail />

      <Rule thick className="mt-8" />

      {videos.length === 0 ? (
        <p className="mt-12 italic text-sage">Nothing new to triage.</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <LibraryCard
              key={video.id}
              video={video}
              playlists={playlistsByVideo.get(video.id) ?? []}
              action={
                <div className="flex flex-wrap gap-2">
                  <ConsumptionAction
                    videoId={video.id}
                    next="saved"
                    label="Save"
                  />
                  <ConsumptionAction
                    videoId={video.id}
                    next="dismissed"
                    label="Dismiss"
                    variant="ghost"
                  />
                </div>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
