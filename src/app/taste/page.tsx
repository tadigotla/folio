import Link from 'next/link';
import { TopNav } from '../../components/TopNav';
import { Kicker } from '../../components/ui/Kicker';
import { Rule } from '../../components/ui/Rule';
import { ClusterCard } from '../../components/taste/ClusterCard';
import {
  getClusterSummaries,
  getClusterDrift,
} from '../../lib/taste-read';
import { getMutedClusterIdsToday } from '../../lib/mutes';

export const dynamic = 'force-dynamic';

export default function TastePage() {
  const { active, empty, retired } = getClusterSummaries();
  const drift = getClusterDrift();
  const mutedIds = getMutedClusterIdsToday();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-12">
        <Kicker>Taste lab</Kicker>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="font-[var(--font-serif-display)] text-5xl font-medium italic tracking-tight">
            Tend the cluster map.
          </h1>
          {drift.visible && (
            <Link
              href="#rebuild"
              className="border border-rule px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:border-oxblood hover:text-oxblood"
              title={`${drift.driftCount} of ${drift.totalLikes} likes have similarity < ${drift.threshold.toFixed(2)} to their current cluster`}
            >
              Drift {drift.driftCount}/{drift.totalLikes}
            </Link>
          )}
        </div>
        <p className="mt-3 font-[var(--font-serif-display)] text-xl italic leading-snug text-ink-soft">
          Label clusters, tune weights, fix bad assignments. The agent reads
          this map; cheap edits here pay dividends in its prose.
        </p>
        <p className="mt-2 font-sans text-xs italic text-ink-soft/80">
          Weights take effect when the editor agent lands in phase 3 — see the{' '}
          <Link
            href="/RUNBOOK.md#taste-lab"
            className="underline decoration-rule underline-offset-2 hover:text-ink"
          >
            runbook
          </Link>
          .
        </p>
      </header>

      <Rule thick className="my-10" />

      {active.length === 0 ? (
        <section>
          <Kicker>Empty</Kicker>
          <p className="mt-3 font-[var(--font-serif-display)] text-xl italic text-ink-soft">
            No active clusters yet. Run{' '}
            <code className="font-mono text-sm">just taste-build</code> to
            populate the map from your likes.
          </p>
        </section>
      ) : (
        <section className="space-y-4">
          {active.map((c) => (
            <ClusterCard
              key={c.id}
              cluster={c}
              mutedToday={mutedIds.has(c.id)}
            />
          ))}
        </section>
      )}

      {empty.length > 0 && (
        <details className="mt-10 border-t border-rule pt-6">
          <summary className="cursor-pointer font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink">
            Empty clusters ({empty.length})
          </summary>
          <div className="mt-4 space-y-4">
            {empty.map((c) => (
              <ClusterCard
                key={c.id}
                cluster={c}
                mutedToday={mutedIds.has(c.id)}
              />
            ))}
          </div>
        </details>
      )}

      {retired.length > 0 && (
        <details className="mt-10 border-t border-rule pt-6">
          <summary className="cursor-pointer font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink">
            Retired ({retired.length})
          </summary>
          <div className="mt-4 space-y-4">
            {retired.map((c) => (
              <ClusterCard key={c.id} cluster={c} editable={false} />
            ))}
          </div>
        </details>
      )}

      <section id="rebuild" className="mt-12 border-t border-rule pt-6">
        <Kicker>Rebuild</Kicker>
        <p className="mt-3 font-sans text-sm text-ink-soft">
          The cluster map is rebuilt by{' '}
          <code className="font-mono text-xs">just taste-cluster</code>. Labels
          and weights survive the rebuild via centroid matching. See the runbook
          section &ldquo;Taste lab&rdquo; for details.
        </p>
      </section>
    </div>
  );
}
