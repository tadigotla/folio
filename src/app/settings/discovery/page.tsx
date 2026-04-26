import { listRejections } from '../../../lib/discovery/read';
import { relativeTime } from '../../../lib/time';
import { TopNav } from '../../../components/TopNav';
import { Rule } from '../../../components/ui/Rule';
import {
  RejectionRowActions,
  ClearAllRejectionsButton,
} from '../../../components/discovery/RejectionRowActions';

export const dynamic = 'force-dynamic';

export default function DiscoverySettingsPage() {
  const rejections = listRejections();

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
          Discovery rejections
        </h1>
        <p className="mt-2 font-sans text-sm italic text-ink-soft">
          Targets you dismissed. Description-graph and active-search results
          skip anything in this list. Clear an entry to let proposals come
          back.
        </p>
      </header>

      <Rule thick className="my-8" />

      {rejections.length === 0 ? (
        <p className="font-[var(--font-serif-display)] text-lg italic text-ink-soft">
          Nothing has been dismissed yet.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="font-sans text-xs italic text-ink-soft">
              {rejections.length} dismissed target
              {rejections.length === 1 ? '' : 's'}
            </p>
            <ClearAllRejectionsButton />
          </div>

          <ul className="mt-6 divide-y divide-rule border border-rule">
            {rejections.map((r) => (
              <li
                key={r.target_id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div>
                  <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                    {r.kind}
                  </div>
                  <div className="mt-1 font-mono text-sm text-ink">
                    {r.target_id}
                  </div>
                  <div className="font-sans text-[11px] italic text-ink-soft">
                    dismissed {relativeTime(r.dismissed_at)}
                  </div>
                </div>
                <RejectionRowActions targetId={r.target_id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
