import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toLocalDateTime } from '../../../lib/time';
import {
  getSyncMeta,
  getUserSourceCounts,
  recordSyncError,
  syncSubscriptions,
} from '../../../lib/subscription-sync';
import {
  OAuthRefreshError,
  getStoredToken,
} from '../../../lib/youtube-oauth';
import { TopNav } from '../../../components/issue/TopNav';
import { Kicker } from '../../../components/ui/Kicker';
import { Rule } from '../../../components/ui/Rule';

export const dynamic = 'force-dynamic';

async function resyncAction() {
  'use server';
  if (!getStoredToken()) {
    redirect('/settings/youtube?error=not_connected');
  }
  try {
    await syncSubscriptions();
  } catch (err) {
    if (err instanceof OAuthRefreshError) {
      recordSyncError(err.message);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      recordSyncError(message);
    }
  }
  revalidatePath('/settings/youtube');
  redirect('/settings/youtube');
}

interface SearchParams {
  connected?: string;
  error?: string;
}

function isRefreshFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return /invalid_grant|refresh/i.test(message);
}

export default async function YouTubeSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const token = getStoredToken();
  const meta = getSyncMeta();
  const counts = getUserSourceCounts();

  const connected = !!token;
  const refreshBroken = connected && isRefreshFailure(meta?.last_error);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-8">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
          Settings
        </div>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
          YouTube account
        </h1>
      </header>

      <Rule thick className="my-8" />

      {params.connected === '1' && (
        <div className="mb-4 bg-sage/20 px-4 py-3 font-sans text-sm text-ink">
          Connected. Subscription sync ran.
        </div>
      )}
      {params.error === 'access_denied' && (
        <div className="mb-4 bg-sage/20 px-4 py-3 font-sans text-sm text-ink">
          You declined consent. Nothing was changed.
        </div>
      )}
      {params.error && params.error !== 'access_denied' && (
        <div className="mb-4 bg-oxblood/10 px-4 py-3 font-sans text-sm text-oxblood">
          OAuth error: {params.error}
        </div>
      )}

      {!connected && (
        <section>
          <Kicker>Connect</Kicker>
          <p className="mt-3 italic text-sage">
            Import your YouTube subscriptions as per-channel sources. The app polls
            their RSS feeds at the usual cadence; OAuth is used only to discover
            which channels to poll.
          </p>
          <form action="/api/youtube/oauth/authorize" className="mt-5">
            <button
              type="submit"
              className="bg-oxblood px-4 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-ink"
            >
              Connect YouTube account
            </button>
          </form>
        </section>
      )}

      {connected && refreshBroken && (
        <div className="mb-6 bg-oxblood/10 px-4 py-4 font-sans text-sm text-oxblood">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">
            Reconnect required
          </p>
          <p className="mt-2 italic text-ink-soft">
            The stored refresh token was rejected by Google. Existing imported
            sources still fetch via RSS, but new subscriptions won&apos;t sync
            until you reconnect.
          </p>
          <form action="/api/youtube/oauth/authorize" className="mt-3">
            <button
              type="submit"
              className="bg-oxblood px-3 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-paper hover:bg-ink"
            >
              Reconnect
            </button>
          </form>
        </div>
      )}

      {connected && (
        <section className="space-y-8">
          <div>
            <Kicker>Last sync</Kicker>
            <div className="mt-2 font-mono text-sm">
              {meta?.last_fetched_at
                ? toLocalDateTime(meta.last_fetched_at)
                : 'never'}
            </div>
            {meta?.last_error && !refreshBroken && (
              <div className="mt-2 font-sans text-xs text-oxblood">
                Last error: {meta.last_error}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div>
              <Kicker>Imported (active)</Kicker>
              <div className="mt-2 font-[var(--font-serif-display)] text-4xl">
                {counts.enabled}
              </div>
            </div>
            <div>
              <Kicker>Disabled</Kicker>
              <div className="mt-2 font-[var(--font-serif-display)] text-4xl">
                {counts.disabled}
              </div>
            </div>
          </div>

          <Rule />

          <div className="flex flex-wrap gap-6">
            <form action={resyncAction}>
              <button
                type="submit"
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink hover:text-oxblood"
              >
                Re-sync now →
              </button>
            </form>
            <form action="/api/youtube/oauth/disconnect" method="post">
              <button
                type="submit"
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink"
              >
                Disconnect
              </button>
            </form>
            <form action="/api/youtube/oauth/disconnect" method="post">
              <input type="hidden" name="disable_sources" value="true" />
              <button
                type="submit"
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-oxblood/80 hover:text-oxblood"
              >
                Disconnect &amp; disable imported sources
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
