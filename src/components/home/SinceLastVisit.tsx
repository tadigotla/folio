import { getLatestDigest } from '../../lib/nightly/read';
import { Kicker } from '../ui/Kicker';

export function SinceLastVisit() {
  const digest = getLatestDigest();
  if (!digest) return null;

  return (
    <section className="mt-8">
      <Kicker>Since last visit</Kicker>
      <p className="mt-3 font-[var(--font-serif-display)] text-lg italic leading-snug text-ink-soft">
        {digest.notes}
      </p>
    </section>
  );
}
