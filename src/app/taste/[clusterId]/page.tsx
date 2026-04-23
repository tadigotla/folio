import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TopNav } from '../../../components/TopNav';
import { Kicker } from '../../../components/ui/Kicker';
import { Rule } from '../../../components/ui/Rule';
import { DuotoneThumbnail } from '../../../components/DuotoneThumbnail';
import { ClusterLabelInput } from '../../../components/taste/ClusterLabelInput';
import { WeightSlider } from '../../../components/taste/WeightSlider';
import { ReassignPopover } from '../../../components/taste/ReassignPopover';
import { MergeDialog } from '../../../components/taste/MergeDialog';
import { SplitDialog } from '../../../components/taste/SplitDialog';
import { RetireConfirm } from '../../../components/taste/RetireConfirm';
import { MuteTodayButton } from '../../../components/taste/MuteTodayButton';
import {
  getClusterDetail,
  getClusterMembers,
  getClusterSummaries,
} from '../../../lib/taste-read';
import { isMutedToday } from '../../../lib/mutes';
import { formatDuration, toLocalDateTime } from '../../../lib/time';

export const dynamic = 'force-dynamic';

interface Params {
  clusterId: string;
}

export default async function ClusterDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { clusterId: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const cluster = getClusterDetail(id);
  if (!cluster) notFound();

  const members = getClusterMembers(id, { limit: 500 });
  const { active } = getClusterSummaries();
  const reassignOptions = active.map((c) => ({ id: c.id, label: c.label }));
  const mergeCandidates = active.map((c) => ({
    id: c.id,
    label: c.label,
    memberCount: c.memberCount,
  }));
  const isRetired = cluster.retiredAt !== null;
  const mutedToday = !isRetired && isMutedToday(cluster.id);
  const sourceCandidate = {
    id: cluster.id,
    label: cluster.label,
    memberCount: cluster.memberCount,
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-12">
        <Kicker>
          <Link href="/taste" className="hover:text-ink">
            ← Taste lab
          </Link>
        </Kicker>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-ink-soft">
              cluster #{cluster.id}
            </span>
            {isRetired ? (
              <span className="font-[var(--font-serif-display)] text-4xl italic">
                {cluster.label ?? '(unlabeled)'}
              </span>
            ) : (
              <ClusterLabelInput
                clusterId={cluster.id}
                initialLabel={cluster.label}
                expectedUpdatedAt={cluster.updatedAt}
              />
            )}
          </div>
          {!isRetired && (
            <div className="flex flex-col items-end gap-2">
              <WeightSlider
                clusterId={cluster.id}
                initialWeight={cluster.weight}
                expectedUpdatedAt={cluster.updatedAt}
              />
              <MuteTodayButton
                clusterId={cluster.id}
                initiallyMuted={mutedToday}
              />
            </div>
          )}
        </div>
        <p className="mt-2 font-sans text-xs text-ink-soft">
          {cluster.memberCount} {cluster.memberCount === 1 ? 'member' : 'members'}
          {cluster.fuzzyCount > 0 ? ` · ${cluster.fuzzyCount} fuzzy` : ''}
          {' · updated '}
          {toLocalDateTime(cluster.updatedAt)}
          {isRetired && cluster.retiredAt
            ? ` · retired ${toLocalDateTime(cluster.retiredAt)}`
            : ''}
        </p>

        {!isRetired && (
          <div className="mt-4 flex flex-wrap gap-2">
            <MergeDialog
              source={sourceCandidate}
              expectedUpdatedAt={cluster.updatedAt}
              candidates={mergeCandidates}
            />
            <SplitDialog
              clusterId={cluster.id}
              memberCount={cluster.memberCount}
              expectedUpdatedAt={cluster.updatedAt}
            />
            <RetireConfirm
              clusterId={cluster.id}
              expectedUpdatedAt={cluster.updatedAt}
            />
          </div>
        )}
      </header>

      <Rule thick className="my-10" />

      <section>
        <Kicker>Members</Kicker>
        {members.length === 0 ? (
          <p className="mt-3 font-[var(--font-serif-display)] text-xl italic text-ink-soft">
            No members assigned to this cluster.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-rule">
            {members.map((m) => (
              <li
                key={m.videoId}
                className="grid grid-cols-[120px_1fr_auto] items-start gap-4 py-3"
              >
                <Link href={`/watch/${m.videoId}`} className="block">
                  {m.thumbnailUrl ? (
                    <DuotoneThumbnail src={m.thumbnailUrl} alt={m.title} />
                  ) : (
                    <div
                      className="bg-rule"
                      style={{ aspectRatio: '16/9' }}
                      aria-label={m.title}
                    />
                  )}
                </Link>
                <div className="min-w-0">
                  <Link
                    href={`/watch/${m.videoId}`}
                    className="block font-[var(--font-serif-display)] text-base italic leading-snug hover:text-oxblood"
                  >
                    {m.title}
                  </Link>
                  <p className="mt-1 font-sans text-xs text-ink-soft">
                    {m.channelName ?? 'unknown channel'}
                    {m.durationSeconds
                      ? ` · ${formatDuration(m.durationSeconds)}`
                      : ''}
                    {m.publishedAt ? ` · ${m.publishedAt.slice(0, 10)}` : ''}
                    {m.consumptionStatus
                      ? ` · ${m.consumptionStatus}`
                      : ''}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-ink-soft/80">
                    sim {m.similarity.toFixed(3)}
                    {m.isFuzzy ? ' · fuzzy' : ''}
                  </p>
                </div>
                {!isRetired && (
                  <div className="pt-1">
                    <ReassignPopover
                      videoId={m.videoId}
                      currentClusterId={cluster.id}
                      options={reassignOptions}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
