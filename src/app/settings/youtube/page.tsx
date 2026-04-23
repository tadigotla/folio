import { toLocalDateTime } from '../../../lib/time';
import { getStoredToken } from '../../../lib/youtube-oauth';
import {
  getLastImports,
  getLastPlaylistImports,
} from '../../../lib/youtube-import';
import { TopNav } from '../../../components/TopNav';
import { Kicker } from '../../../components/ui/Kicker';
import { Rule } from '../../../components/ui/Rule';
import { YouTubeImportButton } from '../../../components/YouTubeImportButton';
import { YouTubePlaylists } from '../../../components/YouTubePlaylists';
import { YouTubeReconnectBanner } from '../../../components/YouTubeReconnectBanner';

export const dynamic = 'force-dynamic';

interface SearchParams {
  connected?: string;
  error?: string;
}

function fmtLast(iso: string | null): string {
  return iso ? toLocalDateTime(iso) : 'never';
}

export default async function YouTubeSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const token = getStoredToken();
  const connected = !!token;

  const lastImports = connected
    ? getLastImports()
    : { like: null, subscription_upload: null, playlist: null };
  const lastPlaylistImports = connected
    ? Object.fromEntries(getLastPlaylistImports())
    : {};

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
          YouTube library
        </h1>
      </header>

      <Rule thick className="my-8" />

      {params.connected === '1' && (
        <div className="mb-4 bg-sage/20 px-4 py-3 font-sans text-sm text-ink">
          Connected. Import your library below.
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

      <YouTubeReconnectBanner />

      {!connected && (
        <section>
          <Kicker>Connect</Kicker>
          <p className="mt-3 italic text-sage">
            Connect your YouTube account to import your Likes, subscription
            uploads, and playlists into Folio. Read-only access; Folio never
            modifies your YouTube state.
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

      {connected && (
        <section className="space-y-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Kicker>Connected</Kicker>
              <p className="mt-2 font-sans text-sm text-ink-soft">
                Tokens stored locally in <code>events.db</code>. Scope: {token?.scope ?? '—'}.
              </p>
            </div>
            <form action="/api/youtube/oauth/disconnect" method="post">
              <button
                type="submit"
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink"
              >
                Disconnect
              </button>
            </form>
          </div>

          <Rule />

          <div>
            <Kicker>Import</Kicker>

            <ul className="mt-4 divide-y divide-sage/40">
              <li className="flex items-center justify-between gap-4 py-4">
                <div>
                  <div className="font-[var(--font-serif-display)] text-xl">
                    Likes
                  </div>
                  <div className="font-sans text-xs text-ink-soft">
                    Last: {fmtLast(lastImports.like)} · saved to Library (weight 1.0)
                  </div>
                </div>
                <YouTubeImportButton
                  endpoint="/api/youtube/import/likes"
                  label="Import likes"
                />
              </li>
              <li className="flex items-center justify-between gap-4 py-4">
                <div>
                  <div className="font-[var(--font-serif-display)] text-xl">
                    Subscriptions
                  </div>
                  <div className="font-sans text-xs text-ink-soft">
                    Last: {fmtLast(lastImports.subscription_upload)} · recent
                    uploads land in Inbox (weight 0.3)
                  </div>
                </div>
                <YouTubeImportButton
                  endpoint="/api/youtube/import/subscriptions"
                  label="Import subscriptions"
                />
              </li>
              <li className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-[var(--font-serif-display)] text-xl">
                      Playlists
                    </div>
                    <div className="font-sans text-xs text-ink-soft">
                      Last: {fmtLast(lastImports.playlist)} · saved to Library
                      (weight 0.7)
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <YouTubePlaylists lastImports={lastPlaylistImports} />
                </div>
              </li>
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
