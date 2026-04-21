import { toLocal } from '../../lib/time';
import { LiveNowBadge } from './LiveNowBadge';
import type { VideoWithConsumption } from '../../lib/consumption';

interface Props {
  issueNumber: number;
  issueDate: string;
  liveVideos: VideoWithConsumption[];
}

export function Masthead({ issueNumber, issueDate, liveVideos }: Props) {
  return (
    <header className="mt-6">
      <div className="flex items-center justify-between gap-4">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          Vol I &middot; Issue {issueNumber}
        </div>
        {liveVideos.length > 0 && <LiveNowBadge videos={liveVideos} />}
        <div className="flex items-center gap-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">
            {toLocal(issueDate, 'EEE · MMM d yyyy')}
          </div>
          <form action="/api/issues/publish" method="post">
            <button
              type="submit"
              className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-oxblood hover:text-ink"
              title="Recompose today's issue"
            >
              ↻ Publish new
            </button>
          </form>
        </div>
      </div>
      <div className="mt-4 text-center">
        <h1 className="font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight md:text-6xl">
          Folio
        </h1>
      </div>
      <div className="mt-2 text-center font-sans text-[10px] uppercase tracking-[0.22em] text-sage">
        A daily for videos
      </div>
    </header>
  );
}
