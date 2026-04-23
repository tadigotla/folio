import Link from 'next/link';
import { Kicker } from '../ui/Kicker';
import { formatDuration } from '../../lib/time';
import type { VideoWithConsumption } from '../../lib/consumption';

interface Props {
  next: VideoWithConsumption[];
}

function Row({ v }: { v: VideoWithConsumption }) {
  const duration = formatDuration(v.duration_seconds);
  return (
    <li className="border-b" style={{ borderColor: 'var(--color-rule)' }}>
      <Link
        href={`/watch/${encodeURIComponent(v.id)}`}
        className="group flex items-baseline gap-3 py-2"
      >
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

export function NextPieceFooter({ next }: Props) {
  return (
    <footer>
      <Kicker withRule>Next up</Kicker>
      {next.length === 0 ? (
        <p className="mt-4 italic text-sage">Nothing else queued.</p>
      ) : (
        <ul className="mt-4">
          {next.map((v) => (
            <Row key={v.id} v={v} />
          ))}
        </ul>
      )}
    </footer>
  );
}
