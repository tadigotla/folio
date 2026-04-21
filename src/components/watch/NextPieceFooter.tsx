import Link from 'next/link';
import { Kicker } from '../ui/Kicker';
import { formatDuration } from '../../lib/time';
import type { IssueVideo } from '../../lib/issue';

interface Props {
  sectionName: string | null;
  nextInSection: IssueVideo[];
  alsoInIssue: IssueVideo[];
}

function Row({ v }: { v: IssueVideo }) {
  const duration = formatDuration(v.duration_seconds);
  return (
    <li className="border-b" style={{ borderColor: 'var(--color-rule)' }}>
      <Link
        href={`/watch/${encodeURIComponent(v.id)}`}
        className="group flex items-baseline gap-3 py-2"
      >
        <span className="shrink-0 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-oxblood">
          {(v.section_name ?? 'UNSORTED').toUpperCase()}
        </span>
        <span className="flex-1 truncate font-[var(--font-serif-body)] text-base group-hover:text-oxblood">
          {v.title}
        </span>
        <span className="shrink-0 italic text-sage text-xs">
          {v.channel_name}
        </span>
        {duration && (
          <span className="shrink-0 font-mono text-xs text-ink-soft">
            {duration}
          </span>
        )}
      </Link>
    </li>
  );
}

export function NextPieceFooter({
  sectionName,
  nextInSection,
  alsoInIssue,
}: Props) {
  const sectionLabel = sectionName ? sectionName.toUpperCase() : 'UNSORTED';
  return (
    <footer className="grid grid-cols-1 gap-10 md:grid-cols-2">
      <div>
        <Kicker withRule>Next in {sectionLabel}</Kicker>
        {nextInSection.length === 0 ? (
          <p className="mt-4 italic text-sage">Nothing else queued here.</p>
        ) : (
          <ul className="mt-4">
            {nextInSection.map((v) => (
              <Row key={v.id} v={v} />
            ))}
          </ul>
        )}
      </div>
      <div>
        <Kicker withRule>Also in this issue</Kicker>
        {alsoInIssue.length === 0 ? (
          <p className="mt-4 italic text-sage">You&apos;ve seen the rest.</p>
        ) : (
          <ul className="mt-4">
            {alsoInIssue.map((v) => (
              <Row key={v.id} v={v} />
            ))}
          </ul>
        )}
      </div>
    </footer>
  );
}
