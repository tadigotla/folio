import { listProposedCandidates } from '../../lib/discovery/read';
import { Kicker } from '../ui/Kicker';
import { CandidateCard } from './CandidateCard';

export function ProposedRail() {
  const candidates = listProposedCandidates({ limit: 20 });
  if (candidates.length === 0) return null;

  return (
    <section className="mt-8">
      <Kicker>Proposed imports</Kicker>
      <p className="mt-2 font-sans text-xs italic text-ink-soft">
        {candidates.length} awaiting your approval
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((c) => (
          <CandidateCard key={c.id} candidate={c} />
        ))}
      </div>
    </section>
  );
}
