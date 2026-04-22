import { runMigrations, getDb } from '../../src/lib/db';
import { fetchTranscript, storeTranscript, sleep } from '../../src/lib/transcripts';

async function main() {
  runMigrations();
  const db = getDb();

  const videos = db
    .prepare(
      `SELECT v.id FROM videos v
         LEFT JOIN video_transcripts t ON t.video_id = v.id
       WHERE t.video_id IS NULL
       ORDER BY v.first_seen_at DESC`
    )
    .all() as { id: string }[];

  console.log(`[transcripts] ${videos.length} videos without transcripts`);

  let ok = 0;
  let miss = 0;
  for (let i = 0; i < videos.length; i++) {
    const { id } = videos[i];
    const t = await fetchTranscript(id);
    if (t) {
      storeTranscript(id, t);
      ok++;
    } else {
      miss++;
    }
    if ((i + 1) % 25 === 0) {
      console.log(`[transcripts] ${i + 1}/${videos.length}  ok=${ok} miss=${miss}`);
    }
    // Be polite to YouTube — small jitter between requests.
    await sleep(250 + Math.floor(Math.random() * 250));
  }

  console.log(`[transcripts] done. fetched=${ok} missing=${miss}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
