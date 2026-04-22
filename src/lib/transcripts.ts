import { YoutubeTranscript } from 'youtube-transcript';
import { getDb } from './db';

export interface FetchedTranscript {
  text: string;
  language: string;
  source: 'youtube-captions';
}

export async function fetchTranscript(videoId: string): Promise<FetchedTranscript | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    if (!segments || segments.length === 0) return null;

    const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    // youtube-transcript does not expose language on the return type; assume
    // requested language since we asked for 'en'. A future improvement could
    // inspect available tracks.
    return { text, language: 'en', source: 'youtube-captions' };
  } catch {
    return null;
  }
}

export function storeTranscript(videoId: string, t: FetchedTranscript): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO video_transcripts
       (video_id, source, language, text, fetched_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(videoId, t.source, t.language, t.text, new Date().toISOString());
}

export function hasTranscript(videoId: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT 1 FROM video_transcripts WHERE video_id = ?')
    .get(videoId);
  return !!row;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
