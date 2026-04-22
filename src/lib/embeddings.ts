import { getDb } from './db';

export type EmbeddingProvider = 'openai' | 'bge-local';

export interface ActiveEmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  host?: string;
}

const OPENAI_DEFAULT_MODEL = 'text-embedding-3-small';
const BGE_DEFAULT_MODEL = 'bge-m3';

export function getActiveEmbeddingConfig(): ActiveEmbeddingConfig {
  const provider = (process.env.EMBEDDING_PROVIDER ?? 'openai') as EmbeddingProvider;
  if (provider === 'bge-local') {
    return {
      provider,
      model: process.env.OLLAMA_EMBEDDING_MODEL ?? BGE_DEFAULT_MODEL,
      host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
    };
  }
  return { provider: 'openai', model: OPENAI_DEFAULT_MODEL };
}

async function embedOpenAI(texts: string[], model: string): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'OPENAI_API_KEY is not set. Set it or switch EMBEDDING_PROVIDER=bge-local. See RUNBOOK "Taste substrate".'
    );
  }
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    data: { index: number; embedding: number[] }[];
  };
  // Restore order by index.
  const out = new Array<number[]>(texts.length);
  for (const row of json.data) out[row.index] = row.embedding;
  return out;
}

async function embedBgeLocal(
  texts: string[],
  model: string,
  host: string
): Promise<number[][]> {
  // Ollama's embedding endpoint embeds one input per call. Batch sequentially.
  const out: number[][] = [];
  for (const text of texts) {
    const res = await fetch(`${host}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama embedding ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { embedding: number[] };
    out.push(json.embedding);
  }
  return out;
}

export async function embed(
  texts: string[],
  cfg: ActiveEmbeddingConfig = getActiveEmbeddingConfig()
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (cfg.provider === 'openai') return embedOpenAI(texts, cfg.model);
  return embedBgeLocal(texts, cfg.model, cfg.host ?? 'http://localhost:11434');
}

function floatsToBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function bufferToFloats(buf: Buffer): Float32Array {
  // better-sqlite3 hands us a Node Buffer for BLOB columns. Copy into a
  // Float32Array so downstream math works with typed arrays.
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

export function storeEmbedding(
  videoId: string,
  provider: string,
  model: string,
  vec: number[]
) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO video_embeddings
       (video_id, provider, model, dim, vec, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(videoId, provider, model, vec.length, floatsToBuffer(vec), new Date().toISOString());
}

export interface PendingEmbeddingRow {
  id: string;
  title: string;
  channel: string;
  description: string | null;
  summary: string | null;
}

export function listVideosMissingEmbedding(cfg: ActiveEmbeddingConfig): PendingEmbeddingRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT v.id, v.title, v.description, c.name AS channel,
              e.summary
         FROM videos v
         JOIN channels c ON c.id = v.channel_id
         LEFT JOIN video_enrichment e ON e.video_id = v.id
         LEFT JOIN video_embeddings emb
           ON emb.video_id = v.id
          AND emb.provider = ?
          AND emb.model = ?
        WHERE emb.video_id IS NULL
        ORDER BY v.first_seen_at DESC`
    )
    .all(cfg.provider, cfg.model) as PendingEmbeddingRow[];
}

export function buildEmbedInputText(row: PendingEmbeddingRow): string {
  const desc = (row.description ?? '').slice(0, 800);
  return [
    row.title,
    row.channel,
    desc,
    row.summary ?? '',
  ]
    .filter((s) => s && s.trim())
    .join('\n\n');
}

export function openaiBatchSize() {
  return 100;
}
export function localBatchSize() {
  return 32;
}
