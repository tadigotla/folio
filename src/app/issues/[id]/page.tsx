import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIssueById, getIssueSlots, type SlotVideo } from '../../../lib/issues';
import { toLocalDateTime, formatDuration } from '../../../lib/time';
import { TopNav } from '../../../components/issue/TopNav';
import { DuotoneThumbnail } from '../../../components/DuotoneThumbnail';
import { Rule } from '../../../components/ui/Rule';
import type { SlotKind } from '../../../lib/types';

export const dynamic = 'force-dynamic';

function findSlot(
  slots: SlotVideo[],
  kind: SlotKind,
  index: number,
): SlotVideo | null {
  return (
    slots.find((s) => s.slot_kind === kind && s.slot_index === index) ?? null
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center border border-dashed border-rule bg-paper/40 aspect-[16/9] text-ink-soft/60">
      <span className="font-sans text-xs uppercase tracking-[0.16em]">
        {label}
      </span>
    </div>
  );
}

function BriefPlaceholder() {
  return (
    <div className="flex items-center justify-center border border-dashed border-rule bg-paper/40 min-h-[64px] text-ink-soft/60 px-3 py-2">
      <span className="font-sans text-[10px] uppercase tracking-[0.16em]">
        Brief
      </span>
    </div>
  );
}

function thumb(slot: SlotVideo): string {
  return (
    slot.thumbnail_url ?? `https://i.ytimg.com/vi/${slot.video_id}/hqdefault.jpg`
  );
}

export default async function PublishedIssuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const issue = getIssueById(id);
  if (!issue || issue.status !== 'published') notFound();

  const slots = getIssueSlots(id);
  const cover = findSlot(slots, 'cover', 0);
  const featured = [0, 1, 2].map((i) => findSlot(slots, 'featured', i));
  const briefs = Array.from({ length: 10 }, (_, i) =>
    findSlot(slots, 'brief', i),
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <div className="pt-6">
        <TopNav />
      </div>

      <header className="mt-10">
        <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
          {issue.published_at
            ? toLocalDateTime(issue.published_at)
            : 'Published'}
        </div>
        <h1 className="mt-2 font-[var(--font-serif-display)] text-6xl font-medium italic tracking-tight">
          {issue.title ?? `Issue #${issue.id}`}
        </h1>
        <p className="mt-2 italic text-ink-soft">
          {slots.length} of 14 slots filled.
        </p>
      </header>

      <Rule thick className="my-10" />

      <section className="mb-12">
        {cover ? (
          <Link href={`/watch/${encodeURIComponent(cover.video_id)}`}>
            <div className="relative">
              <DuotoneThumbnail src={thumb(cover)} alt={cover.title} aspect="16/9" />
              {formatDuration(cover.duration_seconds) && (
                <span className="absolute bottom-3 right-3 bg-ink/80 px-2 py-1 font-mono text-xs text-paper">
                  {formatDuration(cover.duration_seconds)}
                </span>
              )}
            </div>
            <div className="mt-4">
              <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
                {cover.channel_name}
              </div>
              <h2 className="mt-1 font-[var(--font-serif-display)] text-4xl italic leading-tight hover:text-oxblood">
                {cover.title}
              </h2>
            </div>
          </Link>
        ) : (
          <Placeholder label="Cover" />
        )}
      </section>

      <section className="mb-12">
        <div className="mb-3 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          Featured
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {featured.map((s, i) =>
            s ? (
              <Link
                key={i}
                href={`/watch/${encodeURIComponent(s.video_id)}`}
                className="group block"
              >
                <div className="relative">
                  <DuotoneThumbnail src={thumb(s)} alt={s.title} aspect="16/9" />
                  {formatDuration(s.duration_seconds) && (
                    <span className="absolute bottom-2 right-2 bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] text-paper">
                      {formatDuration(s.duration_seconds)}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                    {s.channel_name}
                  </div>
                  <h3 className="mt-0.5 font-[var(--font-serif-display)] text-lg leading-snug group-hover:text-oxblood">
                    {s.title}
                  </h3>
                </div>
              </Link>
            ) : (
              <Placeholder key={i} label={`Featured ${i + 1}`} />
            ),
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          Briefs
        </div>
        <div className="flex flex-col divide-y divide-rule">
          {briefs.map((s, i) =>
            s ? (
              <Link
                key={i}
                href={`/watch/${encodeURIComponent(s.video_id)}`}
                className="group flex items-center gap-4 py-3"
              >
                <div className="w-[100px] shrink-0">
                  <DuotoneThumbnail
                    src={thumb(s)}
                    alt={s.title}
                    aspect="16/9"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                    {s.channel_name}
                  </div>
                  <h4 className="font-[var(--font-serif-display)] text-base leading-snug group-hover:text-oxblood">
                    {s.title}
                  </h4>
                </div>
                {formatDuration(s.duration_seconds) && (
                  <span className="font-mono text-[10px] text-ink-soft">
                    {formatDuration(s.duration_seconds)}
                  </span>
                )}
              </Link>
            ) : (
              <div key={i} className="py-3">
                <BriefPlaceholder />
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
