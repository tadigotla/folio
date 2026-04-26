import Link from 'next/link';
import type { CandidateRow } from '../../lib/discovery/read';
import { CandidateActions } from './CandidateActions';

interface Props {
  candidate: CandidateRow;
}

export function CandidateCard({ candidate }: Props) {
  const title = candidate.title || candidate.target_id;
  const channel = candidate.channel_name || '';
  const score = candidate.score.toFixed(2);
  const sourceTitle = candidate.source_video_title || candidate.source_video_id;

  return (
    <article className="border border-rule bg-paper px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
          {candidate.kind} · {candidate.target_id}
        </div>
        <div className="font-sans text-[10px] italic text-ink-soft">
          score {score}
        </div>
      </div>
      <h3 className="mt-2 font-[var(--font-serif-display)] text-xl italic leading-snug text-ink">
        {title}
      </h3>
      {channel && (
        <p className="mt-1 font-sans text-xs text-ink-soft">{channel}</p>
      )}
      {candidate.source_video_id && (
        <p className="mt-2 font-sans text-[11px] italic text-ink-soft">
          from{' '}
          <Link
            href={`/watch/${candidate.source_video_id}`}
            className="underline hover:text-ink"
          >
            {sourceTitle}
          </Link>
        </p>
      )}
      <div className="mt-4">
        <CandidateActions candidateId={candidate.id} />
      </div>
    </article>
  );
}
