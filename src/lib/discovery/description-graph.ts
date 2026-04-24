export type CandidateKind = 'video' | 'channel';
export type CandidateSourceKind =
  | 'description_link'
  | 'description_handle'
  | 'transcript_link';

export interface ParsedRef {
  kind: CandidateKind;
  targetId: string;
  sourceKind: CandidateSourceKind;
}

export interface ExtractInput {
  id: string;
  description: string | null;
  transcriptText?: string | null;
}

const VIDEO_ID_RE = /[A-Za-z0-9_-]{11}/;
const CHANNEL_ID_RE = /UC[A-Za-z0-9_-]{22}/;
const HANDLE_RE = /[A-Za-z0-9][A-Za-z0-9._-]{1,29}/;

function dedupe(refs: ParsedRef[]): ParsedRef[] {
  const seen = new Set<string>();
  const out: ParsedRef[] = [];
  for (const r of refs) {
    const key = `${r.kind}:${r.targetId}:${r.sourceKind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function scanText(
  text: string,
  origin: 'description' | 'transcript',
): ParsedRef[] {
  const out: ParsedRef[] = [];
  const linkSourceKind: CandidateSourceKind =
    origin === 'description' ? 'description_link' : 'transcript_link';

  const youtubeDotCom =
    /(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(watch\?[^\s"'<>]*v=([A-Za-z0-9_-]{11})|channel\/(UC[A-Za-z0-9_-]{22})|@([A-Za-z0-9][A-Za-z0-9._-]{1,29}))/gi;
  let m: RegExpExecArray | null;
  while ((m = youtubeDotCom.exec(text)) !== null) {
    if (m[2]) {
      out.push({ kind: 'video', targetId: m[2], sourceKind: linkSourceKind });
    } else if (m[3]) {
      out.push({ kind: 'channel', targetId: m[3], sourceKind: linkSourceKind });
    } else if (m[4]) {
      out.push({
        kind: 'channel',
        targetId: `@${m[4]}`,
        sourceKind:
          origin === 'description'
            ? 'description_handle'
            : 'transcript_link',
      });
    }
  }

  const shortLink = /(?:https?:\/\/)?youtu\.be\/([A-Za-z0-9_-]{11})/gi;
  while ((m = shortLink.exec(text)) !== null) {
    out.push({ kind: 'video', targetId: m[1], sourceKind: linkSourceKind });
  }

  // Bare @handle mentions — only in description, and only if surrounding
  // ±50 chars contain "youtube" (case-insensitive). Skip anything preceded by
  // "/" or "@" (to avoid re-matching URL handles already caught above).
  if (origin === 'description') {
    const bare = new RegExp(`(?<![/@A-Za-z0-9_])@(${HANDLE_RE.source})`, 'g');
    while ((m = bare.exec(text)) !== null) {
      const handle = m[1];
      const start = Math.max(0, m.index - 50);
      const end = Math.min(text.length, m.index + m[0].length + 50);
      const window = text.slice(start, end).toLowerCase();
      if (!window.includes('youtube')) continue;
      out.push({
        kind: 'channel',
        targetId: `@${handle}`,
        sourceKind: 'description_handle',
      });
    }
  }

  return out;
}

export function extractCandidates(video: ExtractInput): ParsedRef[] {
  const refs: ParsedRef[] = [];
  if (video.description && video.description.trim()) {
    refs.push(...scanText(video.description, 'description'));
  }
  if (video.transcriptText && video.transcriptText.trim()) {
    refs.push(...scanText(video.transcriptText, 'transcript'));
  }
  // Drop self-references (a video linking to itself).
  const filtered = refs.filter(
    (r) => !(r.kind === 'video' && r.targetId === video.id),
  );
  return dedupe(filtered);
}

// Re-exported for test hooks and consumers that want the shapes only.
export const _internals = { VIDEO_ID_RE, CHANNEL_ID_RE, HANDLE_RE };
