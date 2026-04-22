import { runMigrations } from '../../src/lib/db';
import {
  enrichOne,
  getOllamaConfig,
  listVideosMissingEnrichment,
  OllamaUnavailableError,
  storeEnrichment,
} from '../../src/lib/enrichment';

async function main() {
  runMigrations();
  const { model } = getOllamaConfig();

  const pending = listVideosMissingEnrichment();
  console.log(`[enrich] ${pending.length} videos missing enrichment (model=${model})`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    try {
      const result = await enrichOne({
        videoId: row.id,
        title: row.title,
        channel: row.channel,
        description: row.description,
        transcript: row.transcript,
      });
      if (!result) {
        fail++;
        console.warn(`[enrich] ${row.id} "${row.title.slice(0, 60)}" — unparseable`);
      } else {
        storeEnrichment(row.id, model, result);
        ok++;
      }
    } catch (err) {
      if (err instanceof OllamaUnavailableError) {
        console.error(`[enrich] ${err.message}`);
        process.exit(1);
      }
      fail++;
      console.warn(`[enrich] ${row.id} — ${String(err).slice(0, 200)}`);
    }

    if ((i + 1) % 10 === 0) {
      console.log(`[enrich] ${i + 1}/${pending.length}  ok=${ok} fail=${fail}`);
    }
  }

  console.log(`[enrich] done. enriched=${ok} failed=${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
