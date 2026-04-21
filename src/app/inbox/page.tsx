import { getInboxVideosWithSection } from '../../lib/consumption';
import { listSections } from '../../lib/sections';
import { getTagsByChannel } from '../../lib/tags';
import { InboxList } from '../../components/InboxList';
import { TopNav } from '../../components/issue/TopNav';
import { Rule } from '../../components/ui/Rule';
import type { Tag } from '../../lib/types';

export const dynamic = 'force-dynamic';

export default function InboxPage() {
  const videos = getInboxVideosWithSection();
  const sections = listSections();
  const tagsByChannel: Record<string, Tag[]> = {};
  for (const [channelId, tags] of getTagsByChannel()) {
    tagsByChannel[channelId] = tags;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-8">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
          Raw firehose
        </div>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
          Inbox
        </h1>
        <p className="mt-2 italic text-sage">
          {videos.length} piece{videos.length === 1 ? '' : 's'} awaiting triage &middot; <kbd className="font-mono">?</kbd> for keys
        </p>
      </header>

      <Rule thick className="my-8" />

      {videos.length === 0 ? (
        <p className="italic text-ink-soft py-16 text-center">
          Nothing new to triage.
        </p>
      ) : (
        <InboxList
          videos={videos}
          sections={sections}
          tagsByChannel={tagsByChannel}
        />
      )}
    </div>
  );
}
