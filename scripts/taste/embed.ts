import { runMigrations } from '../../src/lib/db';
import {
  buildEmbedInputText,
  embed,
  getActiveEmbeddingConfig,
  listVideosMissingEmbedding,
  openaiBatchSize,
  localBatchSize,
  storeEmbedding,
} from '../../src/lib/embeddings';

async function main() {
  runMigrations();
  const cfg = getActiveEmbeddingConfig();
  const pending = listVideosMissingEmbedding(cfg);
  console.log(
    `[embed] ${pending.length} videos missing embedding (provider=${cfg.provider} model=${cfg.model})`
  );
  if (pending.length === 0) return;

  const batchSize = cfg.provider === 'openai' ? openaiBatchSize() : localBatchSize();
  let done = 0;

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const inputs = batch.map(buildEmbedInputText);
    const vecs = await embed(inputs, cfg);
    if (vecs.length !== batch.length) {
      throw new Error(`embed() returned ${vecs.length} vectors for ${batch.length} inputs`);
    }
    for (let j = 0; j < batch.length; j++) {
      storeEmbedding(batch[j].id, cfg.provider, cfg.model, vecs[j]);
    }
    done += batch.length;
    console.log(`[embed] ${done}/${pending.length}`);
  }

  console.log(`[embed] done. embedded=${done}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
