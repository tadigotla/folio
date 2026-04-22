import Link from 'next/link';
import { DuotoneThumbnail } from '../DuotoneThumbnail';
import { ClusterLabelInput } from './ClusterLabelInput';
import { WeightSlider } from './WeightSlider';
import type { ClusterSummary } from '../../lib/taste-read';

interface Props {
  cluster: ClusterSummary;
  editable?: boolean;
}

export function ClusterCard({ cluster, editable = true }: Props) {
  const isRetired = cluster.retiredAt !== null;
  const sizeNote = `${cluster.memberCount} ${cluster.memberCount === 1 ? 'member' : 'members'}`;
  const fuzzyNote =
    cluster.fuzzyCount > 0 ? `${cluster.fuzzyCount} fuzzy` : null;

  return (
    <article className="border border-rule bg-paper/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft/70">
              #{cluster.id}
            </span>
            {editable && !isRetired ? (
              <ClusterLabelInput
                clusterId={cluster.id}
                initialLabel={cluster.label}
                expectedUpdatedAt={cluster.updatedAt}
              />
            ) : (
              <span className="font-[var(--font-serif-display)] text-xl italic">
                {cluster.label ?? '(unlabeled)'}
              </span>
            )}
          </div>
          <p className="mt-1 font-sans text-xs text-ink-soft">
            {sizeNote}
            {fuzzyNote ? ` · ${fuzzyNote}` : ''}
            {isRetired && cluster.retiredAt
              ? ` · retired ${cluster.retiredAt.slice(0, 10)}`
              : ''}
          </p>
        </div>
        {editable && !isRetired && (
          <div className="shrink-0">
            <WeightSlider
              clusterId={cluster.id}
              initialWeight={cluster.weight}
              expectedUpdatedAt={cluster.updatedAt}
            />
          </div>
        )}
      </div>

      {cluster.preview.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
          {cluster.preview.map((p) => (
            <Link
              key={p.videoId}
              href={`/watch/${p.videoId}`}
              title={`${p.title}${p.channelName ? ` — ${p.channelName}` : ''} (${p.similarity.toFixed(2)})`}
              className="group block"
            >
              {p.thumbnailUrl ? (
                <DuotoneThumbnail src={p.thumbnailUrl} alt={p.title} />
              ) : (
                <div
                  className="bg-rule"
                  style={{ aspectRatio: '16/9' }}
                  aria-label={p.title}
                />
              )}
            </Link>
          ))}
        </div>
      )}

      {!isRetired && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <Link
            href={`/taste/${cluster.id}`}
            className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-oxblood"
          >
            Open cluster →
          </Link>
        </div>
      )}
    </article>
  );
}
