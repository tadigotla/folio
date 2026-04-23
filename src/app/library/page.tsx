import type { ReactNode } from 'react';
import { getLibraryVideos, type VideoWithConsumption } from '../../lib/consumption';
import { getPlaylistsForVideos, type PlaylistMembership } from '../../lib/playlists';
import { LibraryCard } from '../../components/LibraryCard';
import { ConsumptionAction } from '../../components/ConsumptionAction';
import { TopNav } from '../../components/TopNav';
import { Kicker } from '../../components/ui/Kicker';
import { Rule } from '../../components/ui/Rule';

export const dynamic = 'force-dynamic';

function Section({
  id,
  title,
  empty,
  videos,
  renderAction,
  playlistsByVideo,
}: {
  id: string;
  title: string;
  empty: string;
  videos: VideoWithConsumption[];
  renderAction?: (video: VideoWithConsumption) => ReactNode;
  playlistsByVideo: Map<string, PlaylistMembership[]>;
}) {
  return (
    <section id={id} className="py-10 scroll-mt-6">
      <Kicker withRule>{title}</Kicker>
      {videos.length === 0 ? (
        <p className="mt-6 italic text-sage">{empty}</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <LibraryCard
              key={video.id}
              video={video}
              action={renderAction ? renderAction(video) : undefined}
              playlists={playlistsByVideo.get(video.id) ?? []}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function LibraryPage() {
  const { saved, inProgress, archived } = getLibraryVideos();
  const allIds = [
    ...saved.map((v) => v.id),
    ...inProgress.map((v) => v.id),
    ...archived.map((v) => v.id),
  ];
  const playlistsByVideo = getPlaylistsForVideos(allIds);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-8">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
          Keepers
        </div>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
          Library
        </h1>
      </header>

      <Rule thick className="mt-8" />

      <Section
        id="saved"
        title="Saved"
        empty="Nothing saved yet. Head to the Inbox to triage new arrivals."
        videos={saved}
        playlistsByVideo={playlistsByVideo}
        renderAction={(v) => (
          <ConsumptionAction
            videoId={v.id}
            next="archived"
            label="Archive"
            variant="secondary"
          />
        )}
      />

      <Rule thick />

      <Section
        id="in-progress"
        title="In Progress"
        empty="Nothing in progress. Start a video from the Inbox or Saved to see it here."
        videos={inProgress}
        playlistsByVideo={playlistsByVideo}
        renderAction={(v) => (
          <ConsumptionAction
            videoId={v.id}
            next="archived"
            label="Archive"
            variant="secondary"
          />
        )}
      />

      <Rule thick />

      <Section
        id="archived"
        title="Archived"
        empty="Nothing archived yet."
        videos={archived}
        playlistsByVideo={playlistsByVideo}
        renderAction={(v) => (
          <ConsumptionAction
            videoId={v.id}
            next="saved"
            label="Re-open"
            variant="ghost"
          />
        )}
      />
    </div>
  );
}
