import Link from 'next/link';
import { headers } from 'next/headers';
import { getDb } from '../lib/db';
import { getStoredToken } from '../lib/youtube-oauth';
import {
  getDraftIssue,
  getIssueSlots,
  getInboxPool,
} from '../lib/issues';
import { isMobileUserAgent } from '../lib/device';
import { TopNav } from '../components/issue/TopNav';
import { Kicker } from '../components/ui/Kicker';
import { Rule } from '../components/ui/Rule';
import { EditorWorkspace } from '../components/workspace/EditorWorkspace';
import { NewDraftButton } from '../components/workspace/NewDraftButton';

export const dynamic = 'force-dynamic';

function getCorpusSize(): { videos: number; channels: number } {
  const db = getDb();
  const v = db.prepare(`SELECT COUNT(*) AS n FROM videos`).get() as { n: number };
  const c = db.prepare(`SELECT COUNT(*) AS n FROM channels`).get() as { n: number };
  return { videos: v.n, channels: c.n };
}

export default async function Home() {
  const h = await headers();
  const ua = h.get('user-agent');
  const mobile = isMobileUserAgent(ua);

  const connected = !!getStoredToken();
  const { videos, channels } = connected
    ? getCorpusSize()
    : { videos: 0, channels: 0 };

  const workspaceBranch = connected && videos > 0;

  return (
    <div
      className={`mx-auto w-full px-6 pb-16 ${
        workspaceBranch && !mobile ? 'max-w-7xl' : 'max-w-3xl'
      }`}
    >
      <div className="pt-6">
        <TopNav />
      </div>

      {!workspaceBranch && (
        <>
          <header className="mt-12">
            <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
              Folio
            </div>
            <h1 className="mt-2 font-[var(--font-serif-display)] text-6xl font-medium italic tracking-tight">
              A personal video magazine.
            </h1>
          </header>
          <Rule thick className="my-10" />
        </>
      )}

      {!connected && (
        <section>
          <Kicker>Get started</Kicker>
          <p className="mt-3 font-[var(--font-serif-display)] text-2xl italic leading-snug text-ink-soft">
            Connect your YouTube account to begin seeding your library.
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
        <section>
          <Kicker>Next step</Kicker>
          <p className="mt-3 font-[var(--font-serif-display)] text-2xl italic leading-snug text-ink-soft">
            Import your library to get started.
          </p>
          <Link
            href="/settings/youtube"
            className="mt-6 inline-block bg-oxblood px-4 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-ink"
          >
            Import from YouTube
          </Link>
        </section>
      )}

      {workspaceBranch && mobile && (
        <section className="mt-12">
          <Kicker>Desktop only</Kicker>
          <p className="mt-3 font-[var(--font-serif-display)] text-2xl italic leading-snug text-ink-soft">
            The editor workspace is desktop-only. Open Folio on a larger screen
            to compose an issue.
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <Link
              href="/library"
              className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink hover:text-oxblood"
            >
              Library →
            </Link>
            <Link
              href="/issues"
              className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink hover:text-oxblood"
            >
              Published issues →
            </Link>
          </div>
        </section>
      )}

      {workspaceBranch && !mobile && <WorkspaceBranch videos={videos} channels={channels} />}
    </div>
  );
}

function WorkspaceBranch({
  videos,
  channels,
}: {
  videos: number;
  channels: number;
}) {
  const draft = getDraftIssue();

  if (!draft) {
    return (
      <section className="mt-12">
        <Kicker>Compose</Kicker>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
          No draft yet.
        </h1>
        <p className="mt-3 font-[var(--font-serif-display)] text-xl italic leading-snug text-ink-soft">
          Start a new issue — pick a cover, three featured pieces, and up to ten
          briefs from your library.
        </p>
        <div className="mt-6">
          <NewDraftButton />
        </div>
        <Rule className="my-10" />
        <p className="font-sans text-xs italic text-ink-soft/80">
          {videos} {videos === 1 ? 'video' : 'videos'} across {channels}{' '}
          {channels === 1 ? 'channel' : 'channels'} in your library.
        </p>
      </section>
    );
  }

  const slots = getIssueSlots(draft.id);
  const pool = getInboxPool(draft.id);

  return (
    <div className="mt-8">
      <EditorWorkspace
        initialIssue={draft}
        initialSlots={slots}
        initialPool={pool}
      />
    </div>
  );
}
